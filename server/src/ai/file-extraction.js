import { inflateRawSync } from "node:zlib";
import { decodeProjectText } from "../constructive/parsers/project-text.js";
import { extractEnverAssemblyFromB3d } from "../constructive/parsers/assembly-export.js";

const MAX_TEXT_CHARS = 120_000;

const TEXT_EXTENSIONS = new Set([".txt", ".xml", ".csv", ".json", ".dxf", ".project"]);

function detectSourceType(name, mime) {
  const n = String(name || "").toLowerCase();
  const t = String(mime || "").toLowerCase();

  if (n.endsWith(".pdf") || t.includes("pdf")) return "pdf";
  if (n.endsWith(".zip") || t.includes("zip")) return "zip";
  if (n.endsWith(".dxf")) return "dxf";
  if (n.endsWith(".b3d")) return "b3d";
  if (n.endsWith(".project")) return "project";
  if (n.endsWith(".dwg") || t.includes("dwg")) return "dwg";
  if (
    t.includes("text") ||
    n.endsWith(".txt") ||
    n.endsWith(".xml") ||
    n.endsWith(".csv") ||
    n.endsWith(".json")
  ) {
    return "text";
  }
  return "unknown";
}

function truncateText(text, max = MAX_TEXT_CHARS) {
  return String(text || "").slice(0, max);
}

function isMostlyReadable(text) {
  if (!text || text.length < 20) return false;
  const sample = text.slice(0, 500);
  const readable = (sample.match(/[\p{L}\p{N}\s.,;:\-+/=]/gu) || []).length;
  return readable / sample.length > 0.5;
}

function extractPdfTextLegacy(buffer) {
  const raw = buffer.toString("latin1");
  const chunks = raw.match(/\(([^)]{4,200})\)/g) || [];
  const text = chunks
    .map((c) => c.slice(1, -1).replace(/\\n/g, " ").replace(/\\r/g, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  if (text.length > 80 && isMostlyReadable(text)) {
    return { text, quality: "partial", warnings: [] };
  }

  return {
    text: text || "",
    quality: "poor",
    warnings: ["PDF розпізнано частково — для точного аналізу експортуйте специфікацію в XML/TXT"]
  };
}

async function extractPdfText(buffer) {
  try {
    const mod = await import("pdf-parse");
    const pdfParse = mod.default || mod;
    const data = await pdfParse(buffer);
    const text = truncateText(
      String(data.text || "")
        .replace(/\s+/g, " ")
        .trim()
    );
    if (text.length > 120 && isMostlyReadable(text)) {
      return { text, quality: "good", warnings: [] };
    }
    if (text.length > 40) {
      return {
        text,
        quality: "partial",
        warnings: ["PDF розпізнано частково — перевірте специфікацію"]
      };
    }
  } catch {
    /* fallback */
  }
  return extractPdfTextLegacy(buffer);
}

function readZipEntryBody(buffer, offset, compression, compressedSize) {
  const data = buffer.subarray(offset, offset + compressedSize);
  if (compression === 0) {
    return data;
  }
  if (compression === 8) {
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_TEXT_CHARS * 2 });
    } catch {
      return null;
    }
  }
  return null;
}

function extractZipText(buffer, originalName) {
  const extractedFiles = [];
  const warnings = [];
  const parts = [];
  let offset = 0;
  const maxFiles = 12;

  while (offset < buffer.length - 30 && extractedFiles.length < maxFiles) {
    if (
      buffer[offset] !== 0x50 ||
      buffer[offset + 1] !== 0x4b ||
      buffer[offset + 2] !== 0x03 ||
      buffer[offset + 3] !== 0x04
    ) {
      offset += 1;
      continue;
    }

    const compression = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLen = buffer.readUInt16LE(offset + 26);
    const extraLen = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const name = buffer.toString("utf8", nameStart, nameStart + nameLen);
    const dataStart = nameStart + nameLen + extraLen;

    const lower = name.toLowerCase();
    const isTextLike = [...TEXT_EXTENSIONS].some((ext) => lower.endsWith(ext));

    if (isTextLike && compressedSize > 0 && compressedSize < MAX_TEXT_CHARS) {
      const body = readZipEntryBody(buffer, dataStart, compression, compressedSize);
      if (body) {
        const text = body.toString("utf8");
        if (text.trim()) {
          parts.push(`--- ${name} ---\n${text}`);
          extractedFiles.push(name);
        }
      }
    }

    offset = dataStart + compressedSize;
  }

  if (parts.length === 0) {
    return {
      text: `[ZIP архів: ${originalName}, ${buffer.length} байт — не знайдено XML/TXT/CSV/JSON для аналізу]`,
      quality: "poor",
      warnings: ["ZIP не містить читабельних файлів — розпакуйте XML/TXT/CSV і завантажте окремо"],
      extractedFiles: []
    };
  }

  const combined = truncateText(parts.join("\n\n"));
  const quality =
    extractedFiles.length >= 2 && combined.length > 500
      ? "good"
      : combined.length > 200
        ? "partial"
        : "poor";

  if (quality !== "good") {
    warnings.push("ZIP розпізнано частково — перевірте вміст архіву");
  }

  return { text: combined, quality, warnings, extractedFiles };
}

function extractDxfText(buffer) {
  const raw = buffer.toString("utf8");
  const lines = raw.split(/\r?\n/);
  const collected = [];
  const layers = new Set();

  for (let i = 0; i < lines.length - 1; i++) {
    const code = lines[i].trim();
    const value = lines[i + 1]?.trim() || "";

    if (code === "8" && value) layers.add(value);
    if (code === "1" && value.length > 1) collected.push(value);
    if (code === "2" && value.length > 1) collected.push(value);
    if (code === "10" || code === "20" || code === "30") {
      if (value && !Number.isNaN(Number(value))) {
        collected.push(value);
      }
    }
  }

  const layerPart = layers.size ? `Шари: ${[...layers].slice(0, 20).join(", ")}` : "";
  const text = truncateText([layerPart, ...collected.slice(0, 400)].filter(Boolean).join("\n"));

  if (text.length < 40) {
    return {
      text: text || `[DXF: мало текстових даних]`,
      quality: "poor",
      warnings: ["DXF розпізнано частково — перевірте експорт з CAD"]
    };
  }

  return {
    text,
    quality: text.length > 300 ? "partial" : "poor",
    warnings: text.length < 300 ? ["DXF розпізнано частково"] : []
  };
}

function extractProjectText(buffer, originalName) {
  const text = truncateText(decodeProjectText(buffer));
  if (text.length > 200 && (text.includes("<") || text.includes("part"))) {
    return { text, quality: text.length > 800 ? "good" : "partial", warnings: [] };
  }
  return {
    text: text || `[.project: ${originalName}]`,
    quality: "partial",
    warnings: [".project розпізнано частково — перевірте XML"]
  };
}

function extractB3dText(buffer, originalName) {
  const assembly = extractEnverAssemblyFromB3d(buffer);
  if (assembly?.panels?.length) {
    const lines = assembly.panels.slice(0, 80).map((p) => {
      const size = Array.isArray(p.sizeMm) ? p.sizeMm.join("x") : "";
      return `${p.code} ${p.name || ""} ${size}`.trim();
    });
    const text = truncateText(
      `ENVER3 збірка (${assembly.panels.length} панелей)\n${lines.join("\n")}`
    );
    return { text, quality: "good", warnings: [] };
  }

  const raw = buffer.toString("latin1");
  const strings = (raw.match(/[\x20-\x7E\u0400-\u04FF]{4,}/g) || [])
    .filter((s) => /[a-zA-Zа-яА-ЯіїєґІЇЄҐ0-9]/.test(s))
    .slice(0, 400)
    .join(" ");
  if (strings.length > 80) {
    return {
      text: truncateText(strings),
      quality: "partial",
      warnings: [
        ".b3d без ENVER3 — для точного аналізу запустіть enver-b3d-assembly-export.js у Базіс"
      ]
    };
  }

  return {
    text: `[.b3d: ${originalName}, ${buffer.length} байт]`,
    quality: "poor",
    warnings: [
      ".b3d без читабельних даних — додайте .project або ENVER3 (скрипт enver-b3d-assembly-export.js)"
    ]
  };
}

function extractPlainText(buffer, name) {
  const text = truncateText(buffer.toString("utf8"));
  if (name.toLowerCase().endsWith(".json")) {
    try {
      const obj = JSON.parse(text);
      const pretty = JSON.stringify(obj, null, 0).slice(0, MAX_TEXT_CHARS);
      return { text: pretty, quality: "good", warnings: [] };
    } catch {
      return { text, quality: "partial", warnings: ["JSON пошкоджено — читаємо як текст"] };
    }
  }
  return {
    text,
    quality: isMostlyReadable(text) ? "good" : "partial",
    warnings: isMostlyReadable(text) ? [] : ["Текст файлу розпізнано частково"]
  };
}

/**
 * Витягує текст з буфера конструктива з метаданими якості.
 * @returns {{ text: string, sourceType: string, extractionQuality: string, warnings: string[], extractedFiles: string[] }}
 */
export async function extractTextFromBuffer(buffer, mime, originalName) {
  const sourceType = detectSourceType(originalName, mime);
  const base = {
    sourceType,
    extractedFiles: [],
    warnings: []
  };

  if (sourceType === "text") {
    const { text, quality, warnings } = extractPlainText(buffer, originalName);
    return { ...base, text, extractionQuality: quality, warnings };
  }

  if (sourceType === "pdf") {
    const { text, quality, warnings } = await extractPdfText(buffer);
    return {
      ...base,
      text: truncateText(text) || `[PDF: ${originalName}, ${buffer.length} байт]`,
      extractionQuality: quality,
      warnings
    };
  }

  if (sourceType === "zip") {
    try {
      const result = extractZipText(buffer, originalName);
      return { ...base, ...result, extractionQuality: result.quality };
    } catch {
      return {
        ...base,
        text: `[ZIP: ${originalName} — не вдалося розпакувати]`,
        extractionQuality: "poor",
        warnings: ["Не вдалося прочитати ZIP — завантажте розпакований файл"]
      };
    }
  }

  if (sourceType === "dxf") {
    const { text, quality, warnings } = extractDxfText(buffer);
    return { ...base, text, extractionQuality: quality, warnings };
  }

  if (sourceType === "dwg") {
    return {
      ...base,
      text: `[DWG: ${originalName}, ${buffer.length} байт]`,
      extractionQuality: "poor",
      warnings: ["Для точного AI-аналізу DWG краще експортувати в DXF/PDF/XML"]
    };
  }

  if (sourceType === "project") {
    const { text, quality, warnings } = extractProjectText(buffer, originalName);
    return { ...base, text, extractionQuality: quality, warnings };
  }

  if (sourceType === "b3d") {
    const { text, quality, warnings } = extractB3dText(buffer, originalName);
    return { ...base, text, extractionQuality: quality, warnings };
  }

  return {
    ...base,
    text: `[Файл: ${originalName}, тип ${mime || "unknown"}, ${buffer.length} байт]`,
    extractionQuality: "poor",
    warnings: ["Невідомий формат файлу — AI може дати неточний аналіз"]
  };
}

export { MAX_TEXT_CHARS };
