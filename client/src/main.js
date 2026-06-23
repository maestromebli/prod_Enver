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
  shouldShowProductionFloorByDefault
} from "./auth.js";
import { PRODUCTION_FLOOR_TAB } from "./constants.js";
import { loadProductionFloor } from "./production-floor.js";
import { toastError } from "./toast.js";
import { initOrderModal, openOrderModal, setOrderSaveHandler } from "./orders.js";
import { loadGlobalHistory } from "./history.js";
import {
  initPositionDrawer,
  openPositionDrawer,
  openSubPositionDrawer,
  quickAdvancePosition,
  setPositionSaveHandler
} from "./positions.js";
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
  openNotificationSettings,
  openSettings
} from "./settings.js";
import { refreshAppData } from "./data-sync.js";
import { watchAppBuildUpdates } from "./operator-ui.js";
import {
  emitRoleNotifications,
  initializeRoleNotificationBaselines,
  reminderSnapshot,
  markOrdersSeenForCurrentRole,
  markProductionTasksSeenForCurrentRole
} from "./role-notifications.js";
import { state } from "./state.js";
import {
  applyUiState,
  clearPersistedUiState,
  initUiPersistence,
  loadPersistedUiState,
  persistUiState,
  restoreOverlays,
  restoreScrollPosition,
  schedulePersistUiState
} from "./ui-persistence.js";
import { applyTourHighlights, nextTourStep, startTour, stopTour } from "./tour.js";
import { initTheme } from "./theme.js";
import { $ } from "./utils.js";
import "./styles/app-shell.css";

let contentRenderTimer = null;
const CONTENT_RENDER_DELAY_MS = 180;

function setLoading(visible) {
  $("#loadingOverlay").classList.toggle("visible", visible);
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
}

function bindContentActions() {
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
      if (step?.tab) await setTab(step.tab);
      else renderApp();
    });
  });

  document.querySelectorAll("[data-tour-next]").forEach((el) => {
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      const step = nextTourStep();
      if (step?.tab) await setTab(step.tab);
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
    el.addEventListener("click", (e) => {
      if (e.target.closest("[data-quick-stage]")) return;
      e.stopPropagation();
      const id = Number(el.dataset.editPosition);
      const position = state.positions.find((p) => p.id === id);
      if (position) openPositionDrawer(position);
    });
  });

  document.querySelectorAll("tr.row-clickable[data-edit-position]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("button")) return;
      const id = Number(row.dataset.editPosition);
      const position = state.positions.find((p) => p.id === id);
      if (position) openPositionDrawer(position);
    });
  });

  document.querySelectorAll("[data-quick-stage]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.positionId);
      const stageKey = btn.dataset.quickStage;
      try {
        await quickAdvancePosition(id, stageKey);
      } catch (err) {
        toastError(err.message);
      }
    });
  });

  $("#newOrderBtn")?.addEventListener("click", () => openOrderModal());
  $("#toolbarNewOrderBtn")?.addEventListener("click", () => openOrderModal());
  $("#newPositionBtn")?.addEventListener("click", () => openPositionDrawer());
  $("#toolbarNewPositionBtn")?.addEventListener("click", () => openPositionDrawer());

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
      openSubPositionDrawer(Number(btn.dataset.addSubPosition));
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

window.__enverRender = renderApp;

async function loadData({ silent = false } = {}) {
  if (!silent) setLoading(true);
  try {
    await refreshAppData({ includeDirectories: true });
    initializeRoleNotificationBaselines();
    await emitRoleNotifications(reminderSnapshot());
    renderResponsibleOptions();
    renderApp(silent ? { contentOnly: true } : undefined);
  } catch (err) {
    $("#content").innerHTML = `
      <div class="note" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">
        Не вдалося завантажити дані: ${err.message}. Запустіть сервер командою <code>npm run dev</code> у корені проєкту.
      </div>
    `;
  } finally {
    if (!silent) setLoading(false);
  }
}

async function prepareViewData() {
  if (state.view === "main" && state.activeTab === PRODUCTION_FLOOR_TAB) {
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
  if (state.activeTab === "Історія змін") {
    try {
      await loadGlobalHistory();
    } catch (err) {
      state.history = [];
      toastError(`Не вдалося завантажити історію: ${err.message}`);
    }
  }
}

async function setTab(tab) {
  state.activeTab = tab;
  if (tab === "Замовлення") {
    markOrdersSeenForCurrentRole(state.orders);
  }
  if (tab === PRODUCTION_FLOOR_TAB) {
    markProductionTasksSeenForCurrentRole(state.positions);
  }
  if (tab === PRODUCTION_FLOOR_TAB) {
    setLoading(true);
    try {
      await loadProductionFloor();
    } catch (err) {
      toastError(err.message);
    } finally {
      setLoading(false);
    }
  }
  if (tab === "Історія змін") {
    setLoading(true);
    try {
      await loadGlobalHistory();
    } catch (err) {
      state.history = [];
      toastError(`Не вдалося завантажити історію: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }
  renderApp();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function applyQuickFilters({ status = "", search = "", responsible = "" } = {}) {
  const searchInput = $("#searchInput");
  const statusFilter = $("#statusFilter");
  const responsibleFilter = $("#responsibleFilter");
  const stageFilter = $("#stageFilter");

  if (searchInput) searchInput.value = search;
  if (statusFilter) statusFilter.value = status;
  if (responsibleFilter) responsibleFilter.value = responsible;
  state.productionStageFilter = "";
  if (stageFilter) stageFilter.value = "";
}

async function handleDashboardNav(destination) {
  const quickRoutes = {
    "У фокусі": { tab: "Прострочки" },
    Проблеми: { tab: "Позиції", status: "Проблема" },
    "У виробництві": { tab: "Позиції", status: "У виробництві" },
    "До монтажу": { tab: "Позиції", status: "Готово до встановлення" }
  };

  const route = quickRoutes[destination];
  if (route) {
    applyQuickFilters({ status: route.status });
    await setTab(route.tab);
    return;
  }

  await setTab(destination);
}

async function openSettingsView() {
  if (!canViewSettings()) {
    toastError("Немає доступу до налаштувань");
    return;
  }

  initSettingsUi(renderApp);
  setLoading(true);
  try {
    await loadSettingsData();
    openSettings(state.settingsSection || "users");
    renderApp();
  } catch (err) {
    toastError(err.message || "Не вдалося відкрити налаштування");
  } finally {
    setLoading(false);
  }
}

async function openNotificationSettingsView() {
  if (!state.currentUser) return;
  openNotificationSettings();
  initSettingsUi(renderApp);
  renderApp();
}

initOrderModal();
initPositionDrawer();
initInstallScheduleModal();
initSettingsUi(renderApp);
bindSettingsActions(renderApp);
bindOperatorActions(renderApp);

async function reloadAfterSave() {
  try {
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
  }
}

setOrderSaveHandler(reloadAfterSave);
setPositionSaveHandler(reloadAfterSave);
setInstallScheduleSaveHandler(reloadAfterSave);

$("#tabs")?.addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (btn) setTab(btn.dataset.tab);
});

$("#searchInput")?.addEventListener("input", scheduleContentRender);
$("#statusFilter")?.addEventListener("change", () => renderApp({ contentOnly: true }));
$("#responsibleFilter")?.addEventListener("change", () => renderApp({ contentOnly: true }));
$("#stageFilter")?.addEventListener("change", (e) => {
  state.productionStageFilter = e.target.value;
  renderApp({ contentOnly: true });
});

$("#resetBtn")?.addEventListener("click", () => {
  $("#searchInput").value = "";
  $("#statusFilter").value = "";
  $("#responsibleFilter").value = "";
  state.productionStageFilter = "";
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
  clearPersistedUiState();
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
    clearPersistedUiState();
    await loadData();
    await afterAuth();
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
  applyProductionUi();
  const hasToken = Boolean(localStorage.getItem("enver_token"));
  if (hasToken && loadStoredUser()) {
    const user = await refreshCurrentUser();
    if (!user) {
      showLoginModal(true);
      return;
    }

    const persisted = loadPersistedUiState();
    const restoreNavigation = applyUiState(persisted);

    await loadData();
    await afterAuth({ restoreNavigation });
    await prepareViewData();
    renderApp();
    await restoreOverlays(persisted);
    restoreScrollPosition();
    persistUiState();
    return;
  }

  showLoginModal(true);
}

bootstrap();
watchAppBuildUpdates();
