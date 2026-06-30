import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_MAX_PAGES = 4;
const DEFAULT_DPI = 144;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

let pdftoppmAvailable = null;

async function isPdftoppmAvailable() {
  if (pdftoppmAvailable !== null) return pdftoppmAvailable;
  try {
    await execFileAsync("pdftoppm", ["-v"]);
    pdftoppmAvailable = true;
  } catch {
    pdftoppmAvailable = false;
  }
  return pdftoppmAvailable;
}

export function shouldUsePdfVision(extractionMeta, settings = {}) {
  if (settings.usePdfVision === false) return false;
  if (extractionMeta?.sourceType !== "pdf") return false;
  return extractionMeta.extractionQuality !== "good";
}

/**
 * Рендерить сторінки PDF у JPEG для Vision API.
 * @returns {Promise<{ images: Array<{ mime: string, base64: string, page: number }>, warnings: string[] }>}
 */
export async function renderPdfPagesForVision(
  buffer,
  { maxPages = DEFAULT_MAX_PAGES, dpi = DEFAULT_DPI } = {}
) {
  const warnings = [];
  if (!buffer?.length) {
    return { images: [], warnings: ["PDF порожній"] };
  }

  if (!(await isPdftoppmAvailable())) {
    return {
      images: [],
      warnings: [
        "Vision OCR недоступний (немає pdftoppm). У Docker встановіть poppler-utils або експортуйте PDF у XML/TXT."
      ]
    };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "enver-pdf-"));
  const inputPath = path.join(dir, "input.pdf");
  const outPrefix = path.join(dir, "page");

  try {
    await fs.writeFile(inputPath, buffer);
    await execFileAsync("pdftoppm", [
      "-jpeg",
      "-r",
      String(dpi),
      "-f",
      "1",
      "-l",
      String(Math.max(1, maxPages)),
      inputPath,
      outPrefix
    ]);

    const files = (await fs.readdir(dir))
      .filter((f) => /^page-\d+\.jpg$/i.test(f))
      .sort((a, b) => {
        const na = Number(a.match(/(\d+)/)?.[1] || 0);
        const nb = Number(b.match(/(\d+)/)?.[1] || 0);
        return na - nb;
      })
      .slice(0, maxPages);

    const images = [];
    for (const file of files) {
      const raw = await fs.readFile(path.join(dir, file));
      if (raw.length > MAX_IMAGE_BYTES) {
        warnings.push(`Сторінка ${file} занадто велика — пропущено`);
        continue;
      }
      const page = Number(file.match(/(\d+)/)?.[1] || images.length + 1);
      images.push({
        page,
        mime: "image/jpeg",
        base64: raw.toString("base64")
      });
    }

    if (!images.length) {
      warnings.push("Не вдалося згенерувати зображення сторінок PDF");
    }

    return { images, warnings };
  } catch (err) {
    return {
      images: [],
      warnings: [`Vision OCR: ${err?.message || "помилка рендеру PDF"}`]
    };
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Доповнює метадані витягування після успішного Vision. */
export function applyVisionToExtractionMeta(meta, { images = [], warnings = [] } = {}) {
  if (!images.length) {
    return { ...meta, visionWarnings: warnings };
  }
  const nextWarnings = [...(meta.warnings || [])];
  for (const w of warnings) {
    if (!nextWarnings.includes(w)) nextWarnings.push(w);
  }
  const filtered = nextWarnings.filter(
    (w) =>
      !/експортуйте специфікацію в XML/i.test(w) && !/розпізнано частково — для точного/i.test(w)
  );
  if (!filtered.some((w) => /vision/i.test(w))) {
    filtered.push(`PDF прочитано через Vision OCR (${images.length} стор.)`);
  }
  return {
    ...meta,
    extractionQuality: meta.extractionQuality === "poor" ? "partial" : meta.extractionQuality,
    visionUsed: true,
    visionPageCount: images.length,
    warnings: filtered,
    visionWarnings: warnings
  };
}
