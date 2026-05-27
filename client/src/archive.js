import { state } from "./state.js";

export const ORDER_DONE_STATUS = "Завершено";
export const POSITION_ARCHIVED_STATUS = "Завершено";

export function isArchivedOrder(order) {
  return String(order?.status || "").trim() === ORDER_DONE_STATUS;
}

export function archivedOrders(orders = state.orders) {
  return orders.filter(isArchivedOrder);
}

export function activeOrders(orders = state.orders) {
  return orders.filter((o) => !isArchivedOrder(o));
}

function archivedOrderKeys(orders = state.orders) {
  const ids = new Set();
  const numbers = new Set();
  for (const o of archivedOrders(orders)) {
    if (o.id != null) ids.add(Number(o.id));
    if (o.orderNumber) numbers.add(String(o.orderNumber));
  }
  return { ids, numbers };
}

export function isArchivedPosition(position, orders = state.orders) {
  if (String(position?.positionStatus || "").trim() === POSITION_ARCHIVED_STATUS) return true;
  const keys = archivedOrderKeys(orders);
  if (position?.orderId != null && keys.ids.has(Number(position.orderId))) return true;
  if (position?.orderNumber && keys.numbers.has(String(position.orderNumber))) return true;
  return false;
}

export function archivedPositions(positions = state.positions, orders = state.orders) {
  return positions.filter((p) => isArchivedPosition(p, orders));
}

export function activePositions(positions = state.positions, orders = state.orders) {
  return positions.filter((p) => !isArchivedPosition(p, orders));
}
