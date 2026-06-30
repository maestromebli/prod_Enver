/** Евристичні рекомендації етапів з розібраного пакета (доповнює ШІ). */

import { computePackageStageMetrics } from "./stage-metrics.js";

const STAGES = ["cutting", "edging", "drilling", "assembly"];

function task(stage, reason, confidence) {
  return { stage, needed: true, reason, confidence: Math.min(0.95, Math.max(0.65, confidence)) };
}

function hasEdging(parts = []) {
  return parts.some((p) => {
    const code = String(p.edgeCode || p.edge_code || "").trim();
    if (!code || /^0+$/i.test(code) || /^(none|немає|—|-)$/i.test(code)) return false;
    return true;
  });
}

function hasDrillingSignals(parts = [], hardware = []) {
  if (hardware.length > 0) return true;
  return parts.some(
    (p) =>
      Array.isArray(p.bazisOperationCodes) &&
      p.bazisOperationCodes.length > 0 &&
      p.bazisOperationCodes.some((c) => String(c || "").trim())
  );
}

/**
 * Визначає етапи з фактичних даних пакета (не LLM).
 * @param {{ parts?: object[], hardware?: object[], itemName?: string, itemType?: string }} input
 */
export function inferSuggestedTasksFromPackage({
  parts = [],
  hardware = [],
  itemName = "",
  itemType = ""
} = {}) {
  const metrics = computePackageStageMetrics(parts, hardware);
  const tasks = [];
  const label = [itemName, itemType].filter(Boolean).join(" / ");

  if (metrics.partsCount > 0) {
    const mCut = Math.round(metrics.cutLengthMm / 1000);
    tasks.push(
      task(
        "cutting",
        label
          ? `Порізка ${metrics.partsCount} дет. для «${label}» (~${mCut} м периметру)`
          : `Порізка ${metrics.partsCount} деталей (~${mCut} м периметру)`,
        metrics.partsCount >= 5 ? 0.93 : 0.88
      )
    );
  }

  if (metrics.edgeLengthMm > 0 || hasEdging(parts)) {
    const mEdge = Math.round(metrics.edgeLengthMm / 1000);
    tasks.push(
      task(
        "edging",
        mEdge > 0
          ? `Кромкування ~${mEdge} м крайки`
          : "Є деталі з кодом крайки — потрібне кромкування",
        mEdge > 3000 ? 0.92 : 0.86
      )
    );
  }

  if (hasDrillingSignals(parts, hardware)) {
    const hw = metrics.hardwareCount;
    tasks.push(
      task(
        "drilling",
        hw > 0
          ? `Присадка під ${hw} поз. фурнітури`
          : "Є операції Базіс / отвори — потрібна присадка",
        hw >= 5 ? 0.9 : 0.84
      )
    );
  } else if (metrics.drillPoints > metrics.partsCount * 3) {
    tasks.push(task("drilling", "Орієнтовно багато отворів за розмірами деталей", 0.75));
  }

  if (metrics.partsCount >= 2 && (metrics.hardwareCount > 0 || metrics.partsCount >= 6)) {
    tasks.push(
      task(
        "assembly",
        metrics.hardwareCount > 0
          ? `Збірка ${metrics.partsCount} дет. з фурнітурою`
          : `Збірка ${metrics.partsCount} деталей`,
        metrics.hardwareCount > 0 ? 0.88 : 0.82
      )
    );
  }

  return tasks;
}

/**
 * Об'єднує задачі ШІ та евристики: зберігає вищу впевненість, додає відсутні етапи.
 */
export function mergeSuggestedTasks(aiTasks = [], inferredTasks = []) {
  const byStage = new Map();

  const upsert = (t) => {
    if (!t || t.needed === false) return;
    const stage = String(t.stage || "").trim();
    if (!STAGES.includes(stage)) return;
    const conf = Number(t.confidence);
    const confidence = Number.isFinite(conf) ? conf : 0.6;
    const prev = byStage.get(stage);
    if (!prev || confidence >= (prev.confidence ?? 0)) {
      byStage.set(stage, {
        stage,
        needed: true,
        reason: String(t.reason || prev?.reason || "").trim(),
        confidence
      });
    } else if (prev && !prev.reason && t.reason) {
      prev.reason = String(t.reason).trim();
    }
  };

  for (const t of inferredTasks) upsert(t);
  for (const t of aiTasks) upsert(t);

  return STAGES.filter((s) => byStage.has(s)).map((s) => byStage.get(s));
}

/** Евристика з panels[] legacy-аналізу файлу. */
export function inferSuggestedTasksFromPanels(panels = [], { itemName = "", itemType = "" } = {}) {
  const parts = panels.map((p) => {
    const size = String(p.size || "").match(/(\d{2,5})\s*[xх×]\s*(\d{2,5})/i);
    return {
      partName: p.name || "",
      length: size ? Number(size[1]) : 0,
      width: size ? Number(size[2]) : 0,
      qty: Math.max(1, Number(p.qty) || 1),
      edgeCode: p.edge || ""
    };
  });
  return inferSuggestedTasksFromPackage({ parts, hardware: [], itemName, itemType });
}

/** Короткий блок сигналів для prompt ШІ. */
export function formatPackageMetricsForPrompt(parts = [], hardware = []) {
  const m = computePackageStageMetrics(parts, hardware);
  if (!m.partsCount) return "";
  const lines = [
    `Сигнали розбору ENVER (орієнтир для suggestedTasks, не ігноруй без причини):`,
    `- порізка: ${m.partsCount} дет., ~${Math.round(m.cutLengthMm / 1000)} м периметру`,
    `- кромкування: ~${Math.round(m.edgeLengthMm / 1000)} м крайки`,
    `- присадка: ${m.hardwareCount} поз. фурнітури, ~${m.drillPoints} отворів`,
    `- збірка: ${m.partsCount >= 6 || m.hardwareCount > 0 ? "ймовірно потрібна" : "за складністю"}`
  ];
  if (m.materialSummary) lines.push(`- матеріали: ${m.materialSummary}`);
  return lines.join("\n");
}
