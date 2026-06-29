import { all, one, run } from "../db.js";

function dbClient(db) {
  return db || { one, all, run };
}

export async function receiveItemToWarehouse(
  { procurementItemId, positionId, qty, location, notes },
  actor,
  db = null
) {
  const client = dbClient(db);
  const row = await client.one(
    `INSERT INTO warehouse_movements
     (movement_type, procurement_item_id, position_id, qty, location, notes, actor_id)
     VALUES ('inbound', $1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [procurementItemId, positionId, qty, location || "", notes || "", actor?.id || null]
  );

  await client.run(
    `INSERT INTO position_reservations (position_id, procurement_item_id, qty_reserved, status)
     VALUES ($1, $2, $3, 'reserved')
     ON CONFLICT (position_id, procurement_item_id)
     DO UPDATE SET qty_reserved = position_reservations.qty_reserved + EXCLUDED.qty_reserved,
                   updated_at = now()`,
    [positionId, procurementItemId, qty]
  );

  return {
    id: row.id,
    movementType: row.movement_type,
    procurementItemId: row.procurement_item_id,
    positionId: row.position_id,
    qty: Number(row.qty),
    location: row.location,
    notes: row.notes,
    createdAt: row.created_at
  };
}

export async function issueItemToProduction(
  { procurementItemId, positionId, qty, notes },
  actor,
  db = null
) {
  const client = dbClient(db);
  const reservation = await client.one(
    `SELECT * FROM position_reservations WHERE position_id = $1 AND procurement_item_id = $2`,
    [positionId, procurementItemId]
  );
  if (!reservation || Number(reservation.qty_reserved) < qty) {
    const err = new Error("Недостатньо зарезервованого матеріалу на складі");
    err.status = 400;
    throw err;
  }

  const row = await client.one(
    `INSERT INTO warehouse_movements
     (movement_type, procurement_item_id, position_id, qty, notes, actor_id)
     VALUES ('issue', $1, $2, $3, $4, $5)
     RETURNING *`,
    [procurementItemId, positionId, qty, notes || "", actor?.id || null]
  );

  const remaining = Number(reservation.qty_reserved) - qty;
  await client.run(
    `UPDATE position_reservations SET qty_reserved = $1, status = $2, updated_at = now()
     WHERE id = $3`,
    [remaining, remaining <= 0 ? "issued" : "reserved", reservation.id]
  );

  return {
    id: row.id,
    movementType: row.movement_type,
    procurementItemId: row.procurement_item_id,
    positionId: row.position_id,
    qty: Number(row.qty),
    createdAt: row.created_at
  };
}

export async function listPendingReceipts({ days = 7 } = {}) {
  const rows = await all(
    `SELECT pri.*, pr.position_id, pr.status AS request_status,
            p.order_number, p.item AS position_item, p.object
     FROM procurement_request_items pri
     JOIN procurement_requests pr ON pr.id = pri.request_id
     JOIN positions p ON p.id = pr.position_id
     WHERE pr.status IN ('ordered','partially_received','approved')
       AND pri.status NOT IN ('received','cancelled')
       AND (
         pri.expected_delivery_date IS NULL
         OR pri.expected_delivery_date <= CURRENT_DATE + $1::int
       )
     ORDER BY pri.expected_delivery_date NULLS LAST, pri.id`,
    [days]
  );

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    qty: r.qty,
    qtyReceived: Number(r.qty_received) || 0,
    unit: r.unit,
    expectedDeliveryDate: r.expected_delivery_date
      ? String(r.expected_delivery_date).slice(0, 10)
      : null,
    positionId: r.position_id,
    orderNumber: r.order_number,
    positionItem: r.position_item,
    object: r.object,
    supplier: r.supplier
  }));
}

export async function listWarehouseMovements({ positionId, limit = 50 } = {}) {
  const params = [];
  let where = "WHERE 1=1";
  if (positionId) {
    params.push(positionId);
    where += ` AND wm.position_id = $${params.length}`;
  }
  params.push(limit);

  const rows = await all(
    `SELECT wm.*, pri.name AS item_name, u.name AS actor_name
     FROM warehouse_movements wm
     LEFT JOIN procurement_request_items pri ON pri.id = wm.procurement_item_id
     LEFT JOIN users u ON u.id = wm.actor_id
     ${where}
     ORDER BY wm.created_at DESC
     LIMIT $${params.length}`,
    params
  );

  return rows.map((r) => ({
    id: r.id,
    movementType: r.movement_type,
    itemName: r.item_name,
    positionId: r.position_id,
    qty: Number(r.qty),
    location: r.location,
    notes: r.notes,
    actorName: r.actor_name,
    createdAt: r.created_at
  }));
}
