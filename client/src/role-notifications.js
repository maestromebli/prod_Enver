import { state } from "./state.js";
import { NOTIFICATION_TASK_STATUSES, STAGE_CLIENT_FIELD } from "@enver/shared/production/stages.js";
import { activePositions } from "./archive.js";
import { countAttentionItems } from "./attention.js";
const SOUND_COOLDOWN_MS = 2500;

const DEFAULT_CONFIG_BY_ROLE = {
  admin: { windowHours: 72, soundEnabled: true, desktopEnabled: true },
  manager: { windowHours: 48, soundEnabled: true, desktopEnabled: true },
  production: { windowHours: 24, soundEnabled: true, desktopEnabled: true },
  operator: { windowHours: 12, soundEnabled: true, desktopEnabled: true }
};

const ALLOWED_WINDOWS = [12, 24, 48, 72, 168];

let lastScopeSnapshot = null;
let lastSoundAt = 0;

function scopeKey() {
  const user = state.currentUser;
  if (!user) return "guest";
  return `${user.role}:${user.id || "unknown"}`;
}

function roleKey() {
  return state.currentUser?.role || "manager";
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

function nowMs() {
  return Date.now();
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

function configKey() {
  return `enver_notify_config:${scopeKey()}`;
}

function ordersSeenKey() {
  return `enver_seen_orders_at:${scopeKey()}`;
}

function productionSeenKey() {
  return `enver_seen_production_tasks_at:${scopeKey()}`;
}

function attentionSeenKey() {
  return `enver_seen_attention_at:${scopeKey()}`;
}

function attentionAlertCount(positions = state.positions, orders = state.orders) {
  return countAttentionItems(activePositions(positions, orders), orders);
}

function operatorSeenKey(stageKey) {
  return `enver_seen_operator_tasks_at:${scopeKey()}:${stageKey || "cutting"}`;
}

function normalizeWindowHours(value, fallback = 24) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (ALLOWED_WINDOWS.includes(n)) return n;
  return fallback;
}

export function getNotificationConfigForCurrentRole() {
  const defaults = DEFAULT_CONFIG_BY_ROLE[roleKey()] || DEFAULT_CONFIG_BY_ROLE.manager;
  try {
    const raw = localStorage.getItem(configKey());
    if (!raw) return { ...defaults };
    const parsed = JSON.parse(raw);
    return {
      windowHours: normalizeWindowHours(parsed?.windowHours, defaults.windowHours),
      soundEnabled: parsed?.soundEnabled !== false,
      desktopEnabled: parsed?.desktopEnabled !== false
    };
  } catch {
    return { ...defaults };
  }
}

export function updateNotificationConfigForCurrentRole(patch = {}) {
  const current = getNotificationConfigForCurrentRole();
  const next = {
    windowHours: normalizeWindowHours(
      patch.windowHours ?? current.windowHours,
      current.windowHours
    ),
    soundEnabled: patch.soundEnabled ?? current.soundEnabled,
    desktopEnabled: patch.desktopEnabled ?? current.desktopEnabled
  };
  try {
    localStorage.setItem(configKey(), JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

export function notificationWindowOptions() {
  return [...ALLOWED_WINDOWS];
}

function thresholdByWindow(seenAt, windowHours) {
  const windowStart = nowMs() - windowHours * 60 * 60 * 1000;
  return Math.max(Number(seenAt) || 0, windowStart);
}

export function productionTaskPositions(positions = state.positions) {
  return positions.filter((p) =>
    Object.values(STAGE_CLIENT_FIELD).some((field) => NOTIFICATION_TASK_STATUSES.has(p?.[field]))
  );
}

export function initializeRoleNotificationBaselines() {
  if (!state.currentUser) return;
  getNotificationConfigForCurrentRole();
  ensureBaseline(ordersSeenKey(), maxCreatedAt(state.orders));
  ensureBaseline(productionSeenKey(), maxCreatedAt(productionTaskPositions(state.positions)));
  ensureBaseline(attentionSeenKey(), attentionAlertCount());
}

export function initializeOperatorStageBaseline(stageKey, queue = state.operatorQueue) {
  if (!state.currentUser || !stageKey) return;
  ensureBaseline(operatorSeenKey(stageKey), maxCreatedAt(queue));
}

export function newOrderIdsForCurrentRole(orders = state.orders) {
  const seenAt = getNum(ordersSeenKey());
  const cfg = getNotificationConfigForCurrentRole();
  const threshold = thresholdByWindow(seenAt, cfg.windowHours);
  return new Set(
    orders
      .filter((order) => parseTime(order?.createdAt) > threshold)
      .map((order) => Number(order.id))
  );
}

export function newProductionTaskIdsForCurrentRole(positions = state.positions) {
  const seenAt = getNum(productionSeenKey());
  const cfg = getNotificationConfigForCurrentRole();
  const threshold = thresholdByWindow(seenAt, cfg.windowHours);
  return new Set(
    productionTaskPositions(positions)
      .filter((position) => parseTime(position?.createdAt) > threshold)
      .map((position) => Number(position.id))
  );
}

export function newOperatorQueueIdsForStage(stageKey, queue = state.operatorQueue) {
  const seenAt = getNum(operatorSeenKey(stageKey));
  const cfg = getNotificationConfigForCurrentRole();
  const threshold = thresholdByWindow(seenAt, cfg.windowHours);
  return new Set(
    queue
      .filter((position) => parseTime(position?.createdAt) > threshold)
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

export function countNewAttentionAlerts(positions = state.positions, orders = state.orders) {
  const current = attentionAlertCount(positions, orders);
  const seen = getNum(attentionSeenKey());
  return Math.max(0, current - seen);
}

export function markAttentionSeenForCurrentRole(
  positions = state.positions,
  orders = state.orders
) {
  setNum(attentionSeenKey(), attentionAlertCount(positions, orders));
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

export function reminderSnapshot({
  orders = state.orders,
  positions = state.positions,
  operatorStage = state.operatorStage,
  operatorQueue = state.operatorQueue
} = {}) {
  return {
    scope: scopeKey(),
    newOrders: countNewOrdersForCurrentRole(orders),
    newProduction: countNewProductionTasksForCurrentRole(positions),
    newOperator: operatorStage ? countNewOperatorQueueForStage(operatorStage, operatorQueue) : 0,
    attentionAlerts: countNewAttentionAlerts(positions, orders)
  };
}

function shouldPlaySound() {
  const now = nowMs();
  if (now - lastSoundAt < SOUND_COOLDOWN_MS) return false;
  lastSoundAt = now;
  return true;
}

function playReminderTone() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 880;
    gain.gain.value = 0.0001;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t0 = ctx.currentTime;
    gain.gain.exponentialRampToValueAtTime(0.08, t0 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
    osc.start(t0);
    osc.stop(t0 + 0.3);
  } catch {
    /* ignore */
  }
}

function composeDesktopBody(snapshot) {
  const parts = [];
  if (snapshot.newOrders > 0) parts.push(`замовлень: ${snapshot.newOrders}`);
  if (snapshot.newProduction > 0) parts.push(`виробничих задач: ${snapshot.newProduction}`);
  if (snapshot.newOperator > 0) parts.push(`операторських задач: ${snapshot.newOperator}`);
  if (snapshot.attentionAlerts > 0) parts.push(`потребує уваги: ${snapshot.attentionAlerts}`);
  return parts.join(" · ");
}

export async function ensureDesktopPermissionIfEnabled() {
  const cfg = getNotificationConfigForCurrentRole();
  if (!cfg.desktopEnabled) return "disabled";
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "granted") return "granted";
  if (Notification.permission === "denied") return "denied";
  try {
    return await Notification.requestPermission();
  } catch {
    return "default";
  }
}

export async function emitRoleNotifications(snapshot = reminderSnapshot()) {
  if (!state.currentUser) return;
  if (!lastScopeSnapshot || lastScopeSnapshot.scope !== snapshot.scope) {
    lastScopeSnapshot = { ...snapshot };
    return;
  }

  const hasIncrease =
    snapshot.newOrders > lastScopeSnapshot.newOrders ||
    snapshot.newProduction > lastScopeSnapshot.newProduction ||
    snapshot.newOperator > lastScopeSnapshot.newOperator ||
    snapshot.attentionAlerts > lastScopeSnapshot.attentionAlerts;
  lastScopeSnapshot = { ...snapshot };
  if (!hasIncrease) return;

  const cfg = getNotificationConfigForCurrentRole();
  if (cfg.soundEnabled && shouldPlaySound()) {
    playReminderTone();
  }

  if (!cfg.desktopEnabled || typeof Notification === "undefined") return;
  if (Notification.permission !== "granted") return;
  const body = composeDesktopBody(snapshot);
  if (!body) return;
  try {
    new Notification("ENVER: нові елементи", { body, tag: `enver-role-${snapshot.scope}` });
  } catch {
    /* ignore */
  }
}
