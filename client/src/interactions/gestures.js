import { isCoarsePointer } from "./touch-utils.js";

/**
 * Свайп-дії для карток (mobile / touch).
 * На desktop залишаються кнопки — свайп не блокує клік.
 */
export function createSwipeActions(el, options = {}) {
  if (!el) return { destroy() {} };

  const threshold = options.threshold ?? (isCoarsePointer() ? 64 : 88);
  const axisLock = options.axisLock ?? 10;
  let startX = 0;
  let startY = 0;
  let tracking = false;
  let locked = null;
  let pointerId = null;
  let revealed = false;

  const reveal = el.querySelector(".enver-swipe-reveal");
  const inner = el.querySelector(".enver-swipe-inner") || el;

  const resetTransform = () => {
    inner.style.transform = "";
    el.classList.remove("is-swiping");
    revealed = false;
  };

  const onPointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    if (e.target.closest("button, a, input, select, textarea")) return;
    tracking = true;
    locked = null;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
  };

  const onPointerMove = (e) => {
    if (!tracking || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    if (!locked) {
      if (Math.abs(dx) < axisLock && Math.abs(dy) < axisLock) return;
      if (Math.abs(dy) > Math.abs(dx)) {
        tracking = false;
        return;
      }
      locked = "x";
      el.classList.add("is-swiping");
      el.setPointerCapture?.(e.pointerId);
    }
    const clamped = Math.max(-120, Math.min(120, dx));
    inner.style.transform = `translateX(${clamped}px)`;
    if (reveal) {
      reveal.classList.toggle("is-visible", Math.abs(clamped) > 24);
    }
  };

  const onPointerUp = (e) => {
    if (!tracking || e.pointerId !== pointerId) return;
    tracking = false;
    const dx = e.clientX - startX;
    try {
      el.releasePointerCapture?.(e.pointerId);
    } catch {
      /* ignore */
    }

    if (dx > threshold && options.onSwipeRight) {
      revealed = true;
      options.onSwipeRight();
      setTimeout(resetTransform, 120);
      return;
    }
    if (dx < -threshold && options.onSwipeLeft) {
      revealed = true;
      options.onSwipeLeft();
      setTimeout(resetTransform, 120);
      return;
    }
    resetTransform();
  };

  const onPointerCancel = () => {
    tracking = false;
    resetTransform();
  };

  el.addEventListener("pointerdown", onPointerDown);
  el.addEventListener("pointermove", onPointerMove);
  el.addEventListener("pointerup", onPointerUp);
  el.addEventListener("pointercancel", onPointerCancel);

  return {
    destroy() {
      el.removeEventListener("pointerdown", onPointerDown);
      el.removeEventListener("pointermove", onPointerMove);
      el.removeEventListener("pointerup", onPointerUp);
      el.removeEventListener("pointercancel", onPointerCancel);
      resetTransform();
    }
  };
}

/** Long press для початку drag на touch (production board). */
export function createLongPress(el, { delayMs = 300, onLongPress, onCancel }) {
  if (!el) return { destroy() {} };
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  const clear = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const onDown = (e) => {
    fired = false;
    startX = e.clientX;
    startY = e.clientY;
    clear();
    timer = setTimeout(() => {
      fired = true;
      onLongPress?.(e);
    }, delayMs);
  };

  const onMove = (e) => {
    if (!timer) return;
    if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) {
      clear();
      onCancel?.();
    }
  };

  const onUp = () => {
    clear();
    if (!fired) onCancel?.();
  };

  el.addEventListener("pointerdown", onDown);
  el.addEventListener("pointermove", onMove);
  el.addEventListener("pointerup", onUp);
  el.addEventListener("pointercancel", onUp);

  return {
    destroy() {
      clear();
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    },
    cancel: clear
  };
}
