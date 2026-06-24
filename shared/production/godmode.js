/**
 * GODMODE — чиста бізнес-логіка «автопілота» виробництва.
 * Без Express, DOM, БД та побічних ефектів.
 */
import { parseUaDate } from "../dates/ua-date.js";
import {
  computeProgress,
  deriveCurrentStage,
  derivePositionStatus,
  hasConstructive
} from "./position-logic.js";
import {
  HANDOFF_CHAIN,
  STAGE_STATUS_DONE,
  STAGE_STATUS_FIELD,
  STAGE_ACTIVE_STATUSES,
  getNextStatus,
  stageLabel
} from "./stages.js";
import {
  getConstructivePackageNextAction,
  getConstructivePackageWarnings
} from "./constructive-godmode.js";

const PRODUCTION_KEYS = ["cutting", "edging", "drilling", "assembly", "packaging"];

const HANDOFF_ACTIONS = {
  cutting: "handoff_to_edging",
  edging: "handoff_to_drilling",
  drilling: "handoff_to_assembly",
  assembly: "handoff_to_packaging",
  packaging: "ready_for_install"
};

const HANDOFF_LABELS = {
  constructor: {
    type: "handoff_to_cutting",
    label: "Передати на порізку",
    buttonLabel: "Передати"
  },
  cutting: { type: "handoff_to_edging", label: "Передати на крайкування", buttonLabel: "Передати" },
  edging: { type: "handoff_to_drilling", label: "Передати на присадку", buttonLabel: "Передати" },
  drilling: { type: "handoff_to_assembly", label: "Передати на збірку", buttonLabel: "Передати" },
  assembly: {
    type: "handoff_to_packaging",
    label: "Передати на пакування",
    buttonLabel: "Передати"
  },
  packaging: {
    type: "ready_for_install",
    label: "Готово до встановлення",
    buttonLabel: "Підтвердити"
  }
};

const SCORE = {
  blocker: 100,
  overdue: 80,
  problem: 70,
  missing_constructive: 50,
  ready_for_install: 40,
  warning: 20,
  normal: 0
};

const IDLE_DAYS_WARNING = 3;
const IN_PROGRESS_DAYS_WARNING = 7;

function field(row, snake, camel) {
  const v = row?.[snake] ?? row?.[camel];
  return v == null ? "" : String(v);
}

function num(row, snake, camel) {
  return Number(row?.[snake] ?? row?.[camel]) || 0;
}

function positionStatus(row) {
  return field(row, "position_status", "positionStatus");
}

function stageStatus(row, stageKey) {
  if (stageKey === "constructor") {
    return hasConstructive(row) ? "Передано" : "Не розпочато";
  }
  const snake = STAGE_STATUS_FIELD[stageKey];
  const camel =
    stageKey === "cutting"
      ? "cuttingStatus"
      : stageKey === "edging"
        ? "edgingStatus"
        : stageKey === "drilling"
          ? "drillingStatus"
          : stageKey === "assembly"
            ? "assemblyStatus"
            : "packagingStatus";
  return field(row, snake, camel) || "Не розпочато";
}

function installDate(row) {
  return field(row, "install_date", "installDate").trim();
}

function planDate(row, context) {
  return field(row, "plan_date", "planDate").trim() || context?.planDate?.trim() || "";
}

function hasAiAnalysis(row, context) {
  if (context?.hasAiAnalysis != null) return Boolean(context.hasAiAnalysis);
  if (row?.has_ai_analysis != null) return Boolean(row.has_ai_analysis);
  if (row?.hasAiAnalysis != null) return Boolean(row.hasAiAnalysis);
  return num(row, "ai_analysis_count", "aiAnalysisCount") > 0;
}

function tasksCreated(row, context) {
  if (context?.tasksCreated != null) return Boolean(context.tasksCreated);
  if (row?.tasks_created != null) return Boolean(row.tasks_created);
  if (row?.tasksCreated != null) return Boolean(row.tasksCreated);
  return PRODUCTION_KEYS.some((k) => {
    const s = stageStatus(row, k);
    return s && s !== "Не розпочато";
  });
}

function productionReady(row) {
  return (
    hasConstructive(row) &&
    PRODUCTION_KEYS.every((k) => {
      const s = stageStatus(row, k);
      return STAGE_STATUS_DONE.has(s) || s === "Не потрібно";
    })
  );
}

function enrichRow(position, _context = {}) {
  const row = { ...position };
  const progress = num(row, "progress", "progress") || computeProgress(row);
  const position_status = positionStatus(row) || derivePositionStatus({ ...row, progress });
  const current_stage =
    field(row, "current_stage", "currentStage") ||
    deriveCurrentStage({ ...row, progress, position_status });
  const overdue_days = num(row, "overdue_days", "overdueDays");
  return { ...row, progress, position_status, current_stage, overdue_days };
}

function makeAction({
  type,
  label,
  description = "",
  buttonLabel = "Виконати",
  priority = "normal",
  allowed = true,
  reason = null,
  stageKey = null,
  targetStatus = null
}) {
  return {
    type,
    label,
    description,
    buttonLabel,
    priority,
    allowed,
    reason,
    stageKey,
    targetStatus
  };
}

function stageIdleDays(row, stageKey, context) {
  const ts = context?.stageTimestamps?.[stageKey] ?? context?.stageTimestamps?.[stageKey];
  if (!ts) return 0;
  const started = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(started.getTime())) return 0;
  const now = context?.now instanceof Date ? context.now : new Date();
  return Math.floor((now.getTime() - started.getTime()) / 86400000);
}

/** Попередження для позиції. */
export function getPositionWarnings(position, context = {}) {
  const row = enrichRow(position, context);
  const warnings = [];
  const overdue = row.overdue_days;

  if (!planDate(row, context) && !context?.planDate) {
    warnings.push({
      type: "missing_due_date",
      level: "warning",
      title: "Немає планової дати",
      message: "Позиція не має планової дати завершення."
    });
  }

  if (!hasConstructive(row)) {
    warnings.push({
      type: "missing_constructive",
      level: "warning",
      title: "Немає конструктива",
      message: "Завантажте файл конструктива для запуску виробництва."
    });
  } else if (
    !context?.packageStatus &&
    !context?.hasConstructivePackage &&
    !hasAiAnalysis(row, context)
  ) {
    warnings.push({
      type: "ai_not_run",
      level: "warning",
      title: "ШІ-аналіз не виконано",
      message: "Запустіть ШІ-аналіз конструктива для рекомендацій по задачах."
    });
  } else if (
    !context?.packageStatus &&
    !context?.hasConstructivePackage &&
    !tasksCreated(row, context)
  ) {
    warnings.push({
      type: "tasks_not_created",
      level: "warning",
      title: "Задачі не створені",
      message: "Створіть виробничі задачі з рекомендацій ШІ."
    });
  }

  if (overdue > 0) {
    warnings.push({
      type: "overdue",
      level: "warning",
      title: "Прострочено",
      message: `Позиція прострочена на ${overdue} дн.`
    });
  }

  const currentKey = row.current_stage;
  const status = stageStatus(row, currentKey);
  const idleDays = stageIdleDays(row, currentKey, context);

  if (status === "Передано" && idleDays >= IDLE_DAYS_WARNING) {
    warnings.push({
      type: "stage_idle_too_long",
      level: "warning",
      title: "Етап очікує запуску",
      message: `Етап «${stageLabel(currentKey)}» у черзі вже ${idleDays} дн.`
    });
  }

  if (status === "В роботі" && idleDays >= IN_PROGRESS_DAYS_WARNING) {
    warnings.push({
      type: "stage_in_progress_too_long",
      level: "warning",
      title: "Етап триває довго",
      message: `Етап «${stageLabel(currentKey)}» у роботі вже ${idleDays} дн.`
    });
  }

  if (
    productionReady(row) &&
    positionStatus(row) === "Готово до встановлення" &&
    !installDate(row)
  ) {
    warnings.push({
      type: "install_not_scheduled",
      level: "warning",
      title: "Монтаж не заплановано",
      message: "Виробництво завершено — заплануйте монтаж."
    });
  }

  if (productionReady(row)) {
    warnings.push({
      type: "ready_for_install",
      level: "info",
      title: "Готово до монтажу",
      message: "Усі етапи виробництва завершені."
    });
  }

  const problem = field(row, "problem", "problem").trim();
  if (problem || status === "Проблема") {
    warnings.push({
      type: "operator_problem",
      level: "warning",
      title: "Проблема на етапі",
      message: problem || `Проблема на етапі «${stageLabel(currentKey)}».`
    });
  }

  warnings.push(...getConstructivePackageWarnings(context));

  return warnings;
}

/** Блокери для позиції. */
export function getPositionBlockers(position, context = {}) {
  const row = enrichRow(position, context);
  const blockers = [];
  const problem = field(row, "problem", "problem").trim();

  if (problem || positionStatus(row) === "Проблема") {
    blockers.push({
      type: "operator_problem",
      level: "blocker",
      title: "Проблема",
      message: problem || "Позиція зі статусом «Проблема» — спочатку вирішіть проблему."
    });
  }

  if (!hasConstructive(row)) {
    blockers.push({
      type: "missing_constructive",
      level: "blocker",
      title: "Немає конструктива",
      message: "Неможливо передати у виробництво без файлу конструктива."
    });
  }

  if (context?.hasActiveOperatorSession) {
    blockers.push({
      type: "active_operator_session",
      level: "blocker",
      title: "Активна сесія оператора",
      message: "Неможливо видалити позицію — оператор працює над нею."
    });
  }

  const currentKey = row.current_stage;
  if (currentKey === "drilling" || currentKey === "assembly") {
    const needsAssembler = !field(row, "assembly_responsible", "assemblyResponsible").trim();
    if (needsAssembler && !STAGE_STATUS_DONE.has(stageStatus(row, currentKey))) {
      blockers.push({
        type: "missing_assignment",
        level: "blocker",
        title: "Немає відповідального",
        message: `Призначте збирача для етапу «${stageLabel(currentKey)}».`
      });
    }
  }

  return blockers;
}

/** Блокери для замовлення. */
export function getOrderBlockers(order, positions = [], context = {}) {
  const blockers = [];
  const status = field(order, "status", "status");
  const roots = positions.filter((p) => !(p.parentId ?? p.parent_id));

  if (roots.length === 0 && status !== "Новий" && status !== "Завершено") {
    blockers.push({
      type: "no_positions",
      level: "blocker",
      title: "Немає позицій",
      message: "Додайте хоча б одну позицію до замовлення."
    });
  }

  const unfinished = roots.filter((p) => {
    const ps = field(p, "position_status", "positionStatus") || positionStatus(p);
    return ps !== "Завершено";
  });

  if (status === "Завершено" && unfinished.length > 0) {
    blockers.push({
      type: "unfinished_positions",
      level: "blocker",
      title: "Незавершені позиції",
      message: `Залишилось ${unfinished.length} незавершених позицій.`
    });
  }

  for (const p of roots) {
    if (!productionReady(p) && installDate(p)) {
      blockers.push({
        type: "install_before_production",
        level: "blocker",
        title: "Монтаж занадто рано",
        message: `Позиція «${field(p, "item", "item") || "—"}»: монтаж можна запланувати після завершення виробництва.`
      });
    }
  }

  if (context?.operatorHasActiveTask) {
    blockers.push({
      type: "operator_active_task",
      level: "blocker",
      title: "Активне завдання",
      message: "Спочатку завершіть поточне завдання оператора."
    });
  }

  return blockers;
}

/** Попередження для замовлення. */
export function getOrderWarnings(order, positions = [], context = {}) {
  const warnings = [];
  const plan = field(order, "plan_date", "planDate").trim();
  if (!plan) {
    warnings.push({
      type: "missing_due_date",
      level: "warning",
      title: "Немає планової дати",
      message: "Замовлення не має планової дати завершення."
    });
  }

  const roots = positions.filter((p) => !(p.parentId ?? p.parent_id));
  for (const p of roots) {
    const pw = getPositionWarnings(p, { ...context, planDate: plan });
    for (const w of pw) {
      if (w.type === "missing_due_date") continue;
      warnings.push({ ...w, positionId: p.id ?? p.id });
    }
  }

  return warnings;
}

/** Наступна дія для позиції. */
export function getPositionNextAction(position, context = {}) {
  const row = enrichRow(position, context);
  const blockers = getPositionBlockers(row, context);

  if (blockers.some((b) => b.type === "operator_problem")) {
    const b = blockers.find((x) => x.type === "operator_problem");
    return makeAction({
      type: "resolve_problem",
      label: "Виправити проблему",
      description: b.message,
      buttonLabel: "Виправити",
      priority: "high",
      allowed: false,
      reason: b.message
    });
  }

  if (!hasConstructive(row)) {
    return makeAction({
      type: "upload_constructive",
      label: "Завантажити конструктив",
      description: "Для запуску виробництва потрібно завантажити файл конструктива.",
      buttonLabel: "Завантажити",
      priority: "high",
      allowed: true,
      stageKey: "constructor"
    });
  }

  const packageAction = getConstructivePackageNextAction(context);
  if (
    packageAction &&
    context?.packageStatus &&
    context.packageStatus !== "released_to_cnc" &&
    context.packageStatus !== "archived"
  ) {
    return makeAction({ ...packageAction, stageKey: packageAction.stageKey || "constructor" });
  }

  if (!hasAiAnalysis(row, context)) {
    return makeAction({
      type: "run_ai_analysis",
      label: "Запустити ШІ-аналіз",
      description: "Проаналізуйте конструктив для отримання рекомендацій по задачах.",
      buttonLabel: "Запустити",
      priority: "high",
      allowed: true,
      stageKey: "constructor"
    });
  }

  if (!tasksCreated(row, context)) {
    return makeAction({
      type: "create_tasks_from_ai",
      label: "Створити задачі з рекомендацій ШІ",
      description: "Підтвердіть або оберіть виробничі задачі на основі аналізу ШІ.",
      buttonLabel: "Створити",
      priority: "high",
      allowed: true,
      stageKey: "constructor"
    });
  }

  const cuttingStatus = stageStatus(row, "cutting");
  if (cuttingStatus === "Не розпочато" || cuttingStatus === "Передано") {
    const cfg = HANDOFF_LABELS.constructor;
    return makeAction({
      type: cfg.type,
      label: cfg.label,
      description: "Конструктив готовий — передайте позицію на порізку.",
      buttonLabel: cfg.buttonLabel,
      priority: "high",
      allowed: !blockers.some((b) => b.type === "missing_constructive"),
      reason: blockers.find((b) => b.type === "missing_constructive")?.message ?? null,
      stageKey: "cutting",
      targetStatus: "Передано"
    });
  }

  for (const stageKey of PRODUCTION_KEYS) {
    const status = stageStatus(row, stageKey);
    if (STAGE_STATUS_DONE.has(status) || status === "Не потрібно") {
      const nextKey = HANDOFF_CHAIN[stageKey];
      if (!nextKey) continue;
      const nextStatus = stageStatus(row, nextKey);
      if (nextStatus === "Не розпочато") {
        const cfg = HANDOFF_LABELS[stageKey];
        return makeAction({
          type: cfg?.type || HANDOFF_ACTIONS[stageKey],
          label: cfg?.label || `Передати на «${stageLabel(nextKey)}»`,
          description: `Етап «${stageLabel(stageKey)}» завершено.`,
          buttonLabel: cfg?.buttonLabel || "Передати",
          priority: "normal",
          allowed: true,
          stageKey: nextKey,
          targetStatus: "Передано"
        });
      }
      continue;
    }

    if (STAGE_ACTIVE_STATUSES.has(status)) {
      const nextStatus = getNextStatus(status);
      const verb =
        status === "Передано"
          ? "Почати роботу"
          : status === "В роботі"
            ? "Завершити етап"
            : status === "На паузі"
              ? "Продовжити роботу"
              : "Продовжити";
      return makeAction({
        type: "advance_stage",
        label: `${verb}: ${stageLabel(stageKey)}`,
        description: `Поточний етап — «${stageLabel(stageKey)}» (${status}).`,
        buttonLabel: verb,
        priority: status === "Проблема" ? "high" : "normal",
        allowed: status !== "Проблема",
        reason: status === "Проблема" ? "Спочатку вирішіть проблему на етапі." : null,
        stageKey,
        targetStatus: nextStatus
      });
    }
  }

  if (productionReady(row)) {
    if (positionStatus(row) === "Завершено") {
      return makeAction({
        type: "close_position",
        label: "Позиція закрита",
        description: "Усі роботи завершені.",
        buttonLabel: "Закрито",
        priority: "low",
        allowed: false,
        stageKey: "install"
      });
    }

    if (!installDate(row)) {
      return makeAction({
        type: "schedule_install",
        label: "Запланувати монтаж",
        description: "Виробництво завершено — призначте дату монтажу.",
        buttonLabel: "Запланувати",
        priority: "high",
        allowed: productionReady(row),
        reason: productionReady(row) ? null : "Спочатку завершіть усі етапи виробництва.",
        stageKey: "install"
      });
    }

    return makeAction({
      type: "wait_install",
      label: "Очікує монтаж",
      description: installDate(row)
        ? `Монтаж заплановано на ${installDate(row)}.`
        : "Очікується монтаж.",
      buttonLabel: "Переглянути",
      priority: "normal",
      allowed: false,
      stageKey: "install"
    });
  }

  return makeAction({
    type: "advance_stage",
    label: "Продовжити виробництво",
    description: "Продовжіть роботу на поточному етапі.",
    buttonLabel: "Продовжити",
    priority: "normal",
    allowed: true,
    stageKey: row.current_stage
  });
}

/** Наступна дія для замовлення (за головною позицією). */
export function getOrderNextAction(order, positions = [], context = {}) {
  const roots = positions.filter((p) => !(p.parentId ?? p.parent_id));
  const orderBlockers = getOrderBlockers(order, positions, context);

  if (orderBlockers.length) {
    const b = orderBlockers[0];
    return makeAction({
      type: "blocked",
      label: b.title,
      description: b.message,
      buttonLabel: "Виправити",
      priority: "high",
      allowed: false,
      reason: b.message
    });
  }

  if (!roots.length) {
    return makeAction({
      type: "add_position",
      label: "Додати позицію",
      description: "Створіть першу позицію для замовлення.",
      buttonLabel: "Додати",
      priority: "high",
      allowed: true
    });
  }

  const sorted = [...roots].sort(
    (a, b) =>
      getAttentionScore(b, getPositionWarnings(b, context), getPositionBlockers(b, context)) -
      getAttentionScore(a, getPositionWarnings(a, context), getPositionBlockers(a, context))
  );

  const main = sorted[0];
  const next = getPositionNextAction(main, {
    ...context,
    planDate: field(order, "plan_date", "planDate")
  });

  const allDone = roots.every((p) => positionStatus(p) === "Завершено");
  if (allDone) {
    return makeAction({
      type: "close_order",
      label: "Закрити замовлення",
      description: "Усі позиції завершені.",
      buttonLabel: "Закрити",
      priority: "normal",
      allowed: true
    });
  }

  return next;
}

/** Оцінка уваги для сутності. */
export function getAttentionScore(entity, warnings = [], blockers = []) {
  let score = SCORE.normal;

  for (const b of blockers) {
    score = Math.max(score, SCORE.blocker);
    if (b.type === "missing_constructive") score = Math.max(score, SCORE.missing_constructive);
  }

  for (const w of warnings) {
    if (w.type === "overdue") score = Math.max(score, SCORE.overdue);
    else if (w.type === "operator_problem") score = Math.max(score, SCORE.problem);
    else if (w.type === "missing_constructive") score = Math.max(score, SCORE.missing_constructive);
    else if (w.type === "ready_for_install") score = Math.max(score, SCORE.ready_for_install);
    else score = Math.max(score, SCORE.warning);
  }

  const overdue = num(entity, "overdue_days", "overdueDays");
  if (overdue > 0) score = Math.max(score, SCORE.overdue);

  const problem = field(entity, "problem", "problem").trim();
  if (problem || positionStatus(entity) === "Проблема") score = Math.max(score, SCORE.problem);

  return score;
}

function deriveHealth(warnings, blockers, entity) {
  if (blockers.length) return "blocked";
  const overdue = num(entity, "overdue_days", "overdueDays");
  if (overdue > 0 || warnings.some((w) => w.type === "overdue")) return "overdue";
  if (warnings.some((w) => w.level === "warning" || w.level === "info")) return "warning";
  return "ok";
}

function buildBadges(warnings, blockers, health, attentionScore) {
  const badges = [];
  if (health === "blocked") badges.push({ type: "blocked", label: "Заблоковано" });
  if (health === "overdue") badges.push({ type: "overdue", label: "Прострочено" });
  if (health === "warning") badges.push({ type: "warning", label: "Увага" });
  if (attentionScore >= SCORE.ready_for_install)
    badges.push({ type: "attention", label: "Потребує уваги" });
  if (blockers.length) badges.push({ type: "blockers", label: `${blockers.length} блок.` });
  if (warnings.length) badges.push({ type: "warnings", label: `${warnings.length} уваг.` });
  return badges;
}

function buildAutomationHints(position, context) {
  const hints = [];
  const row = enrichRow(position, context);
  if (hasConstructive(row) && row.current_stage !== "constructor") {
    hints.push({
      type: "qr_recommended",
      message: "Для цієї позиції можна згенерувати QR для цеху."
    });
  }
  if (hasAiAnalysis(row, context) && !tasksCreated(row, context)) {
    hints.push({
      type: "ai_tasks_ready",
      message: "ШІ підготував рекомендації — можна створити задачі однією кнопкою."
    });
  }
  return hints;
}

/** Повний godmode для позиції. */
export function buildPositionGodmode(position, context = {}) {
  const row = enrichRow(position, context);
  const warnings = getPositionWarnings(row, context);
  const blockers = getPositionBlockers(row, context);
  const nextAction = getPositionNextAction(row, context);
  const attentionScore = getAttentionScore(row, warnings, blockers);
  const health = deriveHealth(warnings, blockers, row);
  const automationHints = buildAutomationHints(row, context);

  return {
    currentStage: row.current_stage,
    progress: row.progress,
    health,
    attentionScore,
    nextAction,
    warnings,
    blockers,
    badges: buildBadges(warnings, blockers, health, attentionScore),
    automationHints
  };
}

/** Повний godmode для замовлення. */
export function buildOrderGodmode(order, positions = [], context = {}) {
  const roots = positions.filter((p) => !(p.parentId ?? p.parent_id));
  const plan = field(order, "plan_date", "planDate");
  const ctx = { ...context, planDate: plan };

  const positionGodmodes = roots.map((p) => ({
    positionId: p.id,
    godmode: buildPositionGodmode(p, ctx)
  }));

  const warnings = getOrderWarnings(order, positions, ctx);
  const blockers = getOrderBlockers(order, positions, ctx);
  const nextAction = getOrderNextAction(order, positions, ctx);
  const attentionScore = Math.max(
    getAttentionScore(order, warnings, blockers),
    ...positionGodmodes.map((pg) => pg.godmode.attentionScore),
    0
  );

  const avgProgress =
    roots.length > 0
      ? Math.round(
          roots.reduce((s, p) => s + (num(p, "progress", "progress") || computeProgress(p)), 0) /
            roots.length
        )
      : 0;

  const currentStage =
    positionGodmodes.sort((a, b) => b.godmode.attentionScore - a.godmode.attentionScore)[0]?.godmode
      ?.currentStage || "constructor";

  const health = deriveHealth(warnings, blockers, order);

  return {
    currentStage,
    progress: avgProgress,
    health,
    attentionScore,
    nextAction,
    warnings,
    blockers,
    badges: buildBadges(warnings, blockers, health, attentionScore),
    automationHints: [],
    positions: positionGodmodes
  };
}

function entityLabel(entity) {
  const orderNumber = field(entity, "order_number", "orderNumber");
  const item = field(entity, "item", "item");
  return orderNumber && item ? `${orderNumber} / ${item}` : orderNumber || item || "—";
}

/** Генерація сповіщень з поточного стану. */
export function buildNotifications({
  orders: _orders = [],
  positions = [],
  users: _users = [],
  now = new Date()
} = {}) {
  const notifications = [];
  const ts = now instanceof Date ? now.toISOString() : new Date(now).toISOString();
  const today = now instanceof Date ? now : new Date(now);
  today.setHours(0, 0, 0, 0);

  const ctx = {
    now,
    stageTimestamps: {}
  };

  for (const p of positions) {
    if (p.parentId ?? p.parent_id) continue;
    const posCtx = {
      ...ctx,
      hasAiAnalysis: hasAiAnalysis(p, ctx),
      stageTimestamps: p._stageTimestamps || ctx.stageTimestamps
    };
    const gm = buildPositionGodmode(p, posCtx);
    const id = p.id ?? p.id;
    const label = entityLabel(p);

    for (const w of gm.warnings) {
      if (w.type === "missing_constructive") {
        notifications.push({
          id: `position-${id}-missing-constructive`,
          type: "missing_constructive",
          level: "warning",
          title: "Позиція очікує конструктив",
          message: `Позиція ${label} не має завантаженого конструктива.`,
          entityType: "position",
          entityId: id,
          actionType: "upload_constructive",
          createdAt: ts
        });
      }
      if (w.type === "tasks_not_created") {
        notifications.push({
          id: `position-${id}-tasks-not-created`,
          type: "tasks_not_created",
          level: "warning",
          title: "Задачі не створені",
          message: `Позиція ${label}: створіть задачі з рекомендацій ШІ.`,
          entityType: "position",
          entityId: id,
          actionType: "create_tasks_from_ai",
          createdAt: ts
        });
      }
      if (w.type === "overdue") {
        notifications.push({
          id: `position-${id}-overdue`,
          type: "overdue",
          level: "warning",
          title: "Прострочено",
          message: `Позиція ${label} прострочена.`,
          entityType: "position",
          entityId: id,
          actionType: "advance_stage",
          createdAt: ts
        });
      }
      if (w.type === "ready_for_install") {
        notifications.push({
          id: `position-${id}-ready-install`,
          type: "ready_for_install",
          level: "info",
          title: "Готово до монтажу",
          message: `Позиція ${label} готова до встановлення.`,
          entityType: "position",
          entityId: id,
          actionType: "schedule_install",
          createdAt: ts
        });
      }
      if (w.type === "operator_problem") {
        notifications.push({
          id: `position-${id}-operator-problem`,
          type: "operator_problem",
          level: "warning",
          title: "Проблема оператора",
          message: `Позиція ${label}: ${w.message}`,
          entityType: "position",
          entityId: id,
          actionType: "resolve_problem",
          createdAt: ts
        });
      }
    }

    for (const b of gm.blockers) {
      notifications.push({
        id: `position-${id}-blocked-${b.type}`,
        type: "blocked",
        level: "blocker",
        title: b.title,
        message: `Позиція ${label}: ${b.message}`,
        entityType: "position",
        entityId: id,
        actionType: gm.nextAction?.type || "blocked",
        createdAt: ts
      });
    }

    const next = gm.nextAction;
    if (next?.type?.startsWith("handoff_to_") && next.allowed) {
      notifications.push({
        id: `position-${id}-ready-next-stage`,
        type: "ready_for_next_stage",
        level: "info",
        title: "Готово до передачі",
        message: `Позиція ${label}: ${next.label}.`,
        entityType: "position",
        entityId: id,
        actionType: next.type,
        createdAt: ts
      });
    }

    if (
      hasAiAnalysis(p, posCtx) &&
      !tasksCreated(p, posCtx) &&
      !gm.warnings.some((w) => w.type === "tasks_not_created")
    ) {
      notifications.push({
        id: `position-${id}-ai-ready`,
        type: "ai_ready",
        level: "info",
        title: "ШІ-аналіз готовий",
        message: `Позиція ${label}: можна створити задачі з рекомендацій ШІ.`,
        entityType: "position",
        entityId: id,
        actionType: "create_tasks_from_ai",
        createdAt: ts
      });
    }

    const inst = installDate(p);
    const instParsed = parseUaDate(inst);
    if (instParsed) {
      instParsed.setHours(0, 0, 0, 0);
      if (instParsed.getTime() === today.getTime()) {
        notifications.push({
          id: `position-${id}-install-today`,
          type: "install_today",
          level: "info",
          title: "Монтаж сьогодні",
          message: `Позиція ${label}: монтаж заплановано на сьогодні.`,
          entityType: "position",
          entityId: id,
          actionType: "wait_install",
          createdAt: ts
        });
      }
    }
  }

  for (const order of _orders) {
    const status = field(order, "status", "status");
    if (status === "Завершено") continue;

    const orderId = order.id;
    if (orderId == null) continue;
    const orderNumber = field(order, "order_number", "orderNumber");
    const manager = field(order, "manager", "manager").trim();

    if (!manager && status !== "Новий") {
      notifications.push({
        id: `order-${orderId}-assignment`,
        type: "order_assignment",
        level: "warning",
        title: "Немає відповідального",
        message: `Замовлення ${orderNumber}: не призначено менеджера замовлення.`,
        entityType: "order",
        entityId: orderId,
        actionType: "open_order",
        createdAt: ts
      });
    }

    const related = positions.filter(
      (p) =>
        (p.order_id ?? p.orderId) === orderId ||
        field(p, "order_number", "orderNumber") === orderNumber
    );
    const orderGm = buildOrderGodmode(order, related, ctx);

    for (const b of orderGm.blockers) {
      notifications.push({
        id: `order-${orderId}-blocker-${b.type}`,
        type: b.type,
        level: "blocker",
        title: b.title || "Замовлення",
        message: `Замовлення ${orderNumber}: ${b.message}`,
        entityType: "order",
        entityId: orderId,
        actionType:
          orderGm.nextAction?.type === "add_position" ? "add_position" : orderGm.nextAction?.type,
        createdAt: ts
      });
    }

    for (const w of orderGm.warnings) {
      if (w.type === "missing_due_date") {
        notifications.push({
          id: `order-${orderId}-missing-due-date`,
          type: "missing_due_date",
          level: "warning",
          title: "Немає планової дати",
          message: `Замовлення ${orderNumber} не має планової дати завершення.`,
          entityType: "order",
          entityId: orderId,
          actionType: "open_order",
          createdAt: ts
        });
      }
    }

    const next = orderGm.nextAction;
    if (next?.type === "close_order" && next.allowed !== false) {
      notifications.push({
        id: `order-${orderId}-close-ready`,
        type: "close_order",
        level: "info",
        title: "Можна закрити замовлення",
        message: `Замовлення ${orderNumber}: усі позиції завершені.`,
        entityType: "order",
        entityId: orderId,
        actionType: "close_order",
        createdAt: ts
      });
    } else if (next?.type === "add_position" && next.allowed !== false) {
      notifications.push({
        id: `order-${orderId}-add-position`,
        type: "add_position",
        level: "warning",
        title: "Додати позицію",
        message: `Замовлення ${orderNumber}: ${next.description || next.label}`,
        entityType: "order",
        entityId: orderId,
        actionType: "add_position",
        createdAt: ts
      });
    }
  }

  const seen = new Set();
  const unique = notifications.filter((n) => {
    if (seen.has(n.id)) return false;
    seen.add(n.id);
    return true;
  });

  return unique.sort((a, b) => {
    const levelRank = { blocker: 0, warning: 1, info: 2 };
    return (levelRank[a.level] ?? 9) - (levelRank[b.level] ?? 9);
  });
}

const HANDOFF_TYPES = new Set([
  "handoff_to_cutting",
  "handoff_to_edging",
  "handoff_to_drilling",
  "handoff_to_assembly",
  "handoff_to_packaging",
  "ready_for_install"
]);

const INPUT_REQUIRED_TYPES = new Set([
  "upload_constructive",
  "run_ai_analysis",
  "create_tasks_from_ai",
  "schedule_install"
]);

/** Чи може користувач виконати дію. */
export function canRunNextAction(entity, action, user, context = {}) {
  if (!action?.type) {
    return { allowed: false, reason: "Дію не визначено." };
  }

  if (INPUT_REQUIRED_TYPES.has(action.type)) {
    return {
      allowed: false,
      code: "ACTION_REQUIRES_INPUT",
      reason:
        action.type === "upload_constructive"
          ? "Для цього потрібно завантажити файл конструктива."
          : action.type === "run_ai_analysis"
            ? "Запустіть ШІ-аналіз через форму конструктива."
            : action.type === "create_tasks_from_ai"
              ? "Оберіть задачі в інтерфейсі ШІ-аналізу."
              : "Заповніть необхідні дані в формі."
    };
  }

  const role = user?.role || user?.roleId || "";
  const isOperator = role === "operator";
  const isAdmin = role === "admin";
  const isProduction = role === "production" || isAdmin;

  if (isOperator) {
    if (HANDOFF_TYPES.has(action.type)) {
      return { allowed: false, reason: "Передачу між етапами виконує начальник виробництва." };
    }
    if (context?.operatorHasActiveTask && action.type === "advance_stage") {
      return {
        allowed: false,
        reason: "Спочатку завершіть поточне завдання (натисніть «Закінчив»)."
      };
    }
    return { allowed: action.type === "advance_stage", reason: null };
  }

  if (HANDOFF_TYPES.has(action.type)) {
    if (!isProduction && !isAdmin) {
      return { allowed: false, reason: "Недостатньо прав для передачі між етапами." };
    }
    const blockers = getPositionBlockers(entity, context);
    if (blockers.some((b) => b.type === "missing_constructive")) {
      return { allowed: false, reason: "Цю позицію ще не можна передати у виробництво." };
    }
    return { allowed: true, reason: null };
  }

  if (action.type === "close_order" || action.type === "close_position") {
    return { allowed: isProduction || role === "manager", reason: null };
  }

  return { allowed: action.allowed !== false, reason: action.reason || null };
}
