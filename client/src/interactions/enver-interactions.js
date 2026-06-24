export {
  prefersReducedMotion,
  motionMs,
  animateStatusChange,
  animateMove,
  pulseSuccess,
  shakeError
} from "./motion.js";

export { isCoarsePointer, isTouchLikeEvent, isScrollableAncestor } from "./touch-utils.js";

export { pushUndo, clearUndoStack, getUndoStackSize } from "./undo-stack.js";

export { showOptimisticUpdate } from "./optimistic-ui.js";

export { createFileDropZone, createDraggableBoard } from "./drag-drop.js";

/**
 * Блокує кнопку під час async-дії з візуальним pending state.
 * @param {HTMLButtonElement | null} btn
 * @param {() => void | Promise<void>} action
 */
export async function lockButtonDuringAction(btn, action) {
  if (!btn) {
    await action();
    return;
  }
  if (btn.disabled || btn.classList.contains("enver-loading")) return;
  btn.disabled = true;
  btn.classList.add("enver-loading", "is-loading");
  btn.setAttribute("aria-busy", "true");
  try {
    await action();
  } finally {
    btn.disabled = false;
    btn.classList.remove("enver-loading", "is-loading");
    btn.setAttribute("aria-busy", "false");
  }
}

/** @deprecated використовуй pushUndo — залишено для сумісності з master prompt */
export function createUndoToast(entry) {
  return import("./undo-stack.js").then(({ pushUndo }) => pushUndo(entry));
}
