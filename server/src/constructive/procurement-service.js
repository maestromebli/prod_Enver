import { all, one, run } from "../db.js";
import { recordHistory } from "../audit.js";
import {
  canCreateProcurement,
  hasConstructorProcurementSource,
  isValidProcurementStatusTransition,
  PROCUREMENT_ELIGIBLE_PACKAGE_STATUSES
} from "../../../shared/production/constructive-package.js";

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

  if (status && !isValidProcurementStatusTransition(req.status, status)) {
    const err = new Error(`Недопустимий перехід статусу закупівлі: ${req.status} → ${status}`);
    err.status = 400;
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

const TERMINAL_PROCUREMENT_STATUSES = new Set(["received", "rejected", "cancelled"]);

/** Список усіх заявок на закупівлю для реєстру. */
export async function listProcurementRequests({ statusFilter = "all" } = {}) {
  const params = [];
  let where = "WHERE 1=1";
  if (statusFilter === "active") {
    where += ` AND pr.status NOT IN ('received','rejected','cancelled')`;
  } else if (statusFilter === "done") {
    where += ` AND pr.status IN ('received','rejected','cancelled')`;
  }

  const rows = await all(
    `SELECT pr.id, pr.order_id, pr.position_id, pr.package_id, pr.status,
            pr.total_estimated, pr.total_actual, pr.created_at, pr.updated_at,
            p.order_number, p.item, p.object, p.constructor_name AS constructor,
            o.client AS order_client,
            u.name AS requested_by_name,
            (SELECT COUNT(*)::int FROM procurement_request_items pri WHERE pri.request_id = pr.id) AS item_count
     FROM procurement_requests pr
     JOIN positions p ON p.id = pr.position_id
     LEFT JOIN orders o ON o.id = pr.order_id
     LEFT JOIN users u ON u.id = pr.requested_by
     ${where}
     ORDER BY pr.created_at DESC, pr.id DESC`,
    params
  );

  return rows.map((row) => ({
    id: row.id,
    orderId: row.order_id,
    positionId: row.position_id,
    packageId: row.package_id,
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
    isActive: !TERMINAL_PROCUREMENT_STATUSES.has(row.status)
  }));
}

/** Автоматично створює закупівлю після розбору XLS, якщо ще немає. */
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
