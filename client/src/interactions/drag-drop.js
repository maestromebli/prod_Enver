import { isCoarsePointer } from "./touch-utils.js";
import { createLongPress } from "./gestures.js";
import { prefersReducedMotion } from "./motion.js";

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
 * Pointer-based drag між колонками (production board).
 *
 * @param {HTMLElement} root
 * @param {{
 *   cardSelector?: string,
 *   columnSelector?: string,
 *   columnListSelector?: string,
 *   getCardId?: (card: HTMLElement) => string,
 *   getColumnKey?: (column: HTMLElement) => string,
 *   getCardStage?: (card: HTMLElement) => string,
 *   canDrop?: (ctx: { cardId: string, fromStage: string, toStage: string, cardEl: HTMLElement }) => boolean | { allowed?: boolean, noop?: boolean, reason?: string, [key: string]: unknown } | Promise<...>,
 *   onDrop?: (ctx: { cardId: string, fromStage: string, toStage: string, cardEl: HTMLElement, fromColumnEl: HTMLElement, toColumnEl: HTMLElement, dropMeta?: Record<string, unknown> }) => void | Promise<void>,
 *   onRollback?: (ctx: { cardEl: HTMLElement, fromColumnEl: HTMLElement }) => void,
 *   onError?: (error: unknown) => void,
 *   movementThreshold?: number,
 *   longPressMs?: number,
 *   getPosition?: (id: string) => unknown,
 *   resolveDrop?: (position: unknown, targetStage: string) => object,
 * }} options
 */
export function createDraggableBoard(root, options = {}) {
  if (!root) return { destroy() {}, refresh() {} };

  const {
    cardSelector = "[data-board-card]",
    columnSelector = "[data-board-column]",
    columnListSelector = ".pf-board-list, [data-board-drop]",
    getCardId = (card) => card.dataset.positionId || "",
    getColumnKey = (col) => col.dataset.stageKey || col.dataset.boardStage || "",
    getCardStage = (card) => card.dataset.currentStage || card.dataset.boardStage || "constructor",
    onDrop,
    onRollback,
    onError,
    movementThreshold = 6,
    longPressMs = 300,
    getPosition,
    resolveDrop
  } = options;

  const canDropFn =
    options.canDrop ||
    (async ({ cardId, toStage }) => {
      if (!getPosition || !resolveDrop) return { allowed: false, reason: "Недоступно" };
      const position = getPosition(cardId);
      const result = resolveDrop(position, toStage);
      if (!result?.ok) return { allowed: false, reason: result?.reason || "Недоступно" };
      if (result.noop) return { allowed: false, noop: true };
      return { allowed: true, ...result };
    });

  let dragCard = null;
  let dragFromColumn = null;
  let dragGhost = null;
  let activeColumn = null;
  let activeDropMeta = null;
  let startX = 0;
  let startY = 0;
  let pointerId = null;
  let moved = false;
  let dragReady = false;
  let longPressCtl = null;
  let escListener = null;
  const cleanups = [];

  const allColumns = () => Array.from(root.querySelectorAll(columnSelector));

  const findColumnAt = (x, y) => {
    const el = document.elementFromPoint(x, y);
    if (!el) return null;
    return el.closest(columnSelector) || null;
  };

  const columnList = (col) => col?.querySelector(columnListSelector) || col;

  const clearColumnStates = () => {
    allColumns().forEach((c) => {
      c.classList.remove("enver-drop-target-active", "enver-drop-target--denied");
      c.removeAttribute("data-drop-hint");
    });
  };

  const setColumnState = (col, state, reason = "") => {
    clearColumnStates();
    if (!col) return;
    if (state === "active") {
      col.classList.add("enver-drop-target-active");
    } else if (state === "denied") {
      col.classList.add("enver-drop-target--denied");
      if (reason) col.setAttribute("data-drop-hint", reason);
    }
  };

  const removeEscListener = () => {
    if (escListener) {
      document.removeEventListener("keydown", escListener);
      escListener = null;
    }
  };

  const addEscListener = () => {
    removeEscListener();
    escListener = (e) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      cancelDrag();
    };
    document.addEventListener("keydown", escListener);
  };

  const cleanupDrag = () => {
    dragCard?.classList.remove("enver-dragging");
    dragCard?.setAttribute("aria-grabbed", "false");
    dragGhost?.remove();
    dragGhost = null;
    dragCard = null;
    dragFromColumn = null;
    activeColumn = null;
    activeDropMeta = null;
    dragReady = false;
    moved = false;
    pointerId = null;
    clearColumnStates();
    longPressCtl?.cancel?.();
    removeEscListener();
  };

  const cancelDrag = () => {
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    cleanupDrag();
  };

  const evaluateDrop = async (card, col) => {
    if (!card || !col) return { allowed: false };
    const cardId = getCardId(card);
    const fromStage = getCardStage(card);
    const toStage = getColumnKey(col);
    if (!cardId || !toStage) return { allowed: false, reason: "Невідома ціль" };
    if (fromStage === toStage) return { allowed: false, noop: true };
    try {
      return await canDropFn({ cardId, fromStage, toStage, cardEl: card });
    } catch {
      return { allowed: false, reason: "Недоступно" };
    }
  };

  const dropAllowed = (result) => {
    if (!result || result.noop) return false;
    if (result.allowed === true) return true;
    if (result.allowed === false) return false;
    return result.ok === true;
  };

  const onMove = (e) => {
    if (e.pointerId !== pointerId || !dragCard) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (!dragReady) {
      if (isCoarsePointer()) return;
      if (Math.hypot(dx, dy) < movementThreshold) return;
    }

    if (!moved && Math.hypot(dx, dy) >= movementThreshold) {
      moved = true;
      dragCard.classList.add("enver-dragging");
      dragCard.setAttribute("aria-grabbed", "true");
      addEscListener();
      if (!prefersReducedMotion()) {
        dragGhost = dragCard.cloneNode(true);
        dragGhost.classList.add("pf-board-card--ghost");
        dragGhost.setAttribute("aria-hidden", "true");
        document.body.appendChild(dragGhost);
      }
    }
    if (!moved) return;

    if (dragGhost) {
      dragGhost.style.left = `${e.clientX}px`;
      dragGhost.style.top = `${e.clientY}px`;
    }

    const col = findColumnAt(e.clientX, e.clientY);
    activeColumn = col;
    if (!col) {
      setColumnState(null);
      activeDropMeta = null;
      return;
    }

    void evaluateDrop(dragCard, col).then((result) => {
      if (activeColumn !== col) return;
      activeDropMeta = result;
      if (result.noop) setColumnState(null);
      else if (dropAllowed(result)) setColumnState(col, "active");
      else setColumnState(col, "denied", result.reason || "Недоступно");
    });
  };

  const onUp = async (e) => {
    if (e.pointerId !== pointerId) return;
    document.removeEventListener("pointermove", onMove);
    document.removeEventListener("pointerup", onUp);
    document.removeEventListener("pointercancel", onUp);
    removeEscListener();

    const card = dragCard;
    const fromCol = dragFromColumn;
    const col = activeColumn;
    const wasMoved = moved;
    const dropMeta = activeDropMeta;

    cleanupDrag();

    if (!card || !wasMoved) return;

    if (!col || !fromCol) return;

    const cardId = getCardId(card);
    const fromStage = getCardStage(card);
    const toStage = getColumnKey(col);

    let check = dropMeta;
    if (!check) {
      check = await evaluateDrop(card, col);
    }

    if (check?.noop || fromStage === toStage) return;

    if (!dropAllowed(check)) {
      const reason = check?.reason || "Цю позицію ще не можна передати на цей етап.";
      onError?.(new Error(reason));
      return;
    }

    const fromList = columnList(fromCol);

    try {
      await onDrop?.({
        cardId,
        fromStage,
        toStage,
        cardEl: card,
        fromColumnEl: fromCol,
        toColumnEl: col,
        dropMeta: check
      });
    } catch (err) {
      if (fromList && card.parentElement !== fromList) {
        fromList.prepend(card);
      }
      onRollback?.({ cardEl: card, fromColumnEl: fromCol });
      onError?.(err);
    }
  };

  const startPointerDrag = (card, e) => {
    dragCard = card;
    dragFromColumn = card.closest(columnSelector);
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
    dragReady = !isCoarsePointer();
    card.setPointerCapture?.(e.pointerId);
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onUp);
  };

  const bindCard = (card) => {
    const onDown = (e) => {
      if (e.button !== 0 && e.pointerType === "mouse") return;
      if (e.target.closest("button, a, input, select, textarea")) return;

      if (isCoarsePointer()) {
        longPressCtl?.destroy();
        longPressCtl = createLongPress(card, {
          delayMs: longPressMs,
          onLongPress: (ev) => {
            dragReady = true;
            if (navigator.vibrate) navigator.vibrate(12);
            startPointerDrag(card, ev);
          }
        });
        startX = e.clientX;
        startY = e.clientY;
        pointerId = e.pointerId;
        return;
      }
      startPointerDrag(card, e);
    };

    card.addEventListener("pointerdown", onDown);
    cleanups.push(() => card.removeEventListener("pointerdown", onDown));
  };

  root.querySelectorAll(cardSelector).forEach(bindCard);

  return {
    refresh() {
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
      cancelDrag();
      root.querySelectorAll(cardSelector).forEach(bindCard);
    },
    destroy() {
      cleanups.forEach((fn) => fn());
      cleanups.length = 0;
      longPressCtl?.destroy();
      cancelDrag();
    }
  };
}
