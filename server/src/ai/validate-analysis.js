import { createEmptyAnalysis } from "./constructive-schema.js";

/** Витягує JSON з відповіді OpenAI (markdown, обгортки). */
export function parseAiJsonContent(content) {
  if (!content || typeof content !== "string") {
    return { ok: false, data: null, error: "empty" };
  }

  let cleaned = content.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else {
    cleaned = cleaned
      .replace(/^```json\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
  }

  const jsonStart = cleaned.indexOf("{");
  const jsonEnd = cleaned.lastIndexOf("}");
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    cleaned = cleaned.slice(jsonStart, jsonEnd + 1);
  }

  try {
    const data = JSON.parse(cleaned);
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { ok: false, data: null, error: "not_object" };
    }
    return { ok: true, data, error: null };
  } catch {
    return { ok: false, data: null, error: "parse_error" };
  }
}

/** Перетворює сирий AI-відповідь у об'єкт або безпечний fallback. */
export function parseRawAnalysisContent(content) {
  const parsed = parseAiJsonContent(content);
  if (parsed.ok) {
    return { raw: parsed.data, parseFailed: false };
  }

  const text = String(content || "").trim();
  if (!text) {
    return {
      raw: createEmptyAnalysis({
        warnings: ["AI не повернув структурований результат"],
        missingInfo: ["Не вдалося розпарсити відповідь AI"]
      }),
      parseFailed: true
    };
  }

  return {
    raw: createEmptyAnalysis({
      summary: text.slice(0, 500),
      warnings: ["AI повернув текст замість JSON — потрібна ручна перевірка"],
      missingInfo: ["Структуровані дані відсутні"]
    }),
    parseFailed: true
  };
}
