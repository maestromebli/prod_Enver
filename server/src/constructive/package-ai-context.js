import { readStoredFile } from "../file-storage.js";
import { decodeProjectText } from "./parsers/project-text.js";
import { extractEnverAssemblyFromB3d } from "./parsers/assembly-export.js";
import { formatPackageMetricsForPrompt } from "../../../shared/production/infer-package-tasks.js";
import { extractTextFromBuffer } from "../ai/file-extraction.js";
import {
  applyVisionToExtractionMeta,
  renderPdfPagesForVision,
  shouldUsePdfVision
} from "../ai/pdf-vision.js";

const MAX_PROJECT_CHARS = 28_000;
const MAX_ENVER3_PANELS = 80;
const MAX_B3D_STRING_CHARS = 8_000;

function extractPrintableStrings(buffer) {
  const raw = buffer.toString("latin1");
  const matches = raw.match(/[\x20-\x7E\u0400-\u04FF]{4,}/g) || [];
  return [...new Set(matches)]
    .filter((s) => /[a-zA-Zа-яА-ЯіїєґІЇЄҐ0-9]/.test(s))
    .join(" ")
    .slice(0, MAX_B3D_STRING_CHARS);
}

function summarizeParts(parts = []) {
  const blocks = new Map();
  for (const p of parts) {
    const key = p.blockCode || "—";
    blocks.set(key, (blocks.get(key) || 0) + 1);
  }
  const blockLine = [...blocks.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([code, count]) => `${code}(${count})`)
    .join(", ");
  const sample = parts.slice(0, 25).map((p) => {
    const size =
      p.length && p.width
        ? `${p.length}x${p.width}`
        : p.length || p.width
          ? `${p.length || p.width}`
          : "";
    return `${p.partNo || p.partCode || "?"} ${p.partName || ""} ${p.material || ""} ${size}`.trim();
  });
  return { blockLine, sample };
}

function buildExtractionQuality({ partsCount, materialsCount, hardwareCount, sourceTypes }) {
  if (partsCount > 0 && (materialsCount > 0 || hardwareCount > 0) && sourceTypes.size > 0) {
    return "good";
  }
  if (partsCount > 0) return "partial";
  return "poor";
}

/**
 * Збирає структурований контекст пакета для prompt ШІ і метадані якості.
 */
export async function buildPackageAiSourceContext(packageDetail, aiSettings = {}) {
  const parts = packageDetail.parts || [];
  const materials = packageDetail.materials || [];
  const hardware = packageDetail.hardware || [];
  const files = packageDetail.files || [];
  const blocks = [];
  const warnings = [];
  const sourceTypes = new Set(["package_db"]);

  const { blockLine, sample } = summarizeParts(parts);
  blocks.push(
    `Агрегати: ${parts.length} деталей, ${materials.length} матеріалів, ${hardware.length} фурнітури`
  );
  if (blockLine) blocks.push(`Блоки: ${blockLine}`);
  if (sample.length) {
    blocks.push(`Приклади деталей:\n${sample.join("\n")}`);
  }

  if (materials.length) {
    blocks.push(
      `Матеріали з розбору: ${materials
        .slice(0, 20)
        .map((m) => {
          const name = m.materialName || m.name || "—";
          const thick = m.thickness ? ` ${m.thickness}мм` : "";
          const qty = m.qtyEstimated ? ` ×${m.qtyEstimated}` : "";
          return `${name}${thick}${qty}`;
        })
        .join("; ")}`
    );
  }

  const metricsBlock = formatPackageMetricsForPrompt(parts, hardware);
  if (metricsBlock) blocks.push(metricsBlock);

  let visionImages = [];
  const pdfFile = files.find((f) => f.kind === "assembly_pdf");
  if (pdfFile?.storage_path) {
    try {
      const buf = await readStoredFile(pdfFile.storage_path);
      let pdfMeta = await extractTextFromBuffer(buf, "application/pdf", pdfFile.original_name);
      if (pdfMeta.text?.length > 60) {
        blocks.push(`\n--- PDF (${pdfFile.original_name}) ---\n${pdfMeta.text.slice(0, 12_000)}`);
        sourceTypes.add("pdf");
      }
      if (shouldUsePdfVision(pdfMeta, aiSettings)) {
        const rendered = await renderPdfPagesForVision(buf, { maxPages: 3 });
        visionImages = rendered.images;
        pdfMeta = applyVisionToExtractionMeta(pdfMeta, rendered);
        if (visionImages.length) {
          sourceTypes.add("pdf_vision");
          blocks.push(`PDF Vision OCR: ${visionImages.length} сторінок додано до запиту ШІ`);
        }
        warnings.push(...(pdfMeta.visionWarnings || []));
      } else if (pdfMeta.extractionQuality === "poor") {
        warnings.push("PDF складання без тексту — для Vision увімкніть OCR у налаштуваннях ШІ");
      }
    } catch {
      warnings.push("Не вдалося прочитати PDF складання для ШІ");
    }
  }

  const projectFile = files.find((f) => f.kind === "project");
  if (projectFile?.storage_path) {
    try {
      const buf = await readStoredFile(projectFile.storage_path);
      const text = decodeProjectText(buf);
      blocks.push(
        `\n--- .project (${projectFile.original_name}) ---\n${text.slice(0, MAX_PROJECT_CHARS)}`
      );
      sourceTypes.add("project");
    } catch {
      warnings.push("Не вдалося прочитати .project для ШІ");
    }
  }

  const b3dFile = files.find((f) => f.kind === "b3d");
  if (b3dFile?.storage_path) {
    try {
      const buf = await readStoredFile(b3dFile.storage_path);
      const assembly = extractEnverAssemblyFromB3d(buf);
      if (assembly?.panels?.length) {
        const lines = assembly.panels.slice(0, MAX_ENVER3_PANELS).map((p) => {
          const size = Array.isArray(p.sizeMm) ? p.sizeMm.join("x") : "";
          const thick = p.thicknessMm ? `${p.thicknessMm}мм` : "";
          return `${p.code} ${p.name || ""} ${size} ${thick}`.trim();
        });
        blocks.push(
          `\n--- ENVER3 збірка (${assembly.panels.length} панелей) ---\n${lines.join("\n")}`
        );
        sourceTypes.add("enver3");
      } else {
        const strings = extractPrintableStrings(buf);
        if (strings.length > 40) {
          blocks.push(`\n--- .b3d рядки ---\n${strings}`);
          sourceTypes.add("b3d");
        }
      }
    } catch {
      warnings.push("Не вдалося прочитати .b3d для ШІ");
    }
  }

  const unmapped = packageDetail.unmappedParts?.length || 0;
  if (unmapped > 0) {
    warnings.push(`${unmapped} деталей без 3D-звʼязку`);
  }

  const partsCount = parts.length;
  const materialsCount = materials.length;
  const hardwareCount = hardware.length;
  const extractionQuality = buildExtractionQuality({
    partsCount,
    materialsCount,
    hardwareCount,
    sourceTypes
  });

  return {
    promptExtra: blocks.join("\n"),
    visionImages,
    sourceMeta: {
      parsedPackage: true,
      extractionQuality,
      sourceType: [...sourceTypes].join("+"),
      partsCount,
      materialsCount,
      hardwareCount,
      visionPageCount: visionImages.length,
      visionUsed: visionImages.length > 0,
      warnings
    },
    inputSummary: `package:${partsCount}parts;${materialsCount}mat;${[...sourceTypes].join("+")}`,
    materialNames: materials.map((m) => m.materialName || m.name || "").filter(Boolean),
    partsForQuality: parts.map((p) => ({
      name: p.partName || p.partCode || "",
      qty: p.qty,
      size: p.length && p.width ? `${p.length}x${p.width}` : "",
      material: p.material || ""
    }))
  };
}
