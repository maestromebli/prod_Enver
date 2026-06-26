import {
  hasOperatorAccess,
  initAuthFromStorage,
  loadStoredUser,
  login,
  logout,
  operatorStages,
  refreshCurrentUser
} from "./auth.js";
import { wireAppRenderBus } from "./app-bus.js";
import {
  confirmKioskBeforeLogout,
  enableOperatorKiosk,
  initOperatorKioskEarly
} from "./operator-kiosk.js";
import { markNativeOperatorShell } from "./operator-native.js";
import {
  bindOperatorActions,
  bindOperatorQueueSwipe,
  loadOperatorData,
  loadOperatorJobDetail,
  openOperatorView,
  renderOperatorView
} from "./operator-panel.js";
import { bindOperatorScanPanel, syncOperatorClientScanButtons } from "./part-scan.js";
import {
  registerOperatorServiceWorker,
  reloadIfAppBuildChanged,
  initOperatorPwaShell,
  setOperatorUiActive,
  syncOperatorBuildChip,
  watchAppBuildUpdates
} from "./operator-ui.js";
import { state } from "./state.js";
import { stageLabel } from "./users-constants.js";
import { toastError } from "./toast.js";
import {
  applyUiState,
  clearPersistedUiState,
  initUiPersistence,
  loadPersistedUiState,
  persistUiState,
  restoreScrollPosition,
  schedulePersistUiState
} from "./ui-persistence.js";
import { setAppLoading } from "./loading-ui.js";
import { $ } from "./utils.js";
import "./styles/operator-entry.css";

function setLoading(visible, options) {
  setAppLoading(visible, options);
}

function showLoginModal(show) {
  const modal = $("#loginModal");
  if (!modal) return;
  modal.classList.toggle("open", show);
  modal.setAttribute("aria-hidden", show ? "false" : "true");
  if (show) requestAnimationFrame(() => $("#loginInput")?.focus());
}

function showAppShell(show) {
  const root = $("#appRoot");
  if (root) root.hidden = !show;
}

function setLoginSubmitting(loading) {
  const btn = $("#loginSubmitBtn");
  if (!btn) return;
  btn.disabled = loading;
  const text = $("#loginSubmitText");
  if (text) text.textContent = loading ? "Вхід…" : "Увійти";
}

function renderOperatorClient() {
  const user = state.currentUser;
  const chip = $("#userChip");
  if (chip && user) chip.textContent = user.name;
  const stageChip = $("#operatorStageChip");
  if (stageChip) {
    stageChip.textContent = state.operatorStage ? stageLabel(state.operatorStage) : "";
  }
  setOperatorUiActive(true);
  const content = $("#content");
  if (content) content.innerHTML = renderOperatorView();
  bindOperatorQueueSwipe();
  bindOperatorScanPanel(state.operatorStage);
  syncOperatorClientScanButtons(state.operatorStage);
  syncOperatorBuildChip("operatorBuildChipInline");
  syncOperatorBuildChip("operatorBuildChip");
  schedulePersistUiState();
}

async function refreshOperatorData({ silent = false } = {}) {
  if (!silent) setLoading(true);
  try {
    await loadOperatorData();
    renderOperatorClient();
  } catch (err) {
    toastError(err.message);
    const content = $("#content");
    if (content) content.innerHTML = `<div class="note">${err.message}</div>`;
  } finally {
    if (!silent) setLoading(false);
  }
}

async function syncOperatorBuildLabel() {
  if (await reloadIfAppBuildChanged()) return;
  await syncOperatorBuildChip("operatorBuildChip");
  await syncOperatorBuildChip("operatorBuildChipInline");
}

async function afterOperatorLogin({ restoreNavigation = false } = {}) {
  if (!hasOperatorAccess()) {
    logout();
    throw new Error("Цей обліковий запис не має доступу до панелі оператора");
  }
  showLoginModal(false);
  showAppShell(true);
  const stages = operatorStages();
  const params = new URLSearchParams(window.location.search);
  const deepStage = params.get("stage");
  const deepPosition = Number(params.get("position")) || null;

  if (restoreNavigation && state.operatorStage && stages.includes(state.operatorStage)) {
    openOperatorView(state.operatorStage, { preserveSelection: true });
  } else if (deepStage && stages.includes(deepStage)) {
    openOperatorView(deepStage);
  } else {
    openOperatorView(stages[0] || "cutting");
  }

  await refreshOperatorData({ silent: restoreNavigation });

  const savedPositionId = restoreNavigation ? state.operatorSelectedPositionId : null;

  if (restoreNavigation && savedPositionId) {
    const inQueue = state.operatorQueue.some((p) => p.id === savedPositionId);
    await loadOperatorJobDetail(savedPositionId);
    renderOperatorClient();
    if (!inQueue) {
      toastError("Позиція не в черзі цього етапу — перегляньте деталі");
    }
  } else if (deepPosition) {
    const inQueue = state.operatorQueue.some((p) => p.id === deepPosition);
    state.operatorSelectedPositionId = deepPosition;
    await loadOperatorJobDetail(deepPosition);
    renderOperatorClient();
    if (!inQueue) {
      toastError("Позиція не в черзі цього етапу — перегляньте деталі");
    }
    document
      .querySelector(".op-work-panel")
      ?.scrollIntoView({ behavior: "instant", block: "start" });
  }

  if (restoreNavigation) {
    restoreScrollPosition();
    persistUiState();
  }

  if (deepStage || deepPosition) {
    const url = new URL(window.location.href);
    url.searchParams.delete("stage");
    url.searchParams.delete("position");
    window.history.replaceState({}, "", `${url.pathname}${url.hash}`);
  }

  await syncOperatorBuildLabel();
  await enableOperatorKiosk();
}

wireAppRenderBus(renderOperatorClient);

bindOperatorActions(() => renderOperatorClient());

$("#logoutBtn")?.addEventListener("click", async () => {
  const ok = await confirmKioskBeforeLogout();
  if (!ok) return;
  clearPersistedUiState();
  logout();
  state.view = "main";
  setOperatorUiActive(false);
  showAppShell(false);
  showLoginModal(true);
});

$("#loginForm")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const err = $("#loginFormError");
  const loginName = $("#loginInput")?.value.trim() ?? "";
  const password = $("#loginPassword")?.value ?? "";
  err.textContent = "";
  err.classList.remove("visible");

  if (!loginName || !password) {
    err.textContent = "Вкажіть логін і пароль";
    err.classList.add("visible");
    return;
  }

  setLoginSubmitting(true);
  try {
    await login(loginName, password);
    clearPersistedUiState();
    await afterOperatorLogin();
  } catch (ex) {
    err.textContent = ex.message;
    err.classList.add("visible");
  } finally {
    setLoginSubmitting(false);
  }
});

initAuthFromStorage();
markNativeOperatorShell();
initOperatorKioskEarly();
initUiPersistence({ scope: "operator" });

async function bootstrap() {
  const hasToken = Boolean(localStorage.getItem("enver_token"));
  if (hasToken && loadStoredUser()) {
    const user = await refreshCurrentUser();
    if (!user) {
      showLoginModal(true);
      return;
    }
    const persisted = loadPersistedUiState();
    const restoreNavigation = applyUiState(persisted);
    try {
      await afterOperatorLogin({ restoreNavigation });
    } catch (err) {
      toastError(err.message);
      showLoginModal(true);
    }
    return;
  }
  showLoginModal(true);
}

async function startOperatorApp() {
  initOperatorPwaShell();
  watchAppBuildUpdates();
  if (await reloadIfAppBuildChanged()) return;
  await bootstrap();
  registerOperatorServiceWorker();
}

startOperatorApp();
