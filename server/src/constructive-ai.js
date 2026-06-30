import { all, one, run } from "./db.js";
import { getAiSettings } from "./app-settings.js";
import { readStoredFile } from "./file-storage.js";
import { parseJsonObject } from "./json-utils.js";
import { attachQualityToAnalysis } from "./ai/analysis-quality.js";
import { extractTextFromBuffer, MAX_TEXT_CHARS } from "./ai/file-extraction.js";
import { normalizeAnalysisResult } from "./ai/normalize-analysis.js";
import { callOpenAiChat } from "./ai/openai-client.js";
import { parseRawAnalysisContent } from "./ai/validate-analysis.js";
import { getRelevantLearningContext } from "./ai/ai-learning.js";

export { extractTextFromBuffer };

export async function getRecentAiFeedback(limit = 5) {
  const rows = await all(
    `SELECT correction_text, rating FROM ai_feedback
     WHERE trim(correction_text) <> ''
     ORDER BY created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

function buildExtractionHint(meta) {
  const parts = [];
  if (meta.extractedFiles?.length) {
    parts.push(`Файли в архіві: ${meta.extractedFiles.join(", ")}`);
  }
  if (meta.text?.length > 0) {
    const preview = meta.text.replace(/\s+/g, " ").slice(0, 200);
    parts.push(`Прочитано: ${preview}${meta.text.length > 200 ? "…" : ""}`);
  }
  return parts.join(". ");
}

function buildPrompt({ orderNumber, item, text, feedback, extractionMeta, learningContext }) {
  const examples =
    feedback.length > 0
      ? `\n\nПриклади корекцій від адміністратора (врахуй стиль і термінологію, але не як абсолютну істину):\n${feedback
          .map((f, i) => `${i + 1}. [${f.rating}] ${f.correction_text}`)
          .join("\n")}`
      : "";

  const extractionNote =
    extractionMeta.extractionQuality !== "good"
      ? `\n\nУВАГА: файл прочитано частково (якість: ${extractionMeta.extractionQuality}). ${
          extractionMeta.warnings?.join("; ") || ""
        }`
      : "";

  const learningBlock = learningContext?.summary
    ? `\n\nДосвід ENVER зі схожих замовлень (підказка, не абсолютна істина):\n${learningContext.summary}`
    : "";

  const rulesBlock =
    learningContext?.rules?.length > 0
      ? `\n\nПравила ENVER:\n${learningContext.rules
          .map((r, i) => `${i + 1}. ${r.rule_text || r.title}`)
          .join("\n")}`
      : "";

  return `Ти аналізуєш конструкторський файл меблевого виробництва для системи ENVER.
Замовлення: ${orderNumber || "—"}, позиція: ${item || "—"}.

Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "summary": "короткий опис замовлення/виробу",
  "materials": ["матеріал1"],
  "panels": [{"name":"...", "qty":0, "size":"...", "material":"...", "edge":"...", "notes":"..."}],
  "warnings": ["попередження"],
  "suggestedTasks": [
    {"stage": "cutting", "needed": true, "reason": "...", "confidence": 0.92}
  ],
  "estimatedComplexity": "low|medium|high",
  "furnitureType": "kitchen|wardrobe|cabinet|bathroom|office|living|other",
  "hardwareSummary": "зведення по фурнітурі",
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
  "missingInfo": ["..."],
  "operatorNotes": {
    "cutting": "...",
    "edging": "...",
    "drilling": "...",
    "assembly": "..."
  }
}

Правила:
- Якщо інформації немає у файлі — не вигадуй, пиши в missingInfo.
- Якщо впевненість нижче 0.8 — додай warning або missingInfo про ручну перевірку.
- Якщо файл прочитано частково — попередь у warnings.
- Для suggestedTasks використовуй ТІЛЬКИ: cutting, edging, drilling, assembly.
- Не створюй задачі без причини (reason обов'язковий).
- operatorNotes — коротко і практично для оператора.
- warnings — попередження; критичні проблеми теж у warnings.
- estimatedLabor — орієнтовний час (constructorHours + stages у хвилинах); знизь confidence якщо файл прочитано частково.
- furnitureType — тип меблів з файлу або назви позиції.
- Досвід ENVER враховуй як підказку; якщо суперечить файлу — додай warning.
- Якщо досвід лише припущення — confidence не вище 0.75.
- Не використовуй markdown. Поверни тільки JSON.
- Усі тексти для користувача — українською.

Текст/вміст файлу:
${text.slice(0, MAX_TEXT_CHARS)}${extractionNote}${learningBlock}${rulesBlock}${examples}`;
}

function flattenAnalysisResponse({
  id,
  createdAt,
  analysis,
  extractedTextMeta,
  learningContext,
  model,
  tokens,
  durationMs
}) {
  const { quality, ...rest } = analysis;
  return {
    id,
    createdAt,
    analysis,
    quality,
    extractedTextMeta,
    learningContext: learningContext || { examples: [], rules: [], summary: "" },
    model,
    tokens,
    durationMs,
    ...rest
  };
}

export async function analyzeConstructiveFile({
  positionFileId,
  orderNumber,
  item,
  itemType = "",
  material = "",
  storagePath,
  mime,
  originalName,
  learningContext = null
}) {
  const ai = await getAiSettings();
  if (!ai.enabled) {
    const err = new Error("ШІ вимкнено в налаштуваннях");
    err.status = 400;
    throw err;
  }
  if (!ai.openaiApiKey?.trim()) {
    const err = new Error("Не налаштовано OpenAI API ключ");
    err.status = 400;
    throw err;
  }

  const buffer = await readStoredFile(storagePath);
  const extractedTextMeta = await extractTextFromBuffer(buffer, mime, originalName);
  const ctx =
    learningContext ||
    (await getRelevantLearningContext({
      itemName: item,
      itemType,
      material,
      extractedText: extractedTextMeta.text
    }));

  const feedback = await getRecentAiFeedback(5);
  const prompt = buildPrompt({
    orderNumber,
    item,
    text: extractedTextMeta.text,
    feedback,
    extractionMeta: extractedTextMeta,
    learningContext: ctx
  });

  const { content, tokens, model, durationMs, raw } = await callOpenAiChat({
    apiKey: ai.openaiApiKey,
    model: ai.openaiModel,
    messages: [
      {
        role: "system",
        content:
          "Ти експерт з меблевого виробництва. Відповідай українською. Повертай лише JSON без markdown."
      },
      { role: "user", content: prompt }
    ],
    temperature: 0.2
  });

  const { raw: parsedRaw } = parseRawAnalysisContent(content);
  let analysis = normalizeAnalysisResult(parsedRaw);

  if (extractedTextMeta.warnings?.length) {
    analysis.warnings = [...new Set([...analysis.warnings, ...extractedTextMeta.warnings])];
  }

  attachQualityToAnalysis(analysis, extractedTextMeta, ctx);

  const storedPayload = {
    ...analysis,
    _meta: {
      extractedTextMeta: {
        sourceType: extractedTextMeta.sourceType,
        extractionQuality: extractedTextMeta.extractionQuality,
        warnings: extractedTextMeta.warnings,
        extractedFiles: extractedTextMeta.extractedFiles,
        readPreview: buildExtractionHint(extractedTextMeta)
      },
      learningContext: ctx,
      durationMs,
      debug: process.env.NODE_ENV !== "production" ? { rawOpenAi: raw } : undefined
    }
  };

  const row = await one(
    `INSERT INTO constructive_analyses (position_file_id, summary_json, model, tokens)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [positionFileId, JSON.stringify(storedPayload), model, tokens]
  );

  const fileRow = await one(`SELECT position_id FROM position_files WHERE id = $1`, [
    positionFileId
  ]);
  if (fileRow?.position_id) {
    const { tryAutoCreateTasksFromAnalysis } = await import("./automation/auto-create-tasks.js");
    void tryAutoCreateTasksFromAnalysis(fileRow.position_id, analysis, {
      source: "constructive_ai"
    }).catch((err) => console.error("[automation] constructive ai tasks:", err?.message || err));

    if (analysis?.quality?.needsHumanReview) {
      const { notifyAiNeedsReview } = await import("./automation/dispatch.js");
      void notifyAiNeedsReview(fileRow.position_id, {
        source: "constructive_ai",
        summary: analysis.summary || ""
      }).catch((err) => console.error("[automation] ai review notify:", err?.message || err));
    }
  }

  return flattenAnalysisResponse({
    id: row.id,
    createdAt: row.created_at,
    analysis,
    extractedTextMeta: {
      ...extractedTextMeta,
      readPreview: buildExtractionHint(extractedTextMeta)
    },
    learningContext: ctx,
    model,
    tokens,
    durationMs
  });
}

function mapStoredAnalysis(row) {
  const parsed = parseJsonObject(row.summary_json);
  const meta = parsed._meta || {};
  const { _meta, quality: storedQuality, ...rest } = parsed;
  const analysis = normalizeAnalysisResult(rest);
  if (storedQuality) {
    analysis.quality = storedQuality;
  } else if (meta.extractedTextMeta) {
    attachQualityToAnalysis(analysis, meta.extractedTextMeta, meta.learningContext || {});
  }

  return {
    ...flattenAnalysisResponse({
      id: row.id,
      createdAt: row.created_at,
      analysis,
      extractedTextMeta: meta.extractedTextMeta || null,
      learningContext: meta.learningContext || { examples: [], rules: [], summary: "" },
      model: row.model,
      tokens: row.tokens,
      durationMs: meta.durationMs || null
    }),
    fileId: row.file_id,
    fileName: row.original_name
  };
}

export async function listAnalysesForPosition(positionId) {
  const rows = await all(
    `SELECT ca.id, ca.summary_json, ca.model, ca.tokens, ca.created_at,
            pf.original_name, pf.id AS file_id
     FROM constructive_analyses ca
     JOIN position_files pf ON pf.id = ca.position_file_id
     WHERE pf.position_id = $1
     ORDER BY ca.created_at DESC`,
    [positionId]
  );
  return rows.map((r) => mapStoredAnalysis(r));
}

export async function listRecentAnalyses(limit = 20) {
  const rows = await all(
    `SELECT ca.id, ca.summary_json, ca.model, ca.created_at,
            pf.original_name, p.order_number, p.item
     FROM constructive_analyses ca
     JOIN position_files pf ON pf.id = ca.position_file_id
     JOIN positions p ON p.id = pf.position_id
     ORDER BY ca.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    id: r.id,
    orderNumber: r.order_number,
    item: r.item,
    fileName: r.original_name,
    model: r.model,
    createdAt: r.created_at,
    summary: parseJsonObject(r.summary_json).summary || ""
  }));
}

export async function saveAiFeedback({
  analysisId,
  rating,
  correctionText,
  correctedTasks,
  correctedMaterials,
  correctedWarnings,
  userId,
  learningMeta = {}
}) {
  await run(
    `INSERT INTO ai_feedback (
      constructive_analysis_id, rating, correction_text, user_id,
      corrected_tasks_json, corrected_materials_json, corrected_warnings_json
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      analysisId,
      rating || "",
      correctionText || "",
      userId || null,
      JSON.stringify(Array.isArray(correctedTasks) ? correctedTasks : []),
      JSON.stringify(Array.isArray(correctedMaterials) ? correctedMaterials : []),
      JSON.stringify(Array.isArray(correctedWarnings) ? correctedWarnings : [])
    ]
  );

  if (learningMeta.saveEvent !== false) {
    const { saveLearningEvent } = await import("./ai/ai-memory.js");
    await saveLearningEvent(
      {
        eventType: learningMeta.eventType || "constructive_analysis_feedback",
        entityType: learningMeta.entityType || "constructive_analysis",
        entityId: analysisId,
        orderNumber: learningMeta.orderNumber || "",
        itemName: learningMeta.itemName || "",
        itemType: learningMeta.itemType || "",
        material: learningMeta.material || "",
        source: learningMeta.source || "ai_analysis",
        inputSummary: learningMeta.inputSummary || "",
        aiOutput: learningMeta.aiOutput || {},
        correctedOutput: {
          suggestedTasks: correctedTasks,
          materials: correctedMaterials,
          warnings: correctedWarnings
        },
        correctionText,
        rating,
        confidenceBefore: learningMeta.confidenceBefore,
        tags: learningMeta.tags
      },
      userId
    ).catch((err) => console.error("[ai feedback learning]", err.message));
  }
}
