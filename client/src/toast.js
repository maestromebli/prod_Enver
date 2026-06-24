let container;

function ensureContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  document.body.appendChild(container);
  return container;
}

function dismissToast(el, delayMs = 300) {
  el.classList.remove("visible");
  setTimeout(() => el.remove(), delayMs);
}

export function toast(message, type = "info", durationMs = 4200) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  ensureContainer().appendChild(el);

  requestAnimationFrame(() => el.classList.add("visible"));

  setTimeout(() => dismissToast(el), durationMs);
}

/**
 * Toast з кнопкою дії (наприклад «Скасувати»).
 */
export function toastWithAction(message, options = {}) {
  const { type = "info", actionLabel, onAction, durationMs = 6500 } = options;
  const el = document.createElement("div");
  el.className = `toast toast-${type} toast-with-action enver-toast-action-wrap`;

  const text = document.createElement("span");
  text.className = "toast-message";
  text.textContent = message;
  el.appendChild(text);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    dismissToast(el);
  };

  if (actionLabel && onAction) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "enver-toast-action";
    btn.textContent = actionLabel;
    btn.addEventListener("click", async () => {
      dismiss();
      await onAction();
    });
    el.appendChild(btn);
  }

  ensureContainer().appendChild(el);
  requestAnimationFrame(() => el.classList.add("visible"));
  setTimeout(dismiss, durationMs);
  return dismiss;
}

export function toastError(message) {
  toast(message, "error", 5500);
}

export function toastSuccess(message) {
  toast(message, "success");
}

/** @deprecated alias для undo-stack */
export function createUndoToast(entry) {
  return import("./interactions/undo-stack.js").then(({ pushUndo }) => pushUndo(entry));
}

export function confirmDialog(message) {
  return window.confirm(message);
}
