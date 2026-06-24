/** Дозволені етапи виробництва для AI suggestedTasks. */
export const ALLOWED_STAGES = ["cutting", "edging", "drilling", "assembly", "packaging"];

export const COMPLEXITY_LEVELS = ["low", "medium", "high"];

export const STAGE_ALIASES = {
  порізка: "cutting",
  cutting: "cutting",
  крайкування: "edging",
  кромкування: "edging",
  edging: "edging",
  присадка: "drilling",
  drilling: "drilling",
  збірка: "assembly",
  assembly: "assembly",
  пакування: "packaging",
  packaging: "packaging"
};

export const EMPTY_OPERATOR_NOTES = {
  cutting: "",
  edging: "",
  drilling: "",
  assembly: "",
  packaging: ""
};

export const DEFAULT_QUALITY = {
  score: 0,
  safeToCreateTasks: false,
  needsHumanReview: true,
  reasons: []
};

/** Безпечний порожній аналіз для fallback. */
export function createEmptyAnalysis(overrides = {}) {
  return {
    summary: "",
    materials: [],
    panels: [],
    warnings: [],
    suggestedTasks: [],
    estimatedComplexity: "medium",
    missingInfo: [],
    operatorNotes: { ...EMPTY_OPERATOR_NOTES },
    quality: { ...DEFAULT_QUALITY },
    ...overrides
  };
}
