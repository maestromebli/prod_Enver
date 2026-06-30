import { one } from "../db.js";
import { parseJsonObject } from "../json-utils.js";
import { normalizeAnalysisResult } from "../ai/normalize-analysis.js";
import { attachQualityToAnalysis } from "../ai/analysis-quality.js";
import { normalizePackageAiAnalysis } from "../../../shared/production/package-ai.js";
import { normalizeSuggestedTasks } from "../ai/normalize-analysis.js";

function flattenStoredConstructiveAnalysis(summaryJson) {
  const parsed = typeof summaryJson === "string" ? parseJsonObject(summaryJson) : summaryJson || {};
  const meta = parsed._meta || {};
  const { _meta, quality: storedQuality, ...rest } = parsed;
  const analysis = normalizeAnalysisResult(rest);
  if (storedQuality) {
    analysis.quality = storedQuality;
  } else if (meta.extractedTextMeta) {
    attachQualityToAnalysis(analysis, meta.extractedTextMeta, meta.learningContext || {});
  }
  return analysis;
}

/** Останній аналіз файлу конструктива для позиції. */
export async function loadLatestConstructiveAnalysis(positionId) {
  const row = await one(
    `SELECT ca.summary_json
     FROM constructive_analyses ca
     JOIN position_files pf ON pf.id = ca.position_file_id
     WHERE pf.position_id = $1
     ORDER BY ca.created_at DESC
     LIMIT 1`,
    [positionId]
  );
  if (!row?.summary_json) return null;
  return flattenStoredConstructiveAnalysis(row.summary_json);
}

/** Додає quality і нормалізує suggestedTasks для автостворення задач. */
export function enrichPackageAnalysisForAuto(analysis, _context = {}, learningContext = {}) {
  const forQuality = {
    summary: analysis.summary,
    materials: (analysis.detectedMaterials || []).map((m) =>
      typeof m === "string" ? m : m?.name || m?.material || ""
    ),
    panels: analysis.detectedParts || [],
    suggestedTasks: analysis.suggestedTasks,
    warnings: analysis.warnings || [],
    missingInfo: []
  };
  const warnings = [];
  forQuality.suggestedTasks = normalizeSuggestedTasks(forQuality.suggestedTasks, warnings);
  attachQualityToAnalysis(forQuality, {}, learningContext || {});
  analysis.quality = forQuality.quality;
  analysis.suggestedTasks = forQuality.suggestedTasks;
  return analysis;
}

/** Останній ШІ-аналіз пакета для позиції. */
export async function loadLatestPackageAiAnalysis(positionId) {
  const row = await one(
    `SELECT pa.summary_json, cp.id AS package_id
     FROM constructive_package_ai_analyses pa
     JOIN constructive_packages cp ON cp.id = pa.package_id
     WHERE cp.position_id = $1 AND pa.status = 'done'
     ORDER BY pa.created_at DESC
     LIMIT 1`,
    [positionId]
  );
  if (!row?.summary_json) return null;

  const payload =
    typeof row.summary_json === "string" ? parseJsonObject(row.summary_json) : row.summary_json;
  const rawAnalysis = payload?.analysis || payload;
  const context = payload?.context || {};
  const analysis = normalizePackageAiAnalysis(rawAnalysis, context);
  enrichPackageAnalysisForAuto(analysis, context, payload?.learningContext || {});

  return analysis;
}

/** Конструктивний аналіз має пріоритет над пакетним. */
export async function loadLatestAiAnalysisForPosition(positionId) {
  const constructive = await loadLatestConstructiveAnalysis(positionId);
  if (constructive) return { analysis: constructive, source: "constructive" };
  const pkg = await loadLatestPackageAiAnalysis(positionId);
  if (pkg) return { analysis: pkg, source: "package" };
  return null;
}
