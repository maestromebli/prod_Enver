import { api } from "./api.js";
import { PRODUCTION_FLOOR_TAB } from "./constants.js";
import {
  markProductionTasksSeenForCurrentRole,
  newProductionTaskIdsForCurrentRole
} from "./role-notifications.js";
import {
  buildFloorGodmodeBuckets,
  renderFloorGodmodeSection,
  renderSmartEmptyState
} from "./godmode-ui.js";
import { state } from "./state.js";
import { stageLabel } from "./users-constants.js";
import { badge, escapeHtml } from "./utils.js";
import { NOTIFICATION_TASK_STATUSES, stageClientField } from "@enver/shared/production/stages.js";
import { bindProductionBoard, renderProductionBoard } from "./production-board.js";

let floorCache = null;

export function getProductionFloorCache() {
  return state.productionFloor ?? floorCache;
}

export function invalidateProductionFloorCache() {
  floorCache = null;
  state.productionFloor = null;
}

export async function loadProductionFloor() {
  state.productionFloorLoading = true;
  try {
    floorCache = await api.getProductionFloor();
    state.productionFloor = floorCache;
    return floorCache;
  } finally {
    state.productionFloorLoading = false;
  }
}

function productionFloorSkeleton() {
  return `
    <div class="pf-skeleton" aria-busy="true" aria-label="Завантаження цеху">
      <div class="enver-skeleton pf-skeleton-hero"></div>
      <div class="pf-skeleton-board">
        ${Array.from({ length: 5 })
          .map(() => '<div class="enver-skeleton pf-skeleton-col"></div>')
          .join("")}
      </div>
      <div class="enver-skeleton pf-skeleton-block"></div>
    </div>`;
}

function stageStatusLabel(status) {
  if (status === "В роботі") return "В роботі";
  if (status === "На паузі") return "На паузі";
  return status || "—";
}

function countNewTasksByStage(stages = []) {
  const freshIds = newProductionTaskIdsForCurrentRole(state.positions);
  const counters = Object.fromEntries((stages || []).map((stage) => [stage.key, 0]));
  for (const position of state.positions) {
    if (!freshIds.has(Number(position.id))) continue;
    for (const stage of stages) {
      const field = stageClientField(stage.key);
      if (NOTIFICATION_TASK_STATUSES.has(position[field])) {
        counters[stage.key] = (counters[stage.key] || 0) + 1;
      }
    }
  }
  return counters;
}

function renderPipelineStrip(stages, freshByStage = {}) {
  if (!stages?.length) return "";
  const items = stages
    .map((s, i) => {
      const total = (s.handed || 0) + (s.inWork || 0) + (s.paused || 0);
      const fresh = freshByStage[s.key] || 0;
      const arrow =
        i < stages.length - 1 ? '<span class="pf-pipe-arrow" aria-hidden="true">→</span>' : "";
      return `
        <button type="button" class="pf-pipe-col ${fresh > 0 ? "is-fresh" : ""}" data-pf-stage="${escapeHtml(s.key)}" data-open-operator-stage="${escapeHtml(s.key)}">
          <span class="pf-pipe-label">${escapeHtml(s.label)}</span>
          <span class="pf-pipe-count">${total}</span>
          <span class="pf-pipe-sub">
            <em>${s.inWork || 0}</em> в роботі
            ${s.problem ? ` · <strong class="pf-pipe-warn">${s.problem}</strong> пробл.` : ""}
            ${s.overdue ? ` · <strong class="pf-pipe-alert">${s.overdue}</strong> простр.` : ""}
          </span>
          ${fresh > 0 ? `<span class="pf-pipe-fresh">+${fresh}</span>` : ""}
        </button>${arrow}`;
    })
    .join("");
  return `<div class="pf-pipeline" role="navigation" aria-label="Потік виробництва">${items}</div>`;
}

function renderStageCards(stages, freshByStage = {}) {
  return (stages || [])
    .map((s) => {
      const total = (s.handed || 0) + (s.inWork || 0) + (s.paused || 0);
      const fresh = freshByStage[s.key] || 0;
      return `
        <article class="pf-stage-card ${fresh > 0 ? "is-fresh" : ""}" data-pf-stage="${escapeHtml(s.key)}">
          <header class="pf-stage-head">
            <h3>${escapeHtml(s.label)} ${fresh > 0 ? `<span class="pf-fresh-pill">+${fresh} нов.</span>` : ""}</h3>
            <button type="button" class="btn btn-sm" data-open-operator-stage="${escapeHtml(s.key)}">Панель етапу</button>
          </header>
          <div class="pf-stage-stats">
            <div class="pf-stat"><span class="pf-stat-val">${s.inWork || 0}</span><span class="pf-stat-lbl">В роботі</span></div>
            <div class="pf-stat"><span class="pf-stat-val">${s.paused || 0}</span><span class="pf-stat-lbl">На паузі</span></div>
            <div class="pf-stat"><span class="pf-stat-val">${s.handed || 0}</span><span class="pf-stat-lbl">У черзі</span></div>
            <div class="pf-stat pf-stat--warn"><span class="pf-stat-val">${s.problem || 0}</span><span class="pf-stat-lbl">Проблеми</span></div>
            <div class="pf-stat pf-stat--alert"><span class="pf-stat-val">${s.overdue || 0}</span><span class="pf-stat-lbl">Простроч.</span></div>
          </div>
          <p class="pf-stage-total">Активних у черзі: <strong>${total}</strong></p>
        </article>
      `;
    })
    .join("");
}

function renderSessions(sessions) {
  if (!sessions?.length) {
    return renderSmartEmptyState({
      icon: "👷",
      title: "Операторів у роботі немає",
      text: "Коли оператор почне завдання, сесія зʼявиться тут."
    });
  }
  return `
    <div class="pf-sessions">
      ${sessions
        .map(
          (s) => `
        <div class="pf-session-row">
          <div class="pf-session-main">
            <strong>${escapeHtml(s.userName)}</strong>
            <span>${escapeHtml(stageLabel(s.stageKey))}</span>
            <span>#${s.positionId} · ${escapeHtml(s.orderNumber)} — ${escapeHtml(s.item)}</span>
          </div>
          <div class="pf-session-meta">
            ${badge(stageStatusLabel(s.stageStatus))}
            <small>${escapeHtml(s.startedAt || "")}</small>
          </div>
          <button type="button" class="btn btn-sm" data-open-operator-stage="${escapeHtml(s.stageKey)}" data-open-operator-position="${s.positionId}">Відкрити етап</button>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderProblems(list) {
  if (!list?.length) {
    return renderSmartEmptyState({
      icon: "✓",
      title: "Проблем немає",
      text: "Усі позиції без блокерів — виробництво йде за планом."
    });
  }

  const cards = list
    .map(
      (p) => `
    <article class="pf-problem-card enver-card" data-edit-position="${p.id}" tabindex="0">
      <div class="pf-problem-card-head">
        <strong>${escapeHtml(p.orderNumber)} · ${escapeHtml(p.item || "—")}</strong>
        ${badge(p.positionStatus)}
      </div>
      <p class="pf-problem-card-text">${escapeHtml(p.problem || "Проблема без опису")}</p>
      ${(p.overdueDays ?? 0) > 0 ? `<span class="pf-problem-card-overdue">+${p.overdueDays} д прострочення</span>` : ""}
      <button type="button" class="btn btn-sm pf-problem-card-open" data-edit-position="${p.id}">Відкрити</button>
    </article>`
    )
    .join("");

  const rows = list
    .map(
      (p) => `
            <tr class="pf-problem-row" data-edit-position="${p.id}" tabindex="0">
              <td>${p.id}</td>
              <td>${escapeHtml(p.orderNumber)}</td>
              <td>${escapeHtml(p.item)}</td>
              <td class="left">${escapeHtml(p.problem || "—")}</td>
              <td>${badge(p.positionStatus)}</td>
              <td><button type="button" class="btn btn-sm" data-edit-position="${p.id}">Відкрити</button></td>
            </tr>`
    )
    .join("");

  return `
    <div class="pf-problems-view">
      <div class="pf-problems-cards" aria-label="Проблемні позиції (картки)">${cards}</div>
      <div class="table-wrap pf-problems-table-wrap" aria-label="Проблемні позиції (таблиця)">
        <table class="pf-problems-table">
          <thead>
            <tr><th>ID</th><th>Замовлення</th><th>Виріб</th><th>Проблема</th><th>Статус</th><th></th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;
}

export function renderProductionFloorTab(data = getProductionFloorCache()) {
  if (state.productionFloorLoading && !data) {
    return `<div class="production-floor">${productionFloorSkeleton()}</div>`;
  }
  const d = data || { stages: [], activeSessions: [], problemPositions: [] };
  const syncingClass = state.productionFloorLoading && data ? " production-floor--syncing" : "";
  const freshByStage = countNewTasksByStage(d.stages);
  const freshTotal = Object.values(freshByStage).reduce((acc, value) => acc + value, 0);
  const godmodeBuckets = buildFloorGodmodeBuckets(state.positions);
  const godmodeSections = renderFloorGodmodeSection(godmodeBuckets);
  return `
    <div class="production-floor${syncingClass}">
      <div class="card pf-hero">
        <div class="block-title">Цех зараз</div>
        <p class="settings-hint">Зведення по всіх етапах: черга, активні сесії операторів і проблемні позиції. «Панель етапу» — огляд без кнопок оператора.</p>
        <div class="pf-fresh-reminder">
          Нові задачі у цеху: <strong>${freshTotal}</strong>
          <span class="pf-fresh-empty">${freshTotal > 0 ? "" : "нових поки немає"}</span>
          ${freshTotal > 0 ? '<button type="button" class="btn btn-sm btn-ghost" id="pfMarkSeenBtn">Позначити переглянутими</button>' : ""}
        </div>
        <button type="button" class="btn btn-sm" id="pfRefreshBtn">Оновити</button>
      </div>

      ${godmodeSections}

      <section class="pf-section pf-section--pipeline">
        <h2 class="pf-section-title enver-section-title">Потік виробництва</h2>
        <p class="pf-pipeline-hint enver-meta">Конструктив → Порізка → Крайкування → Присадка → Збірка → Монтаж</p>
        ${renderPipelineStrip(d.stages, freshByStage)}
      </section>

      ${renderProductionBoard()}

      <section class="pf-section">
        <h2 class="pf-section-title">Етапи</h2>
        <div class="pf-stage-grid">${renderStageCards(d.stages, freshByStage)}</div>
      </section>

      <section class="pf-section">
        <h2 class="pf-section-title">Хто зараз працює</h2>
        ${renderSessions(d.activeSessions)}
      </section>

      <section class="pf-section">
        <h2 class="pf-section-title">Проблемні позиції</h2>
        ${renderProblems(d.problemPositions)}
      </section>
    </div>
  `;
}

let floorActionsBound = false;
let floorHandlers = {};
let floorAutoRefreshTimer = null;

/** Автооновлення зведення цеху кожні 45 с на активній вкладці. */
export function startProductionFloorAutoRefresh(onRefresh) {
  stopProductionFloorAutoRefresh();
  floorAutoRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    if (state.activeTab !== PRODUCTION_FLOOR_TAB || state.view !== "main") return;
    onRefresh?.();
  }, 45000);
}

export function stopProductionFloorAutoRefresh() {
  if (floorAutoRefreshTimer) {
    clearInterval(floorAutoRefreshTimer);
    floorAutoRefreshTimer = null;
  }
}

export function bindProductionFloorActions(handlers = {}) {
  floorHandlers = handlers;
  bindProductionBoard(document.querySelector("#pfProductionBoard"), handlers);

  if (floorActionsBound) return;
  floorActionsBound = true;

  document.addEventListener("click", async (e) => {
    const refreshBtn = e.target.closest("#pfRefreshBtn");
    if (refreshBtn) {
      const { setSubmitLoading } = await import("./save-flow.js");
      setSubmitLoading(refreshBtn, true);
      try {
        await floorHandlers.onRefresh?.();
      } finally {
        setSubmitLoading(refreshBtn, false);
      }
      return;
    }

    const seenBtn = e.target.closest("#pfMarkSeenBtn");
    if (seenBtn) {
      markProductionTasksSeenForCurrentRole(state.positions);
      floorHandlers.onRefresh?.();
      return;
    }

    const stageBtn = e.target.closest("[data-open-operator-stage]");
    if (stageBtn) {
      const { enterOperatorView } = await import("./operator-panel.js");
      const positionId = stageBtn.dataset.openOperatorPosition;
      await enterOperatorView(stageBtn.dataset.openOperatorStage, {
        positionId: positionId ? Number(positionId) : null
      });
      return;
    }

    const runBtn = e.target.closest("[data-pf-run]");
    if (runBtn) {
      e.stopPropagation();
      const { executeGodmodeAction } = await import("./godmode-ui.js");
      await executeGodmodeAction({
        entityType: "position",
        entityId: runBtn.dataset.pfRun,
        actionType: runBtn.dataset.pfAction
      }).catch(() => {});
      floorHandlers.onRefresh?.();
      return;
    }

    const expandBtn = e.target.closest("[data-pf-expand]");
    if (expandBtn) {
      const id = expandBtn.dataset.pfExpand;
      const more = document.querySelector(`[data-pf-more="${id}"]`);
      if (more) {
        more.hidden = false;
        expandBtn.hidden = true;
      }
      return;
    }

    const posBtn = e.target.closest(
      ".pf-godmode-row-wrap [data-edit-position], .pf-problem-card[data-edit-position], tr.pf-problem-row[data-edit-position]"
    );
    if (posBtn) {
      const id = Number(posBtn.dataset.editPosition);
      if (floorHandlers.onOpenPosition) {
        void floorHandlers.onOpenPosition(id);
        return;
      }
      const { openPositionFromContext } = await import("./godmode-navigation.js");
      if (await openPositionFromContext(id)) {
        window.__enverRender?.();
        window.scrollTo?.({ top: 0, behavior: "instant" });
      }
    }
  });
}
