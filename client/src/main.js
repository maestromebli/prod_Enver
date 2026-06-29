import { api } from "./api.js";
import {
  canViewSettings,
  initAuthFromStorage,
  isOperator,
  loadStoredUser,
  login,
  logout,
  operatorStages,
  refreshCurrentUser,
  shouldShowProductionFloorByDefault,
  canViewProcurement
} from "./auth.js";
import {
  PRODUCTION_FLOOR_TAB,
  ATTENTION_TAB,
  CONSTRUCTOR_DESK_TAB,
  PROCUREMENT_TAB
} from "./constants.js";
import { bindConstructorDeskActions, loadConstructorDesk } from "./constructor-desk.js";
import { loadProductionFloor } from "./production-floor.js";
import { loadProcurementList } from "./procurement-view.js";
import { toastError } from "./toast.js";
import { syncOperatorBuildChip } from "./operator-ui.js";
import { initOrderModal, openOrderModal, setOrderSaveHandler } from "./orders.js";
import { loadGlobalHistory } from "./history.js";
import { initPositionDrawer, setPositionSaveHandler } from "./positions.js";
import { togglePositionExpanded } from "./position-tree.js";
import {
  bindOperatorActions,
  loadOperatorData,
  shouldShowOperatorByDefault
} from "./operator-panel.js";
import { bindInstallTab } from "./install-calendar.js";
import {
  initInstallScheduleModal,
  setInstallScheduleSaveHandler
} from "./install-schedule-modal.js";
import { renderApp as paint, renderResponsibleOptions } from "./render.js";
import {
  bindSettingsActions,
  initSettingsUi,
  loadSettingsData,
  navigateToNotificationSettings,
  openSettings
} from "./settings.js";
import { refreshAppData } from "./data-sync.js";
import { redirectPureOperatorToClientPage, watchAppBuildUpdates } from "./operator-ui.js";
import {
  initializeRoleNotificationBaselines,
  primeRoleNotifications,
  reminderSnapshot,
  setRoleNotificationsReady,
  markOrdersSeenForCurrentRole,
  markAttentionSeenForCurrentRole,
  markProductionTasksSeenForCurrentRole
} from "./role-notifications.js";
import { state } from "./state.js";
import {
  applyUiState,
  clearPersistedUiState,
  initUiPersistence,
  loadPersistedUiState,
  notifyUiChanged,
  persistUiState,
  restoreOverlays,
  restoreScrollPosition,
  schedulePersistUiState
} from "./ui-persistence.js";
import { wireAppRenderBus } from "./app-bus.js";
import { applyTourHighlights, nextTourStep, startTour, stopTour } from "./tour.js";
import { initTheme } from "./theme.js";
import { hideAiAssistant, initAiAssistant } from "./ai-assistant.js";
import {
  bindGodmodeNotifyActions,
  mountGodmodeNotifyChrome,
  startGodmodeNotificationPolling,
  stopGodmodeNotificationPolling
} from "./godmode-notifications.js";
import { initOrderDetailDrawer } from "./order-detail-drawer.js";
import { openInlineAddPosition } from "./position-workspace.js";
import { initCommandPalette } from "./command-palette.js";
import { hintToast, initKeyboardShortcuts } from "./keyboard-shortcuts.js";
import { initModalFocusTraps } from "./focus-trap.js";
import { resolveDashboardNav } from "./dashboard-routes.js";
import { setListFilters } from "./filters.js";
import { $, escapeHtml } from "./utils.js";
import "./styles/manager-entry.css";

import { setAppLoading } from "./loading-ui.js";

let contentRenderTimer = null;
const CONTENT_RENDER_DELAY_MS = 180;
let bootstrapping = true;

function setLoading(visible, options) {
  setAppLoading(visible, options);
  state.loading = visible;
}

function showLoginModal(show) {
  const modal = $("#loginModal");
  if (!modal) return;
  modal.classList.toggle("open", show);
  modal.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) {
    const err = $("#loginFormError");
    err.textContent = "";
    err.classList.remove("visible");
    setLoginSubmitting(false);
    requestAnimationFrame(() => $("#loginInput")?.focus());
  }
}

function setLoginSubmitting(loading) {
  const btn = $("#loginSubmitBtn");
  const spinner = $("#loginSubmitSpinner");
  if (!btn) return;
  btn.disabled = loading;
  btn.classList.toggle("is-loading", loading);
  btn.setAttribute("aria-busy", loading ? "true" : "false");
  if (spinner) spinner.hidden = !loading;
  const text = $("#loginSubmitText");
  if (text) text.textContent = loading ? "Вхід…" : "Увійти";
}

function initLoginForm() {
  const toggle = $("#loginPasswordToggle");
  const password = $("#loginPassword");
  if (!toggle || !password) return;

  const eye = toggle.querySelector(".icon-eye");
  const eyeOff = toggle.querySelector(".icon-eye-off");

  toggle.addEventListener("click", () => {
    const visible = password.type === "text";
    password.type = visible ? "password" : "text";
    toggle.setAttribute("aria-pressed", visible ? "false" : "true");
    toggle.setAttribute("aria-label", visible ? "Показати пароль" : "Приховати пароль");
    if (eye) eye.hidden = !visible;
    if (eyeOff) eyeOff.hidden = visible;
  });
}

async function afterAuth({ restoreNavigation = false } = {}) {
  if (isOperator() && operatorStages().length === 0) {
    logout();
    throw new Error(
      "Оператору не призначено етапи. Увійдіть як admin і перевірте користувача в Налаштуваннях."
    );
  }

  if (!restoreNavigation) {
    if (shouldShowOperatorByDefault()) {
      const stages = operatorStages();
      state.view = "operator";
      state.operatorStage = stages[0];
    } else if (shouldShowProductionFloorByDefault()) {
      state.view = "main";
      state.activeTab = PRODUCTION_FLOOR_TAB;
    } else {
      state.view = "main";
    }
  } else if (state.view === "operator") {
    const stages = operatorStages();
    if (!state.operatorStage || !stages.includes(state.operatorStage)) {
      state.operatorStage = stages[0] || null;
    }
  }

  if (state.view === "operator" && state.operatorStage) {
    try {
      await loadOperatorData();
    } catch (err) {
      state.operatorQueue = [];
      state.operatorLoadError = err.message;
    }
  }

  showLoginModal(false);
  initAiAssistant({ onNavigate: handleAiNavigate });
  mountGodmodeNotifyChrome();
  bindGodmodeNotifyActions();
  startGodmodeNotificationPolling();
}

function bindContentActions() {
  document.querySelectorAll("[data-dash-open-order]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(el.dataset.dashOpenOrder);
      state.activeTab = "Замовлення";
      state.selectedOrderId = id;
      state.ordersView.detailTab = "overview";
      const { notifyUiChanged } = await import("./ui-persistence.js");
      notifyUiChanged();
      renderApp();
      window.scrollTo({ top: 0, behavior: "instant" });
    });
  });

  document.querySelectorAll("[data-edit-order]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.editOrder);
      const order = state.orders.find((o) => o.id === id);
      if (order) openOrderModal(order);
    });
  });

  document.querySelectorAll("[data-dash-nav]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const tab = el.dataset.dashNav;
      if (tab) await handleDashboardNav(tab);
    });
  });

  document.querySelectorAll("[data-dash-dismiss-onboarding]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      try {
        localStorage.setItem("enver_dashboard_onboarding_dismissed", "1");
      } catch {
        /* ignore */
      }
      renderApp({ contentOnly: true });
    });
  });

  document.querySelectorAll("[data-dash-tour-start]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const step = startTour();
      if (step?.tab) await setTab(step.tab, { ordersDisplayMode: step.ordersDisplayMode });
      else renderApp();
    });
  });

  document.querySelectorAll("[data-tour-next]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const step = nextTourStep();
      if (step?.tab) await setTab(step.tab, { ordersDisplayMode: step.ordersDisplayMode });
      else renderApp();
    });
  });

  document.querySelectorAll("[data-tour-stop]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      stopTour();
      renderApp();
    });
  });

  document.querySelectorAll("[data-edit-position]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      if (e.target.closest("[data-toggle-position], [data-add-sub-position]")) return;
      e.stopPropagation();
      const id = Number(el.dataset.editPosition);
      const { openPositionFromContext } = await import("./godmode-navigation.js");
      if (await openPositionFromContext(id)) {
        notifyUiChanged();
        renderApp();
        window.scrollTo({ top: 0, behavior: "instant" });
      }
    });
  });

  document
    .querySelectorAll(
      "tr.row-clickable[data-edit-position], .position-card[data-edit-position], .pf-problem-card[data-edit-position], tr.pf-problem-row[data-edit-position]"
    )
    .forEach((row) => {
      const openRow = async (e) => {
        if (e?.target?.closest?.("button, [data-toggle-position], [data-add-sub-position]")) return;
        e?.preventDefault?.();
        const id = Number(row.dataset.editPosition);
        const { openPositionFromContext } = await import("./godmode-navigation.js");
        if (await openPositionFromContext(id)) {
          notifyUiChanged();
          renderApp();
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      };
      row.addEventListener("click", openRow);
      row.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.target.closest("button")) return;
        void openRow(e);
      });
    });

  $("#toolbarNewOrderBtn")?.addEventListener("click", () => openOrderModal());

  document.querySelectorAll("[data-toggle-position]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      togglePositionExpanded(Number(btn.dataset.togglePosition));
      renderApp({ contentOnly: true });
    });
  });

  document.querySelectorAll("[data-add-sub-position]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (openInlineAddPosition(Number(btn.dataset.addSubPosition))) {
        renderApp();
      }
    });
  });

  $("#historyEntityFilter")?.addEventListener("change", (e) => {
    state.historyEntityFilter = e.target.value;
    renderApp({ contentOnly: true });
  });

  $("#refreshHistoryBtn")?.addEventListener("click", async () => {
    try {
      await loadGlobalHistory();
      renderApp();
    } catch (err) {
      toastError(err.message);
    }
  });

  $("#exportCsvBtn")?.addEventListener("click", () => {
    import("./export.js").then(({ exportPositionsCsv }) => exportPositionsCsv());
  });

  if (state.activeTab === "Встановлення") {
    bindInstallTab();
  }
}

function renderApp(options) {
  if (state.view === "main" && state.activeTab === "Замовлення") {
    markOrdersSeenForCurrentRole(state.orders);
  }
  if (state.view === "main" && state.activeTab === PRODUCTION_FLOOR_TAB) {
    markProductionTasksSeenForCurrentRole(state.positions);
  }
  paint(options);
  if (state.view === "main") {
    bindContentActions();
    applyTourHighlights();
  }
  schedulePersistUiState();
}

function scheduleContentRender() {
  clearTimeout(contentRenderTimer);
  contentRenderTimer = setTimeout(() => renderApp({ contentOnly: true }), CONTENT_RENDER_DELAY_MS);
}

wireAppRenderBus(renderApp);
window.__enverOpenPosition = async (id) => {
  const { openPositionFromContext } = await import("./godmode-navigation.js");
  if (await openPositionFromContext(id)) {
    notifyUiChanged();
    renderApp();
    window.scrollTo({ top: 0, behavior: "instant" });
  }
};

async function loadData({ silent = false, preserveScroll = false } = {}) {
  const blocking = bootstrapping && !silent;
  if (!silent) setLoading(true, { blocking });
  try {
    await refreshAppData({ includeDirectories: true, syncViews: true });
    initializeRoleNotificationBaselines();
    primeRoleNotifications(reminderSnapshot());
    renderResponsibleOptions();
    renderApp(silent ? { contentOnly: !preserveScroll, preserveScroll } : { preserveScroll });
  } catch (err) {
    $("#content").innerHTML = `
      <div class="note" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">
        Не вдалося завантажити дані: ${escapeHtml(err.message)}. Запустіть сервер командою <code>npm run dev</code> у корені проєкту.
      </div>
    `;
  } finally {
    if (!silent) setLoading(false);
    bootstrapping = false;
  }
}

async function prepareViewData() {
  if (
    state.view === "main" &&
    (state.activeTab === PRODUCTION_FLOOR_TAB ||
      state.activeTab === ATTENTION_TAB ||
      state.activeTab === CONSTRUCTOR_DESK_TAB)
  ) {
    try {
      await loadProductionFloor();
    } catch (err) {
      toastError(err.message);
    }
  }
  if (state.view === "settings") {
    initSettingsUi(renderApp);
    if (canViewSettings()) {
      await loadSettingsData();
      if (state.settingsSection === "directories") {
        state.directories = await api.getDirectories();
      }
    }
  }
  if (state.activeTab === CONSTRUCTOR_DESK_TAB && state.view === "main") {
    try {
      const hasDeskContext =
        state.constructorDesk.selectedPositionId != null ||
        state.constructorDesk.selectedOrderId != null;
      await loadConstructorDesk({ silent: hasDeskContext });
      if (state.constructorDesk.selectedPositionId != null) {
        const { restoreConstructorDeskSession } = await import("./constructor-desk.js");
        await restoreConstructorDeskSession();
      }
    } catch (err) {
      toastError(err.message);
    }
  }
  if (state.activeTab === "Історія змін") {
    try {
      await loadGlobalHistory();
    } catch (err) {
      state.history = [];
      toastError(`Не вдалося завантажити історію: ${err.message}`);
    }
  }
  if (state.activeTab === PROCUREMENT_TAB) {
    try {
      await loadProcurementList();
    } catch (err) {
      toastError(`Не вдалося завантажити закупівлі: ${err.message}`);
    }
  } else if (canViewProcurement() && !state.procurement?.items?.length) {
    loadProcurementList().catch(() => {});
  }
}

async function setTab(tab, { ordersDisplayMode } = {}) {
  const prevTab = state.activeTab;
  if (tab !== "Замовлення") {
    state.selectedOrderId = null;
  }
  state.activeTab = tab;
  if (tab === "Замовлення" && ordersDisplayMode) {
    state.ordersView.displayMode = ordersDisplayMode;
  }
  if (state.constructorDesk.stale && prevTab !== tab && tab === "Замовлення") {
    try {
      await refreshAppData({ syncViews: false });
    } catch (err) {
      toastError(err.message);
    }
  }
  if (tab === "Замовлення") {
    markOrdersSeenForCurrentRole(state.orders);
  }
  if (tab === ATTENTION_TAB) {
    markAttentionSeenForCurrentRole(state.positions, state.orders);
  }
  if (tab === PRODUCTION_FLOOR_TAB) {
    markProductionTasksSeenForCurrentRole(state.positions);
  }
  if (tab === CONSTRUCTOR_DESK_TAB) {
    if (prevTab !== CONSTRUCTOR_DESK_TAB) {
      state.constructorDesk.selectedOrderId = null;
      state.constructorDesk.selectedPositionId = null;
      state.constructorDesk.detail = null;
      state.constructorDesk.workspaceTab = "work";
    }
    try {
      const hasWorkspace = state.constructorDesk.selectedPositionId != null;
      await loadConstructorDesk({ silent: hasWorkspace });
      if (hasWorkspace) {
        const { restoreConstructorDeskSession } = await import("./constructor-desk.js");
        await restoreConstructorDeskSession();
      }
    } catch (err) {
      toastError(err.message);
    }
  }
  if (tab === ATTENTION_TAB || tab === PRODUCTION_FLOOR_TAB) {
    try {
      await loadProductionFloor();
    } catch (err) {
      toastError(err.message);
    }
  }
  if (tab === "Історія змін") {
    try {
      await loadGlobalHistory();
    } catch (err) {
      state.history = [];
      toastError(`Не вдалося завантажити історію: ${err.message}`);
    }
  }
  if (tab === PROCUREMENT_TAB) {
    try {
      await loadProcurementList();
    } catch (err) {
      toastError(`Не вдалося завантажити закупівлі: ${err.message}`);
    }
  }
  try {
    renderApp();
  } catch (err) {
    console.error("setTab render failed", err);
    toastError(err.message || "Не вдалося відобразити вкладку");
  }
}

function applyQuickFilters({ status = "", search = "", responsible = "" } = {}) {
  setListFilters({ search, status, responsible });
  state.productionStageFilter = "";
  state.ordersView.priorityFilter = "";
  const stageFilter = $("#stageFilter");
  if (stageFilter) stageFilter.value = "";
}

async function handleAiNavigate(destination) {
  const route = resolveDashboardNav(destination);
  applyQuickFilters({ status: route.status || "" });
  if (route.ordersDisplayMode) {
    state.ordersView.displayMode = route.ordersDisplayMode;
  }
  if (route.archived) {
    state.showArchived = true;
  } else if (destination !== "Архів") {
    state.showArchived = false;
  }
  await setTab(route.tab, { ordersDisplayMode: route.ordersDisplayMode });
}

async function handleDashboardNav(destination) {
  const route = resolveDashboardNav(destination);
  applyQuickFilters({ status: route.status || "" });
  if (route.ordersDisplayMode) {
    state.ordersView.displayMode = route.ordersDisplayMode;
  }
  if (route.archived) {
    state.showArchived = true;
  } else {
    state.showArchived = false;
  }
  await setTab(route.tab, { ordersDisplayMode: route.ordersDisplayMode });
}

async function openSettingsView() {
  if (!canViewSettings()) {
    toastError("Немає доступу до налаштувань");
    return;
  }

  initSettingsUi(renderApp);
  try {
    await loadSettingsData();
    openSettings(state.settingsSection || "users");
    renderApp();
  } catch (err) {
    toastError(err.message || "Не вдалося відкрити налаштування");
  }
}

async function openNotificationSettingsView() {
  if (!state.currentUser) return;
  navigateToNotificationSettings();
  initSettingsUi(renderApp);
  renderApp();
  persistUiState();
}

initOrderModal();
initPositionDrawer();
initOrderDetailDrawer();
initInstallScheduleModal();
initSettingsUi(renderApp);
bindSettingsActions(renderApp);
bindConstructorDeskActions(renderApp);
bindOperatorActions(renderApp);

initCommandPalette({
  focusSearch: () => $("#searchInput")?.focus(),
  setTab: (tab, options) => void setTab(tab, options),
  openSettings: () => void openSettingsView(),
  openOperatorPanel: async () => {
    const { enterOperatorView } = await import("./operator-panel.js");
    const { operatorStages } = await import("./auth.js");
    const stages = operatorStages();
    await enterOperatorView(stages[0] || "cutting");
  },
  hint: hintToast
});

initKeyboardShortcuts({
  focusSearch: () => $("#searchInput")?.focus(),
  onEscape: () => {
    document.querySelector(".modal-backdrop.open")?.classList.remove("open");
  }
});

initModalFocusTraps();

async function reloadAfterSave() {
  try {
    setLoading(true);
    await loadData({ silent: true });
    if (state.activeTab === "Історія змін") {
      try {
        await loadGlobalHistory();
        renderApp({ contentOnly: true });
      } catch {
        /* ignore */
      }
    }
    if (state.view === "operator") {
      await loadOperatorData();
      renderApp();
    }
  } catch (err) {
    toastError(err.message);
  } finally {
    setLoading(false);
  }
}

setOrderSaveHandler(reloadAfterSave);
setPositionSaveHandler(reloadAfterSave);
setInstallScheduleSaveHandler(reloadAfterSave);

$("#tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) setTab(btn.dataset.tab);
});

$("#searchInput")?.addEventListener("input", (e) => {
  state.listFilters.search = e.target.value;
  scheduleContentRender();
});
$("#statusFilter")?.addEventListener("change", (e) => {
  state.listFilters.status = e.target.value;
  renderApp({ contentOnly: true });
});
$("#responsibleFilter")?.addEventListener("change", (e) => {
  state.listFilters.responsible = e.target.value;
  renderApp({ contentOnly: true });
});
$("#stageFilter")?.addEventListener("change", (e) => {
  if (state.activeTab === "Замовлення") {
    state.ordersView.priorityFilter = e.target.value;
  } else {
    state.productionStageFilter = e.target.value;
  }
  renderApp({ contentOnly: true });
});

$("#resetBtn")?.addEventListener("click", () => {
  setListFilters({ search: "", status: "", responsible: "" });
  state.productionStageFilter = "";
  state.ordersView.priorityFilter = "";
  state.showArchived = false;
  if ($("#stageFilter")) $("#stageFilter").value = "";
  renderApp({ contentOnly: true });
});

$("#settingsGearBtn")?.addEventListener("click", () => openSettingsView());
$("#notifySettingsBtn")?.addEventListener("click", () => openNotificationSettingsView());

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-open-notify-settings]")) {
    void openNotificationSettingsView();
  }
});

$("#logoutBtn")?.addEventListener("click", () => {
  logout();
  stopGodmodeNotificationPolling();
  setRoleNotificationsReady(false);
  clearPersistedUiState();
  hideAiAssistant();
  state.view = "main";
  showLoginModal(true);
  renderApp();
});

initLoginForm();

$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginFormError");
  const loginInput = $("#loginInput");
  const passwordInput = $("#loginPassword");
  const loginName = loginInput?.value.trim() ?? "";
  const password = passwordInput?.value ?? "";

  err.textContent = "";
  err.classList.remove("visible");

  if (!loginName) {
    err.textContent = "Вкажіть логін";
    err.classList.add("visible");
    loginInput?.focus();
    return;
  }
  if (!password) {
    err.textContent = "Вкажіть пароль";
    err.classList.add("visible");
    passwordInput?.focus();
    return;
  }

  setLoginSubmitting(true);
  try {
    await login(loginName, password);
    if (redirectPureOperatorToClientPage()) return;
    clearPersistedUiState();
    await loadData();
    await afterAuth();
    if (state.view === "operator") {
      const { ensureOperatorStyles } = await import("./operator-styles.js");
      await ensureOperatorStyles();
    }
    renderApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add("visible");
    passwordInput?.focus();
    passwordInput?.select();
  } finally {
    setLoginSubmitting(false);
  }
});

initAuthFromStorage();
initTheme();
initUiPersistence();

async function applyProductionUi() {
  try {
    const health = await fetch(`${window.location.origin}/api/health`).then((r) => r.json());
    if (health?.data?.production) {
      document.querySelector("#loginDemoHint")?.setAttribute("hidden", "");
      document.querySelectorAll(".settings-demo-hint").forEach((el) => {
        el.hidden = true;
      });
    }
  } catch {
    /* ignore */
  }
}

async function bootstrap() {
  void syncOperatorBuildChip("appBuildChip");
  applyProductionUi();
  const hasToken = Boolean(localStorage.getItem("enver_token"));
  if (hasToken && loadStoredUser()) {
    const user = await refreshCurrentUser();
    if (!user) {
      showLoginModal(true);
      return;
    }
    if (redirectPureOperatorToClientPage()) return;

    const persisted = loadPersistedUiState();
    const restoreNavigation = applyUiState(persisted);

    if (restoreNavigation) {
      showLoginModal(false);
      await afterAuth({ restoreNavigation });
    }

    await loadData({ silent: restoreNavigation, preserveScroll: restoreNavigation });
    if (!restoreNavigation) {
      await afterAuth();
    }
    await prepareViewData();
    if (state.view === "operator") {
      const { ensureOperatorStyles } = await import("./operator-styles.js");
      await ensureOperatorStyles();
    }
    renderApp({ preserveScroll: restoreNavigation });
    await restoreOverlays(persisted);
    restoreScrollPosition();
    persistUiState();
    return;
  }

  showLoginModal(true);
}

bootstrap();
watchAppBuildUpdates();

window.addEventListener("enver:session-expired", async () => {
  await logout();
  showLoginModal(true);
  renderApp();
});
