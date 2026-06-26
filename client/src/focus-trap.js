const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const OPEN_OVERLAY_SELECTOR = ".modal-backdrop.open, .drawer-backdrop.open";

/** @param {ParentNode | null | undefined} root */
export function getFocusableElements(root) {
  if (!root) return [];
  return [...root.querySelectorAll(FOCUSABLE_SELECTOR)].filter((el) => {
    if (!(el instanceof HTMLElement)) return false;
    if (el.hasAttribute("disabled") || el.getAttribute("aria-hidden") === "true") return false;
    return el.getClientRects().length > 0;
  });
}

let activeTrapRoot = null;
let previousFocus = null;

function onTrapKeydown(e) {
  if (e.key !== "Tab" || !activeTrapRoot) return;
  const focusable = getFocusableElements(activeTrapRoot);
  if (!focusable.length) {
    e.preventDefault();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}

function focusTrapRoot(root) {
  const focusable = getFocusableElements(root);
  if (focusable.length) {
    focusable[0].focus();
    return;
  }
  if (root instanceof HTMLElement) {
    root.setAttribute("tabindex", "-1");
    root.focus();
  }
}

/** @param {HTMLElement | null} root */
export function activateFocusTrap(root) {
  if (!root || activeTrapRoot === root) return;
  deactivateFocusTrap();
  activeTrapRoot = root;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.addEventListener("keydown", onTrapKeydown, true);
  focusTrapRoot(root);
}

export function deactivateFocusTrap() {
  if (!activeTrapRoot) return;
  document.removeEventListener("keydown", onTrapKeydown, true);
  activeTrapRoot = null;
  previousFocus?.focus?.();
  previousFocus = null;
}

function syncOpenOverlayTrap() {
  const open = document.querySelector(OPEN_OVERLAY_SELECTOR);
  if (open instanceof HTMLElement) activateFocusTrap(open);
  else deactivateFocusTrap();
}

/** Глобальний focus trap для модалок і drawer-ів з класом .open */
export function initModalFocusTraps() {
  const observer = new MutationObserver(syncOpenOverlayTrap);
  observer.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden", "aria-hidden"]
  });

  document.addEventListener("focusin", (e) => {
    if (!activeTrapRoot || !(e.target instanceof Node) || activeTrapRoot.contains(e.target)) return;
    const focusable = getFocusableElements(activeTrapRoot);
    (focusable[0] || activeTrapRoot).focus?.();
  });

  syncOpenOverlayTrap();
}
