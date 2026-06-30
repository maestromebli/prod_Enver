import { TABS } from "./constants.js";
import { PRODUCTION_FLOOR_TAB, CONSTRUCTOR_DESK_TAB } from "./users-constants.js";
import { setListFilters } from "./filters.js";
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
const VERSION = 6;
const SUPPORTED_VERSIONS = new Set([3, 4, 5, 6]);
const VALID_POSITIONS_COLUMN_PRESETS = new Set(["manager", "floor", "full"]);
const VALID_VIEWS = new Set(["main", "settings", "operator"]);
const VALID_CALENDAR_VIEWS = new Set(["month", "week", "day", "agenda"]);
const VALID_INSTALL_DISPLAY = new Set(["calendar", "list"]);
const VALID_ORDERS_DISPLAY = new Set(["cards", "list", "positions"]);
const VALID_CD_ORDERS_DISPLAY = new Set(["cards", "list"]);
const LEGACY_TAB_ALIASES = {
  "Виробництво за етапами": PRODUCTION_FLOOR_TAB,
  Конструктив: CONSTRUCTOR_DESK_TAB
};

let saveTimer = null;
let persistenceScope = "main";
let scrollRestoreY = null;
let operatorScrollRestore = null;

function resolveActiveTab(tab) {
  if (!tab) return null;
  if (tab === "Позиції") return "Замовлення";
  const resolved = LEGACY_TAB_ALIASES[tab] || tab;
  return TABS.includes(resolved) ? resolved : null;
}

function migrateSnapshot(data) {
  if (!data || typeof data !== "object" || !SUPPORTED_VERSIONS.has(data.v)) return null;
  const snapshot = { ...data, v: VERSION };
  const tab = resolveActiveTab(snapshot.activeTab);
  if (tab) snapshot.activeTab = tab;
  return snapshot;
}

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
      search: state.listFilters.search ?? "",
      status: state.listFilters.status ?? "",
      responsible: state.listFilters.responsible ?? "",
      productionStageFilter: state.productionStageFilter ?? ""
    },
    showArchived: state.showArchived === true,
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
      displayMode: state.ordersView.displayMode,
      priorityFilter: state.ordersView.priorityFilter ?? "",
      detailTab: state.ordersView.detailTab ?? "overview",
      positionsColumnPreset: state.ordersView.positionsColumnPreset ?? "manager"
    },
    constructorDesk: {
      displayMode: state.constructorDesk.displayMode,
      selectedPositionId: state.constructorDesk.selectedPositionId,
      selectedOrderId: state.constructorDesk.selectedOrderId,
      workspaceTab: state.constructorDesk.workspaceTab,
      onlyMine: state.constructorDesk.onlyMine === true
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
    return migrateSnapshot(JSON.parse(raw));
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
  setListFilters({
    search: filters.search ?? "",
    status: filters.status ?? "",
    responsible: filters.responsible ?? ""
  });
  if (filters.productionStageFilter != null) {
    state.productionStageFilter = filters.productionStageFilter;
    const stageEl = $("#stageFilter");
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
  const activeTab = resolveActiveTab(snapshot.activeTab);
  if (activeTab) state.activeTab = activeTab;
  if (snapshot.activeTab === "Позиції") {
    state.ordersView.displayMode = "positions";
  }
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

  applyFilters(snapshot.filters ?? {});
  if (typeof snapshot.showArchived === "boolean") {
    state.showArchived = snapshot.showArchived;
  }
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
  if (ordersView?.priorityFilter != null) {
    state.ordersView.priorityFilter = ordersView.priorityFilter;
  }
  if (ordersView?.detailTab) {
    state.ordersView.detailTab = ordersView.detailTab;
  }
  if (
    ordersView?.positionsColumnPreset &&
    VALID_POSITIONS_COLUMN_PRESETS.has(ordersView.positionsColumnPreset)
  ) {
    state.ordersView.positionsColumnPreset = ordersView.positionsColumnPreset;
  }

  const constructorDesk = snapshot.constructorDesk;
  if (constructorDesk && VALID_CD_ORDERS_DISPLAY.has(constructorDesk.displayMode)) {
    state.constructorDesk.displayMode = constructorDesk.displayMode;
  }
  if (constructorDesk?.selectedPositionId != null) {
    const positionId = Number(constructorDesk.selectedPositionId);
    if (Number.isFinite(positionId)) {
      state.constructorDesk.selectedPositionId = positionId;
    }
  }
  if (constructorDesk?.selectedOrderId != null) {
    state.constructorDesk.selectedOrderId = constructorDesk.selectedOrderId;
  }
  if (constructorDesk?.workspaceTab === "work" || constructorDesk?.workspaceTab === "package") {
    state.constructorDesk.workspaceTab = constructorDesk.workspaceTab;
  }
  if (typeof constructorDesk?.onlyMine === "boolean") {
    state.constructorDesk.onlyMine = constructorDesk.onlyMine;
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

export { syncListFiltersToDom } from "./filters.js";

export function notifyUiChanged() {
  document.dispatchEvent(new CustomEvent("enver-ui-changed"));
}
