/** Утиліти анімацій ENVER — transform/opacity, без важкого layout. */

export function prefersReducedMotion() {
  return (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true
  );
}

export function motionMs(fast = 120, base = 180, slow = 260) {
  if (prefersReducedMotion()) return 0;
  return { fast, base, slow };
}

export function animateStatusChange(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove("enver-status-change");
  void el.offsetWidth;
  el.classList.add("enver-status-change");
  const onEnd = () => {
    el.classList.remove("enver-status-change");
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
}

export function animateMove(el, done) {
  if (!el || prefersReducedMotion()) {
    done?.();
    return;
  }
  el.classList.add("enver-card-enter");
  const onEnd = () => {
    el.classList.remove("enver-card-enter");
    el.removeEventListener("animationend", onEnd);
    done?.();
  };
  el.addEventListener("animationend", onEnd);
}

export function pulseSuccess(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.add("enver-save-flash");
  setTimeout(() => el.classList.remove("enver-save-flash"), motionMs().base + 40);
}

export function shakeError(el) {
  if (!el || prefersReducedMotion()) return;
  el.classList.remove("enver-shake");
  void el.offsetWidth;
  el.classList.add("enver-shake");
  const onEnd = () => {
    el.classList.remove("enver-shake");
    el.removeEventListener("animationend", onEnd);
  };
  el.addEventListener("animationend", onEnd);
}
