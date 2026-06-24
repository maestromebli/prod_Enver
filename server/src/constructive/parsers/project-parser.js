import { computeChecksum } from "../part-code.js";

/** Безпечний fallback для .project — без fake parsing. */
export function parseProjectBuffer(buffer, originalName = "") {
  const checksum = computeChecksum(buffer);
  const textSample = buffer
    .toString("utf8", 0, Math.min(buffer.length, 8000))
    .replace(/[^\x20-\x7E\u0400-\u04FF\n\r\t]/g, " ")
    .slice(0, 4000);

  const hasXml = textSample.includes("<?xml") || textSample.includes("<Project");
  const hasJson = textSample.trim().startsWith("{");

  return {
    sourceMeta: {
      originalName,
      sizeBytes: buffer.length,
      checksum,
      detectedFormat: hasXml ? "xml-like" : hasJson ? "json-like" : "binary",
      preview: textSample.slice(0, 500)
    },
    warnings: [
      "Файл .project збережено як джерело. Автоматичний розбір недоступний — використовуйте XLS/PDF для деталей."
    ],
    extractionQuality: "poor",
    parts: [],
    materials: [],
    hardware: []
  };
}
