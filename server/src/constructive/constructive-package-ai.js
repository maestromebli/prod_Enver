import { all, one, run } from "../db.js";
import { getPackageDetail } from "./constructive-package-service.js";
import { getAiSettings } from "../app-settings.js";
import { callOpenAiChat } from "../ai/openai-client.js";
import { parseRawAnalysisContent } from "../ai/validate-analysis.js";
import { getRelevantLearningContext } from "../ai/ai-learning.js";
import { normalizePackageAiAnalysis } from "../../../shared/production/package-ai.js";
import { parseJsonObject } from "../json-utils.js";
import { loadStageDurationHints } from "../stage-duration-learning.js";

function buildPackageAiPrompt({
  orderNumber,
  item,
  itemType,
  packageDetail,
  learningContext,
  durationHints
}) {
  const parts = packageDetail.parts || [];
  const materials = packageDetail.materials || [];
  const hardware = packageDetail.hardware || [];
  const files = packageDetail.files || [];

  const learningBlock = learningContext?.summary
    ? `\n\nДосвід ENVER зі схожих замовлень:\n${learningContext.summary}`
    : "";
  const durationBlock = durationHints
    ? `\n\nФактичні середні темпи ENVER з завершених етапів (калібруй estimatedLabor):\n${durationHints}`
    : "";

  return `Ти аналізуєш пакет конструктива ENVER для меблевого виробництва.
Замовлення: ${orderNumber || "—"}, позиція: ${item || "—"}, тип: ${itemType || "—"}.
Статус пакета: ${packageDetail.package?.status || "—"}.

Файли: ${files.map((f) => `${f.kindLabel || f.kind}: ${f.originalName}`).join("; ") || "—"}
Деталей: ${parts.length}, матеріалів: ${materials.length}, фурнітури: ${hardware.length}
Unmapped 3D: ${packageDetail.unmappedParts?.length || 0}

Поверни ТІЛЬКИ валідний JSON:
{
  "summary": "короткий опис виробу українською",
  "furnitureType": "kitchen|wardrobe|cabinet|bathroom|office|living|other",
  "hardwareSummary": "зведення по фурнітурі одним абзацом",
  "detectedHardware": [{"name":"","qty":"","notes":""}],
  "detectedBlocks": [],
  "detectedParts": [{"partNo":"","partName":"","material":""}],
  "detectedMaterials": [],
  "estimatedComplexity": "low|medium|high",
  "estimatedLabor": {
    "constructorHours": 0,
    "stages": {
      "cutting": {"minutes": 0},
      "edging": {"minutes": 0},
      "drilling": {"minutes": 0},
      "assembly": {"minutes": 0}
    },
    "totalHours": 0,
    "confidence": 0.7,
    "basis": "на чому базується оцінка"
  },
  "procurementDraft": [{"name":"","qty":"","type":"board|hardware|other"}],
  "cncReadiness": {"ready": false, "missing": [], "warnings": []},
  "modelReadiness": {"has3dSource": false, "needsGlbExport": false, "mappedPartsCount": 0, "unmappedParts": []},
  "reviewChecklist": ["..."],
  "warnings": [],
  "suggestedActions": [],
  "suggestedTasks": [{"stage":"cutting","needed":true,"reason":"","confidence":0.8}]
}

Правила:
- furnitureType визначай з назв деталей, блоків, фурнітури та позиції замовлення.
- detectedHardware — лише з наведеного списку фурнітури; не вигадуй позиції.
- estimatedLabor — орієнтовний час для планування; якщо даних мало — знизь confidence до 0.5–0.65.
- constructorHours — час роботи конструктора з цим пакетом (перевірка, доопрацювання).
- stages — час цеху в хвилинах; cutting/edging/drilling/assembly.
- Якщо немає GLB/GLTF — modelReadiness.needsGlbExport = true.
- B3D без GLB — не вважай 3D готовим.
- Не пропонуй автоматично відправку на ЧПК чи finance.
- Усі тексти українською.
- Не використовуй markdown.${learningBlock}${durationBlock}

Деталі (перші 40):
${JSON.stringify(parts.slice(0, 40), null, 0)}

Матеріали:
${JSON.stringify(materials.slice(0, 20), null, 0)}

Фурнітура:
${JSON.stringify(hardware.slice(0, 30), null, 0)}`;
}

function enrichReadiness(analysis, detail) {
  const hasGlb = detail.files?.some(
    (f) => f.kind === "glb_model" || f.kind === "gltf_model" || f.kind === "wrl_model"
  );
  const hasB3d = detail.files?.some((f) => f.kind === "b3d");
  const mappedCount = (detail.parts || []).filter((p) => p.modelNodeId || p.modelMeshName).length;

  if (!analysis.modelReadiness) {
    analysis.modelReadiness = {
      has3dSource: hasGlb || hasB3d,
      needsGlbExport: hasB3d && !hasGlb,
      mappedPartsCount: mappedCount,
      unmappedParts: (detail.unmappedParts || []).map((p) => p.partName)
    };
  }

  if (!analysis.cncReadiness) {
    const approved = ["approved_by_constructor", "approved_by_production", "cnc_ready"].includes(
      detail.package?.status
    );
    analysis.cncReadiness = {
      ready: approved && hasGlb,
      missing: approved ? [] : ["Потрібне підтвердження пакета"],
      warnings: detail.unmappedParts?.length
        ? [`${detail.unmappedParts.length} деталей без 3D-звʼязку`]
        : []
    };
  }

  return analysis;
}

function mapAiRow(row) {
  if (!row) return null;
  const parsed = parseJsonObject(row.summary_json);
  const analysis = parsed.analysis
    ? normalizePackageAiAnalysis(parsed.analysis, parsed.context || {})
    : normalizePackageAiAnalysis(parsed, parsed.context || {});

  return {
    id: row.id,
    packageId: row.package_id,
    status: row.status,
    analysis,
    model: row.model || "",
    tokens: row.tokens || 0,
    durationMs: row.duration_ms || 0,
    errorMessage: row.error_message || "",
    createdAt: row.created_at
  };
}

export async function getLatestPackageAiAnalysis(packageId) {
  const row = await one(
    `SELECT * FROM constructive_package_ai_analyses
     WHERE package_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [packageId]
  );
  return mapAiRow(row);
}

async function createPendingPackageAiRow(packageId) {
  const row = await one(
    `INSERT INTO constructive_package_ai_analyses (package_id, status, summary_json)
     VALUES ($1, 'pending', '{}')
     RETURNING *`,
    [packageId]
  );
  return row;
}

async function savePackageAiResult(
  rowId,
  { status, analysis, model, tokens, durationMs, errorMessage }
) {
  await run(
    `UPDATE constructive_package_ai_analyses
     SET status = $1, summary_json = $2, model = $3, tokens = $4, duration_ms = $5, error_message = $6
     WHERE id = $7`,
    [
      status,
      JSON.stringify(analysis),
      model || "",
      tokens || 0,
      durationMs || 0,
      errorMessage || "",
      rowId
    ]
  );
}

/**
 * ШІ-аналіз пакета. За save=true зберігає результат у БД.
 */
export async function analyzeConstructivePackage(
  packageId,
  { orderNumber, item, itemType, save = false, pendingRowId = null } = {}
) {
  const detail = await getPackageDetail(packageId);
  if (!detail) {
    const err = new Error("Пакет не знайдено");
    err.status = 404;
    throw err;
  }

  const settings = await getAiSettings();
  if (!settings.enabled || !settings.openaiApiKey) {
    const skipped = {
      available: false,
      analysis: null,
      message: "ШІ не налаштовано"
    };
    if (save && pendingRowId) {
      await savePackageAiResult(pendingRowId, {
        status: "skipped",
        analysis: { message: skipped.message },
        model: "",
        tokens: 0,
        durationMs: 0,
        errorMessage: ""
      });
    }
    return skipped;
  }

  if (!detail.parts?.length && !detail.hardware?.length && !detail.materials?.length) {
    const empty = {
      available: false,
      analysis: null,
      message: "Спочатку розберіть пакет — немає деталей для аналізу"
    };
    if (save && pendingRowId) {
      await savePackageAiResult(pendingRowId, {
        status: "skipped",
        analysis: { message: empty.message },
        model: "",
        tokens: 0,
        durationMs: 0,
        errorMessage: ""
      });
    }
    return empty;
  }

  const learningContext = await getRelevantLearningContext({
    itemName: item,
    itemType,
    material: detail.materials?.[0]?.materialName || ""
  });
  const durationHints = await loadStageDurationHints().catch(() => "");

  const prompt = buildPackageAiPrompt({
    orderNumber,
    item,
    itemType,
    packageDetail: detail,
    learningContext,
    durationHints
  });

  const started = Date.now();
  const raw = await callOpenAiChat({
    apiKey: settings.openaiApiKey,
    model: settings.openaiModel,
    messages: [
      {
        role: "system",
        content:
          "Ти експерт з меблевого виробництва ENVER. Відповідай українською. Повертай лише JSON без markdown."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  });

  const parsed = parseRawAnalysisContent(raw.content);
  const rawData = parsed.ok ? parsed.data : {};
  enrichReadiness(rawData, detail);

  const context = {
    partsCount: detail.parts?.length || 0,
    hardwareCount: detail.hardware?.length || 0,
    itemName: item,
    itemType
  };
  const analysis = normalizePackageAiAnalysis(rawData, context);
  const durationMs = Date.now() - started;

  const payload = {
    analysis,
    context,
    learningContext: {
      summary: learningContext.summary || "",
      examplesCount: learningContext.examples?.length || 0
    },
    durationMs
  };

  if (save && pendingRowId) {
    await savePackageAiResult(pendingRowId, {
      status: "done",
      analysis: payload,
      model: settings.openaiModel,
      tokens: raw.tokens || 0,
      durationMs,
      errorMessage: parsed.ok ? "" : "Частковий розбір відповіді ШІ"
    });
  }

  return {
    available: true,
    analysis,
    learningContext,
    model: settings.openaiModel,
    tokens: raw.tokens || 0,
    durationMs,
    id: pendingRowId || null
  };
}

/**
 * Створює pending-запис і запускає ШІ у фоні. Повертає id рядка або null.
 */
export async function kickoffPackageAiAnalysis(packageId, { orderNumber, item, itemType } = {}) {
  const settings = await getAiSettings();
  if (!settings.enabled || !settings.openaiApiKey) return null;

  const existing = await getLatestPackageAiAnalysis(packageId);
  if (existing?.status === "pending") return existing.id;

  const pendingRow = await createPendingPackageAiRow(packageId);
  void runPackageAiAnalysisJob(packageId, {
    orderNumber,
    item,
    itemType,
    pendingRowId: pendingRow.id
  }).catch((err) => {
    console.error("[package-ai] auto analysis failed:", err?.message || err);
  });
  return pendingRow.id;
}

/**
 * @deprecated Використовуйте kickoffPackageAiAnalysis
 */
export function schedulePackageAiAnalysis(packageId, meta = {}) {
  void kickoffPackageAiAnalysis(packageId, meta);
}

async function runPackageAiAnalysisJob(
  packageId,
  { orderNumber, item, itemType, pendingRowId: existingRowId } = {}
) {
  let pendingRowId = existingRowId;
  if (!pendingRowId) {
    const row = await createPendingPackageAiRow(packageId);
    pendingRowId = row.id;
  }
  try {
    await analyzeConstructivePackage(packageId, {
      orderNumber,
      item,
      itemType,
      save: true,
      pendingRowId
    });
  } catch (err) {
    await savePackageAiResult(pendingRowId, {
      status: "error",
      analysis: { error: err.message },
      model: "",
      tokens: 0,
      durationMs: 0,
      errorMessage: err.message || "Помилка ШІ-аналізу"
    });
    throw err;
  }
}

/** Ручний перезапуск аналізу (кнопка в UI). */
export async function rerunPackageAiAnalysis(packageId, positionMeta = {}) {
  const pendingRow = await createPendingPackageAiRow(packageId);
  return analyzeConstructivePackage(packageId, {
    ...positionMeta,
    save: true,
    pendingRowId: pendingRow.id
  });
}

export async function listPackageAiAnalyses(packageId, limit = 5) {
  const rows = await all(
    `SELECT * FROM constructive_package_ai_analyses
     WHERE package_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [packageId, limit]
  );
  return rows.map(mapAiRow).filter(Boolean);
}
