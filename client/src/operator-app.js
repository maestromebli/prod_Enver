import {
  hasOperatorAccess,
  initAuthFromStorage,
  loadStoredUser,
  login,
  logout,
  operatorStages,
  refreshCurrentUser
} from "./auth.js";
import {
  confirmKioskBeforeLogout,
  enableOperatorKiosk,
  initOperatorKioskEarly
} from "./operator-kiosk.js";
import { markNativeOperatorShell } from "./operator-native.js";
import {
  bindOperatorActions,
  loadOperatorData,
  loadOperatorJobDetail,
  openOperatorView,
  renderOperatorView
} from "./operator-panel.js";
import {
  registerOperatorServiceWorker,
  reloadIfAppBuildChanged,
  setOperatorUiActive,
  syncOperatorBuildChip,
  watchAppBuildUpdates
} from "./operator-ui.js";
import { state } from "./state.js";
import { stageLabel } from "./users-constants.js";
import { toastError } from "./toast.js";
import { $ } from "./utils.js";

function setLoading(visible) {
  const el = $("#loadingOverlay");
  if (el) el.classList.toggle("visible", visible);
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
  syncOperatorBuildChip("operatorBuildChipInline");
  syncOperatorBuildChip("operatorBuildChip");
}

async function refreshOperatorData() {
  setLoading(true);
  try {
    await loadOperatorData();
    renderOperatorClient();
  } catch (err) {
    toastError(err.message);
    const content = $("#content");
    if (content) content.innerHTML = `<div class="note">${err.message}</div>`;
  } finally {
    setLoading(false);
  }
}

async function syncOperatorBuildLabel() {
  if (await reloadIfAppBuildChanged()) return;
  await syncOperatorBuildChip("operatorBuildChip");
  await syncOperatorBuildChip("operatorBuildChipInline");
}

async function afterOperatorLogin() {
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

  if (deepStage && stages.includes(deepStage)) {
    openOperatorView(deepStage);
  } else {
    openOperatorView(stages[0] || "cutting");
  }

  await refreshOperatorData();

  if (deepPosition) {
    state.operatorSelectedPositionId = deepPosition;
    await loadOperatorJobDetail(deepPosition);
    renderOperatorClient();
  }

  await syncOperatorBuildLabel();
  await enableOperatorKiosk();
}

window.__enverRender = () => {
  renderOperatorClient();
};

bindOperatorActions(() => renderOperatorClient());

$("#logoutBtn")?.addEventListener("click", async () => {
  const ok = await confirmKioskBeforeLogout();
  if (!ok) return;
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

async function bootstrap() {
  const hasToken = Boolean(localStorage.getItem("enver_token"));
  if (hasToken && loadStoredUser()) {
    const user = await refreshCurrentUser();
    if (!user) {
      showLoginModal(true);
      return;
    }
    try {
      await afterOperatorLogin();
    } catch (err) {
      toastError(err.message);
      showLoginModal(true);
    }
    return;
  }
  showLoginModal(true);
}

async function startOperatorApp() {
  registerOperatorServiceWorker();
  watchAppBuildUpdates();
  if (await reloadIfAppBuildChanged()) return;
  await bootstrap();
}

startOperatorApp();
