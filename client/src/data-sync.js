import { buildOrderGodmode } from "@enver/shared/production/godmode.js";
import {
  deriveOrderStatusFromPositions,
  shouldUpdateOrderStatus
} from "@enver/shared/production/order-status-from-positions.js";
import { api } from "./api.js";
import { expandParentsWithChildren } from "./position-tree.js";
import { invalidateProductionFloorCache } from "./production-floor.js";
import { positionsForOrder } from "./workflows.js";
import { state } from "./state.js";

/** Перерахувати godmode замовлення з актуальних позицій (замовлення — агрегат над positions). */
export function reconcileOrderFromPositions(orderId) {
  if (!orderId) return;
  const idx = state.orders.findIndex((o) => o.id === orderId);
  if (idx < 0) return;
  const order = state.orders[idx];
  const related = positionsForOrder(order, state.positions);
  const derived = deriveOrderStatusFromPositions(order, related);
  const status = shouldUpdateOrderStatus(order.status, derived) ? derived : order.status;
  const synced = { ...order, status };
  state.orders[idx] = {
    ...synced,
    godmode: buildOrderGodmode(synced, related, { planDate: order.planDate })
  };
}

function reconcileOrdersForPosition(position) {
  if (position?.orderId) {
    reconcileOrderFromPositions(position.orderId);
    return;
  }
  if (position?.orderNumber) {
    const order = state.orders.find((o) => o.orderNumber === position.orderNumber);
    if (order) reconcileOrderFromPositions(order.id);
  }
}

/** Позначити похідні кеші (цех, конструктори) як застарілі. */
export function markDerivedDataStale() {
  invalidateProductionFloorCache();
  state.constructorDesk.stale = true;
}

export function upsertPosition(position) {
  if (!position?.id) return;
  const idx = state.positions.findIndex((p) => p.id === position.id);
  if (idx >= 0) state.positions[idx] = position;
  else state.positions.push(position);
  expandParentsWithChildren(state.positions);
  reconcileOrdersForPosition(position);
  markDerivedDataStale();
}

/** Застосувати відповідь API після дії на етапі (оператор, handoff тощо). */
export function propagatePositionMutation(result) {
  const position = result?.position ?? (result?.id ? result : null);
  if (position?.id) upsertPosition(position);
}

export function removePosition(id) {
  const position = state.positions.find((p) => p.id === id);
  state.positions = state.positions.filter((p) => p.id !== id);
  if (position) reconcileOrdersForPosition(position);
  markDerivedDataStale();
}

export function upsertOrder(order) {
  if (!order?.id) return;
  const idx = state.orders.findIndex((o) => o.id === order.id);
  const related = positionsForOrder(order, state.positions);
  const merged = {
    ...order,
    godmode: order.godmode || buildOrderGodmode(order, related, { planDate: order.planDate })
  };
  if (idx >= 0) state.orders[idx] = merged;
  else state.orders.push(merged);
  markDerivedDataStale();
}

export function removeOrder(id) {
  state.orders = state.orders.filter((o) => o.id !== id);
  markDerivedDataStale();
}

/** Оновити вкладки, що читають окремі API, після зміни позицій. */
export async function syncWorkflowViews() {
  const { CONSTRUCTOR_DESK_TAB, PRODUCTION_FLOOR_TAB } = await import("./constants.js");
  const tasks = [];

  if (state.view === "main" && state.activeTab === CONSTRUCTOR_DESK_TAB) {
    const { loadConstructorDesk } = await import("./constructor-desk.js");
    tasks.push(loadConstructorDesk());
  }
  if (
    state.view === "main" &&
    (state.activeTab === PRODUCTION_FLOOR_TAB || state.activeTab === "Потребує уваги")
  ) {
    const { loadProductionFloor } = await import("./production-floor.js");
    tasks.push(loadProductionFloor());
  }
  if (state.view === "operator") {
    const { loadOperatorData } = await import("./operator-panel.js");
    tasks.push(loadOperatorData());
  }

  if (tasks.length) await Promise.all(tasks);
  state.constructorDesk.stale = false;
}

/**
 * Повне оновлення з сервера + синхронізація похідних екранів.
 * Після будь-якої мутації позиції/замовлення — єдине джерело правди.
 */
export async function refreshAppData({ includeDirectories = false, syncViews = false } = {}) {
  const tasks = [api.getOrders(), api.getPositions(), api.getKpis()];
  if (includeDirectories) tasks.push(api.getDirectories());

  const results = await Promise.all(tasks);
  state.orders = results[0];
  state.positions = results[1];
  state.kpis = results[2];
  if (includeDirectories) state.directories = results[3];
  expandParentsWithChildren(state.positions);

  for (const order of state.orders) {
    reconcileOrderFromPositions(order.id);
  }

  markDerivedDataStale();
  if (syncViews) await syncWorkflowViews();
  return state;
}

/** Після зміни на етапі: оновити позицію локально і за потреби підтягнути все з сервера. */
export async function applyWorkflowMutation(result, { fullRefresh = false } = {}) {
  propagatePositionMutation(result);
  if (fullRefresh) {
    await refreshAppData({ syncViews: true });
  } else {
    await syncWorkflowViews();
  }
}
