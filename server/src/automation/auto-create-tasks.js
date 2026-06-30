import { one } from "../db.js";
import { updatePositionFull } from "../db/position-persistence.js";
import { logPositionUpdate, SYSTEM_ACTOR } from "../audit.js";
import { enrichPositionRow } from "../position-logic.js";
import { STAGE_STATUS_FIELD } from "../roles.js";
import { ALLOWED_STAGES } from "../ai/constructive-schema.js";
import { normalizeSuggestedTasks } from "../ai/normalize-analysis.js";
import { getAutomationSettings } from "./settings.js";

const PRODUCTION_STATUS_FIELDS = [
  "cutting_status",
  "edging_status",
  "drilling_status",
  "assembly_status"
];

export function productionTasksExist(row) {
  return PRODUCTION_STATUS_FIELDS.some((field) => {
    const value = row?.[field];
    return value && value !== "Не розпочато";
  });
}

/**
 * @param {object} analysis — нормалізований аналіз з suggestedTasks і quality
 * @param {'strict'|'assisted'} mode
 */
export function selectStagesFromAnalysis(analysis, { mode = "strict", minConfidence = 0.8 } = {}) {
  if (!analysis || typeof analysis !== "object") return [];

  const quality = analysis.quality || {};
  if (mode === "strict") {
    if (!quality.safeToCreateTasks) return [];
  } else if (quality.needsHumanReview) {
    return [];
  }

  const warnings = [];
  const tasks = normalizeSuggestedTasks(analysis.suggestedTasks || [], warnings);
  const threshold = mode === "assisted" ? Math.min(minConfidence, 0.8) : minConfidence;

  return tasks
    .filter((task) => task.needed !== false && ALLOWED_STAGES.includes(task.stage))
    .filter((task) => (task.confidence ?? 0.6) >= threshold)
    .map((task) => task.stage)
    .filter((stage, index, list) => list.indexOf(stage) === index);
}

async function planDateForRow(row) {
  if (!row?.order_number) return null;
  const order = await one(`SELECT plan_date FROM orders WHERE order_number = $1 LIMIT 1`, [
    row.order_number
  ]);
  return order?.plan_date ?? null;
}

async function loadPositionRow(positionId) {
  return one(`SELECT * FROM positions WHERE id = $1`, [positionId]);
}

/**
 * Застосовує етапи «Передано» до позиції (як POST /create-tasks).
 */
export async function applyStagesToPosition(positionId, stages, { actor = SYSTEM_ACTOR } = {}) {
  const valid = (Array.isArray(stages) ? stages : []).filter((key) => STAGE_STATUS_FIELD[key]);
  if (!valid.length) {
    return { applied: false, reason: "no_stages", stages: [] };
  }

  const existing = await loadPositionRow(positionId);
  if (!existing) {
    return { applied: false, reason: "not_found", stages: [] };
  }
  if (existing.parent_id) {
    return { applied: false, reason: "child_position", stages: [] };
  }
  if (productionTasksExist(existing)) {
    return { applied: false, reason: "tasks_exist", stages: [] };
  }

  const before = { ...existing };
  for (const key of valid) {
    const field = STAGE_STATUS_FIELD[key];
    if (!existing[field] || existing[field] === "Не розпочато") {
      existing[field] = "Передано";
    }
  }

  const planDate = await planDateForRow(existing);
  const enriched = enrichPositionRow(existing, { planDate });
  await updatePositionFull({ ...enriched, id: positionId });
  const afterRow = await loadPositionRow(positionId);
  await logPositionUpdate(before, afterRow, actor);

  const { recordTaskCorrectionLearning } = await import("../ai/ai-task-learning.js");
  await recordTaskCorrectionLearning({
    positionId,
    positionRow: afterRow,
    selectedStages: valid,
    userId: actor?.id ?? null,
    source: "ai_analysis"
  }).catch((err) => console.error("[auto-create-tasks learning]", err.message));

  return { applied: true, reason: "ok", stages: valid };
}

/**
 * Автостворення задач після ШІ (strict — лише safeToCreateTasks).
 */
export async function tryAutoCreateTasksFromAnalysis(
  positionId,
  analysis,
  { source = "ai", actor = SYSTEM_ACTOR, settings: settingsIn, mode = "strict" } = {}
) {
  const settings = settingsIn || (await getAutomationSettings());
  if (mode === "strict" && !settings.autoCreateTasksFromAi) {
    return { applied: false, reason: "disabled", stages: [] };
  }

  const stages = selectStagesFromAnalysis(analysis, {
    mode:
      mode === "strict" && settings.autoCreateTasksRequireSafeQuality === false ? "assisted" : mode,
    minConfidence: settings.autoCreateTasksMinConfidence
  });
  if (!stages.length) {
    return { applied: false, reason: "no_matching_stages", stages: [] };
  }

  const result = await applyStagesToPosition(positionId, stages, { actor });
  if (result.applied) {
    console.info(
      `[automation] create_tasks_from_ai position=${positionId} source=${source} stages=${stages.join(",")}`
    );
  }
  return { ...result, source };
}
