import { all, one, run, withTransaction } from "../db.js";
import { recordHistory } from "../audit.js";
import {
  canCreateProcurement,
  canMarkPackageSentToProcurement,
  hasConstructorProcurementSource,
  isValidProcurementStatusTransition,
  PROCUREMENT_ELIGIBLE_PACKAGE_STATUSES
} from "../../../shared/production/constructive-package.js";
import {
  isItemFullyReceived,
  summarizeProcurementItems
} from "../../../shared/production/procurement.js";
import { receiveItemToWarehouse } from "../warehouse/warehouse-service.js";

function mapItemRow(i, extra = {}) {
  return {
    id: i.id,
    requestId: i.request_id,
    itemType: i.item_type,
    procurementClass: i.procurement_class || "spec",
    category: i.category || "",
    name: i.name,
    article: i.article,
    material: i.material,
    thickness: i.thickness,
    qty: i.qty,
    unit: i.unit,
    qtyReceived: Number(i.qty_received) || 0,
    warehouseLocation: i.warehouse_location || "",
    expectedDeliveryDate: i.expected_delivery_date
      ? String(i.expected_delivery_date).slice(0, 10)
      : null,
    requiredByDate: i.required_by_date ? String(i.required_by_date).slice(0, 10) : null,
    requiredByStage: i.required_by_stage || "",
    replacesItemId: i.replaces_item_id ?? null,
    estimatedPrice: Number(i.estimated_price) || 0,
    actualPrice: Number(i.actual_price) || 0,
    supplier: i.supplier,
    status: i.status,
    ...extra
  };
}

function mapRequestRow(req, items = []) {
  return {
    id: req.id,
    orderId: req.order_id,
    positionId: req.position_id,
    packageId: req.package_id,
    requestKind: req.request_kind || "spec_auto",
    notes: req.notes || "",
    status: req.status,
    totalEstimated: Number(req.total_estimated) || 0,
    totalActual: Number(req.total_actual) || 0,
    items,
    summary: summarizeProcurementItems(items)
  };
}

async function loadPackageProcurementContext(packageId) {
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) return null;
  const [fileRows, materialRows, hardwareRows, procurementRow] = await Promise.all([
    all(`SELECT kind, original_name FROM constructive_package_files WHERE package_id = $1`, [
      packageId
    ]),
    all(`SELECT * FROM constructive_materials WHERE package_id = $1`, [packageId]),
    all(`SELECT * FROM constructive_hardware WHERE package_id = $1`, [packageId]),
    one(
      `SELECT id FROM procurement_requests WHERE package_id = $1 AND status NOT IN ('cancelled','rejected') ORDER BY id DESC LIMIT 1`,
      [packageId]
    )
  ]);
  return {
    package: { id: pkg.id, status: pkg.status, version: pkg.version },
    files: fileRows.map((f) => ({ kind: f.kind, originalName: f.original_name })),
    materials: materialRows.map((m) => ({
      materialName: m.material_name,
      thickness: m.thickness,
      qtyEstimated: m.qty_estimated,
      unit: m.unit,
      source: m.source
    })),
    hardware: hardwareRows.map((h) => ({
      name: h.name,
      article: h.article,
      qty: h.qty,
      unit: h.unit
    })),
    procurement: procurementRow ? { id: procurementRow.id } : null
  };
}

async function loadItemsForRequest(requestId) {
  const items = await all(`SELECT * FROM procurement_request_items WHERE request_id = $1`, [
    requestId
  ]);
  return items.map((i) => mapItemRow(i));
}

export async function getProcurementRequest(requestId) {
  const req = await one(`SELECT * FROM procurement_requests WHERE id = $1`, [requestId]);
  if (!req) return null;
  return mapRequestRow(req, await loadItemsForRequest(requestId));
}

async function syncRequestKind(requestId) {
  const rows = await all(
    `SELECT procurement_class FROM procurement_request_items WHERE request_id = $1`,
    [requestId]
  );
  if (!rows.length) return;
  const hasSpec = rows.some((r) => r.procurement_class === "spec");
  const hasMto = rows.some((r) => r.procurement_class === "mto");
  const kind = hasSpec && hasMto ? "mixed" : hasMto ? "mto_manual" : "spec_auto";
  await run(`UPDATE procurement_requests SET request_kind = $1, updated_at = now() WHERE id = $2`, [
    kind,
    requestId
  ]);
}

async function tryMarkPackageProcurementDone(positionId) {
  const pkg = await one(
    `SELECT id, status FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC LIMIT 1`,
    [positionId]
  );
  if (!pkg) return;
  const req = await one(
    `SELECT id FROM procurement_requests WHERE position_id = $1 AND status NOT IN ('cancelled','rejected') ORDER BY id DESC LIMIT 1`,
    [positionId]
  );
  if (!req) return;
  const items = await loadItemsForRequest(req.id);
  const summary = summarizeProcurementItems(items);
  if (!summary.allBlockingReceived) return;
  if (pkg.status === "procurement_done") return;
  await run(
    `UPDATE constructive_packages SET status = 'procurement_done', updated_at = now() WHERE id = $1`,
    [pkg.id]
  );
}

async function markPackageSentToProcurement(packageId, actor = null) {
  const pkg = await one(`SELECT id, status, position_id FROM constructive_packages WHERE id = $1`, [
    packageId
  ]);
  if (!pkg) return;
  if (pkg.status === "sent_to_procurement" || pkg.status === "procurement_done") return;
  if (!canMarkPackageSentToProcurement(pkg.status)) return;
  await run(
    `UPDATE constructive_packages SET status = 'sent_to_procurement', updated_at = now() WHERE id = $1`,
    [packageId]
  );
  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    pkg.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: pkg.position_id,
    action: "update",
    meta: {
      summary: "Пакет конструктива передано в закупівлю",
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });
}

const REQUEST_ITEM_STATUS_SYNC = {
  waiting_approval: "waiting_approval",
  approved: "approved",
  ordered: "ordered",
  partially_received: "partially_received",
  received: "received",
  rejected: "rejected",
  cancelled: "cancelled"
};

async function syncRequestItemsStatus(requestId, requestStatus) {
  const itemStatus = REQUEST_ITEM_STATUS_SYNC[requestStatus];
  if (!itemStatus) return;
  await run(
    `UPDATE procurement_request_items SET status = $1, updated_at = now()
     WHERE request_id = $2 AND status NOT IN ('received','cancelled')`,
    [itemStatus, requestId]
  );
}

export async function createProcurementFromPackage(packageId, actor) {
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  if (!PROCUREMENT_ELIGIBLE_PACKAGE_STATUSES.includes(pkg.status)) {
    const err = new Error(
      "Спочатку розберіть пакет конструктива — закупівля формується з Excel-специфікації"
    );
    err.status = 403;
    throw err;
  }

  const detail = await loadPackageProcurementContext(packageId);
  if (!hasConstructorProcurementSource(detail)) {
    const err = new Error(
      "Закупівля формується з XLS конструктора — додайте Excel до пакета і розберіть. Файли ЧПК не використовуються."
    );
    err.status = 400;
    throw err;
  }

  if (!canCreateProcurement(detail)) {
    if (detail?.procurement?.id) {
      return getProcurementRequest(detail.procurement.id);
    }
    const err = new Error("Немає даних для закупівлі з XLS — перевірте специфікацію");
    err.status = 400;
    throw err;
  }

  const existing = await one(
    `SELECT id FROM procurement_requests WHERE package_id = $1 AND status NOT IN ('cancelled','rejected')`,
    [packageId]
  );
  if (existing) {
    return getProcurementRequest(existing.id);
  }

  const materials = await all(
    `SELECT * FROM constructive_materials WHERE package_id = $1 AND COALESCE(source, '') != 'cnc'`,
    [packageId]
  );
  const hardware = await all(`SELECT * FROM constructive_hardware WHERE package_id = $1`, [
    packageId
  ]);

  if (!materials.length && !hardware.length) {
    const err = new Error(
      "У XLS не знайдено матеріалів чи фурнітури — оновіть Excel і розберіть пакет знову"
    );
    err.status = 400;
    throw err;
  }

  const reqRow = await one(
    `INSERT INTO procurement_requests (order_id, position_id, package_id, status, requested_by, request_kind)
     VALUES ($1,$2,$3,'draft',$4,'spec_auto')
     RETURNING *`,
    [pkg.order_id, pkg.position_id, packageId, actor?.id || null]
  );

  for (const m of materials) {
    await run(
      `INSERT INTO procurement_request_items
       (request_id, item_type, procurement_class, name, material, thickness, qty, unit, status)
       VALUES ($1,'board','spec',$2,$2,$3,$4,$5,'draft')`,
      [reqRow.id, m.material_name, m.thickness, m.qty_estimated, m.unit || "лист"]
    );
  }

  for (const h of hardware) {
    await run(
      `INSERT INTO procurement_request_items
       (request_id, item_type, procurement_class, name, article, qty, unit, status)
       VALUES ($1,'hardware','spec',$2,$3,$4,$5,'draft')`,
      [reqRow.id, h.name, h.article, h.qty, h.unit || "шт"]
    );
  }

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    pkg.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: pkg.position_id,
    action: "update",
    meta: {
      summary: `Закупівлю створено з XLS специфікації (${materials.length} матеріалів, ${hardware.length} фурнітури)`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  await markPackageSentToProcurement(packageId, actor);

  const { sendProcurementWebhook } = await import("../automation/overdue-digest.js");
  void sendProcurementWebhook(reqRow, { materials, hardware }).catch((err) =>
    console.error("[automation] procurement webhook:", err?.message || err)
  );

  return getProcurementRequest(reqRow.id);
}

async function getOrCreateActiveRequest(positionId, actor, { packageId = null } = {}) {
  const existing = await one(
    `SELECT * FROM procurement_requests WHERE position_id = $1 AND status NOT IN ('cancelled','rejected') ORDER BY id DESC LIMIT 1`,
    [positionId]
  );
  if (existing) return existing;

  const pos = await one(`SELECT order_id FROM positions WHERE id = $1`, [positionId]);
  if (!pos) {
    const err = new Error("Позицію не знайдено");
    err.status = 404;
    throw err;
  }

  return one(
    `INSERT INTO procurement_requests (order_id, position_id, package_id, status, requested_by, request_kind)
     VALUES ($1,$2,$3,'draft',$4,'mto_manual')
     RETURNING *`,
    [pos.order_id, positionId, packageId, actor?.id || null]
  );
}

export async function addMtoProcurementItem(positionId, body, actor) {
  const name = String(body?.name || "").trim();
  if (!name) {
    const err = new Error("Вкажіть назву матеріалу");
    err.status = 400;
    throw err;
  }

  const pkg = await one(
    `SELECT id FROM constructive_packages WHERE position_id = $1 ORDER BY version DESC LIMIT 1`,
    [positionId]
  );
  const req = await getOrCreateActiveRequest(positionId, actor, { packageId: pkg?.id || null });

  const row = await one(
    `INSERT INTO procurement_request_items
     (request_id, item_type, procurement_class, category, name, article, qty, unit, supplier,
      expected_delivery_date, required_by_date, required_by_stage, replaces_item_id, status)
     VALUES ($1,'accessory','mto',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'draft')
     RETURNING *`,
    [
      req.id,
      body.category || "custom",
      name,
      body.article || "",
      body.qty || "1",
      body.unit || "шт",
      body.supplier || "",
      body.expectedDeliveryDate || null,
      body.requiredByDate || null,
      body.requiredByStage || "assembly",
      body.replacesItemId || null
    ]
  );

  await syncRequestKind(req.id);

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    positionId
  ]);
  await recordHistory({
    entityType: "position",
    entityId: positionId,
    action: "update",
    meta: {
      summary: `Додано MTO: ${name}`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  return mapItemRow(row, { positionId });
}

export async function updateProcurementItem(itemId, body, _actor) {
  const item = await one(`SELECT * FROM procurement_request_items WHERE id = $1`, [itemId]);
  if (!item) {
    const err = new Error("Рядок закупівлі не знайдено");
    err.status = 404;
    throw err;
  }

  await run(
    `UPDATE procurement_request_items SET
       name = COALESCE($1, name),
       article = COALESCE($2, article),
       qty = COALESCE($3, qty),
       unit = COALESCE($4, unit),
       supplier = COALESCE($5, supplier),
       category = COALESCE($6, category),
       expected_delivery_date = COALESCE($7, expected_delivery_date),
       required_by_date = COALESCE($8, required_by_date),
       required_by_stage = COALESCE($9, required_by_stage),
       status = COALESCE($10, status),
       updated_at = now()
     WHERE id = $11`,
    [
      body.name?.trim() || null,
      body.article ?? null,
      body.qty ?? null,
      body.unit ?? null,
      body.supplier ?? null,
      body.category ?? null,
      body.expectedDeliveryDate ?? null,
      body.requiredByDate ?? null,
      body.requiredByStage ?? null,
      body.status ?? null,
      itemId
    ]
  );

  const req = await one(`SELECT position_id FROM procurement_requests WHERE id = $1`, [
    item.request_id
  ]);
  if (req?.position_id) {
    await tryMarkPackageProcurementDone(req.position_id);
  }

  const updated = await one(`SELECT * FROM procurement_request_items WHERE id = $1`, [itemId]);
  return mapItemRow(updated, { positionId: req?.position_id });
}

export async function updateProcurementStatus(
  requestId,
  status,
  actor,
  { actualPrices = [] } = {}
) {
  const req = await one(`SELECT * FROM procurement_requests WHERE id = $1`, [requestId]);
  if (!req) {
    const err = new Error("Закупівлю не знайдено");
    err.status = 404;
    throw err;
  }

  if (status && !isValidProcurementStatusTransition(req.status, status)) {
    const err = new Error(`Недопустимий перехід статусу закупівлі: ${req.status} → ${status}`);
    err.status = 400;
    throw err;
  }

  await run(`UPDATE procurement_requests SET status = $1, updated_at = now() WHERE id = $2`, [
    status,
    requestId
  ]);

  await syncRequestItemsStatus(requestId, status);

  if (status === "waiting_approval" && req.package_id) {
    await markPackageSentToProcurement(req.package_id, actor);
  }

  for (const p of actualPrices) {
    if (!p.itemId) continue;
    await run(
      `UPDATE procurement_request_items SET actual_price = $1, updated_at = now() WHERE id = $2 AND request_id = $3`,
      [Number(p.actualPrice) || 0, p.itemId, requestId]
    );
  }

  if (status === "received") {
    const items = await all(`SELECT * FROM procurement_request_items WHERE request_id = $1`, [
      requestId
    ]);
    const totalActual = items.reduce(
      (s, i) => s + Number(i.actual_price || i.estimated_price || 0),
      0
    );
    await run(`UPDATE procurement_requests SET total_actual = $1 WHERE id = $2`, [
      totalActual,
      requestId
    ]);
  }

  await tryMarkPackageProcurementDone(req.position_id);

  const position = await one(`SELECT order_number, item FROM positions WHERE id = $1`, [
    req.position_id
  ]);
  await recordHistory({
    entityType: "position",
    entityId: req.position_id,
    action: "update",
    meta: {
      summary: `Статус закупівлі: ${status}`,
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  return getProcurementRequest(requestId);
}

export async function receiveProcurementItem(itemId, { qty, location, notes } = {}, actor) {
  const result = await withTransaction(async (db) => {
    const item = await db.one(`SELECT * FROM procurement_request_items WHERE id = $1`, [itemId]);
    if (!item) {
      const err = new Error("Рядок закупівлі не знайдено");
      err.status = 404;
      throw err;
    }

    const req = await db.one(`SELECT * FROM procurement_requests WHERE id = $1`, [item.request_id]);
    const receiveQty = Number(qty) || Number(item.qty) || 1;
    const newReceived = Number(item.qty_received) + receiveQty;
    const itemStatus =
      newReceived >= Number(item.qty || 0) && Number(item.qty || 0) > 0
        ? "received"
        : "partially_received";

    await db.run(
      `UPDATE procurement_request_items SET
         qty_received = $1,
         warehouse_location = COALESCE(NULLIF($2,''), warehouse_location),
         status = $3,
         updated_at = now()
       WHERE id = $4`,
      [newReceived, location || "", itemStatus, itemId]
    );

    await receiveItemToWarehouse(
      {
        procurementItemId: itemId,
        positionId: req.position_id,
        qty: receiveQty,
        location: location || "",
        notes: notes || ""
      },
      actor,
      db
    );

    const allItems = await db.all(`SELECT * FROM procurement_request_items WHERE request_id = $1`, [
      item.request_id
    ]);
    const allReceived = allItems.every(isItemFullyReceived);
    const anyPartial = allItems.some((i) => Number(i.qty_received) > 0 && !isItemFullyReceived(i));

    let requestStatus = req.status;
    if (allReceived) requestStatus = "received";
    else if (anyPartial) requestStatus = "partially_received";
    else if (req.status === "draft") requestStatus = "ordered";

    if (requestStatus !== req.status) {
      await db.run(
        `UPDATE procurement_requests SET status = $1, updated_at = now() WHERE id = $2`,
        [requestStatus, req.id]
      );
    }

    const position = await db.one(`SELECT order_number, item FROM positions WHERE id = $1`, [
      req.position_id
    ]);
    await recordHistory({
      entityType: "position",
      entityId: req.position_id,
      action: "update",
      meta: {
        summary: `Прийнято на склад: ${item.name} (${receiveQty} ${item.unit || ""})`,
        orderNumber: position?.order_number,
        item: position?.item
      },
      actor
    });

    return { requestId: req.id, positionId: req.position_id };
  });

  await tryMarkPackageProcurementDone(result.positionId);
  return getProcurementRequest(result.requestId);
}

export async function getProcurementForPosition(positionId) {
  const req = await one(
    `SELECT * FROM procurement_requests WHERE position_id = $1 ORDER BY id DESC LIMIT 1`,
    [positionId]
  );
  if (!req) return null;
  return getProcurementRequest(req.id);
}

const TERMINAL_PROCUREMENT_STATUSES = new Set(["received", "rejected", "cancelled"]);

export async function listProcurementRequests({ statusFilter = "all" } = {}) {
  let where = "WHERE 1=1";
  if (statusFilter === "active") {
    where += ` AND pr.status NOT IN ('received','rejected','cancelled')`;
  } else if (statusFilter === "done") {
    where += ` AND pr.status IN ('received','rejected','cancelled')`;
  }

  const rows = await all(
    `SELECT pr.id, pr.order_id, pr.position_id, pr.package_id, pr.status, pr.request_kind,
            pr.total_estimated, pr.total_actual, pr.created_at, pr.updated_at,
            p.order_number, p.item, p.object, p.constructor_name AS constructor,
            o.client AS order_client,
            u.name AS requested_by_name,
            (SELECT COUNT(*)::int FROM procurement_request_items pri WHERE pri.request_id = pr.id) AS item_count,
            (SELECT COUNT(*)::int FROM procurement_request_items pri WHERE pri.request_id = pr.id AND pri.procurement_class = 'mto') AS mto_count
     FROM procurement_requests pr
     JOIN positions p ON p.id = pr.position_id
     LEFT JOIN orders o ON o.id = pr.order_id
     LEFT JOIN users u ON u.id = pr.requested_by
     ${where}
     ORDER BY pr.created_at DESC, pr.id DESC`
  );

  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    positionId: row.position_id,
    packageId: row.package_id,
    requestKind: row.request_kind || "spec_auto",
    status: row.status,
    totalEstimated: Number(row.total_estimated) || 0,
    totalActual: Number(row.total_actual) || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    orderNumber: row.order_number,
    item: row.item,
    object: row.object,
    constructor: row.constructor,
    orderClient: row.order_client,
    requestedByName: row.requested_by_name,
    itemCount: Number(row.item_count) || 0,
    mtoCount: Number(row.mto_count) || 0,
    isActive: !TERMINAL_PROCUREMENT_STATUSES.has(row.status)
  }));
}

export async function listMtoItems({ filter = "open" } = {}) {
  let where = `WHERE pri.procurement_class = 'mto' AND pr.status NOT IN ('cancelled','rejected')`;
  if (filter === "open") {
    where += ` AND pri.status NOT IN ('received','cancelled')`;
  } else if (filter === "no_date") {
    where += ` AND pri.expected_delivery_date IS NULL AND pri.status NOT IN ('received','cancelled')`;
  } else if (filter === "overdue") {
    where += ` AND pri.expected_delivery_date < CURRENT_DATE AND pri.status NOT IN ('received','cancelled')`;
  }

  const rows = await all(
    `SELECT pri.*, pr.position_id, pr.status AS request_status,
            p.order_number, p.item AS position_item, p.object
     FROM procurement_request_items pri
     JOIN procurement_requests pr ON pr.id = pri.request_id
     JOIN positions p ON p.id = pr.position_id
     ${where}
     ORDER BY pri.expected_delivery_date NULLS LAST, pri.id DESC`,
    []
  );

  return rows.map((r) =>
    mapItemRow(r, {
      positionId: r.position_id,
      orderNumber: r.order_number,
      positionItem: r.position_item,
      object: r.object,
      requestStatus: r.request_status
    })
  );
}

export async function listCalendarEvents({ from, to } = {}) {
  let where = `WHERE pri.expected_delivery_date IS NOT NULL
    AND pr.status NOT IN ('cancelled','rejected')`;
  const params = [];
  if (from) {
    params.push(from);
    where += ` AND pri.expected_delivery_date >= $${params.length}`;
  }
  if (to) {
    params.push(to);
    where += ` AND pri.expected_delivery_date <= $${params.length}`;
  }

  const rows = await all(
    `SELECT pri.*, pr.position_id, pr.status AS request_status,
            p.order_number, p.item AS position_item, p.object
     FROM procurement_request_items pri
     JOIN procurement_requests pr ON pr.id = pri.request_id
     JOIN positions p ON p.id = pr.position_id
     ${where}
     ORDER BY pri.expected_delivery_date, pri.id`,
    params
  );

  return rows.map((r) =>
    mapItemRow(r, {
      positionId: r.position_id,
      orderNumber: r.order_number,
      positionItem: r.position_item,
      object: r.object,
      requestStatus: r.request_status
    })
  );
}

export async function listPositionSummaries() {
  const rows = await all(
    `SELECT pr.position_id,
            COUNT(pri.id)::int AS total_items,
            COUNT(*) FILTER (WHERE pri.procurement_class = 'mto')::int AS mto_count,
            COUNT(*) FILTER (
              WHERE pri.expected_delivery_date < CURRENT_DATE
                AND pri.status NOT IN ('received','cancelled')
            )::int AS overdue_count,
            COUNT(*) FILTER (
              WHERE pri.category IN ('facade_agt','facade_veneer','facade_painted','sliding_system','mirror','glass','stone','custom')
                AND pri.status NOT IN ('received','cancelled')
            )::int AS blocking_count
     FROM procurement_requests pr
     JOIN procurement_request_items pri ON pri.request_id = pr.id
     WHERE pr.status NOT IN ('cancelled','rejected')
     GROUP BY pr.position_id`
  );

  const returnRows = await all(
    `SELECT position_id, COUNT(*)::int AS open_returns
     FROM procurement_return_claims
     WHERE status NOT IN ('closed','rejected')
     GROUP BY position_id`
  );
  const returnsByPos = new Map(returnRows.map((r) => [r.position_id, r.open_returns]));

  return rows.map((r) => ({
    positionId: r.position_id,
    totalItems: r.total_items,
    mtoCount: r.mto_count,
    overdueCount: r.overdue_count,
    blockingCount: r.blocking_count,
    openReturns: returnsByPos.get(r.position_id) || 0
  }));
}

export async function tryAutoCreateProcurementFromPackage(packageId, actor) {
  const detail = await loadPackageProcurementContext(packageId);
  if (!detail || !canCreateProcurement(detail)) {
    return { created: false, detail };
  }
  try {
    await createProcurementFromPackage(packageId, actor);
    return { created: true };
  } catch (err) {
    return { created: false, error: err.message };
  }
}
