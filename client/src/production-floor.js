import { api } from "./api.js";
import { enterOperatorView } from "./operator-panel.js";
import {
  markProductionTasksSeenForCurrentRole,
  newProductionTaskIdsForCurrentRole
} from "./role-notifications.js";
import { state } from "./state.js";
import { stageLabel } from "./users-constants.js";
import { badge, escapeHtml } from "./utils.js";

let floorCache = null;

export async function loadProductionFloor() {
  floorCache = await api.getProductionFloor();
  return floorCache;
}

function stageStatusLabel(status) {
  if (status === "В роботі") return "В роботі";
  if (status === "На паузі") return "На паузі";
  return status || "—";
}

function stageStatusField(stageKey) {
  const map = {
    cutting: "cuttingStatus",
    edging: "edgingStatus",
    drilling: "drillingStatus",
    assembly: "assemblyStatus"
  };
  return map[stageKey] || "cuttingStatus";
}

function countNewTasksByStage(stages = []) {
  const freshIds = newProductionTaskIdsForCurrentRole(state.positions);
  const counters = Object.fromEntries((stages || []).map((stage) => [stage.key, 0]));
  for (const position of state.positions) {
    if (!freshIds.has(Number(position.id))) continue;
    for (const stage of stages) {
      const field = stageStatusField(stage.key);
      if (["Передано", "В роботі", "На паузі"].includes(position[field])) {
        counters[stage.key] = (counters[stage.key] || 0) + 1;
      }
    }
  }
  return counters;
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
          <div class="pf-machine">
            <span>Станок: ${s.machineProgress || 0}%</span>
            ${s.machineMatch ? `<small title="${escapeHtml(s.machineMatch)}">${escapeHtml(s.machineMatch.slice(0, 48))}${s.machineMatch.length > 48 ? "…" : ""}</small>` : ""}
          </div>
          <p class="pf-stage-total">Активних у черзі: <strong>${total}</strong></p>
        </article>
      `;
    })
    .join("");
}

function renderSessions(sessions) {
  if (!sessions?.length) {
    return '<p class="pf-empty">Зараз немає відкритих сесій операторів.</p>';
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
          <button type="button" class="btn btn-sm" data-open-operator-stage="${escapeHtml(s.stageKey)}">Відкрити етап</button>
        </div>`
        )
        .join("")}
    </div>
  `;
}

function renderProblems(list) {
  if (!list?.length) {
    return '<p class="pf-empty">Позицій з проблемою немає.</p>';
  }
  return `
    <div class="table-wrap">
      <table class="pf-problems-table">
        <thead>
          <tr><th>ID</th><th>Замовлення</th><th>Виріб</th><th>Проблема</th><th>Статус</th><th></th></tr>
        </thead>
        <tbody>
          ${list
            .map(
              (p) => `
            <tr>
              <td>${p.id}</td>
              <td>${escapeHtml(p.orderNumber)}</td>
              <td>${escapeHtml(p.item)}</td>
              <td class="left">${escapeHtml(p.problem || "—")}</td>
              <td>${badge(p.positionStatus)}</td>
              <td><button type="button" class="btn btn-sm" data-edit-position="${p.id}">Відкрити</button></td>
            </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

export function renderProductionFloorTab(data = floorCache) {
  const d = data || { stages: [], activeSessions: [], problemPositions: [] };
  const freshByStage = countNewTasksByStage(d.stages);
  const freshTotal = Object.values(freshByStage).reduce((acc, value) => acc + value, 0);
  return `
    <div class="production-floor">
      <div class="card pf-hero">
        <div class="block-title">Цех зараз</div>
        <p class="settings-hint">Зведення по всіх етапах: черга, активні сесії операторів, проблеми та прогрес станків. «Панель етапу» — огляд без кнопок оператора.</p>
        ${
          freshTotal > 0
            ? `<div class="pf-fresh-reminder">Нові задачі у цеху: <strong>${freshTotal}</strong></div>
               <button type="button" class="btn btn-sm btn-ghost" id="pfMarkSeenBtn">Позначити переглянутими</button>`
            : ""
        }
        <button type="button" class="btn btn-sm" id="pfRefreshBtn">Оновити</button>
      </div>

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

export function bindProductionFloorActions({ onRefresh, onOpenPosition }) {
  document.querySelector("#pfRefreshBtn")?.addEventListener("click", () => onRefresh?.());
  document.querySelector("#pfMarkSeenBtn")?.addEventListener("click", () => {
    markProductionTasksSeenForCurrentRole(state.positions);
    onRefresh?.();
  });

  document.querySelectorAll("[data-open-operator-stage]").forEach((btn) => {
    btn.addEventListener("click", () => {
      enterOperatorView(btn.dataset.openOperatorStage);
    });
  });

  document.querySelectorAll("[data-edit-position]").forEach((btn) => {
    btn.addEventListener("click", () => {
      void onOpenPosition?.(Number(btn.dataset.editPosition));
    });
  });
}
