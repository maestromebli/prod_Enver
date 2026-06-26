import { one } from "../db.js";
import { parseJsonObject } from "../json-utils.js";
import { saveLearningEvent } from "./ai-memory.js";

const PRODUCTION_STAGES = ["cutting", "edging", "drilling", "assembly"];

async function getLatestAnalysisForPosition(positionId) {
  const row = await one(
    `SELECT ca.summary_json
     FROM constructive_analyses ca
     JOIN position_files pf ON pf.id = ca.position_file_id
     WHERE pf.position_id = $1
     ORDER BY ca.created_at DESC
     LIMIT 1`,
    [positionId]
  );
  if (!row) return null;
  return parseJsonObject(row.summary_json);
}

function extractAiStages(analysis) {
  const tasks = analysis?.suggestedTasks || [];
  return tasks
    .filter((t) => t && t.needed !== false)
    .map((t) => (typeof t === "string" ? t : t.stage))
    .filter((s) => PRODUCTION_STAGES.includes(s));
}

/**
 * Зберігає learning event, якщо обрані етапи відрізняються від AI-рекомендації.
 */
export async function recordTaskCorrectionLearning({
  positionId,
  positionRow,
  selectedStages,
  userId,
  source = "production_floor"
}) {
  const analysis = await getLatestAnalysisForPosition(positionId);
  if (!analysis) return null;

  const aiStages = extractAiStages(analysis);
  const chosen = (selectedStages || []).filter((s) => PRODUCTION_STAGES.includes(s));
  const added = chosen.filter((s) => !aiStages.includes(s));
  const removed = aiStages.filter((s) => !chosen.includes(s));

  if (!added.length && !removed.length) return null;

  const parts = [];
  if (added.length) parts.push(`додано етапи: ${added.join(", ")}`);
  if (removed.length) parts.push(`прибрано етапи: ${removed.join(", ")}`);

  return saveLearningEvent(
    {
      eventType: "stage_prediction_corrected",
      entityType: "position",
      entityId: positionId,
      orderNumber: positionRow?.order_number || positionRow?.orderNumber || "",
      itemName: positionRow?.item || "",
      itemType: positionRow?.item_type || positionRow?.itemType || "",
      material: positionRow?.material || "",
      source,
      inputSummary: analysis.summary?.slice(0, 300) || "",
      aiOutput: {
        suggestedTasks: analysis.suggestedTasks,
        quality: analysis.quality
      },
      correctedOutput: { suggestedTasks: chosen },
      correctionText: `Після AI-рекомендації ${parts.join("; ")}.`,
      rating: "partial",
      tags: ["task_correction", ...added.map((s) => `added_${s}`)]
    },
    userId
  );
}

/**
 * Оператор повідомив про проблему — сигнал для learning (не глобальне правило).
 */
export async function recordOperatorProblemLearning({ positionRow, stageKey, comment, userId }) {
  return saveLearningEvent(
    {
      eventType: "operator_problem_pattern",
      entityType: "position",
      entityId: positionRow?.id,
      orderNumber: positionRow?.order_number || "",
      itemName: positionRow?.item || "",
      itemType: positionRow?.item_type || "",
      material: positionRow?.material || "",
      source: "operator_panel",
      correctionText: String(comment || "").slice(0, 500),
      rating: "partial",
      tags: ["operator_problem", stageKey].filter(Boolean),
      correctedOutput: { stage: stageKey, problem: comment }
    },
    userId
  );
}
