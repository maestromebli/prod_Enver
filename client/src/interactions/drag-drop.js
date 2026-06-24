const DEFAULT_DRAG_CLASS = "enver-drag-over";

/**
 * Зона drag & drop для файлів (конструктив тощо).
 *
 * @param {HTMLElement} zoneEl
 * @param {{
 *   inputEl?: HTMLInputElement | null,
 *   accept?: string[],
 *   maxBytes?: number,
 *   disabled?: boolean,
 *   onFile: (file: File) => void | Promise<void>,
 *   onReject?: (reason: "too-large" | "unsupported" | "empty") => void,
 *   onStateChange?: (state: string) => void,
 * }} options
 */
export function createFileDropZone(zoneEl, options) {
  if (!zoneEl) return { destroy() {} };

  const accept = (options.accept || []).map((e) => e.toLowerCase());
  const maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
  let dragDepth = 0;
  let destroyed = false;

  const setState = (state) => {
    zoneEl.dataset.state = state;
    options.onStateChange?.(state);
  };

  const extOf = (name) => {
    const i = String(name || "").lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  };

  const validate = (file) => {
    if (!file) return "empty";
    if (file.size > maxBytes) return "too-large";
    if (accept.length && !accept.includes(extOf(file.name))) return "unsupported";
    return null;
  };

  const handleFile = async (file) => {
    if (options.disabled || destroyed) return;
    const reason = validate(file);
    if (reason) {
      setState(reason);
      options.onReject?.(reason);
      return;
    }
    setState("uploading");
    try {
      await options.onFile(file);
      if (!destroyed) setState("success");
    } catch {
      if (!destroyed) setState("error");
    }
  };

  const onClick = () => {
    if (options.disabled || destroyed) return;
    options.inputEl?.click();
  };

  const onDragEnter = (e) => {
    if (options.disabled || destroyed) return;
    e.preventDefault();
    dragDepth += 1;
    zoneEl.classList.add(DEFAULT_DRAG_CLASS);
    setState("dragover");
  };

  const onDragOver = (e) => {
    if (options.disabled || destroyed) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
  };

  const onDragLeave = (e) => {
    if (options.disabled || destroyed) return;
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) {
      zoneEl.classList.remove(DEFAULT_DRAG_CLASS);
      if (zoneEl.dataset.state === "dragover") {
        setState(zoneEl.dataset.prevState || "idle");
      }
    }
  };

  const onDrop = (e) => {
    if (options.disabled || destroyed) return;
    e.preventDefault();
    dragDepth = 0;
    zoneEl.classList.remove(DEFAULT_DRAG_CLASS);
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleFile(file);
    else setState("idle");
  };

  const onInputChange = (e) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  };

  zoneEl.addEventListener("click", onClick);
  zoneEl.addEventListener("dragenter", onDragEnter);
  zoneEl.addEventListener("dragover", onDragOver);
  zoneEl.addEventListener("dragleave", onDragLeave);
  zoneEl.addEventListener("drop", onDrop);
  options.inputEl?.addEventListener("change", onInputChange);

  zoneEl.setAttribute("role", "button");
  zoneEl.setAttribute("tabindex", options.disabled ? "-1" : "0");
  zoneEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onClick();
    }
  });

  return {
    setState,
    setDisabled(disabled) {
      options.disabled = disabled;
      zoneEl.setAttribute("tabindex", disabled ? "-1" : "0");
      zoneEl.classList.toggle("is-disabled", Boolean(disabled));
    },
    destroy() {
      destroyed = true;
      zoneEl.removeEventListener("click", onClick);
      zoneEl.removeEventListener("dragenter", onDragEnter);
      zoneEl.removeEventListener("dragover", onDragOver);
      zoneEl.removeEventListener("dragleave", onDragLeave);
      zoneEl.removeEventListener("drop", onDrop);
      options.inputEl?.removeEventListener("change", onInputChange);
      zoneEl.classList.remove(DEFAULT_DRAG_CLASS);
    }
  };
}

/**
 * Заготовка для production board (етап 4) — pointer-based drag між колонками.
 * Поки лише API-контракт без прив'язки до бізнес-логіки.
 */
export function createDraggableBoard(_root, _options = {}) {
  return {
    destroy() {},
    refresh() {}
  };
}
