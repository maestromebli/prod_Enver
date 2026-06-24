import { $ } from "./utils.js";

const SYNC_SHOW_DELAY_MS = 400;
let syncDelayTimer = null;
let syncActive = false;

function ensureSyncBar() {
  let bar = document.querySelector("#syncBar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "syncBar";
    bar.className = "enver-sync-bar";
    bar.setAttribute("aria-hidden", "true");
    document.body.prepend(bar);
  }
  return bar;
}

/**
 * Легкий індикатор синхронізації (тонка смуга зверху).
 * blocking — лише для першого входу, без blur і скелетонів.
 */
export function setAppLoading(visible, { blocking = false } = {}) {
  const overlay = $("#loadingOverlay");
  const content = $("#content");
  const bar = ensureSyncBar();

  if (!visible) {
    clearTimeout(syncDelayTimer);
    syncDelayTimer = null;
    syncActive = false;
    overlay?.classList.remove("visible", "loading-overlay--blocking");
    overlay?.setAttribute("aria-busy", "false");
    content?.classList.remove("enver-content-loading", "enver-content-syncing");
    bar.classList.remove("visible");
    bar.setAttribute("aria-hidden", "true");
    return;
  }

  if (blocking) {
    clearTimeout(syncDelayTimer);
    syncDelayTimer = null;
    syncActive = false;
    overlay?.classList.add("visible", "loading-overlay--blocking");
    overlay?.setAttribute("aria-busy", "true");
    bar.classList.remove("visible");
    content?.classList.remove("enver-content-syncing");
    return;
  }

  syncActive = true;
  overlay?.classList.remove("visible", "loading-overlay--blocking");
  overlay?.setAttribute("aria-busy", "false");

  if (bar.classList.contains("visible")) {
    content?.classList.add("enver-content-syncing");
    return;
  }

  clearTimeout(syncDelayTimer);
  syncDelayTimer = setTimeout(() => {
    if (!syncActive) return;
    bar.classList.add("visible");
    bar.setAttribute("aria-hidden", "false");
    content?.classList.add("enver-content-syncing");
  }, SYNC_SHOW_DELAY_MS);
}
