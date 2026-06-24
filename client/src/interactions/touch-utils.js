/** Touch-first допоміжні функції. */

export function isCoarsePointer() {
  return window.matchMedia?.("(pointer: coarse)")?.matches === true;
}

export function isTouchLikeEvent(e) {
  return e.pointerType === "touch" || e.type.startsWith("touch");
}

/** Чи елемент всередині скрол-контейнера з overflow. */
export function isScrollableAncestor(el) {
  let node = el;
  while (node && node !== document.body) {
    const style = getComputedStyle(node);
    const overflowY = style.overflowY;
    if ((overflowY === "auto" || overflowY === "scroll") && node.scrollHeight > node.clientHeight) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}
