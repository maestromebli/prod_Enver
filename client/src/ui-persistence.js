import { TABS } from "./constants.js";
import {
  captureInstallScheduleOverlay,
  restoreInstallScheduleOverlay
} from "./install-schedule-modal.js";
import { captureOrderModalState, restoreOrderModalState } from "./orders.js";
import { capturePositionDrawerState, restorePositionDrawerState } from "./positions.js";
import { state } from "./state.js";
import { $ } from "./utils.js";

const STORAGE_KEY = "enver_ui_state";
const VERSION = 2;
const VALID_VIEWS = new Set(["main", "settings", "operator"]);
const VALID_CALENDAR_VIEWS = new Set(["month", "week", "day", "agenda"]);
const VALID_INSTALL_DISPLAY = new Set(["calendar", "list"]);

let saveTimer = null;
let scrollRestoreY = null;

function captureOverlays() {
  return {
    order: captureOrderModalState(),
    position: capturePositionDrawerState(),
    installSchedule: captureInstallScheduleOverlay()
  };
}

export function captureUiState() {
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
    installCalendar: {
      displayMode: state.installCalendar.displayMode,
      view: state.installCalendar.view,
      anchor: state.installCalendar.anchor,
      installerFilter: state.installCalendar.installerFilter ?? ""
    },
    operatorStage: state.operatorStage,
    operatorSelectedPositionId: state.operatorSelectedPositionId,
    scrollY: window.scrollY,
    overlays: captureOverlays()
  };
}

export function loadPersistedUiState() {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
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
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(captureUiState()));
  } catch {
    /* ignore quota */
  }
}

export function clearPersistedUiState() {
  sessionStorage.removeItem(STORAGE_KEY);
  scrollRestoreY = null;
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

/** Застосовує збережений стан до `state` і фільтрів у DOM. Повертає true, якщо були збережені дані. */
export function applyUiState(snapshot) {
  if (!snapshot) return false;

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

  const cal = snapshot.installCalendar;
  if (cal) {
    if (VALID_INSTALL_DISPLAY.has(cal.displayMode)) {
      state.installCalendar.displayMode = cal.displayMode;
    }
    if (VALID_CALENDAR_VIEWS.has(cal.view)) state.installCalendar.view = cal.view;
    if (cal.anchor) state.installCalendar.anchor = cal.anchor;
    if (cal.installerFilter != null) state.installCalendar.installerFilter = cal.installerFilter;
  }

  if (snapshot.operatorStage) state.operatorStage = snapshot.operatorStage;
  if (snapshot.operatorSelectedPositionId != null) {
    state.operatorSelectedPositionId = snapshot.operatorSelectedPositionId;
  }

  if (typeof snapshot.scrollY === "number" && snapshot.scrollY >= 0) {
    scrollRestoreY = snapshot.scrollY;
  }

  return true;
}

export async function restoreOverlays(snapshot) {
  const overlays = snapshot?.overlays;
  if (!overlays) return;

  if (overlays.order) restoreOrderModalState(overlays.order);
  if (overlays.position) restorePositionDrawerState(overlays.position);
  if (overlays.installSchedule) restoreInstallScheduleOverlay(overlays.installSchedule);
}

export function restoreScrollPosition() {
  if (scrollRestoreY == null) return;
  const y = scrollRestoreY;
  scrollRestoreY = null;
  requestAnimationFrame(() => {
    window.scrollTo(0, y);
  });
}

export function initUiPersistence() {
  window.addEventListener("pagehide", persistUiState);
  window.addEventListener("beforeunload", persistUiState);
  document.addEventListener("enver-ui-changed", schedulePersistUiState);
  window.addEventListener(
    "scroll",
    () => {
      schedulePersistUiState();
    },
    { passive: true }
  );
}

export function notifyUiChanged() {
  document.dispatchEvent(new CustomEvent("enver-ui-changed"));
}
