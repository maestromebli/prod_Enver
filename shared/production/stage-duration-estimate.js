/**
 * Оцінка тривалості етапу на основі метрик пакета та історії завершень.
 */

import { estimateLaborHeuristic } from "./package-ai.js";

export function median(values) {
  const nums = values.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
  if (!nums.length) return null;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

function materialMatch(summary, material) {
  const hay = String(summary || "").toLowerCase();
  const needle = String(material || "")
    .trim()
    .toLowerCase();
  if (!needle) return true;
  return hay.includes(needle) || needle.includes(hay.split(",")[0] || "");
}

function filterHistory(history, { material, userId, stageKey }) {
  return history.filter((row) => {
    if (row.stage_key && row.stage_key !== stageKey) return false;
    if (userId && row.user_id && row.user_id !== userId) return false;
    if (material && !materialMatch(row.material_summary, material)) return false;
    return row.active_seconds > 0;
  });
}

function ratePerUnit(history, numeratorKey, denominatorKey) {
  const rates = history
    .filter((r) => Number(r[denominatorKey]) > 0)
    .map((r) => r.active_seconds / 60 / Number(r[denominatorKey]));
  return median(rates);
}

/**
 * @param {'cutting'|'edging'|'drilling'|'assembly'} stageKey
 * @param {object} metrics — computePackageStageMetrics()
 * @param {Array<object>} history — stage_completion_facts rows
 * @param {{ userId?: number, aiMinutes?: number, furnitureType?: string }} [options]
 */
export function estimateStageDuration(stageKey, metrics, history = [], options = {}) {
  const {
    partsCount = 0,
    cutLengthMm = 0,
    edgeLengthMm = 0,
    drillPoints = 0,
    hardwareCount = 0,
    materialSummary = ""
  } = metrics || {};

  const material = materialSummary.split(",")[0]?.trim() || "";
  const pool = filterHistory(history, {
    material,
    userId: options.userId,
    stageKey
  });
  const broadPool = pool.length
    ? pool
    : history.filter((r) => r.stage_key === stageKey && r.active_seconds > 0);

  let minutes = null;
  let method = "default";
  let confidence = 0.3;
  let reason = "Базова оцінка — мало історії";

  if (stageKey === "cutting") {
    const perMm = ratePerUnit(broadPool, "active_seconds", "cut_length_mm");
    const perPiece = ratePerUnit(broadPool, "active_seconds", "parts_count");
    if (cutLengthMm > 0 && perMm) {
      minutes = perMm * cutLengthMm;
      method = "history_per_mm";
      confidence = broadPool.length >= 8 ? 0.82 : broadPool.length >= 3 ? 0.65 : 0.5;
      reason = `~${Math.round(perMm * 1000) / 1000} хв/м порізки (${broadPool.length} замовлень)`;
    } else if (partsCount > 0 && perPiece) {
      minutes = perPiece * partsCount;
      method = "history_per_piece";
      confidence = broadPool.length >= 5 ? 0.75 : 0.55;
      reason = `~${Math.round(perPiece * 10) / 10} хв/деталь (${broadPool.length} замовлень)`;
    }
  }

  if (stageKey === "edging") {
    const perMm = ratePerUnit(broadPool, "active_seconds", "edge_length_mm");
    const perPiece = ratePerUnit(broadPool, "active_seconds", "parts_count");
    if (edgeLengthMm > 0 && perMm) {
      minutes = perMm * edgeLengthMm;
      method = "history_per_edge_mm";
      confidence = broadPool.length >= 6 ? 0.8 : 0.55;
      reason = `~${Math.round(perMm * 1000) / 1000} хв/м кромки (${broadPool.length} замовлень)`;
    } else if (partsCount > 0 && perPiece) {
      minutes = perPiece * partsCount * 0.65;
      method = "history_per_piece_edging";
      confidence = 0.5;
      reason = `Кромка за деталями (${broadPool.length} замовлень)`;
    }
  }

  if (stageKey === "drilling") {
    const perPoint = ratePerUnit(broadPool, "active_seconds", "drill_points");
    const perPiece = ratePerUnit(broadPool, "active_seconds", "parts_count");
    if (drillPoints > 0 && perPoint) {
      minutes = perPoint * drillPoints;
      method = "history_per_drill";
      confidence = broadPool.length >= 5 ? 0.78 : 0.55;
      reason = `~${Math.round(perPoint * 100) / 100} хв/отвір (${broadPool.length} замовлень)`;
    } else if (partsCount > 0 && perPiece) {
      minutes = perPiece * partsCount * 0.45;
      method = "history_per_piece_drilling";
      confidence = 0.5;
      reason = `Присадка за деталями (${broadPool.length} замовлень)`;
    }
  }

  if (stageKey === "assembly") {
    const perHw = ratePerUnit(broadPool, "active_seconds", "hardware_count");
    const perPiece = ratePerUnit(broadPool, "active_seconds", "parts_count");
    if (hardwareCount > 0 && perHw) {
      minutes = perHw * hardwareCount + (perPiece || 0) * partsCount * 0.3;
      method = "history_hardware_assembly";
      confidence = broadPool.length >= 5 ? 0.8 : 0.55;
      reason = `Збірка: фурнітура + деталі (${broadPool.length} замовлень)`;
    } else if (partsCount > 0 && perPiece) {
      minutes = perPiece * partsCount;
      method = "history_per_piece_assembly";
      confidence = broadPool.length >= 4 ? 0.72 : 0.5;
      reason = `Збірка за деталями (${broadPool.length} замовлень)`;
    }
  }

  const heuristic = estimateLaborHeuristic({
    partsCount,
    hardwareCount,
    furnitureType: options.furnitureType || "other"
  });
  const heuristicMinutes = Number(heuristic.stages?.[stageKey]) || 0;

  if (!minutes || !Number.isFinite(minutes)) {
    minutes = heuristicMinutes || 60;
    method = "heuristic";
    confidence = Math.max(confidence, heuristic.confidence || 0.35);
    reason = heuristic.basis || reason;
  }

  if (options.aiMinutes > 0 && broadPool.length < 5) {
    const blend = broadPool.length === 0 ? 0.7 : 0.4;
    minutes = minutes * (1 - blend) + options.aiMinutes * blend;
    method = `${method}+ai`;
    confidence = Math.min(confidence, 0.6);
    reason = `${reason}; з урахуванням ШІ-аналізу пакета`;
  } else if (options.aiMinutes > 0 && broadPool.length >= 5) {
    minutes = minutes * 0.75 + options.aiMinutes * 0.25;
    method = `${method}+ai_hint`;
  }

  minutes = Math.max(5, Math.round(minutes));

  const medianDuration = median(broadPool.map((r) => r.active_seconds / 60));
  if (medianDuration && minutes > medianDuration * 3) {
    minutes = Math.round(medianDuration * 1.5);
    reason += "; обмежено медіаною цеху";
  }

  return {
    stageKey,
    estimatedMinutes: minutes,
    confidence: Math.round(confidence * 100) / 100,
    method,
    reason,
    sampleSize: broadPool.length,
    metrics: {
      partsCount,
      cutLengthMm,
      edgeLengthMm,
      drillPoints,
      hardwareCount,
      cutMeters: Math.round((cutLengthMm / 1000) * 10) / 10,
      edgeMeters: Math.round((edgeLengthMm / 1000) * 10) / 10
    }
  };
}

export function formatStageEstimateLabel(estimate) {
  if (!estimate?.estimatedMinutes) return "";
  const h = Math.floor(estimate.estimatedMinutes / 60);
  const m = estimate.estimatedMinutes % 60;
  if (h > 0) return `~${h} год ${m} хв`;
  return `~${m} хв`;
}

export function estimateFinishAt(fromDate, estimatedMinutes) {
  const base = fromDate instanceof Date ? fromDate : new Date();
  return new Date(base.getTime() + (Number(estimatedMinutes) || 0) * 60_000);
}
