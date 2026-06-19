import { toastError } from "./toast.js";
import { isNativeOperatorShell } from "./operator-native.js";
import { $ } from "./utils.js";

const KIOSK_EXIT_PASSWORD = "1111";
const KIOSK_SESSION_KEY = "enver_operator_kiosk_unlocked";

let kioskLocked = false;
let kioskListenersBound = false;

function isIos() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

function isStandalonePwa() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    window.matchMedia("(display-mode: fullscreen)").matches ||
    Boolean(window.navigator.standalone)
  );
}

function fullscreenElement() {
  return (
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.webkitCurrentFullScreenElement
  );
}

function requestAppFullscreen() {
  const el = document.documentElement;
  const fn =
    el.requestFullscreen?.bind(el) ||
    el.webkitRequestFullscreen?.bind(el) ||
    el.webkitEnterFullscreen?.bind(el);
  if (!fn) return Promise.resolve(false);
  return fn()
    .then(() => true)
    .catch(() => false);
}

function exitAppFullscreen() {
  const fn =
    document.exitFullscreen?.bind(document) ||
    document.webkitExitFullscreen?.bind(document) ||
    document.webkitCancelFullScreen?.bind(document);
  if (!fn) return Promise.resolve();
  return fn().catch(() => {});
}

function isFullscreenActive() {
  return Boolean(fullscreenElement()) || (isIos() && isStandalonePwa());
}

export function isKioskLocked() {
  return kioskLocked;
}

function applyKioskDom(locked) {
  document.body.classList.toggle("operator-kiosk-locked", locked);
  document.body.classList.toggle("operator-kiosk-unlocked", !locked);

  const exitBtn = $("#kioskExitBtn");
  const logoutBtn = $("#logoutBtn");
  const restoreBtn = $("#kioskRestoreBtn");

  if (exitBtn) exitBtn.hidden = !locked;
  if (logoutBtn) logoutBtn.hidden = locked;
  if (restoreBtn) restoreBtn.hidden = locked || isFullscreenActive();
}

function showKioskPasswordModal() {
  return new Promise((resolve) => {
    const modal = $("#kioskPasswordModal");
    const input = $("#kioskPasswordInput");
    const err = $("#kioskPasswordError");
    const form = $("#kioskPasswordForm");
    if (!modal || !form || !input) {
      resolve(null);
      return;
    }

    err.textContent = "";
    err.classList.remove("visible");
    input.value = "";
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => input.focus());

    const close = (value) => {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
      form.removeEventListener("submit", onSubmit);
      $("#kioskPasswordCancel")?.removeEventListener("click", onCancel);
      resolve(value);
    };

    const onCancel = (e) => {
      e.preventDefault();
      close(null);
    };

    const onSubmit = (e) => {
      e.preventDefault();
      const pwd = input.value;
      if (pwd !== KIOSK_EXIT_PASSWORD) {
        err.textContent = "Невірний пароль";
        err.classList.add("visible");
        input.select();
        return;
      }
      close(pwd);
    };

    form.addEventListener("submit", onSubmit);
    $("#kioskPasswordCancel")?.addEventListener("click", onCancel);
  });
}

async function tryRestoreFullscreen() {
  if (!kioskLocked) return;
  if (isFullscreenActive()) {
    applyKioskDom(true);
    return;
  }
  await requestAppFullscreen();
  applyKioskDom(true);
}

function bindKioskListeners() {
  if (kioskListenersBound) return;
  kioskListenersBound = true;

  const onFullscreenChange = () => {
    if (!kioskLocked) return;
    if (!fullscreenElement()) {
      applyKioskDom(true);
      setTimeout(() => tryRestoreFullscreen(), 300);
    }
  };

  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") tryRestoreFullscreen();
  });

  window.addEventListener("resize", () => {
    if (kioskLocked) applyKioskDom(true);
  });

  $("#kioskRestoreBtn")?.addEventListener("click", () => {
    tryRestoreFullscreen();
  });

  $("#kioskExitBtn")?.addEventListener("click", async () => {
    if (window.enverDesktop?.requestExit) {
      await window.enverDesktop.requestExit();
      return;
    }
    const pwd = await showKioskPasswordModal();
    if (pwd !== KIOSK_EXIT_PASSWORD) return;

    kioskLocked = false;
    sessionStorage.setItem(KIOSK_SESSION_KEY, "1");
    await exitAppFullscreen();
    applyKioskDom(false);
  });
}

/** Увімкнути повноекранний kiosk після входу оператора. */
export async function enableOperatorKiosk() {
  if (window.enverDesktop?.isDesktop) {
    kioskLocked = true;
    bindKioskListeners();
    applyKioskDom(true);
    return;
  }

  sessionStorage.removeItem(KIOSK_SESSION_KEY);
  kioskLocked = true;
  bindKioskListeners();
  applyKioskDom(true);

  // У нативній Android-оболонці вже повноекранна activity — без Fullscreen API.
  if (isNativeOperatorShell()) {
    return;
  }

  await requestAppFullscreen();
  applyKioskDom(true);
}

/** Вихід з облікового запису — лише після розблокування kiosk. */
export async function confirmKioskBeforeLogout() {
  if (!kioskLocked) return true;
  const pwd = await showKioskPasswordModal();
  if (pwd !== KIOSK_EXIT_PASSWORD) {
    if (pwd !== null) toastError("Невірний пароль");
    return false;
  }
  kioskLocked = false;
  sessionStorage.setItem(KIOSK_SESSION_KEY, "1");
  await exitAppFullscreen();
  applyKioskDom(false);
  return true;
}

export function initOperatorKioskEarly() {
  bindKioskListeners();
  if (isStandalonePwa() || isIos() || isNativeOperatorShell()) {
    document.documentElement.classList.add("operator-pwa-capable");
  }
}
