/** Спільна схема ШІ-аналізу пакета конструктива. */

export const FURNITURE_TYPES = [
  "kitchen",
  "wardrobe",
  "cabinet",
  "bathroom",
  "office",
  "living",
  "other"
];

export const FURNITURE_TYPE_LABELS = {
  kitchen: "Кухня",
  wardrobe: "Шафа / гардероб",
  cabinet: "Тумба / комод",
  bathroom: "Ванна кімната",
  office: "Офіс / робочий стіл",
  living: "Вітальня / стінка",
  other: "Інше"
};

export const LABOR_STAGES = ["cutting", "edging", "drilling", "assembly", "constructor"];

export const LABOR_STAGE_LABELS = {
  constructor: "Конструктив",
  cutting: "Порізка",
  edging: "Кромкування",
  drilling: "Присадка",
  assembly: "Збірка"
};

function clampConfidence(value, fallback = 0.6) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

function normalizeFurnitureType(raw) {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (FURNITURE_TYPES.includes(key)) return key;
  if (/кухн/i.test(key)) return "kitchen";
  if (/шаф|гардероб|купе/i.test(key)) return "wardrobe";
  if (/тумб|комод/i.test(key)) return "cabinet";
  if (/ванн/i.test(key)) return "bathroom";
  if (/офіс|стіл/i.test(key)) return "office";
  if (/вітальн|стінк/i.test(key)) return "living";
  return "other";
}

function normalizeHardwareList(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((h) => {
      if (typeof h === "string") return { name: h.trim(), qty: "", notes: "" };
      if (!h || typeof h !== "object") return null;
      return {
        name: String(h.name || h.title || "").trim(),
        qty: String(h.qty ?? h.quantity ?? "").trim(),
        notes: String(h.notes || h.note || "").trim()
      };
    })
    .filter((h) => h?.name);
}

function normalizeStageMinutes(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n);
}

/**
 * Евристична оцінка часу за кількістю деталей/фурнітури (орієнтир, не норма).
 */
export function estimateLaborHeuristic({
  partsCount = 0,
  hardwareCount = 0,
  complexity = "medium",
  furnitureType = "other"
} = {}) {
  const mult = complexity === "high" ? 1.35 : complexity === "low" ? 0.85 : 1;
  const typeBoost = furnitureType === "kitchen" ? 1.2 : furnitureType === "wardrobe" ? 1.1 : 1;
  const parts = Math.max(0, Number(partsCount) || 0);
  const hardware = Math.max(0, Number(hardwareCount) || 0);

  const constructorHours = Math.max(1, (1.5 + parts * 0.04 + hardware * 0.08) * mult * typeBoost);
  const stages = {
    cutting: normalizeStageMinutes(parts * 2.5 * mult),
    edging: normalizeStageMinutes(parts * 1.8 * mult),
    drilling: normalizeStageMinutes(parts * 1.2 * mult + hardware * 2),
    assembly: normalizeStageMinutes(parts * 2 * mult + hardware * 1.5)
  };
  const productionMinutes = stages.cutting + stages.edging + stages.drilling + stages.assembly;
  const totalHours = Math.round((constructorHours + productionMinutes / 60) * 10) / 10;

  return {
    constructorHours: Math.round(constructorHours * 10) / 10,
    stages,
    totalHours,
    confidence: parts > 0 ? 0.55 : 0.35,
    basis: `Евристика: ${parts} деталей, ${hardware} поз. фурнітури, складність ${complexity}`
  };
}

function mergeLabor(aiLabor, heuristic) {
  const stages = {};
  for (const stage of ["cutting", "edging", "drilling", "assembly"]) {
    const aiVal = normalizeStageMinutes(
      aiLabor?.stages?.[stage]?.minutes ?? aiLabor?.stages?.[stage]
    );
    stages[stage] = { minutes: aiVal || heuristic.stages[stage] };
  }
  const constructorHours =
    Number(aiLabor?.constructorHours) > 0
      ? Math.round(Number(aiLabor.constructorHours) * 10) / 10
      : heuristic.constructorHours;
  const productionMinutes = Object.values(stages).reduce((s, v) => s + (v.minutes || 0), 0);
  const totalHours =
    Number(aiLabor?.totalHours) > 0
      ? Math.round(Number(aiLabor.totalHours) * 10) / 10
      : Math.round((constructorHours + productionMinutes / 60) * 10) / 10;

  return {
    constructorHours,
    stages,
    totalHours,
    confidence: clampConfidence(aiLabor?.confidence, heuristic.confidence),
    basis: String(aiLabor?.basis || heuristic.basis).trim()
  };
}

/**
 * @param {unknown} raw
 * @param {{ partsCount?: number, hardwareCount?: number, itemName?: string, itemType?: string }} [context]
 */
export function normalizePackageAiAnalysis(raw, context = {}) {
  const partsCount = context.partsCount ?? 0;
  const hardwareCount = context.hardwareCount ?? 0;

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    const heuristic = estimateLaborHeuristic({
      partsCount,
      hardwareCount,
      complexity: "medium",
      furnitureType: "other"
    });
    return {
      summary: "",
      furnitureType: "other",
      furnitureTypeLabel: FURNITURE_TYPE_LABELS.other,
      hardwareSummary: "",
      detectedHardware: [],
      estimatedComplexity: "medium",
      estimatedLabor: heuristic,
      reviewChecklist: [],
      warnings: ["Некоректний формат відповіді ШІ"],
      suggestedActions: []
    };
  }

  const data = /** @type {Record<string, any>} */ (raw);
  const heuristic = estimateLaborHeuristic({
    partsCount,
    hardwareCount,
    complexity: String(data.estimatedComplexity || "medium").toLowerCase(),
    furnitureType: normalizeFurnitureType(data.furnitureType)
  });

  const furnitureType = normalizeFurnitureType(data.furnitureType);
  const detectedHardware = normalizeHardwareList(data.detectedHardware);
  const hardwareSummary = String(data.hardwareSummary || "").trim();

  return {
    summary: String(data.summary || "").trim(),
    furnitureType,
    furnitureTypeLabel: FURNITURE_TYPE_LABELS[furnitureType] || FURNITURE_TYPE_LABELS.other,
    hardwareSummary,
    detectedHardware,
    detectedBlocks: Array.isArray(data.detectedBlocks) ? data.detectedBlocks.map(String) : [],
    detectedParts: Array.isArray(data.detectedParts) ? data.detectedParts : [],
    detectedMaterials: Array.isArray(data.detectedMaterials) ? data.detectedMaterials : [],
    procurementDraft: Array.isArray(data.procurementDraft) ? data.procurementDraft : [],
    estimatedComplexity: ["low", "medium", "high"].includes(
      String(data.estimatedComplexity || "").toLowerCase()
    )
      ? String(data.estimatedComplexity).toLowerCase()
      : "medium",
    estimatedLabor: mergeLabor(data.estimatedLabor, heuristic),
    cncReadiness: data.cncReadiness || null,
    modelReadiness: data.modelReadiness || null,
    reviewChecklist: Array.isArray(data.reviewChecklist)
      ? data.reviewChecklist.map((s) => String(s).trim()).filter(Boolean)
      : [],
    warnings: Array.isArray(data.warnings)
      ? data.warnings.map((w) => String(w).trim()).filter(Boolean)
      : [],
    suggestedActions: Array.isArray(data.suggestedActions)
      ? data.suggestedActions.map((s) => String(s).trim()).filter(Boolean)
      : [],
    suggestedTasks: Array.isArray(data.suggestedTasks) ? data.suggestedTasks : []
  };
}

/** Форматує години для UI. */
export function formatLaborHours(hours) {
  const n = Number(hours);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1) return `${Math.round(n * 60)} хв`;
  const h = Math.floor(n);
  const m = Math.round((n - h) * 60);
  return m > 0 ? `${h} год ${m} хв` : `${h} год`;
}
