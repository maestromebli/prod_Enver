import {
  isCommandPaletteOpen,
  closeCommandPalette,
  toggleCommandPalette
} from "./command-palette.js";
import { closeOrderDetailDrawer, isOrderDetailDrawerOpen } from "./order-detail-drawer.js";
import { closeOperatorProblemSheet, isOperatorProblemSheetOpen } from "./operator-panel.js";
import { toastSuccess } from "./toast.js";
import { escapeHtml } from "./utils.js";

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

function isMac() {
  return typeof navigator !== "undefined" && /Mac|iPhone|iPad/i.test(navigator.platform);
}

function modLabel() {
  return isMac() ? "⌘" : "Ctrl+";
}

let shortcutsVisible = false;

function shortcutRows() {
  const mod = modLabel();
  return [
    { keys: `${mod}K`, label: "Команди (пошук дій)" },
    { keys: "/", label: "Фокус на пошук" },
    { keys: "N", label: "Нове замовлення" },
    { keys: "?", label: "Ця підказка" },
    { keys: "Esc", label: "Закрити панель або діалог" }
  ];
}

function ensureShortcutsSheet() {
  let el = document.getElementById("shortcutsSheet");
  if (el) return el;

  el = document.createElement("div");
  el.id = "shortcutsSheet";
  el.className = "shortcuts-sheet";
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-label", "Гарячі клавіші");
  el.innerHTML = `
    <div class="shortcuts-sheet-backdrop" data-shortcuts-close="1" aria-hidden="true"></div>
    <div class="shortcuts-sheet-panel enver-card-enter">
      <header class="shortcuts-sheet-head">
        <h2 class="shortcuts-sheet-title">Гарячі клавіші</h2>
        <button type="button" class="btn-icon shortcuts-sheet-close" data-shortcuts-close="1" aria-label="Закрити">✕</button>
      </header>
      <ul class="shortcuts-sheet-list" id="shortcutsSheetList"></ul>
      <p class="shortcuts-sheet-foot enver-meta">Працюють поза полями вводу. На Mac — ⌘, на Windows/Linux — Ctrl.</p>
    </div>`;
  document.body.appendChild(el);

  el.addEventListener("click", (e) => {
    if (e.target.closest("[data-shortcuts-close]")) closeShortcutsSheet();
  });

  return el;
}

function renderShortcutsList() {
  const list = document.getElementById("shortcutsSheetList");
  if (!list) return;
  list.innerHTML = shortcutRows()
    .map(
      (row) =>
        `<li class="shortcuts-sheet-row">
          <kbd class="shortcuts-sheet-kbd">${escapeHtml(row.keys)}</kbd>
          <span>${escapeHtml(row.label)}</span>
        </li>`
    )
    .join("");
}

export function openShortcutsSheet() {
  const el = ensureShortcutsSheet();
  renderShortcutsList();
  shortcutsVisible = true;
  el.classList.add("open");
  el.setAttribute("aria-hidden", "false");
  el.querySelector(".shortcuts-sheet-close")?.focus();
}

export function closeShortcutsSheet() {
  const el = document.getElementById("shortcutsSheet");
  if (!el) return;
  shortcutsVisible = false;
  el.classList.remove("open");
  el.setAttribute("aria-hidden", "true");
}

export function isShortcutsSheetOpen() {
  return shortcutsVisible;
}

export function renderShortcutsHintButton() {
  const mod = modLabel();
  return `<button type="button" class="btn-icon shortcuts-hint-btn" id="shortcutsHintBtn" title="Гарячі клавіші (${mod}K)" aria-label="Гарячі клавіші">?</button>`;
}

export function bindShortcutsHintButton() {
  document.getElementById("shortcutsHintBtn")?.addEventListener("click", () => {
    if (isShortcutsSheetOpen()) closeShortcutsSheet();
    else openShortcutsSheet();
  });
}

export function hintToast(message) {
  toastSuccess(message);
}

export function initKeyboardShortcuts(handlers = {}) {
  document.addEventListener("keydown", (e) => {
    const typing = isTypingTarget(document.activeElement);

    if (e.key === "Escape") {
      if (isShortcutsSheetOpen()) {
        closeShortcutsSheet();
        e.preventDefault();
        return;
      }
      if (isCommandPaletteOpen()) {
        closeCommandPalette();
        e.preventDefault();
        return;
      }
      if (isOperatorProblemSheetOpen()) {
        closeOperatorProblemSheet();
        e.preventDefault();
        return;
      }
      if (isOrderDetailDrawerOpen()) {
        closeOrderDetailDrawer();
        e.preventDefault();
        return;
      }
      handlers.onEscape?.();
      return;
    }

    if (typing) return;

    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      toggleCommandPalette();
      return;
    }

    if (e.key === "/" && !mod) {
      e.preventDefault();
      handlers.focusSearch?.();
      return;
    }

    if (e.key === "?" && !mod && !e.altKey) {
      e.preventDefault();
      if (isShortcutsSheetOpen()) closeShortcutsSheet();
      else openShortcutsSheet();
      return;
    }

    if (e.key.toLowerCase() === "n" && !mod && !e.altKey) {
      e.preventDefault();
      handlers.openNewOrder?.();
    }
  });
}
