let container;

function ensureContainer() {
  if (container) return container;
  container = document.createElement("div");
  container.className = "toast-container";
  container.setAttribute("aria-live", "polite");
  document.body.appendChild(container);
  return container;
}

export function toast(message, type = "info", durationMs = 4200) {
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  ensureContainer().appendChild(el);

  requestAnimationFrame(() => el.classList.add("visible"));

  setTimeout(() => {
    el.classList.remove("visible");
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

export function toastError(message) {
  toast(message, "error", 5500);
}

export function toastSuccess(message) {
  toast(message, "success");
}

export function confirmDialog(message) {
  return window.confirm(message);
}
