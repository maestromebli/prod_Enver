import { api } from "./api.js";
import { expandParentsWithChildren } from "./position-tree.js";
import { state } from "./state.js";

export function upsertPosition(position) {
  if (!position?.id) return;
  const idx = state.positions.findIndex((p) => p.id === position.id);
  if (idx >= 0) state.positions[idx] = position;
  else state.positions.push(position);
}

export function removePosition(id) {
  state.positions = state.positions.filter((p) => p.id !== id);
}

export function upsertOrder(order) {
  if (!order?.id) return;
  const idx = state.orders.findIndex((o) => o.id === order.id);
  if (idx >= 0) state.orders[idx] = order;
  else state.orders.push(order);
}

export function removeOrder(id) {
  state.orders = state.orders.filter((o) => o.id !== id);
}

/** Оновлення списків без повноекранного оверлею */
export async function refreshAppData({ includeDirectories = false } = {}) {
  const tasks = [api.getOrders(), api.getPositions(), api.getKpis()];
  if (includeDirectories) tasks.push(api.getDirectories());

  const results = await Promise.all(tasks);
  state.orders = results[0];
  state.positions = results[1];
  state.kpis = results[2];
  if (includeDirectories) state.directories = results[3];
  expandParentsWithChildren(state.positions);
  return state;
}
