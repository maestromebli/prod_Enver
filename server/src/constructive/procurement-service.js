import { all, one, run } from "../db.js";
import { recordHistory } from "../audit.js";
import { createFinanceEntriesFromProcurement } from "./finance-service.js";

export async function createProcurementFromPackage(packageId, actor) {
  const pkg = await one(`SELECT * FROM constructive_packages WHERE id = $1`, [packageId]);
  if (!pkg) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  const existing = await one(
    `SELECT id FROM procurement_requests WHERE package_id = $1 AND status NOT IN ('cancelled','rejected')`,
    [packageId]
  );
  if (existing) {
    return one(`SELECT * FROM procurement_requests WHERE id = $1`, [existing.id]);
  }

  const materials = await all(`SELECT * FROM constructive_materials WHERE package_id = $1`, [
    packageId
  ]);
  const hardware = await all(`SELECT * FROM constructive_hardware WHERE package_id = $1`, [
    packageId
  ]);

  const reqRow = await one(
    `INSERT INTO procurement_requests (order_id, position_id, package_id, status, requested_by)
     VALUES ($1,$2,$3,'draft',$4)
     RETURNING *`,
    [pkg.order_id, pkg.position_id, packageId, actor?.id || null]
  );

  let totalEstimated = 0;

  for (const m of materials) {
    await run(
      `INSERT INTO procurement_request_items
       (request_id, item_type, name, material, thickness, qty, unit, status)
       VALUES ($1,'board',$2,$2,$3,$4,$5,'draft')`,
      [reqRow.id, m.material_name, m.thickness, m.qty_estimated, m.unit || "лист"]
    );
  }

  for (const h of hardware) {
    await run(
      `INSERT INTO procurement_request_items
       (request_id, item_type, name, article, qty, unit, status)
       VALUES ($1,'hardware',$2,$3,$4,$5,'draft')`,
      [reqRow.id, h.name, h.article, h.qty, h.unit || "шт"]
    );
  }

  await run(
    `UPDATE procurement_requests SET total_estimated = $1, updated_at = now() WHERE id = $2`,
    [totalEstimated, reqRow.id]
  );

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
      summary: "На базі пакета конструктива створено закупівлю",
      orderNumber: position?.order_number,
      item: position?.item
    },
    actor
  });

  return getProcurementRequest(reqRow.id);
}

export async function getProcurementRequest(requestId) {
  const req = await one(`SELECT * FROM procurement_requests WHERE id = $1`, [requestId]);
  if (!req) return null;
  const items = await all(`SELECT * FROM procurement_request_items WHERE request_id = $1`, [
    requestId
  ]);
  return {
    id: req.id,
    orderId: req.order_id,
    positionId: req.position_id,
    packageId: req.package_id,
    status: req.status,
    totalEstimated: Number(req.total_estimated) || 0,
    totalActual: Number(req.total_actual) || 0,
    items: items.map((i) => ({
      id: i.id,
      itemType: i.item_type,
      name: i.name,
      article: i.article,
      material: i.material,
      thickness: i.thickness,
      qty: i.qty,
      unit: i.unit,
      estimatedPrice: Number(i.estimated_price) || 0,
      actualPrice: Number(i.actual_price) || 0,
      supplier: i.supplier,
      status: i.status
    }))
  };
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

  await run(`UPDATE procurement_requests SET status = $1, updated_at = now() WHERE id = $2`, [
    status,
    requestId
  ]);

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

    if (req.package_id) {
      await run(
        `UPDATE constructive_packages SET status = 'procurement_done', updated_at = now() WHERE id = $1`,
        [req.package_id]
      );
      await run(
        `UPDATE constructive_packages SET status = 'finance_ready', updated_at = now() WHERE id = $1`,
        [req.package_id]
      );
    }

    await createFinanceEntriesFromProcurement(requestId, actor);
  }

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

export async function getProcurementForPosition(positionId) {
  const req = await one(
    `SELECT * FROM procurement_requests WHERE position_id = $1 ORDER BY id DESC LIMIT 1`,
    [positionId]
  );
  if (!req) return null;
  return getProcurementRequest(req.id);
}
