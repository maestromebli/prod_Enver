import { all, one, run } from "./db.js";
import { parseJsonObject } from "./json-utils.js";
import { computePackageStageMetrics } from "../../shared/production/stage-metrics.js";
import {
  estimateStageDuration,
  estimateFinishAt
} from "../../shared/production/stage-duration-estimate.js";
import { getLatestPackageAiAnalysis } from "./constructive/constructive-package-ai.js";
import {
  getPackageHardware,
  getPackageParts
} from "./constructive/constructive-package-service.js";

const HISTORY_LIMIT = 120;

export async function getLatestPackageIdForPosition(positionId) {
  const row = await one(
    `SELECT id FROM constructive_packages
     WHERE position_id = $1
     ORDER BY version DESC, id DESC
     LIMIT 1`,
    [positionId]
  );
  return row?.id || null;
}

export async function loadPositionStageMetrics(positionId) {
  const packageId = await getLatestPackageIdForPosition(positionId);
  if (!packageId) {
    return { packageId: null, metrics: computePackageStageMetrics([], []) };
  }
  const [parts, hardware] = await Promise.all([
    getPackageParts(packageId),
    getPackageHardware(packageId)
  ]);
  return {
    packageId,
    metrics: computePackageStageMetrics(parts, hardware)
  };
}

export async function loadStageCompletionHistory(stageKey, { userId, limit = HISTORY_LIMIT } = {}) {
  const rows = await all(
    `SELECT stage_key, user_id, active_seconds, parts_count, cut_length_mm,
            edge_length_mm, drill_points, hardware_count, material_summary, furniture_type
     FROM stage_completion_facts
     WHERE stage_key = $1
     ORDER BY finished_at DESC
     LIMIT $2`,
    [stageKey, limit]
  );
  if (!userId) return rows;
  const userRows = rows.filter((r) => r.user_id === userId);
  return userRows.length >= 3 ? userRows : rows;
}

async function loadAiStageMinutes(positionId, stageKey) {
  const packageId = await getLatestPackageIdForPosition(positionId);
  if (!packageId) return { aiMinutes: 0, furnitureType: "other" };
  const ai = await getLatestPackageAiAnalysis(packageId);
  const analysis = ai?.analysis;
  if (!analysis || ai?.status !== "done") {
    return { aiMinutes: 0, furnitureType: "other" };
  }
  const labor = analysis.estimatedLabor;
  const aiMinutes = labor?.stages?.[stageKey]?.minutes || 0;
  return {
    aiMinutes: Number(aiMinutes) || 0,
    furnitureType: analysis.furnitureType || "other"
  };
}

/** Прогноз тривалості етапу для позиції (викликається при «Почав»). */
export async function computeStageEstimateForPosition(positionId, stageKey, userId) {
  const [{ metrics, packageId }, history, aiHint] = await Promise.all([
    loadPositionStageMetrics(positionId),
    loadStageCompletionHistory(stageKey, { userId }),
    loadAiStageMinutes(positionId, stageKey)
  ]);

  const estimate = estimateStageDuration(stageKey, metrics, history, {
    userId,
    aiMinutes: aiHint.aiMinutes,
    furnitureType: aiHint.furnitureType
  });

  const finishAt = estimateFinishAt(new Date(), estimate.estimatedMinutes);

  return {
    ...estimate,
    packageId,
    estimatedFinishAt: finishAt.toISOString(),
    aiMinutesUsed: aiHint.aiMinutes
  };
}

export async function saveSessionStageEstimate(sessionId, estimate) {
  await run(
    `UPDATE operator_sessions
     SET estimated_finish_at = $1, estimate_json = $2, updated_at = now()
     WHERE id = $3`,
    [estimate.estimatedFinishAt, JSON.stringify(estimate), sessionId]
  );
}

function sessionActiveSeconds(session) {
  const started = session.started_at ? new Date(session.started_at).getTime() : Date.now();
  const finished = session.finished_at ? new Date(session.finished_at).getTime() : Date.now();
  return Math.max(60, Math.round((finished - started) / 1000));
}

/** Зберігає факт завершення для навчання. */
export async function recordStageCompletionFact({ session, positionId, stageKey, userId }) {
  if (!session?.id) return;

  const { packageId, metrics } = await loadPositionStageMetrics(positionId);
  const aiHint = await loadAiStageMinutes(positionId, stageKey);
  const estimate = parseJsonObject(session.estimate_json);

  const startedAt = session.started_at || new Date().toISOString();
  const finishedAt = new Date().toISOString();

  await run(
    `INSERT INTO stage_completion_facts (
      position_id, package_id, stage_key, user_id,
      started_at, finished_at, active_seconds,
      parts_count, cut_length_mm, edge_length_mm, drill_points, hardware_count,
      material_summary, furniture_type, metrics_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      positionId,
      packageId,
      stageKey,
      userId || null,
      startedAt,
      finishedAt,
      sessionActiveSeconds({ ...session, finished_at: finishedAt }),
      metrics.partsCount,
      metrics.cutLengthMm,
      metrics.edgeLengthMm,
      metrics.drillPoints,
      metrics.hardwareCount,
      metrics.materialSummary,
      aiHint.furnitureType || "other",
      JSON.stringify({
        metrics,
        estimateAtStart: estimate,
        actualVsEstimateMin: estimate?.estimatedMinutes
          ? Math.round(sessionActiveSeconds({ ...session, finished_at: finishedAt }) / 60) -
            estimate.estimatedMinutes
          : null
      })
    ]
  );

  try {
    const { saveLearningEvent } = await import("./ai/ai-memory.js");
    await saveLearningEvent(
      {
        eventType: "stage_duration_completed",
        entityType: "position",
        entityId: positionId,
        itemName: "",
        source: "operator_finish",
        inputSummary: `${stageKey}: ${metrics.partsCount} дет., ${Math.round(metrics.cutLengthMm / 1000)} м порізки`,
        aiOutput: estimate || {},
        correctedOutput: {
          activeSeconds: sessionActiveSeconds({ ...session, finished_at: finishedAt }),
          metrics
        },
        tags: [stageKey, "duration_learning"]
      },
      userId
    );
  } catch (err) {
    console.error("[stage duration learning]", err.message);
  }
}

export function mapSessionEstimate(session) {
  if (!session) return null;
  const estimate = parseJsonObject(session.estimate_json);
  return {
    estimatedFinishAt: session.estimated_finish_at || estimate.estimatedFinishAt || null,
    estimate: Object.keys(estimate).length ? estimate : null
  };
}

/** Підказки для ШІ з фактичної історії цеху. */
export async function loadStageDurationHints() {
  const rows = await all(
    `SELECT stage_key,
            COUNT(*)::int AS samples,
            ROUND(AVG(CASE WHEN cut_length_mm > 0 THEN active_seconds::numeric / cut_length_mm * 1000 END)::numeric, 4) AS sec_per_cut_meter,
            ROUND(AVG(CASE WHEN edge_length_mm > 0 THEN active_seconds::numeric / edge_length_mm * 1000 END)::numeric, 4) AS sec_per_edge_meter,
            ROUND(AVG(CASE WHEN parts_count > 0 THEN active_seconds::numeric / parts_count END)::numeric, 1) AS sec_per_part,
            ROUND(AVG(CASE WHEN hardware_count > 0 THEN active_seconds::numeric / hardware_count END)::numeric, 1) AS sec_per_hardware
     FROM stage_completion_facts
     WHERE finished_at > now() - interval '180 days'
     GROUP BY stage_key`
  );
  if (!rows.length) return "";
  return rows
    .map((r) => {
      const parts = [];
      if (r.sec_per_cut_meter) parts.push(`порізка ~${r.sec_per_cut_meter} с/м`);
      if (r.sec_per_edge_meter) parts.push(`кромка ~${r.sec_per_edge_meter} с/м`);
      if (r.sec_per_part) parts.push(`~${r.sec_per_part} с/деталь`);
      if (r.sec_per_hardware) parts.push(`~${r.sec_per_hardware} с/од. фурнітури`);
      return `${r.stage_key} (${r.samples} завершень): ${parts.join(", ")}`;
    })
    .join("\n");
}
