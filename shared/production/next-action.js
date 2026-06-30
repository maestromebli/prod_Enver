import { deriveCurrentStage, hasConstructive } from "./position-logic.js";
import {
  STAGES,
  ALL_STAGE_KEYS,
  STAGE_STATUS_DONE,
  STAGE_STATUS_FIELD,
  getNextStatus,
  stageLabel
} from "./stages.js";

function field(row, snake, camel) {
  const v = row?.[snake] ?? row?.[camel];
  return v == null ? "" : String(v);
}

function positionStatus(row) {
  return field(row, "position_status", "positionStatus");
}

export function readPositionStageStatus(row, stage) {
  if (!stage) return "Не розпочато";
  if (stage.type === "constructor") {
    return hasConstructive(row) ? "Передано" : "Не розпочато";
  }
  const snake = STAGE_STATUS_FIELD[stage.key];
  return field(row, snake, stage.field) || "Не розпочато";
}

export function stageRequiresAssignment(stage) {
  return stage.type === "constructor" || stage.usesAssembler || stage.key === "drilling";
}

export function hasStageAssignment(row, stage) {
  if (stage.type === "constructor") return hasConstructive(row);
  return Boolean(field(row, "assembly_responsible", "assemblyResponsible").trim());
}

function stageStatus(row, stage) {
  return readPositionStageStatus(row, stage);
}

const ADVANCE_LABELS = {
  "Не розпочато": "Передати на етап",
  Передано: "Почати роботу",
  "В роботі": "Завершити етап",
  "На паузі": "Продовжити роботу",
  Проблема: "Вирішити проблему"
};

/** Блокери — дії неможливі, поки не усунено. */
export function collectBlockers(row) {
  const blockers = [];
  const problem = field(row, "problem", "problem").trim();

  if (problem || positionStatus(row) === "Проблема") {
    blockers.push({
      code: "problem",
      severity: "critical",
      stageKey: deriveCurrentStage(row),
      message: problem || "Позиція зі статусом «Проблема»"
    });
  }

  if (!hasConstructive(row)) {
    blockers.push({
      code: "no_constructive",
      severity: "high",
      stageKey: "constructor",
      message: "Завантажте файл конструктива"
    });
    return blockers;
  }

  for (const stage of STAGES) {
    if (stage.key === "install") continue;
    const status = stageStatus(row, stage);
    if (STAGE_STATUS_DONE.has(status)) continue;
    if (stageRequiresAssignment(stage) && !hasStageAssignment(row, stage)) {
      const label = stageLabel(stage.key);
      blockers.push({
        code: "missing_assignment",
        severity: "high",
        stageKey: stage.key,
        message:
          stage.key === "drilling" || stage.usesAssembler
            ? `Призначте збирача для «${label}»`
            : `Потрібен конструктив для «${label}»`
      });
      break;
    }
    if (status !== "Не розпочато") break;
  }

  return blockers;
}

/** Попередження — не блокують, але потребують уваги. */
export function collectWarnings(row) {
  const warnings = [];
  const overdue = Number(row.overdue_days ?? row.overdueDays) || 0;
  if (overdue > 0) {
    warnings.push({
      code: "overdue",
      severity: "high",
      message: `Прострочено на ${overdue} дн.`
    });
  }

  const currentKey = deriveCurrentStage(row);
  const currentStage = STAGES.find((s) => s.key === currentKey);
  const status = stageStatus(row, currentStage);
  if (status === "На паузі") {
    warnings.push({
      code: "paused",
      severity: "normal",
      stageKey: currentKey,
      message: `Етап «${stageLabel(currentKey)}» на паузі`
    });
  }

  if (status === "Проблема" && !field(row, "problem", "problem").trim()) {
    warnings.push({
      code: "stage_problem",
      severity: "high",
      stageKey: currentKey,
      message: `Проблема на етапі «${stageLabel(currentKey)}»`
    });
  }

  return warnings;
}

/** Рекомендована наступна дія для позиції. */
export function deriveNextAction(row) {
  const blockers = collectBlockers(row);
  const currentKey = deriveCurrentStage(row);
  const currentStage = STAGES.find((s) => s.key === currentKey);
  const status = stageStatus(row, currentStage);

  if (blockers.length) {
    const primary = blockers[0];
    return {
      type: "blocker",
      stageKey: primary.stageKey || currentKey,
      label: primary.message,
      actionKey: primary.code,
      targetStatus: null
    };
  }

  if (!hasConstructive(row)) {
    return {
      type: "task",
      stageKey: "constructor",
      label: "Завантажити файл конструктива",
      actionKey: "upload_constructive",
      targetStatus: "Передано"
    };
  }

  if (currentKey === "install") {
    if (positionStatus(row) === "Готово до встановлення") {
      return {
        type: "done",
        stageKey: "install",
        label: "Запланувати монтаж",
        actionKey: "schedule_install",
        targetStatus: null
      };
    }
    return {
      type: "done",
      stageKey: "install",
      label: "Всі етапи виробництва завершено",
      actionKey: "schedule_install",
      targetStatus: null
    };
  }

  if (STAGE_STATUS_DONE.has(status) || status === "Не потрібно") {
    const order = ALL_STAGE_KEYS;
    const idx = order.indexOf(currentKey);
    for (let i = idx + 1; i < order.length; i++) {
      const nextStage = STAGES.find((s) => s.key === order[i]);
      const nextStatus = stageStatus(row, nextStage);
      if (!STAGE_STATUS_DONE.has(nextStatus) && nextStatus !== "Не потрібно") {
        return {
          type: "advance",
          stageKey: order[i],
          label: `Передати на «${stageLabel(order[i])}»`,
          actionKey: "advance_stage",
          targetStatus: getNextStatus(nextStatus)
        };
      }
    }
    if (positionStatus(row) === "Готово до встановлення") {
      return {
        type: "done",
        stageKey: "install",
        label: "Запланувати монтаж",
        actionKey: "schedule_install",
        targetStatus: null
      };
    }
    return {
      type: "done",
      stageKey: currentKey,
      label: "Всі етапи виробництва завершено",
      actionKey: "schedule_install",
      targetStatus: null
    };
  }

  const nextStatus = getNextStatus(status);
  const verb = ADVANCE_LABELS[status] || "Продовжити";
  return {
    type: "advance",
    stageKey: currentKey,
    label: `${verb}: ${stageLabel(currentKey)}`,
    actionKey: "advance_stage",
    targetStatus: nextStatus
  };
}

/** Автопередачі між етапами (порівняння до/після збереження). */
export function detectAutoHandoffs(beforeRow, afterRow, excludeStageKey = null) {
  const handoffs = [];
  for (const stageKey of ALL_STAGE_KEYS) {
    if (stageKey === excludeStageKey) continue;
    const fieldName = STAGE_STATUS_FIELD[stageKey];
    const from = beforeRow[fieldName] || "Не розпочато";
    const to = afterRow[fieldName] || "Не розпочато";
    if (from !== to && to === "Передано") {
      handoffs.push({ stageKey, from, to });
    }
  }
  return handoffs;
}
