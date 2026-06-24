import {
  ALLOWED_STAGES,
  COMPLEXITY_LEVELS,
  EMPTY_OPERATOR_NOTES,
  STAGE_ALIASES,
  createEmptyAnalysis
} from "./constructive-schema.js";

function clampConfidence(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.6;
  return Math.min(1, Math.max(0, n));
}

function normalizeStage(rawStage) {
  const key = String(rawStage || "")
    .trim()
    .toLowerCase();
  if (!key) return { stage: null, unknown: true };
  const mapped = STAGE_ALIASES[key] || key;
  if (ALLOWED_STAGES.includes(mapped)) {
    return { stage: mapped, unknown: false };
  }
  return { stage: null, unknown: true, original: rawStage };
}

function normalizeMaterials(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw
      .map((m) => (typeof m === "string" ? m.trim() : m?.name ? String(m.name).trim() : ""))
      .filter(Boolean);
  }
  if (typeof raw === "string" && raw.trim()) {
    return [raw.trim()];
  }
  return [];
}

function normalizePanels(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((p) => {
      if (!p || typeof p !== "object") return null;
      return {
        name: String(p.name || p.title || "").trim(),
        qty: Number(p.qty ?? p.quantity ?? 0) || 0,
        size: String(p.size || p.dimensions || "").trim(),
        material: String(p.material || "").trim(),
        edge: String(p.edge || p.edging || "").trim(),
        notes: String(p.notes || p.note || "").trim()
      };
    })
    .filter((p) => p && (p.name || p.size || p.material));
}

function normalizeWarnings(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((w) => String(w || "").trim()).filter(Boolean);
}

function normalizeSuggestedTasks(raw, warningsOut) {
  const items = Array.isArray(raw) ? raw : [];
  const seen = new Set();
  const tasks = [];

  for (const item of items) {
    let stage = null;
    let needed = true;
    let reason = "";
    let confidence = 0.6;

    if (typeof item === "string") {
      const { stage: s, unknown, original } = normalizeStage(item);
      if (unknown) {
        warningsOut.push(`Невідомий етап у рекомендаціях: ${original || item}`);
        continue;
      }
      stage = s;
    } else if (item && typeof item === "object") {
      const { stage: s, unknown, original } = normalizeStage(item.stage);
      if (unknown) {
        warningsOut.push(`Невідомий етап у рекомендаціях: ${original || item.stage || "?"}`);
        continue;
      }
      stage = s;
      needed = item.needed !== false;
      reason = String(item.reason || "").trim();
      confidence = clampConfidence(item.confidence);
    } else {
      continue;
    }

    if (!stage || seen.has(stage)) continue;
    seen.add(stage);
    tasks.push({ stage, needed, reason, confidence });
  }

  return tasks;
}

function normalizeOperatorNotes(raw) {
  const notes = { ...EMPTY_OPERATOR_NOTES };
  if (!raw || typeof raw !== "object") return notes;
  for (const stage of ALLOWED_STAGES) {
    if (raw[stage] != null) {
      notes[stage] = String(raw[stage]).trim();
    }
  }
  return notes;
}

function normalizeComplexity(raw) {
  const c = String(raw || "")
    .trim()
    .toLowerCase();
  return COMPLEXITY_LEVELS.includes(c) ? c : "medium";
}

function normalizeMissingInfo(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map((m) => String(m || "").trim()).filter(Boolean);
}

/**
 * Нормалізує сирий AI-результат до строгої внутрішньої структури.
 * @param {unknown} raw
 * @returns {import('./constructive-schema.js').ReturnType<typeof createEmptyAnalysis>}
 */
export function normalizeAnalysisResult(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return createEmptyAnalysis({
      warnings: ["Некоректний формат відповіді AI"],
      missingInfo: ["Потрібна ручна перевірка конструктора"]
    });
  }

  const extraWarnings = [];
  const suggestedTasks = normalizeSuggestedTasks(raw.suggestedTasks, extraWarnings);
  const warnings = [...normalizeWarnings(raw.warnings), ...extraWarnings];

  const analysis = {
    summary: String(raw.summary || "").trim(),
    materials: normalizeMaterials(raw.materials),
    panels: normalizePanels(raw.panels),
    warnings,
    suggestedTasks,
    estimatedComplexity: normalizeComplexity(raw.estimatedComplexity),
    missingInfo: normalizeMissingInfo(raw.missingInfo),
    operatorNotes: normalizeOperatorNotes(raw.operatorNotes),
    quality: {
      score: 0,
      safeToCreateTasks: false,
      needsHumanReview: true,
      reasons: []
    }
  };

  if (!analysis.summary && suggestedTasks.length === 0 && !analysis.materials.length) {
    analysis.warnings.push("AI не надав корисних даних — потрібна ручна перевірка");
  }

  return analysis;
}
