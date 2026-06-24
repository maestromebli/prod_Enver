import { all, one, run } from "../db.js";
import { recordHistory } from "../audit.js";

export async function createFinanceEntriesFromProcurement(requestId, actor) {
  const req = await one(`SELECT * FROM procurement_requests WHERE id = $1`, [requestId]);
  if (!req) return [];

  const items = await all(`SELECT * FROM procurement_request_items WHERE request_id = $1`, [
    requestId
  ]);
  const entries = [];

  for (const item of items) {
    const amount = Number(item.actual_price || item.estimated_price) || 0;
    if (amount <= 0) continue;
    const type = item.item_type === "hardware" ? "hardware_cost" : "material_cost";
    const row = await one(
      `INSERT INTO finance_entries
       (order_id, position_id, package_id, procurement_request_id, type, amount, description, source, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'procurement',$8)
       RETURNING *`,
      [
        req.order_id,
        req.position_id,
        req.package_id,
        requestId,
        type,
        amount,
        item.name || item.material || "",
        actor?.id || null
      ]
    );
    entries.push(row);
  }

  return entries;
}

export async function getFinanceSummaryForPosition(positionId) {
  const rows = await all(
    `SELECT * FROM finance_entries WHERE position_id = $1 ORDER BY created_at`,
    [positionId]
  );

  const byType = {};
  let estimated = 0;
  let actual = 0;

  for (const r of rows) {
    const type = r.type || "other";
    if (!byType[type]) byType[type] = { estimated: 0, actual: 0, items: [] };
    const amt = Number(r.amount) || 0;
    byType[type].actual += amt;
    actual += amt;
    byType[type].items.push({
      id: r.id,
      amount: amt,
      currency: r.currency,
      description: r.description,
      source: r.source,
      createdAt: r.created_at
    });
  }

  const procurement = await one(
    `SELECT total_estimated, total_actual FROM procurement_requests WHERE position_id = $1 ORDER BY id DESC LIMIT 1`,
    [positionId]
  );
  if (procurement) {
    estimated = Number(procurement.total_estimated) || 0;
    if (!actual) actual = Number(procurement.total_actual) || 0;
  }

  return {
    estimated,
    actual,
    difference: actual - estimated,
    byType,
    entries: rows.map((r) => ({
      id: r.id,
      type: r.type,
      amount: Number(r.amount) || 0,
      currency: r.currency,
      description: r.description,
      source: r.source,
      createdAt: r.created_at
    }))
  };
}
