export const STAGE_STATUS_DONE = new Set(["Готово", "Не потрібно"]);

export function stageScore(status, { isConstructor = false, hasConstructor = false } = {}) {
  if (isConstructor) return hasConstructor ? 100 : 0;
  if (!status || status === "Не розпочато") return 0;
  if (STAGE_STATUS_DONE.has(status)) return 100;
  if (status === "Передано") return 35;
  if (status === "В роботі") return 65;
  if (status === "На паузі" || status === "Проблема") return 45;
  return 25;
}

export function computeProgress(row) {
  const scores = [
    stageScore(null, { isConstructor: true, hasConstructor: Boolean(row.constructor_name?.trim()) }),
    stageScore(row.cutting_status),
    stageScore(row.edging_status),
    stageScore(row.drilling_status),
    stageScore(row.assembly_status)
  ];
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length);
}

export function derivePositionStatus(row) {
  if (row.problem?.trim()) return "Проблема";
  if (row.position_status === "На паузі") return "На паузі";

  const production = [
    row.cutting_status,
    row.edging_status,
    row.drilling_status,
    row.assembly_status
  ];

  const hasConstructor = Boolean(row.constructor_name?.trim());
  const allDone =
    hasConstructor && production.every((s) => STAGE_STATUS_DONE.has(s) || !s);
  const anyActive = production.some((s) =>
    ["Передано", "В роботі", "Проблема"].includes(s)
  );

  if (allDone && production.every((s) => STAGE_STATUS_DONE.has(s))) {
    return "Готово до встановлення";
  }
  if (hasConstructor || anyActive) return "У виробництві";
  if (production.every((s) => !s || s === "Не розпочато") && !hasConstructor) {
    return "Не розпочато";
  }
  return row.position_status?.trim() || "У виробництві";
}

function parseUaDate(str) {
  if (!str?.trim()) return null;
  const m = String(str).trim().match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

export function computeOverdueDays(row, planDateStr) {
  const plan = parseUaDate(planDateStr);
  if (!plan) return Number(row.overdue_days) || 0;
  const done = ["Готово до встановлення", "Завершено"].includes(row.position_status);
  if (done || STAGE_STATUS_DONE.has(row.assembly_status) && row.progress >= 100) return 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  plan.setHours(0, 0, 0, 0);
  const diff = Math.floor((today - plan) / 86400000);
  return diff > 0 ? diff : 0;
}

export function enrichPositionRow(row, { planDate } = {}) {
  const progress = computeProgress(row);
  const position_status = derivePositionStatus({ ...row, progress });
  const overdue_days = planDate
    ? Math.max(computeOverdueDays({ ...row, progress, position_status }, planDate), Number(row.overdue_days) || 0)
    : Number(row.overdue_days) || 0;
  return { ...row, progress, position_status, overdue_days };
}

export const STAGE_PATCH_MAP = {
  constructor: { type: "constructor" },
  cutting: { field: "cutting_status" },
  edging: { field: "edging_status" },
  drilling: { field: "drilling_status" },
  assembly: { field: "assembly_status" }
};
