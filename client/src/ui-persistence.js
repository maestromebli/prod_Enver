import { TABS } from "./constants.js";
import {
  captureInstallScheduleOverlay,
  restoreInstallScheduleOverlay
} from "./install-schedule-modal.js";
import { captureOrderModalState, restoreOrderModalState } from "./orders.js";
import { capturePositionDrawerState, restorePositionDrawerState } from "./positions.js";
import { state } from "./state.js";
import { $ } from "./utils.js";

const STORAGE_KEYS = {
  main: "enver_ui_state",
  operator: "enver_operator_ui_state"
};
const VERSION = 4;
const VALID_VIEWS = new Set(["main", "settings", "operator"]);
const VALID_CALENDAR_VIEWS = new Set(["month", "week", "day", "agenda"]);
const VALID_INSTALL_DISPLAY = new Set(["calendar", "list"]);
const VALID_ORDERS_DISPLAY = new Set(["cards", "list"]);

let saveTimer = null;
let persistenceScope = "main";
let scrollRestoreY = null;
let operatorScrollRestore = null;

function storageKey() {
  return STORAGE_KEYS[persistenceScope] || STORAGE_KEYS.main;
}

function captureOperatorScroll() {
  return {
    queue: document.querySelector(".op-queue-list")?.scrollTop ?? 0,
    work: document.querySelector(".op-work-panel")?.scrollTop ?? 0,
    content: document.querySelector(".operator-client-content")?.scrollTop ?? 0
  };
}

function captureOverlays() {
  return {
    order: captureOrderModalState(),
    position: capturePositionDrawerState(),
    installSchedule: captureInstallScheduleOverlay()
  };
}

export function captureUiState() {
  if (persistenceScope === "operator") {
    return {
      v: VERSION,
      operatorStage: state.operatorStage,
      operatorSelectedPositionId: state.operatorSelectedPositionId,
      operatorScroll: captureOperatorScroll()
    };
  }

  return {
    v: VERSION,
    view: state.view,
    activeTab: state.activeTab,
    settingsSection: state.settingsSection,
    filters: {
      search: $("#searchInput")?.value ?? "",
      status: $("#statusFilter")?.value ?? "",
      responsible: $("#responsibleFilter")?.value ?? "",
      productionStageFilter: state.productionStageFilter ?? ""
    },
    historyEntityFilter: state.historyEntityFilter ?? "",
    expandedPositionIds: [...state.expandedPositionIds],
    expandedOrderIds: [...state.expandedOrderIds],
    installCalendar: {
      displayMode: state.installCalendar.displayMode,
      view: state.installCalendar.view,
      anchor: state.installCalendar.anchor,
      installerFilter: state.installCalendar.installerFilter ?? ""
    },
    ordersView: {
      displayMode: state.ordersView.displayMode
    },
    selectedOrderId: state.selectedOrderId,
    operatorStage: state.operatorStage,
    operatorSelectedPositionId: state.operatorSelectedPositionId,
    scrollY: window.scrollY,
    operatorScroll: captureOperatorScroll(),
    overlays: captureOverlays()
  };
}

export function loadPersistedUiState() {
  try {
    const raw = sessionStorage.getItem(storageKey());
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.v !== VERSION) return null;
    return data;
  } catch {
    return null;
  }
}

export function persistUiState() {
  try {
    sessionStorage.setItem(storageKey(), JSON.stringify(captureUiState()));
  } catch {
    /* ignore quota */
  }
}

export function clearPersistedUiState() {
  sessionStorage.removeItem(storageKey());
  scrollRestoreY = null;
  operatorScrollRestore = null;
}

export function schedulePersistUiState() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(persistUiState, 250);
}

function applyFilters(filters = {}) {
  const searchEl = $("#searchInput");
  const statusEl = $("#statusFilter");
  const responsibleEl = $("#responsibleFilter");
  const stageEl = $("#stageFilter");

  if (searchEl && filters.search != null) searchEl.value = filters.search;
  if (statusEl && filters.status != null) statusEl.value = filters.status;
  if (responsibleEl && filters.responsible != null) responsibleEl.value = filters.responsible;
  if (filters.productionStageFilter != null) {
    state.productionStageFilter = filters.productionStageFilter;
    if (stageEl) stageEl.value = filters.productionStageFilter;
  }
}

function rememberScroll(snapshot) {
  if (typeof snapshot.scrollY === "number" && snapshot.scrollY >= 0) {
    scrollRestoreY = snapshot.scrollY;
  }
  if (snapshot.operatorScroll && typeof snapshot.operatorScroll === "object") {
    operatorScrollRestore = { ...snapshot.operatorScroll };
  }
}

/** Застосовує збережений стан до `state` і фільтрів у DOM. Повертає true, якщо були збережені дані. */
export function applyUiState(snapshot) {
  if (!snapshot) return false;

  if (persistenceScope === "operator") {
    if (snapshot.operatorStage) state.operatorStage = snapshot.operatorStage;
    if (snapshot.operatorSelectedPositionId != null) {
      state.operatorSelectedPositionId = snapshot.operatorSelectedPositionId;
    }
    rememberScroll(snapshot);
    return true;
  }

  if (VALID_VIEWS.has(snapshot.view)) state.view = snapshot.view;
  if (TABS.includes(snapshot.activeTab)) state.activeTab = snapshot.activeTab;
  const settingsSections = new Set([
    "users",
    "access",
    "directories",
    "clients",
    "notifications",
    "ai"
  ]);
  if (settingsSections.has(snapshot.settingsSection)) {
    state.settingsSection = snapshot.settingsSection;
  }
  if (snapshot.activeTab === "Довідники") {
    state.view = "settings";
    state.settingsSection = "directories";
    state.activeTab = "Замовлення";
  }

  applyFilters(snapshot.filters);
  if (snapshot.historyEntityFilter != null)
    state.historyEntityFilter = snapshot.historyEntityFilter;

  if (Array.isArray(snapshot.expandedPositionIds)) {
    state.expandedPositionIds = new Set(
      snapshot.expandedPositionIds.map(Number).filter((id) => Number.isFinite(id))
    );
  }

  if (Array.isArray(snapshot.expandedOrderIds)) {
    state.expandedOrderIds = new Set(
      snapshot.expandedOrderIds.map(Number).filter((id) => Number.isFinite(id))
    );
  }

  const cal = snapshot.installCalendar;
  if (cal) {
    if (VALID_INSTALL_DISPLAY.has(cal.displayMode)) {
      state.installCalendar.displayMode = cal.displayMode;
    }
    if (VALID_CALENDAR_VIEWS.has(cal.view)) state.installCalendar.view = cal.view;
    if (cal.anchor) state.installCalendar.anchor = cal.anchor;
    if (cal.installerFilter != null) state.installCalendar.installerFilter = cal.installerFilter;
  }

  const ordersView = snapshot.ordersView;
  if (ordersView && VALID_ORDERS_DISPLAY.has(ordersView.displayMode)) {
    state.ordersView.displayMode = ordersView.displayMode;
  }

  if (snapshot.selectedOrderId != null) {
    const id = Number(snapshot.selectedOrderId);
    state.selectedOrderId = Number.isFinite(id) ? id : null;
  }

  if (snapshot.operatorStage) state.operatorStage = snapshot.operatorStage;
  if (snapshot.operatorSelectedPositionId != null) {
    state.operatorSelectedPositionId = snapshot.operatorSelectedPositionId;
  }

  rememberScroll(snapshot);
  return true;
}

export async function restoreOverlays(snapshot) {
  const overlays = snapshot?.overlays;
  if (!overlays) return;

  if (overlays.order) restoreOrderModalState(overlays.order);
  if (overlays.position) void restorePositionDrawerState(overlays.position);
  if (overlays.installSchedule) restoreInstallScheduleOverlay(overlays.installSchedule);
}

function applyOperatorScroll(snapshot) {
  if (!snapshot) return;
  const queue = document.querySelector(".op-queue-list");
  const work = document.querySelector(".op-work-panel");
  const content = document.querySelector(".operator-client-content");
  if (queue && typeof snapshot.queue === "number") queue.scrollTop = snapshot.queue;
  if (work && typeof snapshot.work === "number") work.scrollTop = snapshot.work;
  if (content && typeof snapshot.content === "number") content.scrollTop = snapshot.content;
}

function restoreScrollWithRetries(applyScroll, isDone = () => true) {
  let attempts = 0;
  const maxAttempts = 6;
  const tryRestore = () => {
    applyScroll();
    attempts += 1;
    if (attempts < maxAttempts && !isDone()) {
      requestAnimationFrame(tryRestore);
    }
  };
  requestAnimationFrame(tryRestore);
}

export function restoreScrollPosition() {
  const operatorSnapshot = operatorScrollRestore;
  const windowY = scrollRestoreY;
  scrollRestoreY = null;
  operatorScrollRestore = null;

  if (windowY != null) {
    restoreScrollWithRetries(
      () => window.scrollTo(0, windowY),
      () => Math.abs(window.scrollY - windowY) <= 2
    );
  }
  if (operatorSnapshot) {
    restoreScrollWithRetries(() => applyOperatorScroll(operatorSnapshot));
  }
}

function bindScrollPersistence() {
  window.addEventListener(
    "scroll",
    () => {
      schedulePersistUiState();
    },
    { passive: true }
  );

  document.addEventListener(
    "scroll",
    () => {
      schedulePersistUiState();
    },
    { passive: true, capture: true }
  );
}

export function initUiPersistence({ scope = "main" } = {}) {
  persistenceScope = scope === "operator" ? "operator" : "main";
  window.addEventListener("pagehide", persistUiState);
  window.addEventListener("beforeunload", persistUiState);
  document.addEventListener("enver-ui-changed", schedulePersistUiState);
  bindScrollPersistence();
}

export function notifyUiChanged() {
  document.dispatchEvent(new CustomEvent("enver-ui-changed"));
}
