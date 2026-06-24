import {
  isCommandPaletteOpen,
  closeCommandPalette,
  toggleCommandPalette
} from "./command-palette.js";
import { closeOrderDetailDrawer, isOrderDetailDrawerOpen } from "./order-detail-drawer.js";
import { closeOperatorProblemSheet, isOperatorProblemSheetOpen } from "./operator-panel.js";
import { toastSuccess } from "./toast.js";

function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function initKeyboardShortcuts(handlers = {}) {
  document.addEventListener("keydown", (e) => {
    const typing = isTypingTarget(document.activeElement);

    if (e.key === "Escape") {
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

    if (e.key.toLowerCase() === "n" && !mod && !e.altKey) {
      e.preventDefault();
      handlers.openNewOrder?.();
    }
  });
}

export function hintToast(message) {
  toastSuccess(message);
}
