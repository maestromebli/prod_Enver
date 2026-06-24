import { toastError } from "../toast.js";
import { humanizeUserMessage } from "../utils.js";
import { pushUndo } from "./undo-stack.js";
import { animateStatusChange, pulseSuccess } from "./motion.js";

/**
 * Optimistic UI: миттєвий feedback, rollback при помилці, опційний undo.
 *
 * @param {{
 *   apply: () => void,
 *   rollback: () => void,
 *   commit: () => Promise<unknown>,
 *   label?: string,
 *   undo?: () => void | Promise<void>,
 *   undoLabel?: string,
 *   targetEl?: Element | null,
 * }} options
 */
export async function showOptimisticUpdate(options) {
  const { apply, rollback, commit, label, undo, undoLabel, targetEl } = options;
  apply();
  if (targetEl) animateStatusChange(targetEl);

  try {
    const result = await commit();
    if (targetEl) pulseSuccess(targetEl);
    if (label && undo) {
      pushUndo({ label, undoLabel, undo });
    }
    return result;
  } catch (err) {
    rollback();
    if (targetEl) targetEl.classList.add("enver-optimistic-rollback");
    toastError(humanizeUserMessage(err?.message || "Не вдалося виконати дію"));
    setTimeout(() => targetEl?.classList.remove("enver-optimistic-rollback"), 320);
    throw err;
  }
}
