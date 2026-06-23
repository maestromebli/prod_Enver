import { all, one, run } from "./db.js";
import { getAiSettings } from "./app-settings.js";
import { readStoredFile } from "./file-storage.js";
import { parseJsonObject } from "./json-utils.js";

const MAX_TEXT_CHARS = 120_000;

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

export async function extractTextFromBuffer(buffer, mime, originalName) {
  const name = String(originalName || "").toLowerCase();
  const type = String(mime || "").toLowerCase();

  if (
    type.includes("text") ||
    name.endsWith(".txt") ||
    name.endsWith(".xml") ||
    name.endsWith(".csv")
  ) {
    return buffer.toString("utf8").slice(0, MAX_TEXT_CHARS);
  }

  if (name.endsWith(".zip")) {
    return `[ZIP архів: ${originalName}, ${buffer.length} байт — для детального розбору завантажте розпакований XML/TXT]`;
  }

  if (type.includes("pdf") || name.endsWith(".pdf")) {
    const raw = buffer.toString("latin1");
    const chunks = raw.match(/\(([^)]{4,200})\)/g) || [];
    const text = chunks
      .map((c) => c.slice(1, -1))
      .join(" ")
      .replace(/\\n/g, " ")
      .slice(0, MAX_TEXT_CHARS);
    return text || `[PDF: ${originalName}, ${buffer.length} байт]`;
  }

  return `[Файл: ${originalName}, тип ${mime || "unknown"}, ${buffer.length} байт]`;
}

function buildPrompt({ orderNumber, item, text, feedback }) {
  const examples =
    feedback.length > 0
      ? `\n\nПриклади корекцій від адміністратора (врахуй стиль і термінологію):\n${feedback
          .map((f, i) => `${i + 1}. [${f.rating}] ${f.correction_text}`)
          .join("\n")}`
      : "";

  return `Ти аналізуєш конструкторський файл меблевого виробництва для системи ENVER.
Замовлення: ${orderNumber || "—"}, позиція: ${item || "—"}.

Поверни ТІЛЬКИ валідний JSON без markdown:
{
  "summary": "короткий опис замовлення/виробу",
  "materials": ["матеріал1", "..."],
  "panels": [{"name":"...", "qty":0, "size":"..."}],
  "warnings": ["попередження"],
  "suggestedTasks": ["порізка", "кромкування", "присадка", "збірка", "пакування"]
}

Текст/вміст файлу:
${text.slice(0, MAX_TEXT_CHARS)}${examples}`;
}

export async function analyzeConstructiveFile({
  positionFileId,
  orderNumber,
  item,
  storagePath,
  mime,
  originalName
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
  const text = await extractTextFromBuffer(buffer, mime, originalName);
  const feedback = await getRecentAiFeedback(5);
  const prompt = buildPrompt({ orderNumber, item, text, feedback });

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${ai.openaiApiKey.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: ai.openaiModel,
      temperature: 0.2,
      messages: [
        { role: "system", content: "Ти експерт з меблевого виробництва. Відповідай українською." },
        { role: "user", content: prompt }
      ]
    })
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => "");
    const err = new Error(`OpenAI: ${response.status} ${errBody.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content || "{}";
  let summary;
  try {
    const cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    summary = JSON.parse(cleaned);
  } catch {
    summary = { summary: content, materials: [], panels: [], warnings: [], suggestedTasks: [] };
  }

  const tokens = data.usage?.total_tokens || 0;
  const row = await one(
    `INSERT INTO constructive_analyses (position_file_id, summary_json, model, tokens)
     VALUES ($1, $2, $3, $4)
     RETURNING id, created_at`,
    [positionFileId, JSON.stringify(summary), ai.openaiModel, tokens]
  );

  return { id: row.id, createdAt: row.created_at, ...summary, model: ai.openaiModel, tokens };
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
  return rows.map((r) => ({
    id: r.id,
    fileId: r.file_id,
    fileName: r.original_name,
    model: r.model,
    tokens: r.tokens,
    createdAt: r.created_at,
    ...parseJsonObject(r.summary_json)
  }));
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

export async function saveAiFeedback({ analysisId, rating, correctionText, userId }) {
  await run(
    `INSERT INTO ai_feedback (constructive_analysis_id, rating, correction_text, user_id)
     VALUES ($1, $2, $3, $4)`,
    [analysisId, rating || "", correctionText || "", userId || null]
  );
}
