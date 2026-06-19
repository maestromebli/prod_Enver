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
  enterOperatorView,
  loadOperatorData,
  renderOperatorView
} from "./operator-panel.js";
import { initOperatorMachineSettingsModal } from "./operator-machine-settings.js";
import { setOperatorUiActive, syncOperatorBuildChip } from "./operator-ui.js";
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

async function loadOperatorClientData() {
  setLoading(true);
  try {
    await loadOperatorData();
    renderOperatorClient();
  } catch (err) {
    toastError(err.message);
    $("#content").innerHTML = `<div class="note">${err.message}</div>`;
  } finally {
    setLoading(false);
  }
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker
    .register("/sw-operator.js")
    .then((reg) => {
      reg.update().catch(() => {});
    })
    .catch(() => {});
}

async function syncOperatorBuildLabel() {
  const build = await import("./operator-ui.js").then((m) => m.fetchAppBuildLabel());
  const chip = $("#operatorBuildChip");
  if (!build) {
    if (chip) chip.hidden = true;
    return;
  }

  const stored = localStorage.getItem("enver_operator_build");
  if (stored && stored !== build) {
    localStorage.setItem("enver_operator_build", build);
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    location.reload();
    return;
  }
  localStorage.setItem("enver_operator_build", build);
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
  await enterOperatorView(stages[0] || "cutting");
  await loadOperatorClientData();
  await syncOperatorBuildLabel();
  await enableOperatorKiosk();
}

window.__enverRender = () => {
  loadOperatorClientData();
};

bindOperatorActions(() => loadOperatorClientData());
initOperatorMachineSettingsModal();

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
registerServiceWorker();

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

bootstrap();
