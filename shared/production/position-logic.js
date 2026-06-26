import {
  HANDOFF_CHAIN,
  NEXT_STAGE_FIELD,
  PRODUCTION_PROGRESS_WEIGHTS,
  STAGE_ACTIVE_STATUSES,
  STAGE_PATCH_MAP,
  STAGE_STATUS_DONE,
  STAGE_STATUS_FIELD,
  isStageIdle
} from "./stages.js";
import { parseUaDate } from "../dates/ua-date.js";

export {
  collectBlockers,
  collectWarnings,
  deriveNextAction,
  detectAutoHandoffs
} from "./next-action.js";

export { PRODUCTION_PROGRESS_WEIGHTS, STAGE_PATCH_MAP, STAGE_STATUS_DONE };

export function stageScore(status, { isConstructor = false, hasConstructor = false } = {}) {
  if (isConstructor) return hasConstructor ? 100 : 0;
  if (!status || status === "Не розпочато") return 0;
  if (STAGE_STATUS_DONE.has(status)) return 100;
  if (status === "Передано") return 35;
  if (status === "В роботі") return 65;
  if (status === "На паузі" || status === "Проблема") return 45;
  return 25;
}

export function hasConstructive(row) {
  return Boolean(row.has_constructive_file ?? row.hasConstructiveFile);
}

export function computeProgress(row) {
  const w = PRODUCTION_PROGRESS_WEIGHTS;
  const weighted =
    w.cutting * stageScore(row.cutting_status) +
    w.edging * stageScore(row.edging_status) +
    w.drilling * stageScore(row.drilling_status) +
    w.assembly * stageScore(row.assembly_status);
  return Math.round(weighted / 100);
}

export function derivePositionStatus(row) {
  const explicit = String(row.position_status ?? row.positionStatus ?? "").trim();
  if (explicit === "Завершено") return "Завершено";
  if (explicit === "На встановленні") return "На встановленні";

  if (row.problem?.trim()) return "Проблема";
  if (row.position_status === "На паузі") return "На паузі";

  const production = [
    row.cutting_status,
    row.edging_status,
    row.drilling_status,
    row.assembly_status
  ];

  const hasConstructor = hasConstructive(row);
  const allDone = hasConstructor && production.every((s) => STAGE_STATUS_DONE.has(s) || !s);
  const anyActive = production.some((s) => STAGE_ACTIVE_STATUSES.has(s));

  if (allDone && production.every((s) => !s || STAGE_STATUS_DONE.has(s))) {
    return "Готово до встановлення";
  }
  if (hasConstructor || anyActive) return "У виробництві";
  if (production.every((s) => !s || s === "Не розпочато") && !hasConstructor) {
    return "Не розпочато";
  }
  return row.position_status?.trim() || "У виробництві";
}

/** Поточний активний етап для UI та operator queue. */
export function deriveCurrentStage(row) {
  if (!hasConstructive(row)) return "constructor";

  const order = ["cutting", "edging", "drilling", "assembly"];
  for (const key of order) {
    const field = STAGE_STATUS_FIELD[key];
    const status = row[field];
    if (!status || status === "Не розпочато") return key;
    if (STAGE_ACTIVE_STATUSES.has(status)) return key;
    if (!STAGE_STATUS_DONE.has(status)) return key;
  }
  return "assembly";
}

export function computeOverdueDays(row, planDateStr) {
  const plan = parseUaDate(planDateStr);
  if (!plan) return Number(row.overdue_days) || 0;
  const done = ["Готово до встановлення", "Завершено"].includes(row.position_status);
  if (done || (STAGE_STATUS_DONE.has(row.assembly_status) && row.progress >= 100)) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  plan.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - plan.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

/** @param {Record<string, unknown>} row @param {{ planDate?: string }} [options] */
export function enrichPositionRow(row, { planDate } = {}) {
  const progress = computeProgress(row);
  const position_status = derivePositionStatus({ ...row, progress });
  const current_stage = deriveCurrentStage({ ...row, progress, position_status });
  const overdue_days = planDate
    ? Math.max(
        computeOverdueDays({ ...row, progress, position_status }, planDate),
        Number(row.overdue_days) || 0
      )
    : Number(row.overdue_days) || 0;
  const enriched = { ...row, progress, position_status, current_stage, overdue_days };
  return enriched;
}

/** Після завершення етапу — передати наступному «Передано», якщо він ще не активний. */
export function applyStageHandoff(row, stageKey, patch = {}) {
  const copy = { ...row };

  if (stageKey === "constructor") {
    const hasFile = Boolean(copy.has_constructive_file);
    const forwarded = patch.status ? patch.status !== "Не розпочато" : hasFile;
    if (hasFile && forwarded && isStageIdle(copy.cutting_status)) {
      copy.cutting_status = "Передано";
    }
    return copy;
  }

  const config = STAGE_PATCH_MAP[stageKey];
  if (!config?.field) return copy;

  const stageStatus = patch.status ?? copy[config.field];
  const nextField = NEXT_STAGE_FIELD[stageKey];
  if (stageStatus === "Готово" && nextField && isStageIdle(copy[nextField])) {
    copy[nextField] = "Передано";
  }

  return copy;
}

export function nextStageKey(stageKey) {
  return HANDOFF_CHAIN[stageKey] || null;
}
