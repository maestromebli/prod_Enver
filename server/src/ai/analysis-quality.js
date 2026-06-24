import { ALLOWED_STAGES } from "./constructive-schema.js";

const CRITICAL_WARNING_PATTERNS = [
  /критичн/i,
  /блокер/i,
  /небезпеч/i,
  /заборон/i,
  /неможлив/i,
  /відсутн.*фурнітур/i,
  /немає.*фурнітур/i
];

const CONFIDENCE_SAFE_THRESHOLD = 0.8;
const MEMORY_CONFIDENCE_BOOST_CAP = 0.9;

function hasCriticalWarnings(warnings = []) {
  return warnings.some((w) => CRITICAL_WARNING_PATTERNS.some((re) => re.test(w)));
}

function avgTaskConfidence(tasks = []) {
  const needed = tasks.filter((t) => t.needed !== false);
  if (!needed.length) return 0;
  return needed.reduce((sum, t) => sum + (t.confidence ?? 0.6), 0) / needed.length;
}

/**
 * Оцінює якість AI-аналізу та безпеку автоматичного створення задач.
 * @param {object} analysis — нормалізований аналіз
 * @param {object} [sourceMeta] — метадані витягування тексту
 * @param {object} [learningContext] — досвід ENVER (етап 3+)
 */
export function computeAnalysisQuality(analysis, sourceMeta = {}, learningContext = {}) {
  const reasons = [];
  let score = 0.5;
  let needsHumanReview = false;
  let safeToCreateTasks = false;

  const tasks = (analysis.suggestedTasks || []).filter((t) => t.needed !== false);
  const hasMaterials = (analysis.materials || []).length > 0;
  const hasPanels = (analysis.panels || []).length > 0;
  const hasSummary = Boolean(analysis.summary?.trim());
  const missingInfo = analysis.missingInfo || [];
  const warnings = analysis.warnings || [];

  if (!hasSummary && !hasMaterials && !hasPanels && tasks.length === 0) {
    score = 0.15;
    reasons.push("AI повернув лише загальний опис без деталей");
    needsHumanReview = true;
  } else if (!hasSummary && tasks.length === 0) {
    score = 0.25;
    reasons.push("Низька якість аналізу — мало структурованих даних");
    needsHumanReview = true;
  }

  if (!hasMaterials && !hasPanels) {
    reasons.push("Не вистачає даних про матеріали");
    score -= 0.1;
    needsHumanReview = true;
  } else {
    score += 0.1;
  }

  if (hasSummary) score += 0.1;
  if (hasMaterials) score += 0.05;
  if (hasPanels) score += 0.1;

  if (tasks.length === 0) {
    reasons.push("AI не запропонував виробничі етапи");
    score -= 0.15;
    needsHumanReview = true;
  } else {
    score += 0.1;
  }

  const unknownStages = tasks.filter((t) => !ALLOWED_STAGES.includes(t.stage));
  if (unknownStages.length > 0) {
    reasons.push("Є невідомі етапи — потрібна ручна перевірка");
    needsHumanReview = true;
    score -= 0.2;
  }

  if (missingInfo.length > 0) {
    reasons.push("Бракує даних у файлі конструктива");
    needsHumanReview = true;
    score -= 0.1;
  }

  const extractionQuality = sourceMeta.extractionQuality || "good";
  if (extractionQuality === "partial") {
    reasons.push("Файл розпізнано частково");
    needsHumanReview = true;
    score -= 0.15;
  } else if (extractionQuality === "poor") {
    reasons.push("Файл розпізнано частково");
    needsHumanReview = true;
    score -= 0.25;
  }

  if (sourceMeta.sourceType === "dwg") {
    reasons.push("DWG потребує експорту в DXF/PDF для точного аналізу");
    needsHumanReview = true;
    score -= 0.2;
  }

  if (hasCriticalWarnings(warnings)) {
    reasons.push("Є критичні попередження — потрібна перевірка конструктора");
    needsHumanReview = true;
    score -= 0.15;
  }

  const avgConf = avgTaskConfidence(tasks);
  if (tasks.length > 0 && avgConf < CONFIDENCE_SAFE_THRESHOLD) {
    reasons.push("Низька впевненість AI");
    needsHumanReview = true;
    score -= 0.1;
  }

  const examples = learningContext.examples || [];
  const rules = learningContext.rules || [];
  const conflicting = Boolean(learningContext.conflicting);
  const frequentMistakes = Number(learningContext.frequentMistakeCount) || 0;
  const goodExamples = examples.filter((e) => e && e.lesson);

  if (goodExamples.length > 0) {
    reasons.push(`Враховано ${goodExamples.length} схожі замовлення ENVER`);
    score += Math.min(0.1, goodExamples.length * 0.03);
  }

  if (frequentMistakes >= 2) {
    reasons.push("У схожих випадках AI часто помилявся — потрібна перевірка");
    needsHumanReview = true;
    score -= 0.15;
  }

  if (conflicting) {
    reasons.push("Суперечливий досвід ENVER — потрібна ручна перевірка");
    needsHumanReview = true;
    score -= 0.1;
  }

  for (const rule of rules) {
    if (rule?.title || rule?.rule_text) {
      reasons.push(`Застосовано правило ENVER: ${rule.title || rule.rule_text}`);
    }
  }

  score = Math.min(1, Math.max(0, score));

  const allHighConfidence =
    tasks.length > 0 && tasks.every((t) => (t.confidence ?? 0) >= CONFIDENCE_SAFE_THRESHOLD);

  if (
    allHighConfidence &&
    !needsHumanReview &&
    missingInfo.length === 0 &&
    extractionQuality !== "poor" &&
    unknownStages.length === 0 &&
    frequentMistakes < 2 &&
    !conflicting
  ) {
    safeToCreateTasks = true;
    reasons.push("Можна створити задачі автоматично після підтвердження");
  } else if (tasks.length > 0 && avgConf >= 0.65) {
    reasons.push("Потрібна ручна перевірка конструктора");
    needsHumanReview = true;
  }

  let memoryBoost = 0;
  if (goodExamples.length > 0 && !conflicting) {
    memoryBoost = Math.min(0.15, goodExamples.length * 0.04);
  }
  if (memoryBoost > 0) {
    const boostedAvg = Math.min(MEMORY_CONFIDENCE_BOOST_CAP, avgConf + memoryBoost);
    if (boostedAvg < avgConf + memoryBoost) {
      reasons.push("Впевненість обмежено безпечним лімітом ENVER");
    }
  }

  const uniqueReasons = [...new Set(reasons)];

  return {
    score: Math.round(score * 100) / 100,
    safeToCreateTasks,
    needsHumanReview: needsHumanReview || !safeToCreateTasks,
    reasons: uniqueReasons
  };
}

/** Застосовує quality до аналізу (мутує quality поле). */
export function attachQualityToAnalysis(analysis, sourceMeta, learningContext) {
  const quality = computeAnalysisQuality(analysis, sourceMeta, learningContext);
  analysis.quality = quality;
  return analysis;
}
