import { state } from "./state.js";

const STAGE_STATUS_FIELD = {
  cutting: "cuttingStatus",
  edging: "edgingStatus",
  drilling: "drillingStatus",
  assembly: "assemblyStatus"
};

const TASK_STATUSES = new Set(["Передано", "В роботі", "На паузі"]);

function scopeKey() {
  const user = state.currentUser;
  if (!user) return "guest";
  return `${user.role}:${user.id || "unknown"}`;
}

function parseTime(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function maxCreatedAt(items = []) {
  return items.reduce((max, item) => {
    const ms = parseTime(item?.createdAt);
    return ms > max ? ms : max;
  }, 0);
}

function getNum(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return 0;
    const val = Number(raw);
    return Number.isFinite(val) ? val : 0;
  } catch {
    return 0;
  }
}

function setNum(key, value) {
  try {
    localStorage.setItem(key, String(Math.max(0, Number(value) || 0)));
  } catch {
    /* ignore */
  }
}

function ensureBaseline(key, fallbackValue) {
  try {
    const existing = localStorage.getItem(key);
    if (existing == null) {
      setNum(key, fallbackValue);
    }
  } catch {
    /* ignore */
  }
}

function ordersSeenKey() {
  return `enver_seen_orders_at:${scopeKey()}`;
}

function productionSeenKey() {
  return `enver_seen_production_tasks_at:${scopeKey()}`;
}

function operatorSeenKey(stageKey) {
  return `enver_seen_operator_tasks_at:${scopeKey()}:${stageKey || "cutting"}`;
}

export function productionTaskPositions(positions = state.positions) {
  return positions.filter((p) =>
    Object.values(STAGE_STATUS_FIELD).some((field) => TASK_STATUSES.has(p?.[field]))
  );
}

export function initializeRoleNotificationBaselines() {
  if (!state.currentUser) return;
  ensureBaseline(ordersSeenKey(), maxCreatedAt(state.orders));
  ensureBaseline(productionSeenKey(), maxCreatedAt(productionTaskPositions(state.positions)));
}

export function initializeOperatorStageBaseline(stageKey, queue = state.operatorQueue) {
  if (!state.currentUser || !stageKey) return;
  ensureBaseline(operatorSeenKey(stageKey), maxCreatedAt(queue));
}

export function newOrderIdsForCurrentRole(orders = state.orders) {
  const seenAt = getNum(ordersSeenKey());
  return new Set(
    orders.filter((order) => parseTime(order?.createdAt) > seenAt).map((order) => Number(order.id))
  );
}

export function newProductionTaskIdsForCurrentRole(positions = state.positions) {
  const seenAt = getNum(productionSeenKey());
  return new Set(
    productionTaskPositions(positions)
      .filter((position) => parseTime(position?.createdAt) > seenAt)
      .map((position) => Number(position.id))
  );
}

export function newOperatorQueueIdsForStage(stageKey, queue = state.operatorQueue) {
  const seenAt = getNum(operatorSeenKey(stageKey));
  return new Set(
    queue
      .filter((position) => parseTime(position?.createdAt) > seenAt)
      .map((position) => Number(position.id))
  );
}

export function countNewOrdersForCurrentRole(orders = state.orders) {
  return newOrderIdsForCurrentRole(orders).size;
}

export function countNewProductionTasksForCurrentRole(positions = state.positions) {
  return newProductionTaskIdsForCurrentRole(positions).size;
}

export function countNewOperatorQueueForStage(stageKey, queue = state.operatorQueue) {
  return newOperatorQueueIdsForStage(stageKey, queue).size;
}

export function markOrdersSeenForCurrentRole(orders = state.orders) {
  setNum(ordersSeenKey(), maxCreatedAt(orders));
}

export function markProductionTasksSeenForCurrentRole(positions = state.positions) {
  setNum(productionSeenKey(), maxCreatedAt(productionTaskPositions(positions)));
}

export function markOperatorStageSeen(stageKey, queue = state.operatorQueue) {
  if (!stageKey) return;
  setNum(operatorSeenKey(stageKey), maxCreatedAt(queue));
}
