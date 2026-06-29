import { all, one, run } from "../db.js";
import { recordHistory } from "../audit.js";
import {
  nextReturnStatus,
  TERMINAL_RETURN_STATUSES
} from "../../../shared/production/procurement.js";
import { addMtoProcurementItem } from "../constructive/procurement-service.js";

function mapReturn(row, extra = {}) {
  return {
    id: row.id,
    procurementItemId: row.procurement_item_id,
    positionId: row.position_id,
    reasonCode: row.reason_code,
    description: row.description,
    photos: (() => {
      try {
        return JSON.parse(row.photos_json || "[]");
      } catch {
        return [];
      }
    })(),
    status: row.status,
    supplier: row.supplier,
    claimNumber: row.claim_number,
    replacementItemId: row.replacement_item_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra
  };
}

export async function listReturnClaims({ statusFilter = "active" } = {}) {
  let where = "WHERE 1=1";
  if (statusFilter === "active") {
    where += ` AND rc.status NOT IN ('closed','rejected')`;
  } else if (statusFilter === "done") {
    where += ` AND rc.status IN ('closed','rejected')`;
  }

  const rows = await all(
    `SELECT rc.*, pri.name AS item_name, p.order_number, p.item AS position_item, p.object,
            u.name AS created_by_name
     FROM procurement_return_claims rc
     JOIN positions p ON p.id = rc.position_id
     LEFT JOIN procurement_request_items pri ON pri.id = rc.procurement_item_id
     LEFT JOIN users u ON u.id = rc.created_by
     ${where}
     ORDER BY rc.updated_at DESC, rc.id DESC`
  );

  return rows.map((r) =>
    mapReturn(r, {
      itemName: r.item_name,
      orderNumber: r.order_number,
      positionItem: r.position_item,
      object: r.object,
      createdByName: r.created_by_name,
      isActive: !TERMINAL_RETURN_STATUSES.has(r.status)
    })
  );
}

export async function getReturnClaim(id) {
  const row = await one(
    `SELECT rc.*, pri.name AS item_name, p.order_number, p.item AS position_item
     FROM procurement_return_claims rc
     JOIN positions p ON p.id = rc.position_id
     LEFT JOIN procurement_request_items pri ON pri.id = rc.procurement_item_id
     WHERE rc.id = $1`,
    [id]
  );
  if (!row) return null;
  return mapReturn(row, {
    itemName: row.item_name,
    orderNumber: row.order_number,
    positionItem: row.position_item
  });
}

export async function createReturnClaim(body, actor) {
  const positionId = Number(body.positionId);
  if (!positionId) {
    const err = new Error("Вкажіть позицію");
    err.status = 400;
    throw err;
  }

  let supplier = body.supplier || "";
  if (body.procurementItemId) {
    const item = await one(`SELECT supplier, name FROM procurement_request_items WHERE id = $1`, [
      body.procurementItemId
    ]);
    if (item?.supplier) supplier = item.supplier;
  }

  const row = await one(
    `INSERT INTO procurement_return_claims
     (procurement_item_id, position_id, reason_code, description, supplier, claim_number, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING *`,
    [
      body.procurementItemId || null,
      positionId,
      body.reasonCode || "other",
      body.description || "",
      supplier,
      body.claimNumber || "",
      actor?.id || null
    ]
  );

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    positionId
  ]);
  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: `Рекламація: ${body.description || body.reasonCode || "повернення"}`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  return getReturnClaim(row.id);
}

export async function updateReturnStatus(
  claimId,
  status,
  actor,
  { orderReplacement = false } = {}
) {
  const claim = await one(`SELECT * FROM procurement_return_claims WHERE id = $1`, [claimId]);
  if (!claim) {
    const err = new Error("Рекламацію не знайдено");
    err.status = 404;
    throw err;
  }

  const allowed = nextReturnStatus(claim.status);
  if (status && status !== claim.status && allowed !== status && status !== "rejected") {
    const err = new Error(`Недопустимий перехід статусу: ${claim.status} → ${status}`);
    err.status = 400;
    throw err;
  }

  let replacementItemId = claim.replacement_item_id;

  if ((status === "replacement_ordered" || orderReplacement) && !replacementItemId) {
    const orig = claim.procurement_item_id
      ? await one(`SELECT * FROM procurement_request_items WHERE id = $1`, [
          claim.procurement_item_id
        ])
      : null;
    const replacement = await addMtoProcurementItem(
      claim.position_id,
      {
        name: orig ? `Заміна: ${orig.name}` : "Заміна за рекламацією",
        category: orig?.category || "custom",
        article: orig?.article || "",
        qty: orig?.qty || "1",
        unit: orig?.unit || "шт",
        supplier: claim.supplier || orig?.supplier || "",
        replacesItemId: claim.procurement_item_id
      },
      actor
    );
    replacementItemId = replacement.id;
    status = status || "replacement_ordered";
  }

  await run(
    `UPDATE procurement_return_claims SET status = $1, replacement_item_id = $2, updated_at = now() WHERE id = $3`,
    [status || claim.status, replacementItemId, claimId]
  );

  if (status === "accepted" && claim.procurement_item_id) {
    await run(
      `INSERT INTO warehouse_movements (movement_type, procurement_item_id, position_id, qty, notes, actor_id)
       VALUES ('return', $1, $2, 1, $3, $4)`,
      [claim.procurement_item_id, claim.position_id, claim.description || "", actor?.id || null]
    );
  }

  return getReturnClaim(claimId);
}

export async function countOpenReturnsForPosition(positionId) {
  const row = await one(
    `SELECT COUNT(*)::int AS c FROM procurement_return_claims
     WHERE position_id = $1 AND status NOT IN ('closed','rejected')`,
    [positionId]
  );
  return Number(row?.c) || 0;
}
