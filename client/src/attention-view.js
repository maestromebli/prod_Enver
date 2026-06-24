import { stageLabel } from "@enver/shared/production/stages.js";
import { escapeHtml } from "./utils.js";
import { attentionFromState, countAttentionItems } from "./attention.js";
import { state } from "./state.js";
import { activePositions } from "./archive.js";

const ATTENTION_GROUPS = [
  {
    id: "overdue",
    title: "Прострочені",
    countClass: "attention-group-count--warn",
    filter: (i) => i.code === "overdue"
  },
  {
    id: "problems",
    title: "Проблеми",
    countClass: "attention-group-count--critical",
    filter: (i) => i.code === "problem" || i.code === "stage_problem"
  },
  {
    id: "constructive",
    title: "Очікують конструктив",
    countClass: "",
    filter: (i) => i.code === "no_constructive"
  },
  {
    id: "assignment",
    title: "Очікують призначення",
    countClass: "",
    filter: (i) => i.code === "missing_assignment" || i.code === "order_assignment"
  },
  {
    id: "ready-install",
    title: "Готові до монтажу",
    countClass: "",
    filter: (i) => i.code === "ready_install" || i.message?.includes("монтаж")
  },
  {
    id: "next-actions",
    title: "Наступні кроки",
    countClass: "",
    filter: (i) => i.kind === "next"
  }
];

const GROUP_PREVIEW_LIMIT = 4;

function attentionRow(item) {
  const badgeClass =
    item.kind === "blocker"
      ? "attention-badge--blocker"
      : item.kind === "warning"
        ? "attention-badge--warning"
        : "attention-badge--next";
  const badgeLabel = item.kind === "blocker" ? "Блокер" : item.kind === "warning" ? "Увага" : "Дія";
  const stage = item.stageKey ? stageLabel(item.stageKey) : "";
  const title = item.positionId ? `${item.orderNumber} · ${item.item || "—"}` : item.orderNumber;
  const attrs = item.positionId
    ? `data-attention-position="${item.positionId}"`
    : item.orderId
      ? `data-attention-order="${item.orderId}"`
      : "";

  return `
    <button type="button" class="attention-row" ${attrs}>
      <span class="attention-badge ${badgeClass}">${badgeLabel}</span>
      <span class="attention-body">
        <strong class="attention-title">${escapeHtml(title)}</strong>
        <span class="attention-msg">${escapeHtml(item.message)}</span>
        ${stage ? `<span class="attention-stage">${escapeHtml(stage)}</span>` : ""}
      </span>
      <span class="attention-chevron" aria-hidden="true">›</span>
    </button>`;
}

function summaryTiles(items, positions) {
  const blockers = items.filter((i) => i.kind === "blocker").length;
  const warnings = items.filter((i) => i.kind === "warning").length;
  const overdueCount = positions.filter((p) => (p.overdueDays ?? 0) > 0).length;
  const problems = positions.filter(
    (p) => p.problem?.trim() || p.positionStatus === "Проблема"
  ).length;

  return `
    <div class="attention-stats">
      <div class="attention-stat attention-stat--critical">
        <strong>${blockers}</strong><span>Блокери</span>
      </div>
      <div class="attention-stat attention-stat--warn">
        <strong>${warnings}</strong><span>Попередження</span>
      </div>
      <div class="attention-stat">
        <strong>${problems}</strong><span>Проблеми</span>
      </div>
      <div class="attention-stat">
        <strong>${overdueCount}</strong><span>Прострочені</span>
      </div>
    </div>`;
}

function renderAttentionGroup(group, items, allItems) {
  const matched = allItems.filter(group.filter);
  if (!matched.length) return "";

  const preview = matched.slice(0, GROUP_PREVIEW_LIMIT);
  const hasMore = matched.length > GROUP_PREVIEW_LIMIT;

  return `
    <section class="attention-group card" role="region" aria-label="${escapeHtml(group.title)}">
      <div class="attention-group-head">
        <h3 class="attention-group-title">
          ${escapeHtml(group.title)}
          <span class="attention-group-count ${group.countClass}">${matched.length}</span>
        </h3>
        ${hasMore ? `<button type="button" class="attention-show-all" data-attention-expand="${group.id}">Показати всі</button>` : ""}
      </div>
      <div class="attention-list" data-attention-group="${group.id}">
        ${preview.map(attentionRow).join("")}
        ${
          hasMore
            ? `<div class="attention-list-more" data-attention-more="${group.id}" hidden>
                ${matched.slice(GROUP_PREVIEW_LIMIT).map(attentionRow).join("")}
              </div>`
            : ""
        }
      </div>
    </section>`;
}

export function renderAttentionTab() {
  const positions = activePositions(state.positions, state.orders);
  const items = attentionFromState(state);
  const groupsHtml = ATTENTION_GROUPS.map((g) => renderAttentionGroup(g, items, items))
    .filter(Boolean)
    .join("");

  return `
    <div class="attention-screen">
      <header class="attention-hero card">
        <h2 class="attention-hero-title enver-page-title">Потребує уваги</h2>
        <p class="attention-hero-sub enver-meta">Блокери, попередження та рекомендовані дії по всіх активних позиціях</p>
        ${summaryTiles(items, positions)}
      </header>

      ${
        groupsHtml ||
        `<div class="enver-empty-state card">
          <span class="enver-empty-state-icon" aria-hidden="true">✓</span>
          <h3 class="enver-empty-state-title">Усе під контролем</h3>
          <p class="enver-empty-state-text">Немає критичних блокерів і попереджень. Виробництво працює за планом.</p>
        </div>`
      }
    </div>`;
}

export function bindAttentionTab(root, handlers = {}) {
  root?.querySelectorAll("[data-attention-expand]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.attentionExpand;
      const more = root.querySelector(`[data-attention-more="${id}"]`);
      if (more) {
        more.hidden = false;
        btn.hidden = true;
      }
    });
  });

  root?.querySelectorAll("[data-attention-position]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.attentionPosition);
      if (handlers.onOpenPosition) handlers.onOpenPosition(id);
    });
  });
  root?.querySelectorAll("[data-attention-order]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = Number(btn.dataset.attentionOrder);
      if (handlers.onOpenOrder) handlers.onOpenOrder(id);
    });
  });
}

export function attentionTabBadgeCount() {
  const positions = activePositions(state.positions, state.orders);
  return countAttentionItems(positions, state.orders);
}
