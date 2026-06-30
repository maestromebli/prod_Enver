import { api, constructiveFileDownloadUrl } from "./api.js";
import {
  hasOperatorAccess,
  isOperator,
  isSupervisorOperatorPanel,
  logout,
  operatorStages
} from "./auth.js";
import { state } from "./state.js";
import { OPERATOR_STAGES, stageLabel } from "./users-constants.js";
import { brandLogoHtml } from "./brand-logo.js";
import { STAGE_STATUS_FIELD, stageClientField } from "@enver/shared/production/stages.js";
import {
  formatObjectHeader,
  resolveObjectNameFromOrders
} from "@enver/shared/production/object-display.js";
import {
  emitRoleNotifications,
  initializeOperatorStageBaseline,
  markOperatorStageSeen,
  newOperatorQueueIdsForStage,
  reminderSnapshot
} from "./role-notifications.js";
import { runSave } from "./save-flow.js";
import { badge, escapeHtml, progressRing } from "./utils.js";
import { iconSvg, stageIconSvg } from "./icons.js";
import { resolvePositionGodmode, renderSmartEmptyState } from "./godmode-ui.js";
import { createSwipeActions } from "./interactions/gestures.js";
import { formatConstructiveSize } from "@enver/shared/production/constructive-files.js";
import { formatStageEstimateLabel } from "@enver/shared/production/stage-duration-estimate.js";
import { notifyUiChanged, persistUiState } from "./ui-persistence.js";
import {
  isPartScanStage,
  toggleOperatorScanPanel,
  renderOperatorScanPanel,
  handleOperatorScanBack
} from "./part-scan.js";
import { isCuttingOneScreen } from "./operator-ui.js";
import { autoSelectNextOperatorJob, maybeAutoStartOperatorJob } from "./operator-automation.js";

async function afterOperatorMutation(result, onChange, { autoAdvance = false } = {}) {
  const { propagatePositionMutation } = await import("./data-sync.js");
  propagatePositionMutation(result);
  await loadOperatorData();
  if (autoAdvance) {
    const selected = await autoSelectNextOperatorJob({ loadDetail: loadOperatorJobDetail });
    if (selected) {
      await maybeAutoStartOperatorJob({
        onMutation: async (startResult) => {
          propagatePositionMutation(startResult);
          await loadOperatorData();
        }
      });
    }
  }
  onChange?.();
}

const PROBLEM_PRESETS = [
  "Немає матеріалу",
  "Помилка розміру",
  "Немає фурнітури",
  "Пошкодження",
  "Інше"
];

const FINISH_MESSAGES = {
  cutting: "Готово. Позицію передано на крайкування.",
  edging: "Готово. Позицію передано на присадку.",
  drilling: "Готово. Позицію передано на збірку.",
  assembly: "Готово. Позиція готова до монтажу."
};

function finishSuccessMessage(stageKey) {
  return FINISH_MESSAGES[stageKey] || "Етап завершено";
}

const STAGE_THEME = {
  cutting: {
    accent: "#3d8f5c",
    gradient: "linear-gradient(135deg, #4a9e6a 0%, #245c3b 100%)",
    icon: "cut"
  },
  edging: {
    accent: "#5856d6",
    gradient: "linear-gradient(135deg, #7d7aff 0%, #5856d6 100%)",
    icon: "edge"
  },
  drilling: {
    accent: "#ff9500",
    gradient: "linear-gradient(135deg, #ffb340 0%, #ff9500 100%)",
    icon: "drill"
  },
  assembly: {
    accent: "#34c759",
    gradient: "linear-gradient(135deg, #5dd879 0%, #34c759 100%)",
    icon: "assembly"
  }
};

export function openOperatorView(stageKey, { preserveSelection = false, positionId = null } = {}) {
  state.view = "operator";
  state.operatorStage = stageKey;
  if (positionId != null) {
    state.operatorSelectedPositionId = Number(positionId);
  } else if (!preserveSelection) {
    state.operatorSelectedPositionId = null;
  }
}

export async function enterOperatorView(
  stageKey,
  { preserveScroll = false, positionId = null } = {}
) {
  const { ensureOperatorStyles } = await import("./operator-styles.js");
  await ensureOperatorStyles();
  openOperatorView(stageKey, {
    preserveSelection: preserveScroll || positionId != null,
    positionId
  });
  try {
    await loadOperatorData();
    if (state.operatorSelectedPositionId) {
      await loadOperatorJobDetail(state.operatorSelectedPositionId);
    }
  } catch (err) {
    state.operatorQueue = [];
    state.operatorLoadError = err?.message || "Не вдалося завантажити чергу";
  }
  window.__enverRender?.({ preserveScroll });
  if (!preserveScroll) {
    window.scrollTo(0, 0);
  }
}

export function closeOperatorView() {
  state.view = isOperator() ? "operator" : "main";
  if (isOperator()) {
    const stages = operatorStages();
    state.operatorStage = stages[0] || null;
  }
}

export async function loadOperatorData() {
  const stageKey = state.operatorStage;
  if (!stageKey) return;

  state.operatorQueueLoading = true;
  try {
    const data = await api.getOperatorQueue(stageKey);
    state.operatorQueue = data.queue || [];
    state.operatorLoadError = "";
    initializeOperatorStageBaseline(stageKey, state.operatorQueue);
    await emitRoleNotifications(
      reminderSnapshot({ operatorStage: stageKey, operatorQueue: state.operatorQueue }),
      { silent: true }
    );
    state.operatorActiveSession = data.activeSession;
    state.operatorAutomation = data.automation || null;

    if (data.activeSession?.position_id) {
      state.operatorSelectedPositionId = data.activeSession.position_id;
      await loadOperatorJobDetail(data.activeSession.position_id);
    } else {
      state.operatorJobDetail = null;
      await autoSelectNextOperatorJob({ loadDetail: loadOperatorJobDetail });
    }
  } finally {
    state.operatorQueueLoading = false;
  }
}

export async function loadOperatorJobDetail(positionId) {
  if (!positionId) {
    state.operatorJobDetail = null;
    state.operatorStageEstimate = null;
    return;
  }
  try {
    state.operatorJobDetail = await api.getOperatorJob(positionId);
    if (state.operatorStage) {
      try {
        state.operatorStageEstimate = await api.getOperatorStageEstimate(
          positionId,
          state.operatorStage
        );
      } catch {
        state.operatorStageEstimate = null;
      }
    }
  } catch {
    state.operatorJobDetail = null;
    state.operatorStageEstimate = null;
  }
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

function isOnActiveSessionStage() {
  const sk = activeSessionStageKey();
  return !sk || sk === state.operatorStage;
}

function workOrderId(pos) {
  return pos?.orderId || state.operatorJobDetail?.position?.orderId || null;
}

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
    object: resolveObjectNameFromOrders(sess, state.orders) || (sess.object ?? ""),
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

function canReportProblem() {
  if (isSupervisorOperatorPanel()) return false;
  return Boolean(workPosition()?.id);
}

function canStart() {
  if (isSupervisorOperatorPanel()) return false;
  if (hasBlockingSession()) return false;
  if (!isOnActiveSessionStage()) return false;
  const pos = selectedPosition();
  if (!pos) return false;
  return ["Передано", "Не розпочато"].includes(pos[statusField()]);
}

function canFinish() {
  if (isSupervisorOperatorPanel()) return false;
  if (!hasBlockingSession() || !isOnActiveSessionStage()) return false;
  const pos = workPosition();
  if (!pos || activeSessionPositionId() !== pos.id) return false;
  return ["В роботі", "На паузі"].includes(pos[statusField()]);
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

function isSessionPaused() {
  const pos = workPosition();
  if (!pos || !hasBlockingSession()) return false;
  const field = statusFieldForStage(activeSessionStageKey() || state.operatorStage);
  return pos[field] === "На паузі";
}

function statusField() {
  return stageClientField(state.operatorStage);
}

function stageTheme(key) {
  return STAGE_THEME[key] || STAGE_THEME.cutting;
}

function userInitials(name) {
  const parts = String(name || "О")
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return (parts[0]?.[0] || "О").toUpperCase();
}

function renderOperatorNextAction(pos, field) {
  if (!pos) return "";
  const gm = resolvePositionGodmode(pos);
  const next = gm.nextAction;
  const alerts = [...(gm.blockers || []), ...(gm.warnings || [])].slice(0, 3);

  const status = pos[field];
  let afterFinish = "";
  if (status === "В роботі" && hasBlockingSession()) {
    afterFinish = "Після «Закінчив» позиція автоматично передасться на наступний етап.";
  }

  const warnList =
    alerts.length > 0
      ? `<ul class="op-warn-list">${alerts.map((w) => `<li>${escapeHtml(w.message || w.title || "")}</li>`).join("")}</ul>`
      : "";

  const advanceCta =
    next?.type === "advance_stage" && canFinish()
      ? `<button type="button" class="op-advance-cta" id="operatorFocusFinishBtn">Завершити: ${escapeHtml(next.label)}</button>`
      : next?.type === "advance_stage" && canStart()
        ? `<button type="button" class="op-advance-cta" id="operatorFocusStartBtn">Почати: ${escapeHtml(next.label)}</button>`
        : "";

  return `
    <div class="op-next-action" role="status">
      <strong>Наступна дія</strong>
      <span>${escapeHtml(next?.label || "Оберіть завдання з черги")}</span>
      ${afterFinish ? `<p class="op-hint">${escapeHtml(afterFinish)}</p>` : ""}
      ${advanceCta}
      ${warnList}
    </div>`;
}

function formatEstimateDeadline(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return "";
  }
}

function currentStageEstimate() {
  const sess = state.operatorActiveSession;
  if (
    sess?.position_id === workPosition()?.id &&
    sess?.stage_key === state.operatorStage &&
    sess?.stage_estimate
  ) {
    return {
      estimate: sess.stage_estimate,
      finishAt: sess.estimated_finish_at || sess.stage_estimate.estimatedFinishAt
    };
  }
  if (canStart() && state.operatorStageEstimate) {
    return { estimate: state.operatorStageEstimate, finishAt: null, preview: true };
  }
  return null;
}

function renderStageEstimateBlock() {
  const ctx = currentStageEstimate();
  if (!ctx?.estimate?.estimatedMinutes) return "";
  const est = ctx.estimate;
  const m = est.metrics || {};
  const finishLabel = ctx.finishAt ? formatEstimateDeadline(ctx.finishAt) : "";
  const previewNote = ctx.preview
    ? "Прогноз до натискання «Почав» — строк зафіксується при старті."
    : "Строк виготовлення на цьому етапі";

  return `
    <section class="op-stage-estimate" aria-label="Прогноз часу етапу">
      <h3 class="op-section-title">${ctx.preview ? "Прогноз" : "Строк виготовлення"}</h3>
      <p class="op-estimate-total">
        ${ctx.preview ? "Орієнтовно" : "Завершити до"}:
        <strong>${escapeHtml(formatStageEstimateLabel(est))}</strong>
        ${finishLabel ? ` · <span class="op-estimate-deadline">${escapeHtml(finishLabel)}</span>` : ""}
      </p>
      <p class="op-estimate-metrics enver-meta">
        ${m.partsCount ? `${m.partsCount} дет.` : ""}
        ${m.cutMeters ? ` · ${m.cutMeters} м порізки` : ""}
        ${m.edgeMeters ? ` · ${m.edgeMeters} м кромки` : ""}
        ${m.hardwareCount ? ` · ${m.hardwareCount} фурн.` : ""}
      </p>
      <p class="op-estimate-reason enver-meta">${escapeHtml(est.reason || "")} · впевненість ${Math.round((est.confidence || 0) * 100)}%</p>
      <p class="op-hint">${escapeHtml(previewNote)}</p>
    </section>`;
}

function renderJobMeta() {
  const job = state.operatorJobDetail;
  const positionId = job?.position?.id;
  const files = job?.constructiveFiles?.length
    ? job.constructiveFiles
    : job?.constructiveFileName
      ? [{ id: null, fileName: job.constructiveFileName, sizeBytes: 0 }]
      : [];
  if (!files.length) return "";

  const list = files
    .map((f) => {
      const href =
        f.id && positionId
          ? constructiveFileDownloadUrl(positionId, f.id)
          : positionId
            ? constructiveFileDownloadUrl(positionId)
            : "#";
      const size = f.sizeBytes > 0 ? ` · ${formatConstructiveSize(f.sizeBytes)}` : "";
      return `<a class="op-constructive-file" href="${href}" download>${escapeHtml(f.fileName)}${escapeHtml(size)}</a>`;
    })
    .join("");

  return `
    <section class="op-meta-card" aria-label="Конструктив">
      <span class="op-meta-label">Файли конструктива (${files.length})</span>
      <div class="op-constructive-files">${list}</div>
      ${job.material ? `<span class="op-meta-chip">${escapeHtml(job.material)}</span>` : ""}
    </section>`;
}

function operatorQueueSkeleton() {
  return `<div class="op-queue-skeleton" aria-busy="true">
    ${Array.from({ length: 4 })
      .map(() => '<div class="enver-skeleton op-skeleton-card"></div>')
      .join("")}
  </div>`;
}

function renderQueueItem(p, field, freshIds) {
  const status = p[field];
  const active = p.id === state.operatorSelectedPositionId;
  const blocking = hasBlockingSession();
  const working = blocking && p.id === activeSessionPositionId();
  const locked = blocking && p.id !== activeSessionPositionId();
  const order = state.orders.find(
    (o) => o.id === p.orderId || (p.orderNumber && o.orderNumber === p.orderNumber)
  );
  const { title: objectTitle } = formatObjectHeader(order, p);

  return `
    <div class="op-queue-swipe enver-swipe-host" data-queue-wrap="${p.id}">
      <div class="enver-swipe-reveal" aria-hidden="true">
        <span class="enver-swipe-action enver-swipe-action--right">${working ? "Готово" : "Почати"}</span>
        <span class="enver-swipe-action enver-swipe-action--left">Проблема</span>
      </div>
      <div class="enver-swipe-inner">
    <button type="button"
      class="op-queue-card enver-pressable ${active ? "is-active" : ""} ${working ? "is-working" : ""} ${locked ? "is-locked" : ""} ${freshIds.has(Number(p.id)) ? "is-fresh" : ""}"
      data-select-position="${p.id}" ${locked ? "disabled" : ""}>
      <div class="op-queue-card-top">
        <span class="op-queue-num">#${p.id}</span>
        ${working ? '<span class="op-pulse-dot"></span>' : ""}
        ${(p.overdueDays || 0) > 0 ? `<span class="op-overdue-tag">+${p.overdueDays} д</span>` : ""}
      </div>
      <span class="op-queue-order">${escapeHtml(objectTitle)}</span>
      ${p.item ? `<span class="op-queue-item">${escapeHtml(p.item)}</span>` : ""}
      <div class="op-queue-footer">${badge(status)} · ${p.progress || 0}%</div>
    </button>
      </div>
    </div>`;
}

function renderOperatorTaskHero(pos, field, stageKey, inWork) {
  const order = state.orders.find(
    (o) => o.id === pos.orderId || (pos.orderNumber && o.orderNumber === pos.orderNumber)
  );
  const { title: objectTitle, positionName } = formatObjectHeader(order, pos);
  const heroCompact = isCuttingOneScreen(stageKey) ? " op-task-hero--compact" : "";
  const heroLive = inWork && activeSessionPositionId() === pos.id ? " op-task-hero--live" : "";
  return `
            <div class="op-task-hero${heroCompact}${heroLive}">
              <div class="op-task-hero-top"><span class="op-task-id">#${pos.id}</span>${badge(pos[field])}</div>
              <h2 class="op-task-title">${escapeHtml(objectTitle)}</h2>
              ${positionName ? `<p class="op-task-subtitle">${escapeHtml(positionName)}</p>` : ""}
              <div class="op-progress-wrap">${progressRing(pos.progress || 0, { size: 72 })}<span class="op-progress-caption">Загальний прогрес</span></div>
              ${pos.problem ? `<p class="op-task-inline op-task-inline--problem">${escapeHtml(pos.problem)}</p>` : ""}
            </div>`;
}

export function renderOperatorView() {
  const stages = operatorStages();
  const stageKey = state.operatorStage || stages[0];
  const stage = OPERATOR_STAGES.find((s) => s.key === stageKey);
  const theme = stageTheme(stageKey);
  const pos = workPosition();
  const inWork = hasBlockingSession();
  const field = statusField();
  const freshQueueIds = newOperatorQueueIdsForStage(stageKey, state.operatorQueue);
  const sessionOnOtherStage = hasBlockingSession() && !isOnActiveSessionStage();
  const blockingStageKey = activeSessionStageKey();
  const blockingStage = OPERATOR_STAGES.find((s) => s.key === blockingStageKey);

  const stageTabs = stages
    .map((key) => {
      const s = OPERATOR_STAGES.find((x) => x.key === key);
      const t = stageTheme(key);
      return `<button type="button" class="op-stage-tab ${key === stageKey ? "is-active" : ""}" data-operator-stage="${key}" style="--tab-accent:${t.accent}">
        <span class="op-stage-tab-icon">${stageIconSvg(t.icon)}</span>${escapeHtml(s?.label || key)}
      </button>`;
    })
    .join("");

  const queueItems = [...state.operatorQueue]
    .sort((a, b) => {
      const sa = resolvePositionGodmode(a).attentionScore;
      const sb = resolvePositionGodmode(b).attentionScore;
      if (sb !== sa) return sb - sa;
      return (b.overdueDays || 0) - (a.overdueDays || 0);
    })
    .map((p) => renderQueueItem(p, field, freshQueueIds))
    .join("");

  const oneScreenClass = isCuttingOneScreen(stageKey) ? " op-one-screen" : "";

  return `
    <div class="operator-shell v3-operator${oneScreenClass}" data-stage="${escapeHtml(stageKey)}"
      style="--op-accent:${theme.accent};--op-gradient:${theme.gradient}">
      <header class="op-header">
        <div class="op-header-brand">
          <div class="op-logo-mark">${stageIconSvg(theme.icon)}</div>
          <div>
            ${brandLogoHtml("switch", "enver-brand--eyebrow")}
            <h1 class="op-title">${escapeHtml(stage?.label || stageLabel(stageKey))}</h1>
          </div>
        </div>
        <div class="op-header-user">
          <div class="op-avatar">${escapeHtml(userInitials(state.currentUser?.name))}</div>
          <strong>${escapeHtml(state.currentUser?.name || "Оператор")}</strong>
          <div class="op-header-actions">
            ${
              isPartScanStage(stageKey)
                ? `
            <button type="button" class="op-btn-ghost op-btn-scan" id="operatorScanBtn" title="Сканування деталі">
              <span class="op-scan-glyph" aria-hidden="true">${iconSvg("barcode")}</span><span class="op-scan-label">Сканувати</span>
            </button>`
                : ""
            }
            <button type="button" class="op-btn-ghost" id="operatorNotifySettingsBtn" title="Сповіщення" aria-label="Сповіщення">${iconSvg("bell")}</button>
            ${!isOperator() ? '<button type="button" class="op-btn-ghost" id="operatorBackBtn">← Назад</button>' : ""}
            ${isOperator() ? '<button type="button" class="op-btn-ghost op-btn-ghost-danger" id="operatorLogoutBtn">Вийти</button>' : ""}
          </div>
        </div>
      </header>

      ${stages.length > 1 ? `<nav class="op-stage-nav" aria-label="Етапи">${stageTabs}</nav>` : ""}

      ${
        sessionOnOtherStage
          ? `<div class="op-lock-banner" role="alert">
        <strong>Незавершене завдання</strong>
        <p>Завершіть #${activeSessionPositionId()} (${escapeHtml(state.operatorActiveSession?.order_number || "")} — ${escapeHtml(state.operatorActiveSession?.item || "")}) на етапі «${escapeHtml(blockingStage?.label || stageLabel(blockingStageKey || ""))}».</p>
        <button type="button" class="op-btn-ghost" data-operator-stage="${escapeHtml(blockingStageKey || "")}">Перейти до етапу</button>
      </div>`
          : ""
      }

      ${isSupervisorOperatorPanel() ? `<div class="op-supervisor-banner"><strong>Режим огляду</strong> — кнопки дій доступні лише операторам.</div>` : ""}

      <div class="op-layout">
        <aside class="op-queue-panel">
          <div class="op-panel-head"><h2>Черга</h2><span class="op-count-badge">${state.operatorQueue.length}</span></div>
          ${freshQueueIds.size ? `<button type="button" class="op-btn-ghost" id="operatorMarkSeenBtn">Позначити переглянутими (${freshQueueIds.size})</button>` : ""}
          <div class="op-queue-list">${
            state.operatorQueueLoading && !state.operatorQueue.length
              ? operatorQueueSkeleton()
              : queueItems ||
                renderSmartEmptyState({
                  icon: "🎯",
                  title: "Черга порожня",
                  text: "Нових задач на цьому етапі поки немає — перевірте пізніше або оберіть інший етап."
                })
          }</div>
        </aside>

        <main class="op-work-panel">
          ${
            pos
              ? `
            ${renderOperatorTaskHero(pos, field, stageKey, inWork)}
            ${renderStageEstimateBlock()}
            ${renderJobMeta()}
            ${renderOperatorNextAction(pos, field)}
            <section class="op-order-3d" id="operatorOrder3dSection" hidden>
              <div class="op-order-3d-head">
                <h3 class="op-section-title">3D модель</h3>
                <button type="button" class="btn btn-sm btn-primary" id="operatorOpen3dBtn" hidden>
                  На весь екран
                </button>
              </div>
              <div
                id="operatorOrder3dMount"
                class="op-order-3d-mount"
                data-order-id="${workOrderId(pos) || ""}"
                data-position-id="${pos.id}"
              ></div>
            </section>
          `
              : renderSmartEmptyState({
                  icon: "👆",
                  title: "Оберіть завдання",
                  text: "Натисніть картку в черзі зліва — етап, клієнт і дії зʼявляться тут."
                })
          }

          ${renderOperatorScanPanel(stageKey)}

          <div class="op-action-bar">
            <button type="button" class="op-action-btn op-action-btn--start enver-pressable" id="operatorStartBtn" ${canStart() ? "" : "disabled"}>Почав</button>
            <button type="button" class="op-action-btn op-action-btn--pause enver-pressable" id="operatorPauseBtn" ${canPause() || canResume() ? "" : "disabled"}>${canResume() ? "Продовжити" : "Пауза"}</button>
            <button type="button" class="op-action-btn op-action-btn--finish enver-pressable" id="operatorFinishBtn" ${canFinish() ? "" : "disabled"}>Закінчив</button>
            <button type="button" class="op-action-btn op-action-btn--problem enver-pressable" id="operatorProblemBtn" ${canReportProblem() ? "" : "disabled"}>Проблема</button>
          </div>
          <div class="op-problem-sheet" id="operatorProblemSheet" hidden aria-hidden="true">
            <button type="button" class="op-problem-sheet-backdrop" id="operatorProblemBackdrop" aria-label="Закрити"></button>
            <div class="op-problem-sheet-panel" role="dialog" aria-modal="true" aria-labelledby="opProblemTitle">
              <h3 id="opProblemTitle" class="op-problem-sheet-title">Що сталося?</h3>
              <div class="op-problem-presets">
                ${PROBLEM_PRESETS.map((label) => `<button type="button" class="op-problem-preset enver-pressable" data-problem-preset="${escapeHtml(label)}">${escapeHtml(label)}</button>`).join("")}
              </div>
              <label class="op-problem-custom-label" for="operatorProblemInput">Коментар</label>
              <textarea id="operatorProblemInput" rows="3" placeholder="Коротко опишіть проблему…"></textarea>
              <div class="op-problem-sheet-actions">
                <button type="button" class="op-btn-ghost enver-pressable" id="operatorProblemCancel">Скасувати</button>
                <button type="button" class="op-action-btn op-action-btn--problem enver-pressable" id="operatorProblemSubmit">Надіслати</button>
              </div>
            </div>
          </div>
          ${inWork && isSessionPaused() ? '<p class="op-hint">Завдання на паузі</p>' : ""}
        </main>
      </div>
    </div>`;
}

let operatorActionsBound = false;
let operatorOnChange = () => {};
let operatorStageSwitchSeq = 0;
let problemSheetReturnFocus = null;
const operatorSwipeCleanups = [];

export function isOperatorProblemSheetOpen() {
  const sheet = document.querySelector("#operatorProblemSheet");
  return Boolean(sheet && !sheet.hidden);
}

export function closeOperatorProblemSheet() {
  closeProblemSheet();
}

function openProblemSheet() {
  const sheet = document.querySelector("#operatorProblemSheet");
  const input = document.querySelector("#operatorProblemInput");
  if (!sheet) return;
  problemSheetReturnFocus = document.activeElement;
  sheet.hidden = false;
  sheet.setAttribute("aria-hidden", "false");
  if (input) {
    input.value = "";
    input.focus();
  }
}

function closeProblemSheet() {
  const sheet = document.querySelector("#operatorProblemSheet");
  if (!sheet) return;
  sheet.hidden = true;
  sheet.setAttribute("aria-hidden", "true");
  if (problemSheetReturnFocus?.focus) {
    problemSheetReturnFocus.focus();
    problemSheetReturnFocus = null;
  }
}

export function bindOperatorQueueSwipe() {
  operatorSwipeCleanups.forEach((fn) => fn());
  operatorSwipeCleanups.length = 0;
  if (!window.matchMedia("(pointer: coarse)").matches) return;

  document.querySelectorAll(".op-queue-swipe").forEach((wrap) => {
    const id = Number(wrap.dataset.queueWrap);
    const ctl = createSwipeActions(wrap, {
      onSwipeRight: async () => {
        state.operatorSelectedPositionId = id;
        await loadOperatorJobDetail(id);
        if (canStart()) {
          document.querySelector("#operatorStartBtn")?.click();
        } else if (canFinish()) {
          document.querySelector("#operatorFinishBtn")?.click();
        }
        operatorOnChange();
      },
      onSwipeLeft: () => {
        state.operatorSelectedPositionId = id;
        void loadOperatorJobDetail(id).then(() => {
          openProblemSheet();
          operatorOnChange();
        });
      }
    });
    operatorSwipeCleanups.push(() => ctl.destroy());
  });
}

export function bindOperatorActions(onChange) {
  operatorOnChange = onChange;
  if (operatorActionsBound) return;
  operatorActionsBound = true;

  document.addEventListener("click", async (e) => {
    if (e.target.closest("#operatorScanBtn, #operatorClientScanBtn")) {
      toggleOperatorScanPanel();
      return;
    }
    if (e.target.closest("#operatorClientBackBtn, #operatorPartScanBackBtn, #partScanBackBtn")) {
      handleOperatorScanBack();
      return;
    }
    if (e.target.closest("#operatorOpen3dBtn")) {
      const { openOperatorOrder3dWindow } = await import("./operator-3d.js");
      openOperatorOrder3dWindow();
      return;
    }
    if (!e.target.closest(".operator-shell")) return;
    if (e.target.closest("#operatorNotifySettingsBtn")) {
      const { navigateToNotificationSettings } = await import("./settings.js");
      navigateToNotificationSettings({ returnView: "operator" });
      operatorOnChange();
      return;
    }
    if (e.target.closest("#operatorBackBtn")) {
      closeOperatorView();
      notifyUiChanged();
      persistUiState();
      operatorOnChange();
      void (async () => {
        try {
          const { refreshAppData } = await import("./data-sync.js");
          await refreshAppData({ syncViews: true });
          operatorOnChange();
        } catch (err) {
          const { toastError } = await import("./toast.js");
          toastError(err.message || "Не вдалося оновити дані");
        }
      })();
      return;
    }
    if (e.target.closest("#operatorLogoutBtn")) {
      logout();
      state.view = "main";
      document.querySelector("#loginModal")?.classList.add("open");
      operatorOnChange();
      return;
    }
    const stageBtn = e.target.closest("[data-operator-stage]");
    if (stageBtn) {
      const nextStage = stageBtn.dataset.operatorStage;
      if (!nextStage) return;
      const seq = ++operatorStageSwitchSeq;
      state.operatorStage = nextStage;
      if (!hasBlockingSession()) state.operatorSelectedPositionId = null;
      try {
        await loadOperatorData();
      } catch (err) {
        state.operatorQueue = [];
        state.operatorLoadError = err?.message || "Не вдалося завантажити чергу";
      }
      if (seq !== operatorStageSwitchSeq) return;
      operatorOnChange();
      return;
    }
    const posBtn = e.target.closest("[data-select-position]");
    if (posBtn) {
      if (posBtn.closest(".op-queue-swipe")?.dataset.swipeHandled) return;
      if (
        activeSessionPositionId() &&
        Number(posBtn.dataset.selectPosition) !== activeSessionPositionId()
      )
        return;
      state.operatorSelectedPositionId = Number(posBtn.dataset.selectPosition);
      await loadOperatorJobDetail(state.operatorSelectedPositionId);
      await maybeAutoStartOperatorJob({
        onMutation: async (result) => afterOperatorMutation(result, operatorOnChange)
      });
      operatorOnChange();
      return;
    }
    if (e.target.closest("#operatorMarkSeenBtn")) {
      markOperatorStageSeen(state.operatorStage, state.operatorQueue);
      operatorOnChange();
      return;
    }

    const payload = () => ({
      userId: state.currentUser.id,
      positionId: workPosition()?.id,
      stageKey: state.operatorStage
    });

    if (e.target.closest("#operatorStartBtn") && canStart()) {
      const btn = document.querySelector("#operatorStartBtn");
      await runSave("Завдання", {
        submitEl: btn,
        saveFn: () => api.operatorStart(payload()),
        successMessage: "Роботу розпочато",
        onSuccess: (result) => afterOperatorMutation(result, operatorOnChange)
      }).catch(() => {});
    }
    if (e.target.closest("#operatorPauseBtn")) {
      const btn = document.querySelector("#operatorPauseBtn");
      if (canResume()) {
        await runSave("Завдання", {
          submitEl: btn,
          saveFn: () => api.operatorResume(payload()),
          onSuccess: (result) => afterOperatorMutation(result, operatorOnChange)
        }).catch(() => {});
      } else if (canPause()) {
        await runSave("Завдання", {
          submitEl: btn,
          saveFn: () => api.operatorPause(payload()),
          onSuccess: (result) => afterOperatorMutation(result, operatorOnChange)
        }).catch(() => {});
      }
    }
    if (e.target.closest("#operatorFocusFinishBtn")) {
      document.querySelector("#operatorFinishBtn")?.click();
      return;
    }
    if (e.target.closest("#operatorFocusStartBtn")) {
      document.querySelector("#operatorStartBtn")?.click();
      return;
    }
    if (e.target.closest("#operatorFinishBtn") && canFinish()) {
      const stageKey = state.operatorStage;
      const finishedId = workPosition()?.id;
      const card = document.querySelector(`[data-queue-wrap="${finishedId}"]`);
      const btn = document.querySelector("#operatorFinishBtn");
      if (card) card.classList.add("enver-card-exit");
      await runSave("Завдання", {
        submitEl: btn,
        saveFn: () => api.operatorFinish(payload()),
        successMessage: `Задачу завершено. ${finishSuccessMessage(stageKey)}`,
        onSuccess: async (result) => {
          state.operatorSelectedPositionId = null;
          await new Promise((r) => setTimeout(r, card ? 220 : 0));
          await afterOperatorMutation(result, operatorOnChange, { autoAdvance: true });
        }
      }).catch(() => {});
    }

    if (e.target.closest("#operatorProblemBtn") && canReportProblem()) {
      openProblemSheet();
      return;
    }

    if (
      e.target.closest("#operatorProblemBackdrop") ||
      e.target.closest("#operatorProblemCancel")
    ) {
      closeProblemSheet();
      return;
    }

    if (e.target.closest("[data-problem-preset]")) {
      const preset = e.target.closest("[data-problem-preset]").dataset.problemPreset;
      const input = document.querySelector("#operatorProblemInput");
      if (input && preset !== "Інше") {
        input.value = preset;
        void submitOperatorProblem();
      } else if (input) {
        input.focus();
      }
      return;
    }

    if (e.target.closest("#operatorProblemSubmit")) {
      e.preventDefault();
      void submitOperatorProblem();
      return;
    }
  });

  async function submitOperatorProblem() {
    if (!canReportProblem()) return;
    const comment = document.querySelector("#operatorProblemInput")?.value?.trim();
    if (!comment) return;
    const btn = document.querySelector("#operatorProblemSubmit");
    await runSave("Проблема", {
      submitEl: btn,
      saveFn: () =>
        api.operatorReportProblem({
          userId: state.currentUser.id,
          positionId: workPosition()?.id,
          stageKey: state.operatorStage,
          comment
        }),
      successMessage: "Проблему зафіксовано — менеджер отримає сповіщення",
      onSuccess: (result) => {
        closeProblemSheet();
        return afterOperatorMutation(result, operatorOnChange);
      }
    }).catch(() => {});
  }
}

export function shouldShowOperatorByDefault() {
  return isOperator() && hasOperatorAccess();
}
