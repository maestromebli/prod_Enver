import { resolveObjectNameFromOrders } from "@enver/shared/production/object-display.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { escapeHtml } from "./utils.js";
import { attentionFromState, countAttentionItems } from "./attention.js";
import { canAttentionQuickRun } from "./godmode-ui.js";
import { state } from "./state.js";
import { activePositions } from "./archive.js";
import { getProductionFloorCache } from "./production-floor.js";
import { todayUaDate } from "./install-calendar-times.js";
const ATTENTION_GROUPS = [
  {
    id: "blockers",
    title: "Блокери",
    countClass: "attention-group-count--critical",
    filter: (i) =>
      i.kind === "blocker" &&
      ![
        "operator_problem",
        "missing_constructive",
        "no_constructive",
        "missing_assignment",
        "order_assignment"
      ].includes(i.code)
  },
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
    filter: (i) =>
      i.code === "operator_problem" || i.code === "problem" || i.code === "stage_problem"
  },
  {
    id: "constructive",
    title: "Очікують конструктив",
    countClass: "",
    filter: (i) => i.code === "missing_constructive" || i.code === "no_constructive"
  },
  {
    id: "ai-tasks",
    title: "ШІ та задачі",
    countClass: "",
    filter: (i) =>
      ["ai_not_run", "tasks_not_created", "run_ai_analysis", "create_tasks_from_ai"].includes(
        i.code
      )
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
    filter: (i) =>
      ["ready_for_install", "schedule_install", "wait_install", "ready_install"].includes(i.code) ||
      i.message?.toLowerCase().includes("монтаж")
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
  const quickRun =
    item.kind === "next" && item.positionId && canAttentionQuickRun(item.code)
      ? `<button type="button" class="attention-row-run" title="Виконати"
          data-attention-run="${item.positionId}" data-attention-action="${escapeHtml(item.code)}">▶</button>`
      : "";

  return `
    <div class="attention-row-wrap">
      <button type="button" class="attention-row" ${attrs}>
        <span class="attention-badge ${badgeClass}">${badgeLabel}</span>
        <span class="attention-body">
          <strong class="attention-title">${escapeHtml(title)}</strong>
          <span class="attention-msg">${escapeHtml(item.message)}</span>
          ${stage ? `<span class="attention-stage">${escapeHtml(stage)}</span>` : ""}
        </span>
        <span class="attention-chevron" aria-hidden="true">›</span>
      </button>
      ${quickRun}
    </div>`;
}

function operatorSessionRow(session) {
  return `
    <button type="button" class="attention-row attention-row--operator" data-attention-position="${session.positionId}">
      <span class="attention-badge attention-badge--next">Активний</span>
      <span class="attention-body">
        <strong class="attention-title">${escapeHtml(session.userName)} · ${escapeHtml(stageLabel(session.stageKey))}</strong>
        <span class="attention-msg">${escapeHtml(session.orderNumber)} — ${escapeHtml(session.item || "—")}</span>
      </span>
      <span class="attention-chevron" aria-hidden="true">›</span>
    </button>`;
}

function installTodayRow(position) {
  const time =
    position.installTimeStart && position.installTimeEnd
      ? `${position.installTimeStart}–${position.installTimeEnd}`
      : position.installTimeStart || "";
  return `
    <button type="button" class="attention-row" data-attention-position="${position.id}">
      <span class="attention-badge attention-badge--next">Монтаж</span>
      <span class="attention-body">
        <strong class="attention-title">${escapeHtml(position.orderNumber)} · ${escapeHtml(position.item || "—")}</strong>
        <span class="attention-msg">${escapeHtml(resolveObjectNameFromOrders(position, state.orders) || "—")}${time ? ` · ${escapeHtml(time)}` : ""}</span>
      </span>
      <span class="attention-chevron" aria-hidden="true">›</span>
    </button>`;
}

function riskRow(position) {
  const overdue = Number(position.overdueDays) || 0;
  const msg =
    overdue >= 2
      ? `Прострочено на ${overdue} дн. — високий ризик зриву`
      : `План ${position.planDate || "—"} наближається`;
  return `
    <button type="button" class="attention-row attention-row--risk" data-attention-position="${position.id}">
      <span class="attention-badge attention-badge--warning">Ризик</span>
      <span class="attention-body">
        <strong class="attention-title">${escapeHtml(position.orderNumber)} · ${escapeHtml(position.item || "—")}</strong>
        <span class="attention-msg">${escapeHtml(msg)}</span>
      </span>
      <span class="attention-chevron" aria-hidden="true">›</span>
    </button>`;
}

function summaryTiles(items, positions, floor) {
  const blockers = items.filter((i) => i.kind === "blocker").length;
  const warnings = items.filter((i) => i.kind === "warning").length;
  const overdueCount = positions.filter((p) => (p.overdueDays ?? 0) > 0).length;
  const problems = positions.filter(
    (p) => p.problem?.trim() || p.positionStatus === "Проблема"
  ).length;
  const activeOps = floor?.activeSessions?.length || 0;

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
      <div class="attention-stat attention-stat--ok">
        <strong>${activeOps}</strong><span>Оператори</span>
      </div>
    </div>`;
}

function renderAttentionGroup(group, allItems) {
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

function renderCustomGroup(title, countClass, id, rowsHtml, total) {
  if (!total) return "";
  const hasMore = total > GROUP_PREVIEW_LIMIT;
  return `
    <section class="attention-group card" role="region" aria-label="${escapeHtml(title)}">
      <div class="attention-group-head">
        <h3 class="attention-group-title">
          ${escapeHtml(title)}
          <span class="attention-group-count ${countClass}">${total}</span>
        </h3>
        ${hasMore ? `<button type="button" class="attention-show-all" data-attention-expand="${id}">Показати всі</button>` : ""}
      </div>
      <div class="attention-list" data-attention-group="${id}">
        ${rowsHtml.preview}
        ${hasMore ? `<div class="attention-list-more" data-attention-more="${id}" hidden>${rowsHtml.more}</div>` : ""}
      </div>
    </section>`;
}

function pickInstallToday(positions) {
  const today = todayUaDate();
  return positions.filter((p) => !p.parentId && String(p.installDate || "").trim() === today);
}

function pickRiskPositions(positions) {
  return positions
    .filter((p) => !p.parentId)
    .filter((p) => {
      const overdue = Number(p.overdueDays) || 0;
      if (overdue >= 2) return true;
      if (overdue === 1 && (p.progress ?? 0) < 80) return true;
      return false;
    })
    .sort((a, b) => (b.overdueDays || 0) - (a.overdueDays || 0))
    .slice(0, 12);
}

function renderAttentionStickyBar(items) {
  const top =
    items.find((i) => i.kind === "blocker") ||
    items.find((i) => i.kind === "warning") ||
    items.find((i) => i.kind === "next" && i.positionId && canAttentionQuickRun(i.code));
  if (!top) return "";

  const isBlocked = top.kind === "blocker";
  const kicker = isBlocked ? "Блокер" : top.kind === "warning" ? "Увага" : "Дія";

  let primaryBtn = "";
  if (top.kind === "next" && top.positionId && canAttentionQuickRun(top.code)) {
    primaryBtn = `<button type="button" class="enver-sticky-bar-cta" data-attention-run="${top.positionId}" data-attention-action="${escapeHtml(top.code)}">Виконати</button>`;
  } else if (top.positionId) {
    primaryBtn = `<button type="button" class="enver-sticky-bar-cta" data-attention-position="${top.positionId}">Відкрити</button>`;
  } else if (top.orderId) {
    primaryBtn = `<button type="button" class="enver-sticky-bar-cta" data-attention-order="${top.orderId}">Відкрити</button>`;
  }

  if (!primaryBtn) return "";

  return `
    <div class="enver-sticky-bar ${isBlocked ? "enver-sticky-bar--blocked" : ""}" role="region" aria-label="Пріоритетна увага">
      <div class="enver-sticky-bar-text">
        <span class="enver-sticky-bar-kicker">${kicker}</span>
        <strong>${escapeHtml(top.message)}</strong>
      </div>
      <div class="enver-sticky-bar-actions">${primaryBtn}</div>
    </div>`;
}

export function renderAttentionTab() {
  const positions = activePositions(state.positions, state.orders);
  const items = attentionFromState(state);
  const floor = getProductionFloorCache();
  const sessions = floor?.activeSessions || [];
  const installToday = pickInstallToday(positions);
  const riskPositions = pickRiskPositions(positions);

  const groupsHtml = ATTENTION_GROUPS.map((g) => renderAttentionGroup(g, items))
    .filter(Boolean)
    .join("");

  const operatorsHtml = renderCustomGroup(
    "Активні оператори",
    "attention-group-count--ok",
    "active-operators",
    {
      preview: sessions.slice(0, GROUP_PREVIEW_LIMIT).map(operatorSessionRow).join(""),
      more: sessions.slice(GROUP_PREVIEW_LIMIT).map(operatorSessionRow).join("")
    },
    sessions.length
  );

  const installHtml = renderCustomGroup(
    "Монтаж сьогодні",
    "",
    "install-today",
    {
      preview: installToday.slice(0, GROUP_PREVIEW_LIMIT).map(installTodayRow).join(""),
      more: installToday.slice(GROUP_PREVIEW_LIMIT).map(installTodayRow).join("")
    },
    installToday.length
  );

  const riskHtml = renderCustomGroup(
    "Ризик зриву строку",
    "attention-group-count--warn",
    "deadline-risk",
    {
      preview: riskPositions.slice(0, GROUP_PREVIEW_LIMIT).map(riskRow).join(""),
      more: riskPositions.slice(GROUP_PREVIEW_LIMIT).map(riskRow).join("")
    },
    riskPositions.length
  );

  const hasContent = groupsHtml || operatorsHtml || installHtml || riskHtml;
  const stickyBar = renderAttentionStickyBar(items);

  return `
    <div class="attention-screen${stickyBar ? " enver-screen--sticky-mobile" : ""}">
      <header class="attention-hero card">
        <h2 class="attention-hero-title enver-page-title">Потребує уваги</h2>
        <p class="attention-hero-sub enver-meta">Блокери, оператори в цеху, монтаж сьогодні та рекомендовані дії</p>
        ${summaryTiles(items, positions, floor)}
      </header>

      ${riskHtml}
      ${operatorsHtml}
      ${installHtml}
      ${groupsHtml}

      ${
        hasContent
          ? ""
          : `<div class="enver-empty-state card">
          <span class="enver-empty-state-icon" aria-hidden="true">✓</span>
          <h3 class="enver-empty-state-title">Усе під контролем</h3>
          <p class="enver-empty-state-text">Немає критичних блокерів і попереджень. Виробництво працює за планом.</p>
        </div>`
      }
      ${stickyBar}
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

  root?.querySelectorAll("[data-attention-run]").forEach((btn) => {
    const run = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const { executeGodmodeAction } = await import("./godmode-ui.js");
      await executeGodmodeAction({
        entityType: "position",
        entityId: btn.dataset.attentionRun,
        actionType: btn.dataset.attentionAction
      });
      handlers.onAfterAction?.();
    };
    btn.addEventListener("click", run);
    btn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") run(e);
    });
  });

  root?.querySelectorAll("[data-attention-position]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = Number(btn.dataset.attentionPosition);
      if (handlers.onOpenPosition) {
        handlers.onOpenPosition(id);
        return;
      }
      const { openPositionFromContext } = await import("./godmode-navigation.js");
      await openPositionFromContext(id);
      window.__enverRender?.();
      window.scrollTo?.({ top: 0, behavior: "instant" });
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
