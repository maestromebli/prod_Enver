/**
 * HID scanner input detector — Bluetooth/USB keyboard wedge.
 */
export function createScannerInputListener({
  target,
  scanField: _scanField,
  minLength = 4,
  timeoutMs = 80,
  suffix = "Enter",
  onScan,
  onManualSubmit,
  onError
}) {
  let buffer = "";
  let lastKeyTime = 0;
  let timer = null;
  let destroyed = false;

  const el = target || document;

  const shouldIgnore = (e) => {
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === "textarea") return true;
    // Усі input (включно з полем скану) — лише нативне значення + Enter на полі.
    // Інакше паралельний buffer listener псує ручний ввід і дублює HID у полі.
    if (tag === "input") return true;
    if (tag === "select") return true;
    return false;
  };

  const flush = (manual = false) => {
    const code = buffer.trim();
    buffer = "";
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (code.length >= minLength) {
      onScan?.(code, { manual });
    } else if (manual && code.length > 0) {
      onManualSubmit?.(code);
    }
  };

  const onKeyDown = (e) => {
    if (destroyed || shouldIgnore(e)) return;

    const now = Date.now();
    const delta = now - lastKeyTime;
    lastKeyTime = now;

    if (e.key === "Enter" || (suffix === "Tab" && e.key === "Tab")) {
      if (buffer.length >= minLength) {
        e.preventDefault();
        flush(false);
      } else if (buffer.length > 0) {
        flush(true);
      }
      return;
    }

    if (e.key.length !== 1) return;

    if (buffer && delta > timeoutMs * 3) {
      buffer = "";
    }

    const isFast = !buffer || delta < timeoutMs;
    if (!isFast && buffer) {
      flush(true);
      buffer = e.key;
    } else {
      buffer += e.key;
    }

    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (buffer.length >= minLength) flush(false);
      else if (buffer.length > 0) flush(true);
    }, timeoutMs * 4);
  };

  el.addEventListener("keydown", onKeyDown, true);

  return {
    destroy() {
      destroyed = true;
      el.removeEventListener("keydown", onKeyDown, true);
      if (timer) clearTimeout(timer);
      buffer = "";
    },
    clear() {
      buffer = "";
    },
    submitManual(value) {
      const code = String(value || "").trim();
      if (!code) {
        onError?.("Введіть код");
        return;
      }
      onManualSubmit?.(code);
    }
  };
}
