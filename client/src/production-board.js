import { STAGES } from "@enver/shared/production/stages.js";
import { canEditPositions } from "./auth.js";
import { activePositions } from "./archive.js";
import { createDraggableBoard } from "./interactions/drag-drop.js";
import { resolveProductionDrop } from "./interactions/production-handoff.js";
import { state } from "./state.js";
import { escapeHtml, badge, humanizeUserMessage } from "./utils.js";
import { resolvePositionGodmode, canQuickRunGodmodeAction } from "./godmode-ui.js";
import { toastError } from "./toast.js";

const BOARD_STAGES = STAGES.map((s) => s.key);
const PREVIEW_LIMIT = 8;
let boardDrag = null;

function boardPositions() {
  return activePositions(state.positions, state.orders).filter((p) => !p.parentId);
}

function groupByStage(positions) {
  const groups = Object.fromEntries(BOARD_STAGES.map((k) => [k, []]));
  for (const p of positions) {
    const key = p.currentStage || "constructor";
    if (groups[key]) groups[key].push(p);
    else groups.constructor.push(p);
  }
  for (const key of Object.keys(groups)) {
    groups[key].sort((a, b) => (b.progress || 0) - (a.progress || 0));
  }
  return groups;
}

function problemBadge(p, gm) {
  if (p.positionStatus === "Проблема") {
    return '<span class="badge badge-problem pf-board-badge">Проблема</span>';
  }
  if ((p.overdueDays ?? 0) > 0) {
    return `<span class="badge badge-overdue pf-board-badge">+${p.overdueDays} д</span>`;
  }
  if (gm.health === "blocked") {
    return '<span class="badge badge-blocked pf-board-badge">Блокер</span>';
  }
  return "";
}

function responsibleLine(p) {
  const parts = [];
  if (p.client) parts.push(escapeHtml(p.client));
  if (p.zone) parts.push(escapeHtml(p.zone));
  if (p.assembler) parts.push(escapeHtml(p.assembler));
  return parts.length ? `<span class="pf-board-meta">${parts.join(" / ")}</span>` : "";
}

function renderBoardCard(p) {
  const gm = resolvePositionGodmode(p);
  const next = gm.nextAction;
  const nextLine = next?.label
    ? `<small class="pf-board-next">Далі: ${escapeHtml(next.label)}</small>`
    : "";
  const handoffBtn =
    canEditPositions() && canQuickRunGodmodeAction(next?.type) && next?.allowed !== false
      ? `<button type="button" class="btn btn-sm pf-board-handoff enver-pressable" data-pf-board-handoff="${p.id}" data-pf-action="${escapeHtml(next.type)}" title="${escapeHtml(next.label || "Передати")}" aria-label="${escapeHtml(next.label || "Передати на наступний етап")}">→</button>`
      : "";
  const pb = problemBadge(p, gm);

  return `
    <article
      class="pf-board-card enver-interactive enver-draggable enver-pressable"
      data-board-card
      data-position-id="${p.id}"
      data-current-stage="${escapeHtml(p.currentStage || "constructor")}"
      tabindex="0"
      aria-grabbed="false"
    >
      <div class="pf-board-card-head">
        <strong>${escapeHtml(p.orderNumber || "—")} · ${escapeHtml(p.item || "—")}</strong>
        ${handoffBtn}
      </div>
      ${responsibleLine(p)}
      <div class="pf-board-card-status">
        ${badge(p.positionStatus || "—")}
        ${pb}
        <span class="pf-board-progress">${p.progress || 0}%</span>
      </div>
      ${nextLine}
    </article>`;
}

export function renderProductionBoard() {
  const groups = groupByStage(boardPositions());
  const cols = STAGES.map((stage) => {
    const items = groups[stage.key] || [];
    const preview = items.slice(0, PREVIEW_LIMIT);
    const more = items.length - preview.length;
    return `
      <section
        class="pf-board-column enver-drop-target"
        data-board-column
        data-stage-key="${escapeHtml(stage.key)}"
      >
        <header class="pf-board-column-head">
          <h3>${escapeHtml(stage.label)}</h3>
          <span class="pf-board-col-count">${items.length}</span>
        </header>
        <div class="pf-board-list" data-board-drop="${escapeHtml(stage.key)}">
          ${preview.map(renderBoardCard).join("")}
          ${more > 0 ? `<p class="pf-board-more">+ ще ${more}</p>` : ""}
        </div>
      </section>`;
  }).join("");

  const dragHint = canEditPositions()
    ? `<p class="pf-board-hint enver-meta">Перетягніть картку на наступний етап (на планшеті — утримуйте ~0.3 с). Кнопка → — те саме без drag. <kbd>Esc</kbd> — скасувати перетягування.</p>`
    : `<p class="pf-board-hint enver-meta">Перегляд дошки виробництва. Передача між етапами — через панель менеджера.</p>`;

  return `
    <section class="pf-section pf-section--board" id="pfProductionBoard">
      <h2 class="pf-section-title enver-section-title">Дошка виробництва</h2>
      ${dragHint}
      <div class="pf-board" role="list">${cols}</div>
    </section>`;
}

function handoffPendingLabel(actionType) {
  const map = {
    handoff_to_cutting: "Передано на порізку…",
    handoff_to_edging: "Передано на крайкування…",
    handoff_to_drilling: "Передано на присадку…",
    handoff_to_assembly: "Передано на збірку…",
    handoff_to_packaging: "Передано на пакування…",
    ready_for_install: "Позицію позначено готовою до встановлення…"
  };
  return map[actionType] || "Передаємо на наступний етап…";
}

function handoffSuccessLabel(actionType, fallback) {
  const map = {
    handoff_to_cutting: "Позицію передано на порізку",
    handoff_to_edging: "Позицію передано на крайкування",
    handoff_to_drilling: "Позицію передано на присадку",
    handoff_to_assembly: "Позицію передано на збірку",
    handoff_to_packaging: "Позицію передано на пакування",
    ready_for_install: "Позицію позначено готовою до встановлення"
  };
  return map[actionType] || fallback || "Передано на наступний етап";
}

function humanDropError(message) {
  const m = String(message || "");
  if (/constructive|конструктив/i.test(m)) return "Спочатку завантажте конструктив.";
  if (/stale|conflict|оновил/i.test(m)) return "Дані оновились. Повторіть дію.";
  if (/forbidden|заборон/i.test(m)) return "Цю позицію ще не можна передати на цей етап.";
  return humanizeUserMessage(m) || "Цю позицію ще не можна передати на цей етап.";
}

async function runBoardHandoff(positionId, actionType, label, targetStageKey, cardEl) {
  const { api } = await import("./api.js");
  const { upsertPosition, refreshAppData } = await import("./data-sync.js");
  const { showOptimisticUpdate } = await import("./interactions/optimistic-ui.js");

  const position = state.positions.find((p) => p.id === Number(positionId));
  if (!position) throw new Error("Позицію не знайдено");

  const card = cardEl || document.querySelector(`.pf-board-card[data-position-id="${positionId}"]`);
  const fromList = card?.closest(".pf-board-list");
  const toList = targetStageKey
    ? document.querySelector(`[data-board-drop="${targetStageKey}"]`)
    : null;

  await showOptimisticUpdate({
    apply: () => {
      if (card && toList && fromList !== toList) {
        toList.prepend(card);
        card.dataset.currentStage = targetStageKey || card.dataset.currentStage;
      }
    },
    rollback: () => {
      if (card && fromList) {
        fromList.prepend(card);
        card.dataset.currentStage = position.currentStage || "constructor";
      }
    },
    commit: async () => {
      const updated = await api.runPositionNextAction(positionId, actionType);
      upsertPosition(updated);
      await refreshAppData({ includeDirectories: false });
      return updated;
    },
    pendingLabel: handoffPendingLabel(actionType),
    label: handoffSuccessLabel(actionType, label),
    targetEl: card
  });

  window.__enverRender?.({ contentOnly: true });
}

export function bindProductionBoard(root, { onRefresh, onOpenPosition } = {}) {
  boardDrag?.destroy();
  boardDrag = null;

  if (!root) return;

  root.querySelectorAll("[data-pf-board-handoff]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const id = Number(btn.dataset.pfBoardHandoff);
      const action = btn.dataset.pfAction;
      const position = state.positions.find((p) => p.id === id);
      const gm = position ? resolvePositionGodmode(position) : null;
      try {
        await runBoardHandoff(id, action, gm?.nextAction?.label, gm?.nextAction?.stageKey);
        onRefresh?.();
      } catch {
        /* optimistic-ui показує помилку */
      }
    });
  });

  root.querySelectorAll(".pf-board-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest("[data-pf-board-handoff]")) return;
      const id = Number(card.dataset.positionId);
      if (onOpenPosition) void onOpenPosition(id);
    });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        if (e.target.closest("[data-pf-board-handoff]")) return;
        e.preventDefault();
        const id = Number(card.dataset.positionId);
        if (onOpenPosition) void onOpenPosition(id);
      }
    });
  });

  if (!canEditPositions()) return;

  const board = root.querySelector(".pf-board");
  if (!board) return;

  boardDrag = createDraggableBoard(board, {
    cardSelector: "[data-board-card]",
    columnSelector: "[data-board-column]",
    columnListSelector: ".pf-board-list",
    getCardId: (card) => card.dataset.positionId,
    getColumnKey: (col) => col.dataset.stageKey,
    getCardStage: (card) => card.dataset.currentStage,
    canDrop: async ({ cardId, toStage }) => {
      const position = state.positions.find((p) => p.id === Number(cardId));
      const result = resolveProductionDrop(position, toStage, state.currentUser);
      if (!result.ok) return { allowed: false, reason: result.reason };
      if (result.noop) return { allowed: false, noop: true };
      return { allowed: true, actionType: result.actionType, label: result.label };
    },
    onDrop: async ({ cardId, toStage, cardEl, toColumnEl, dropMeta }) => {
      const actionType = dropMeta?.actionType;
      if (!actionType) throw new Error("Цю позицію ще не можна передати на цей етап.");
      const list = toColumnEl.querySelector(".pf-board-list");
      if (cardEl && list) list.prepend(cardEl);
      await runBoardHandoff(cardId, actionType, dropMeta?.label, toStage, cardEl);
      onRefresh?.();
    },
    onRollback: ({ cardEl, fromColumnEl }) => {
      const list = fromColumnEl?.querySelector(".pf-board-list");
      if (cardEl && list) list.prepend(cardEl);
    },
    onError: (err) => {
      toastError(humanDropError(err?.message));
    }
  });
}

export function destroyProductionBoard() {
  boardDrag?.destroy();
  boardDrag = null;
}
