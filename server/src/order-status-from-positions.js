import { all, one } from "./db.js";
import { logOrderUpdate } from "./audit.js";
import {
  deriveOrderStatusFromPositions,
  shouldUpdateOrderStatus
} from "../../shared/production/order-status-from-positions.js";

/** Оновлює статус замовлення за прогресом робочих позицій. */
export async function syncOrderStatusFromPositions(orderId, { actor = null } = {}) {
  const id = Number(orderId);
  if (!id) return { updated: false };

  const order = await one(`SELECT * FROM orders WHERE id = $1`, [id]);
  if (!order) return { updated: false, reason: "order_not_found" };

  const positions = await all(`SELECT * FROM positions WHERE order_id = $1 OR order_number = $2`, [
    id,
    order.order_number
  ]);

  const derived = deriveOrderStatusFromPositions(order, positions);
  if (!shouldUpdateOrderStatus(order.status, derived)) {
    return { updated: false, derived, current: order.status };
  }

  const updated = await one(
    `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
    [id, derived]
  );
  if (updated) {
    await logOrderUpdate(order, updated, actor);
  }
  return { updated: true, status: derived, order: updated };
}
