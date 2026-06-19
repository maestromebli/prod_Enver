import { api } from "./api.js";
import {
  hasOperatorAccess,
  isOperator,
  isSupervisorOperatorPanel,
  logout,
  operatorStages,
  startMachinePolling,
  stopMachinePolling
} from "./auth.js";
import { state } from "./state.js";
import { OPERATOR_STAGES, stageLabel } from "./users-constants.js";
import { STAGE_STATUS_FIELD, stageClientField } from "@enver/shared/production/stages.js";
import {
  emitRoleNotifications,
  initializeOperatorStageBaseline,
  markOperatorStageSeen,
  newOperatorQueueIdsForStage,
  reminderSnapshot
} from "./role-notifications.js";
import { runSave } from "./save-flow.js";
import { ingestBrowserPickedFolder, isBrowserPickedPath } from "./folder-picker.js";
import { badge, escapeHtml } from "./utils.js";
import {
  canShowOperatorMachineSettings,
  initOperatorMachineSettingsModal,
  openOperatorMachineSettings
} from "./operator-machine-settings.js";
import { isCuttingOneScreen } from "./operator-ui.js";

const STAGE_THEME = {
  cutting: {
    accent: "#0284c7",
    accentSoft: "rgba(2, 132, 199, 0.12)",
    gradient: "linear-gradient(135deg, #0ea5e9 0%, #0369a1 100%)",
    icon: "cut"
  },
  edging: {
    accent: "#7c3aed",
    accentSoft: "rgba(124, 58, 237, 0.12)",
    gradient: "linear-gradient(135deg, #8b5cf6 0%, #5b21b6 100%)",
    icon: "edge"
  },
  drilling: {
    accent: "#d97706",
    accentSoft: "rgba(217, 119, 6, 0.12)",
    gradient: "linear-gradient(135deg, #f59e0b 0%, #b45309 100%)",
    icon: "drill"
  },
  assembly: {
    accent: "#059669",
    accentSoft: "rgba(5, 150, 105, 0.12)",
    gradient: "linear-gradient(135deg, #10b981 0%, #047857 100%)",
    icon: "assembly"
  }
};

const RING_C = 2 * Math.PI * 54;

export function openOperatorView(stageKey) {
  state.view = "operator";
  state.operatorStage = stageKey;
  state.operatorSelectedPositionId = null;
}

/** Перехід у панель оператора з завантаженням черги та перемальовкою UI. */
export async function enterOperatorView(stageKey) {
  openOperatorView(stageKey);
  try {
    await loadOperatorData();
  } catch (err) {
    state.operatorQueue = [];
    state.machineProgressMessage = err?.message || "Не вдалося завантажити чергу";
  }
  window.__enverRender?.();
  window.scrollTo(0, 0);
}

export function closeOperatorView() {
  stopMachinePolling();
  state.view = isOperator() ? "operator" : "main";
  if (isOperator()) {
    const stages = operatorStages();
    state.operatorStage = stages[0] || null;
  }
}

export async function loadOperatorData() {
  const stageKey = state.operatorStage;
  if (!stageKey) return;

  const data = await api.getOperatorQueue(stageKey);
  state.operatorQueue = data.queue || [];
  initializeOperatorStageBaseline(stageKey, state.operatorQueue);
  await emitRoleNotifications(
    reminderSnapshot({ operatorStage: stageKey, operatorQueue: state.operatorQueue })
  );
  state.operatorActiveSession = data.activeSession;

  if (data.activeSession?.position_id) {
    state.operatorSelectedPositionId = data.activeSession.position_id;
    await loadOperatorJobDetail(data.activeSession.position_id);
  } else {
    state.operatorJobDetail = null;
    state.operatorCuttingEstimate = null;
  }

  try {
    const cfg = await api.getOperatorMachineConfig(stageKey);
    state.operatorBrowserLogPath = cfg?.logPath || "";
  } catch {
    state.operatorBrowserLogPath = "";
  }

  await refreshMachineProgress();
  syncOperatorPolling();
}

async function operatorMachineTick() {
  const stageKey = state.operatorStage;
  if (!stageKey) return;

  if (isBrowserPickedPath(state.operatorBrowserLogPath)) {
    try {
      await ingestBrowserPickedFolder(stageKey, state.operatorBrowserLogPath);
    } catch {
      /* наступний цикл */
    }
  }

  await refreshMachineProgress();
}

export function syncOperatorPolling() {
  const hasLogPath = Boolean(state.operatorBrowserLogPath?.trim());
  const sessionPoll = hasBlockingSession() && isOnActiveSessionStage() && !isSessionPaused();

  if (hasLogPath || sessionPoll) {
    startMachinePolling(operatorMachineTick);
  } else {
    stopMachinePolling();
  }
}

export async function refreshMachineProgress() {
  const stageKey = state.operatorStage;
  if (!stageKey) return;
  try {
    const data = await api.getMachineProgress(stageKey);
    state.machineProgress = data.progress ?? 0;
    state.machineProgressMessage = data.message || "";
    state.machineMatch = data.match || null;
    state.machinePositionProgress = data.positionProgress || null;
    updateProgressDom();
  } catch {
    /* ignore poll errors */
  }
}

export async function loadOperatorJobDetail(positionId) {
  if (!positionId) {
    state.operatorJobDetail = null;
    state.operatorCuttingEstimate = null;
    return;
  }
  try {
    state.operatorJobDetail = await api.getOperatorJob(positionId);
    if (state.operatorStage === "cutting") {
      state.operatorCuttingEstimate = await api.estimateCutting({ positionId });
    } else {
      state.operatorCuttingEstimate = null;
    }
  } catch {
    state.operatorJobDetail = null;
    state.operatorCuttingEstimate = null;
  }
}

function updateProgressDom() {
  const pct = state.machineProgress;
  const fill = document.querySelector("#operatorProgressFill");
  const label = document.querySelector("#operatorProgressLabel");
  const msg = document.querySelector("#operatorProgressMessage");
  const ring = document.querySelector("#operatorProgressRing");
  const ringText = document.querySelector("#operatorProgressRingText");

  if (fill) fill.style.width = `${pct}%`;
  if (label) label.textContent = `${pct}%`;
  if (msg) msg.textContent = state.machineProgressMessage || "";
  if (ring) ring.style.strokeDashoffset = String(RING_C * (1 - pct / 100));
  if (ringText) ringText.textContent = `${pct}%`;
}

function selectedPosition() {
  const id = state.operatorSelectedPositionId;
  return state.operatorQueue.find((p) => p.id === id) || null;
}

function activeSessionPositionId() {
  return state.operatorActiveSession?.position_id ?? null;
}

function activeSessionStageKey() {
  return state.operatorActiveSession?.stage_key ?? null;
}

function statusFieldForStage(stageKey) {
  return stageClientField(stageKey);
}

function activeSessionStageStatus() {
  const sess = state.operatorActiveSession;
  if (!sess?.position_id) return null;
  if (sess.stage_status) return sess.stage_status;
  const stageKey = sess.stage_key || state.operatorStage;
  const fromQueue = state.operatorQueue.find((p) => p.id === sess.position_id);
  if (fromQueue) return fromQueue[statusFieldForStage(stageKey)];
  const snakeField = STAGE_STATUS_FIELD[stageKey];
  return snakeField ? sess[snakeField] : null;
}

/** Чи відкрита незавершена сесія на поточному етапі */
function isOnActiveSessionStage() {
  const sk = activeSessionStageKey();
  return !sk || sk === state.operatorStage;
}

/** Позиція для відображення: з черги або з активної сесії */
function workPosition() {
  const pos = selectedPosition();
  if (pos) return pos;
  const sess = state.operatorActiveSession;
  if (!sess?.position_id) return null;
  const fromQueue = state.operatorQueue.find((p) => p.id === sess.position_id);
  if (fromQueue) return fromQueue;
  const field = statusField();
  return {
    id: sess.position_id,
    orderNumber: sess.order_number ?? "",
    object: sess.object ?? "",
    item: sess.item ?? "",
    progress: 0,
    overdueDays: 0,
    problem: "",
    note: "",
    [field]: "В роботі"
  };
}

function hasBlockingSession() {
  if (!activeSessionPositionId()) return false;
  return ["В роботі", "На паузі"].includes(activeSessionStageStatus());
}

function canStart() {
  if (isSupervisorOperatorPanel()) return false;
  if (hasBlockingSession()) return false;
  if (!isOnActiveSessionStage()) return false;
  const pos = selectedPosition();
  if (!pos) return false;
  const field = statusField();
  const status = pos[field];
  return ["Передано", "Не розпочато"].includes(status);
}

function canFinish() {
  if (isSupervisorOperatorPanel()) return false;
  if (!hasBlockingSession() || !isOnActiveSessionStage()) return false;
  const pos = workPosition();
  if (!pos) return false;
  if (activeSessionPositionId() !== pos.id) return false;
  const status = pos[statusField()];
  return ["В роботі", "На паузі"].includes(status);
}

function canPause() {
  if (isSupervisorOperatorPanel()) return false;
  if (!hasBlockingSession() || !isOnActiveSessionStage()) return false;
  const pos = workPosition();
  if (!pos || activeSessionPositionId() !== pos.id) return false;
  return pos[statusField()] === "В роботі";
}

function canResume() {
  if (isSupervisorOperatorPanel()) return false;
  if (!hasBlockingSession() || !isOnActiveSessionStage()) return false;
  const pos = workPosition();
  if (!pos || activeSessionPositionId() !== pos.id) return false;
  return pos[statusField()] === "На паузі";
}

function sessionStatusField() {
  return statusFieldForStage(activeSessionStageKey() || state.operatorStage);
}

function isSessionPaused() {
  const pos = workPosition();
  if (!pos || !hasBlockingSession()) return false;
  return pos[sessionStatusField()] === "На паузі";
}

function statusField() {
  return stageClientField(state.operatorStage);
}

function stageTheme(key) {
  return STAGE_THEME[key] || STAGE_THEME.cutting;
}

function stageIconSvg(type) {
  const icons = {
    cut: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M6 3l3 7-3 11M18 3l-3 7 3 11M9 10h6M9 14h6"/></svg>`,
    edge: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="3" y="8" width="18" height="8" rx="1"/><path d="M7 8V6a2 2 0 012-2h6a2 2 0 012 2v2"/></svg>`,
    drill: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg>`,
    assembly: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>`
  };
  return icons[type] || icons.cut;
}

function userInitials(name) {
  const parts = String(name || "О")
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || "О").toUpperCase();
}

function folderStateLabel(state) {
  const map = {
    inbox: "Очікує в цеху",
    active: "Папка: в роботі",
    done: "Папка: порізано",
    archive: "Архів"
  };
  return map[state] || state || "";
}

function renderFolderJobBlock(options = {}) {
  const { compact = false } = options;
  const job = state.operatorJobDetail;
  if (!job) return "";

  const files = (job.files || []).slice(0, 12);
  const estimate = state.operatorCuttingEstimate;
  const mp = job.machineProgress || state.machinePositionProgress || {};

  if (compact) {
    const chips = [];
    if (job.material) {
      chips.push(`<span class="op-folder-chip">${escapeHtml(job.material)}</span>`);
    }
    if (job.giblabSummary?.piecesTotal) {
      chips.push(`<span class="op-folder-chip">${job.giblabSummary.piecesTotal} дет.</span>`);
    }
    if (estimate?.label) {
      chips.push(
        `<span class="op-folder-chip op-folder-chip--accent">${escapeHtml(estimate.label)}</span>`
      );
    }
    if (mp.piecesTotal > 0) {
      chips.push(
        `<span class="op-folder-chip op-folder-chip--live">${mp.piecesDone || 0}/${mp.piecesTotal} дет.${mp.cutLengthM ? ` · ${mp.cutLengthM} м` : ""}</span>`
      );
    }
    if (files.length) {
      chips.push(`<span class="op-folder-chip">${files.length} файлів</span>`);
    }

    if (!chips.length && !job.folderState) return "";

    return `
    <section class="op-folder-card op-folder-card--compact" aria-label="Дані з папки проєкту">
      ${job.folderState ? `<span class="op-folder-state">${escapeHtml(folderStateLabel(job.folderState))}</span>` : ""}
      ${
        chips.length
          ? `<div class="op-folder-chips">${chips.join("")}</div>`
          : '<p class="op-folder-empty">Синхронізація папки…</p>'
      }
    </section>
  `;
  }

  return `
    <section class="op-folder-card" aria-label="Дані з папки проєкту">
      <div class="op-folder-head">
        <h3>Проєкт з папки</h3>
        ${job.folderState ? `<span class="op-folder-state">${escapeHtml(folderStateLabel(job.folderState))}</span>` : ""}
      </div>
      <div class="op-task-grid">
        ${
          job.material
            ? `<div class="op-task-field"><span class="op-task-field-label">Матеріал</span><span class="op-task-field-value">${escapeHtml(job.material)}</span></div>`
            : ""
        }
        ${
          job.client
            ? `<div class="op-task-field"><span class="op-task-field-label">Клієнт</span><span class="op-task-field-value">${escapeHtml(job.client)}</span></div>`
            : ""
        }
        ${
          job.giblabSummary?.piecesTotal
            ? `<div class="op-task-field"><span class="op-task-field-label">Деталей (GibLab)</span><span class="op-task-field-value">${job.giblabSummary.piecesTotal}</span></div>`
            : ""
        }
        ${
          estimate?.label
            ? `<div class="op-task-field op-task-field--accent"><span class="op-task-field-label">Оцінка порізки</span><span class="op-task-field-value">${escapeHtml(estimate.label)}</span></div>`
            : ""
        }
        ${
          mp.piecesTotal > 0
            ? `<div class="op-task-field op-task-field--live"><span class="op-task-field-label">Станок</span><span class="op-task-field-value">${mp.piecesDone || 0}/${mp.piecesTotal} дет.${mp.cutLengthM ? ` · ${mp.cutLengthM} м` : ""}</span></div>`
            : ""
        }
      </div>
      ${
        files.length
          ? `<ul class="op-folder-files">${files
              .map(
                (f) =>
                  `<li><span class="op-file-type">${escapeHtml(f.type || "file")}</span> ${escapeHtml(f.path || f.name)}</li>`
              )
              .join("")}</ul>`
          : '<p class="op-folder-empty">Файли з папки з’являться після синхронізації агентом</p>'
      }
    </section>
  `;
}

function renderMachineMatchBlock() {
  const m = state.machineMatch;
  if (!m) return "";
  const pct = Math.round((m.confidence || 0) * 100);
  return `
    <div class="op-match-card" aria-label="Зіставлення з задачею">
      <div class="op-match-head">
        <span>Задача з логу</span>
        <span class="op-match-confidence">${pct}% · ${escapeHtml(m.method || "heuristic")}</span>
      </div>
      <strong>${escapeHtml(m.orderNumber)} — ${escapeHtml(m.item)}</strong>
      <p class="op-match-reason">${escapeHtml(m.reason || "")}</p>
    </div>
  `;
}

function renderQueueItem(p, field, freshIds) {
  const status = p[field];
  const active = p.id === state.operatorSelectedPositionId;
  const blocking = hasBlockingSession();
  const working = blocking && p.id === activeSessionPositionId();
  const overdue = (p.overdueDays || 0) > 0;
  const locked = blocking && p.id !== activeSessionPositionId();
  const isFresh = freshIds.has(Number(p.id));

  return `
    <button type="button"
      class="op-queue-card ${active ? "is-active" : ""} ${working ? "is-working" : ""} ${locked ? "is-locked" : ""} ${isFresh ? "is-fresh" : ""}"
      data-select-position="${p.id}"
      ${locked ? "disabled" : ""}
      aria-pressed="${active}">
      <div class="op-queue-card-top">
        <span class="op-queue-num">#${p.id}</span>
        ${working ? '<span class="op-pulse-dot" title="В роботі"></span>' : ""}
        ${overdue ? `<span class="op-overdue-tag">+${p.overdueDays} д</span>` : ""}
        ${p.problem ? '<span class="op-problem-tag">!</span>' : ""}
      </div>
      <span class="op-queue-order">${escapeHtml(p.orderNumber)}</span>
      <span class="op-queue-item">${escapeHtml(p.item)}</span>
      <span class="op-queue-object">${escapeHtml(p.object)}</span>
      ${isFresh ? '<span class="op-queue-fresh-pill">NEW</span>' : ""}
      <div class="op-queue-footer">${badge(status)}</div>
    </button>
  `;
}

export function renderOperatorView() {
  const stages = operatorStages();
  const stageKey = state.operatorStage || stages[0];
  const stage = OPERATOR_STAGES.find((s) => s.key === stageKey);
  const theme = stageTheme(stageKey);
  const pos = workPosition();
  const inWork = hasBlockingSession();
  const sessionOnOtherStage = inWork && !isOnActiveSessionStage();
  const blockingStage = OPERATOR_STAGES.find((s) => s.key === activeSessionStageKey());
  const field = statusField();
  const freshQueueIds = newOperatorQueueIdsForStage(stageKey, state.operatorQueue);
  const freshQueueCount = freshQueueIds.size;
  const ringOffset = RING_C * (1 - (state.machineProgress || 0) / 100);
  const oneScreen = isCuttingOneScreen(stageKey);

  const stageTabs = stages
    .map((key) => {
      const s = OPERATOR_STAGES.find((x) => x.key === key);
      const t = stageTheme(key);
      return `
        <button type="button"
          class="op-stage-tab ${key === stageKey ? "is-active" : ""}"
          data-operator-stage="${key}"
          style="--tab-accent: ${t.accent}">
          <span class="op-stage-tab-icon">${stageIconSvg(t.icon)}</span>
          ${escapeHtml(s?.label || key)}
        </button>
      `;
    })
    .join("");

  const queueItems = state.operatorQueue
    .map((p) => renderQueueItem(p, field, freshQueueIds))
    .join("");

  const initials = userInitials(state.currentUser?.name);

  return `
    <div class="operator-shell${oneScreen ? " op-one-screen" : ""}" data-stage="${escapeHtml(stageKey)}"
      style="--op-accent: ${theme.accent}; --op-accent-soft: ${theme.accentSoft}; --op-gradient: ${theme.gradient}">
      <header class="op-header">
        <div class="op-header-brand">
          <div class="op-logo-mark">${stageIconSvg(theme.icon)}</div>
          <div>
            <p class="op-eyebrow">ENVER · ${isSupervisorOperatorPanel() ? "Огляд цеху" : "Робоча зона"}</p>
            <h1 class="op-title">${isSupervisorOperatorPanel() ? "Панель начальника виробництва" : "Панель оператора"}</h1>
          </div>
        </div>

        <div class="op-header-stage">
          <span class="op-stage-badge">${escapeHtml(stage?.label || stageLabel(stageKey))}</span>
        </div>

        <div class="op-header-user">
          <div class="op-avatar" aria-hidden="true">${escapeHtml(initials)}</div>
          <div class="op-user-meta">
            <strong>${escapeHtml(state.currentUser?.name || "Оператор")}</strong>
            <span>${escapeHtml(stage?.label || "")}</span>
          </div>
          <div class="op-header-actions">
            ${!isOperator() ? '<button type="button" class="op-btn-ghost" id="operatorBackBtn">← Система</button>' : ""}
            ${
              canShowOperatorMachineSettings(stageKey)
                ? '<button type="button" class="op-btn-ghost" id="operatorMachineSettingsBtn" title="Логи та ШІ">⚙ Логи</button>'
                : ""
            }
            ${isOperator() ? '<button type="button" class="op-btn-ghost op-btn-ghost-danger" id="operatorLogoutBtn">Вийти</button>' : ""}
          </div>
        </div>
      </header>

      ${stages.length > 1 ? `<nav class="op-stage-nav" aria-label="Етапи">${stageTabs}</nav>` : ""}

      ${
        isSupervisorOperatorPanel()
          ? `
        <div class="op-supervisor-banner" role="status">
          <strong>Режим огляду</strong>
          <p>Статуси змінюють оператори на станках. Тут ви бачите чергу, прогрес станка та активні сесії.</p>
        </div>`
          : ""
      }

      ${
        sessionOnOtherStage
          ? `
        <div class="op-lock-banner" role="alert">
          <strong>Незавершене завдання</strong>
          <p>Завершіть позицію #${activeSessionPositionId()} (${escapeHtml(state.operatorActiveSession?.order_number || "")} — ${escapeHtml(state.operatorActiveSession?.item || "")}) на етапі «${escapeHtml(blockingStage?.label || activeSessionStageKey())}», перш ніж брати інше замовлення.</p>
          <button type="button" class="op-btn-ghost" data-operator-stage="${escapeHtml(activeSessionStageKey())}">
            Перейти до завдання
          </button>
        </div>`
          : ""
      }

      <div class="op-layout">
        <aside class="op-queue-panel" aria-label="Черга завдань">
          <div class="op-panel-head">
            <h2>Черга</h2>
            <span class="op-count-badge">${state.operatorQueue.length}</span>
          </div>
          ${
            freshQueueCount > 0
              ? `<div class="op-fresh-reminder">
                  <span>Нові задачі: <strong>${freshQueueCount}</strong></span>
                  <div class="op-fresh-actions">
                    <button type="button" class="op-btn-ghost" id="operatorMarkSeenBtn">Переглянуто</button>
                    <button type="button" class="op-btn-ghost" data-open-notify-settings>Сповіщення</button>
                  </div>
                </div>`
              : `<div class="op-fresh-reminder op-fresh-reminder--quiet">
                  <button type="button" class="op-btn-ghost" data-open-notify-settings>Сповіщення</button>
                </div>`
          }
          <div class="op-queue-list" role="list">
            ${
              queueItems ||
              `<div class="op-empty-queue">
                <div class="op-empty-icon">${stageIconSvg(theme.icon)}</div>
                <p>Черга порожня</p>
                <span>Нових завдань на цьому етапі немає</span>
              </div>`
            }
          </div>
        </aside>

        <main class="op-work-panel" aria-label="Поточне завдання">
          ${
            pos
              ? `
            <div class="op-task-hero${oneScreen ? " op-task-hero--compact" : ""} ${inWork && isOnActiveSessionStage() && activeSessionPositionId() === pos.id ? "op-task-hero--live" : ""}">
              <div class="op-task-hero-top">
                <span class="op-task-id">Позиція #${pos.id}</span>
                ${badge(pos[field])}
              </div>
              <h2 class="op-task-title">${escapeHtml(pos.item)}</h2>
              <p class="op-task-subtitle">${escapeHtml(pos.orderNumber)} · ${escapeHtml(pos.object)}</p>

              ${
                oneScreen
                  ? `
              ${
                (pos.overdueDays || 0) > 0
                  ? `<p class="op-task-inline op-task-inline--warn">Прострочення: +${pos.overdueDays} дн.</p>`
                  : ""
              }
              ${
                pos.problem
                  ? `<p class="op-task-inline op-task-inline--problem">${escapeHtml(pos.problem)}</p>`
                  : ""
              }
              ${
                pos.note
                  ? `<p class="op-task-inline op-task-inline--note">${escapeHtml(pos.note)}</p>`
                  : ""
              }`
                  : `
              <div class="op-task-grid">
                <div class="op-task-field">
                  <span class="op-task-field-label">Замовлення</span>
                  <span class="op-task-field-value">${escapeHtml(pos.orderNumber)}</span>
                </div>
                <div class="op-task-field">
                  <span class="op-task-field-label">Об'єкт</span>
                  <span class="op-task-field-value">${escapeHtml(pos.object)}</span>
                </div>
                <div class="op-task-field">
                  <span class="op-task-field-label">Загальний прогрес</span>
                  <span class="op-task-field-value">${pos.progress || 0}%</span>
                </div>
                ${
                  (pos.overdueDays || 0) > 0
                    ? `
                <div class="op-task-field op-task-field--warn">
                  <span class="op-task-field-label">Прострочення</span>
                  <span class="op-task-field-value">+${pos.overdueDays} дн.</span>
                </div>`
                    : ""
                }
                ${
                  pos.problem
                    ? `
                <div class="op-task-field op-task-field--problem op-task-field--full">
                  <span class="op-task-field-label">Проблема</span>
                  <span class="op-task-field-value">${escapeHtml(pos.problem)}</span>
                </div>`
                    : ""
                }
                ${
                  pos.note
                    ? `
                <div class="op-task-field op-task-field--full">
                  <span class="op-task-field-label">Примітка</span>
                  <span class="op-task-field-value">${escapeHtml(pos.note)}</span>
                </div>`
                    : ""
                }
              </div>`
              }
            </div>
            ${renderFolderJobBlock({ compact: oneScreen })}
          `
              : `
            <div class="op-task-empty">
              <div class="op-empty-illustration">
                <svg viewBox="0 0 200 120" fill="none" aria-hidden="true">
                  <rect x="20" y="30" width="160" height="70" rx="12" stroke="currentColor" stroke-width="2" opacity="0.2"/>
                  <path d="M50 55h100M50 70h70" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.15"/>
                  <circle cx="100" cy="20" r="8" fill="currentColor" opacity="0.25"/>
                </svg>
              </div>
              <h2>Оберіть завдання</h2>
              <p>Натисніть позицію в черзі зліва, щоб переглянути деталі та розпочати роботу</p>
            </div>
          `
          }

          <section class="op-machine-section${oneScreen ? " op-machine-section--compact" : ""}" aria-labelledby="opMachineTitle">
            <div class="op-machine-head">
              <h3 id="opMachineTitle">Прогрес станка</h3>
              <span class="op-machine-status ${state.machineProgress > 0 ? "is-active" : ""}">
                ${state.machineProgress > 0 ? "Активний" : "Очікування"}
              </span>
            </div>

            <div class="op-machine-body">
              <div class="op-machine-ring-wrap" aria-hidden="true">
                <svg class="op-machine-ring" viewBox="0 0 120 120">
                  <circle class="op-ring-bg" cx="60" cy="60" r="54"/>
                  <circle class="op-ring-fill" id="operatorProgressRing" cx="60" cy="60" r="54"
                    style="stroke-dasharray: ${RING_C}; stroke-dashoffset: ${ringOffset}"/>
                </svg>
                <span class="op-ring-text" id="operatorProgressRingText">${state.machineProgress}%</span>
              </div>

              <div class="op-machine-details">
                <div class="op-linear-progress">
                  <div class="op-linear-progress-head">
                    <span>Виконання циклу</span>
                    <strong id="operatorProgressLabel">${state.machineProgress}%</strong>
                  </div>
                  <div class="op-linear-track">
                    <div class="op-linear-fill" id="operatorProgressFill" style="width:${state.machineProgress}%"></div>
                  </div>
                </div>
                <p class="op-machine-msg" id="operatorProgressMessage">${escapeHtml(state.machineProgressMessage || "Прогрес з логу станка з’явиться після налаштування шляху до файлу")}</p>
                ${renderMachineMatchBlock()}
              </div>
            </div>
          </section>

          <div class="op-action-bar${oneScreen ? " op-action-bar--compact" : ""}">
            <button type="button" class="op-action-btn op-action-btn--start" id="operatorStartBtn" ${canStart() ? "" : "disabled"}>
              <span class="op-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
              </span>
              <span class="op-action-text"><strong>Почав</strong>${oneScreen ? "" : "<small>Розпочати обробку</small>"}</span>
            </button>
            <button type="button" class="op-action-btn ${canResume() ? "op-action-btn--resume" : "op-action-btn--pause"}" id="operatorPauseBtn" ${canPause() || canResume() ? "" : "disabled"}>
              <span class="op-action-icon" aria-hidden="true">
                ${
                  canResume()
                    ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'
                    : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z"/></svg>'
                }
              </span>
              <span class="op-action-text"><strong>${canResume() ? "Продовжити" : "Пауза"}</strong>${oneScreen ? "" : `<small>${canResume() ? "Відновити обробку" : "Тимчасово зупинити"}</small>`}</span>
            </button>
            <button type="button" class="op-action-btn op-action-btn--finish" id="operatorFinishBtn" ${canFinish() ? "" : "disabled"}>
              <span class="op-action-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 13l4 4L19 7"/></svg>
              </span>
              <span class="op-action-text"><strong>Закінчив</strong>${oneScreen ? "" : "<small>Завершити етап</small>"}</span>
            </button>
          </div>

          ${
            oneScreen
              ? ""
              : inWork && isOnActiveSessionStage() && isSessionPaused()
                ? '<p class="op-hint"><span class="op-hint-icon">⏸</span> Завдання на паузі. Натисніть «Продовжити» або «Закінчив», щоб закрити етап.</p>'
                : inWork && isOnActiveSessionStage()
                  ? '<p class="op-hint"><span class="op-hint-icon">ℹ</span> Між «Почав» і «Закінчив» можна поставити на паузу. Наступне замовлення — лише після завершення.</p>'
                  : inWork
                    ? '<p class="op-hint op-hint--warn"><span class="op-hint-icon">!</span> Нове замовлення недоступне, поки не завершите поточне на іншому етапі.</p>'
                    : ""
          }
        </main>
      </div>
    </div>
  `;
}

let operatorActionsBound = false;
let operatorOnChange = () => {};

export function bindOperatorActions(onChange) {
  operatorOnChange = onChange;

  if (!operatorActionsBound) {
    operatorActionsBound = true;
    document.addEventListener("click", async (e) => {
      if (!e.target.closest(".operator-shell")) return;

      if (e.target.closest("#operatorBackBtn")) {
        stopMachinePolling();
        state.view = "main";
        operatorOnChange();
        return;
      }

      if (e.target.closest("#operatorLogoutBtn")) {
        stopMachinePolling();
        logout();
        state.view = "main";
        document.querySelector("#loginModal")?.classList.add("open");
        document.querySelector("#loginModal")?.setAttribute("aria-hidden", "false");
        operatorOnChange();
        return;
      }

      const stageBtn = e.target.closest("[data-operator-stage]");
      if (stageBtn) {
        state.operatorStage = stageBtn.dataset.operatorStage;
        if (!hasBlockingSession()) {
          state.operatorSelectedPositionId = null;
        }
        await loadOperatorData();
        operatorOnChange();
        return;
      }

      const posBtn = e.target.closest("[data-select-position]");
      if (posBtn) {
        if (
          activeSessionPositionId() &&
          Number(posBtn.dataset.selectPosition) !== activeSessionPositionId()
        ) {
          return;
        }
        state.operatorSelectedPositionId = Number(posBtn.dataset.selectPosition);
        await loadOperatorJobDetail(state.operatorSelectedPositionId);
        operatorOnChange();
        return;
      }

      if (e.target.closest("#operatorMarkSeenBtn")) {
        markOperatorStageSeen(state.operatorStage, state.operatorQueue);
        operatorOnChange();
        return;
      }

      if (e.target.closest("#operatorMachineSettingsBtn")) {
        initOperatorMachineSettingsModal();
        await openOperatorMachineSettings(state.operatorStage, async () => {
          try {
            const cfg = await api.getOperatorMachineConfig(state.operatorStage);
            state.operatorBrowserLogPath = cfg?.logPath || "";
          } catch {
            state.operatorBrowserLogPath = "";
          }
          syncOperatorPolling();
          await refreshMachineProgress();
          operatorOnChange();
        });
        return;
      }

      if (e.target.closest("#operatorStartBtn")) {
        if (hasBlockingSession()) {
          const { toastError } = await import("./toast.js");
          toastError(
            isOnActiveSessionStage()
              ? "Спочатку натисніть «Закінчив» для поточного завдання"
              : "Завершіть незавершене завдання на іншому етапі"
          );
          return;
        }
        const pos = selectedPosition();
        if (!pos || !state.currentUser) return;
        if (!canStart()) return;
        const startBtn = e.target.closest("#operatorStartBtn");
        await runSave("Завдання", {
          submitEl: startBtn,
          saveFn: () =>
            api.operatorStart({
              userId: state.currentUser.id,
              positionId: pos.id,
              stageKey: state.operatorStage
            }),
          successMessage: "Завдання розпочато",
          onSuccess: async () => {
            await loadOperatorData();
            operatorOnChange();
          }
        }).catch(() => {});
        return;
      }

      if (e.target.closest("#operatorPauseBtn")) {
        const pos = workPosition();
        if (!pos || !state.currentUser) return;
        const pauseBtn = e.target.closest("#operatorPauseBtn");
        const payload = {
          userId: state.currentUser.id,
          positionId: pos.id,
          stageKey: state.operatorStage
        };
        if (canResume()) {
          await runSave("Завдання", {
            submitEl: pauseBtn,
            saveFn: () => api.operatorResume(payload),
            successMessage: "Обробку відновлено",
            onSuccess: async () => {
              await loadOperatorData();
              syncOperatorPolling();
              operatorOnChange();
            }
          }).catch(() => {});
        } else if (canPause()) {
          await runSave("Завдання", {
            submitEl: pauseBtn,
            saveFn: () => api.operatorPause(payload),
            successMessage: "Завдання на паузі",
            onSuccess: async () => {
              stopMachinePolling();
              await loadOperatorData();
              operatorOnChange();
            }
          }).catch(() => {});
        }
        return;
      }

      if (e.target.closest("#operatorFinishBtn")) {
        const pos = workPosition();
        if (!pos || !state.currentUser || !canFinish()) return;
        const finishBtn = e.target.closest("#operatorFinishBtn");
        await runSave("Завдання", {
          submitEl: finishBtn,
          saveFn: () =>
            api.operatorFinish({
              userId: state.currentUser.id,
              positionId: pos.id,
              stageKey: state.operatorStage
            }),
          successMessage: "Етап завершено",
          onSuccess: async () => {
            stopMachinePolling();
            state.operatorSelectedPositionId = null;
            await loadOperatorData();
            operatorOnChange();
          }
        }).catch(() => {});
      }
    });
  }
}

export function shouldShowOperatorByDefault() {
  return isOperator() && hasOperatorAccess();
}
