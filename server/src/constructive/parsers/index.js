import { parseXlsBuffer } from "./xls-parser.js";
import { parsePdfBuffer } from "./pdf-parser.js";
import { parseProjectBuffer } from "./project-parser.js";
import { parseB3dBuffer } from "./b3d-parser.js";
import { parseCncBuffer } from "./cnc-parser.js";
import { parseWrlBuffer } from "./wrl-parser.js";
import { detectPackageFileKind } from "../../../../shared/production/constructive-package.js";

function mergeWarnings(...lists) {
  return [...new Set(lists.flat().filter(Boolean))];
}

function worstQuality(...qualities) {
  const rank = { good: 0, partial: 1, poor: 2 };
  return qualities.reduce((w, q) => (rank[q] > rank[w] ? q : w), "good");
}

/** Парсинг одного файлу пакета. */
export async function parsePackageFile({ buffer, mime, originalName, kind }) {
  const fileKind = kind || detectPackageFileKind(originalName);

  if (fileKind === "spec_xls") {
    return { fileKind, ...(await parseXlsBuffer(buffer, originalName)) };
  }
  if (fileKind === "assembly_pdf") {
    return { fileKind, ...(await parsePdfBuffer(buffer, mime, originalName)) };
  }
  if (fileKind === "project") {
    return { fileKind, ...parseProjectBuffer(buffer, originalName) };
  }
  if (fileKind === "b3d") {
    return { fileKind, ...parseB3dBuffer(buffer, originalName) };
  }
  if (fileKind === "cnc_file") {
    return { fileKind, ...parseCncBuffer(buffer, originalName) };
  }
  if (fileKind === "wrl_model") {
    return { fileKind, ...parseWrlBuffer(buffer, originalName) };
  }

  return {
    fileKind,
    materials: [],
    hardware: [],
    parts: [],
    blocks: [],
    warnings: [`Файл ${originalName}: автоматичний розбір не підтримується для kind=${fileKind}`],
    extractionQuality: "poor"
  };
}

/** Парсинг усіх файлів пакета паралельно (кожен файл не чекає інші). */
export async function parsePackageFiles(fileRows, readFile) {
  if (!fileRows.length) return [];
  return Promise.all(
    fileRows.map(async (f) => {
      const buffer = await readFile(f.storage_path);
      return parsePackageFile({
        buffer,
        mime: f.mime,
        originalName: f.original_name,
        kind: f.kind
      });
    })
  );
}

/** Об'єднання результатів кількох файлів пакета. */
export function mergeParseResults(results) {
  const materials = [];
  const hardware = [];
  const parts = [];
  const blocks = [];
  const warnings = [];
  let orderNumber = "";
  let modelReadiness = { has3dSource: false, needsGlbExport: false };

  for (const r of results) {
    materials.push(...(r.materials || []));
    hardware.push(...(r.hardware || []));
    parts.push(...(r.parts || []));
    blocks.push(...(r.blocks || []));
    warnings.push(...(r.warnings || []));
    if (r.orderNumber) orderNumber = r.orderNumber;
    if (r.modelReadiness?.has3dSource) {
      modelReadiness = { ...modelReadiness, ...r.modelReadiness };
    }
    if (r.fileKind === "glb_model" || r.fileKind === "gltf_model" || r.fileKind === "wrl_model") {
      modelReadiness.has3dSource = true;
      modelReadiness.needsGlbExport = false;
    }
  }

  const manifestNodes = [];
  for (const r of results) {
    for (const n of r.manifestNodes || []) manifestNodes.push(n);
  }
  for (const b of blocks) {
    const code = b.code || b.blockCode || "";
    if (code) {
      manifestNodes.push({ meshName: code, nodeId: code, partNo: b.partNo || "" });
    }
  }
  for (const p of parts) {
    if (p.partNo) {
      manifestNodes.push({ meshName: String(p.partNo), partNo: String(p.partNo) });
      if (p.blockCode) {
        manifestNodes.push({
          meshName: `${p.blockCode}-${p.partNo}`,
          nodeId: `${p.blockCode}-${p.partNo}`,
          partNo: String(p.partNo)
        });
      }
    }
  }

  return {
    orderNumber,
    materials,
    hardware,
    parts,
    blocks,
    manifestNodes,
    warnings: mergeWarnings(warnings),
    extractionQuality: worstQuality(...results.map((r) => r.extractionQuality || "poor")),
    modelReadiness
  };
}
