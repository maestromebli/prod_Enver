import { toastWithAction } from "../toast.js";

const MAX_UNDO = 12;
const undoStack = [];

/**
 * @param {{ label: string, undoLabel?: string, undo: () => void | Promise<void> }} entry
 */
export function pushUndo(entry) {
  if (!entry?.undo) return null;
  const id = `undo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const item = {
    id,
    label: entry.label,
    undoLabel: entry.undoLabel || "Скасувати",
    undo: entry.undo,
    at: Date.now()
  };
  undoStack.unshift(item);
  if (undoStack.length > MAX_UNDO) undoStack.pop();

  toastWithAction(item.label, {
    type: "success",
    actionLabel: item.undoLabel,
    onAction: async () => {
      const idx = undoStack.findIndex((u) => u.id === id);
      if (idx === -1) return;
      undoStack.splice(idx, 1);
      try {
        await item.undo();
      } catch {
        /* помилку показує викликач undo */
      }
    }
  });

  return id;
}

export function clearUndoStack() {
  undoStack.length = 0;
}

export function getUndoStackSize() {
  return undoStack.length;
}
