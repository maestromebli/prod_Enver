import zlib from "zlib";
import {
  buildPreviewGlbFromPanels,
  extractProjectPanels,
  layoutPreviewPanels
} from "./project-glb-builder.js";
import {
  buildAssemblyGlbFromProject,
  buildMixedPreviewGlb,
  layoutAssemblyPanels
} from "./assembly-glb-builder.js";
import { extractEnverAssemblyFromB3d, parseAssemblyExportJson } from "./parsers/assembly-export.js";
import { fuseBazisPackage } from "./enver-3dscan-fusion.js";
import { normalizePartCode } from "../../../shared/production/enver-3dscan.js";
import { resolveScanPanelDimensions } from "../../../shared/production/enver-3dscan-part-layout.js";

const GLB_MAGIC = 0x46546c67;
const ZLIB_SIGNATURES = [
  Buffer.from([0x78, 0x9c]),
  Buffer.from([0x78, 0xda]),
  Buffer.from([0x78, 0x01])
];

function isGlbBuffer(buf) {
  return buf && buf.length >= 12 && buf.readUInt32LE(0) === GLB_MAGIC;
}

function tryExtractGlbAt(buf, offset) {
  if (offset < 0 || buf.length < offset + 12) return null;
  if (buf.readUInt32LE(offset) !== GLB_MAGIC) return null;

  const declared = buf.readUInt32LE(offset + 8);
  if (declared >= 12 && offset + declared <= buf.length) {
    return buf.subarray(offset, offset + declared);
  }

  if (buf.length >= offset + 20) {
    const jsonLen = buf.readUInt32LE(offset + 12);
    if (jsonLen > 0 && jsonLen < buf.length) {
      const jsonPad = (jsonLen + 3) & ~3;
      const binHeader = offset + 12 + 8 + jsonPad;
      if (binHeader + 8 <= buf.length) {
        const binLen = buf.readUInt32LE(binHeader);
        const binPad = (binLen + 3) & ~3;
        const total = binHeader + 8 + binPad - offset;
        if (total > 12 && offset + total <= buf.length) {
          return buf.subarray(offset, offset + total);
        }
      }
    }
  }

  return null;
}

/** Шукає вбудований GLB у бінарному .b3d. */
export function findEmbeddedGlb(buf) {
  if (!buf?.length) return null;
  const limit = Math.min(buf.length - 12, 4_000_000);
  for (let i = 0; i <= limit; i += 4) {
    for (let j = 0; j < 4 && i + j <= limit; j += 1) {
      const slice = tryExtractGlbAt(buf, i + j);
      if (slice) return slice;
    }
  }
  return null;
}

function tryGunzip(buf) {
  return zlib.gunzipSync(buf);
}

function tryInflate(buf) {
  return zlib.inflateSync(buf);
}

function tryInflateRaw(buf) {
  return zlib.inflateRawSync(buf);
}

/** Сканує zlib-блоки (78 9c / 78 da) у довільних зміщеннях GibLab .b3d. */
export function scanZlibBlocks(buf, { maxBlocks = 32 } = {}) {
  if (!buf?.length) return [];
  const seen = new Set();
  const out = [];

  for (const sig of ZLIB_SIGNATURES) {
    let start = 0;
    while (start < buf.length) {
      const offset = buf.indexOf(sig, start);
      if (offset < 0) break;
      start = offset + 1;
      if (seen.has(offset)) continue;
      seen.add(offset);
      try {
        const data = zlib.inflateSync(buf.subarray(offset));
        out.push({ offset, data });
        if (out.length >= maxBlocks) return out.sort((a, b) => b.data.length - a.data.length);
      } catch {
        /* ignore */
      }
    }
  }

  return out.sort((a, b) => b.data.length - a.data.length);
}

/** Спроби розпакувати вміст GibLab .b3d (gzip/deflate, zlib-скан, зміщення заголовка). */
export function decompressB3dCandidates(buf) {
  const seen = new Set();
  const out = [];

  const push = (candidate) => {
    if (!candidate?.length) return;
    const key = `${candidate.length}:${candidate.readUInt32LE(0)}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  push(buf);
  for (const block of scanZlibBlocks(buf)) {
    push(block.data);
  }
  for (const skip of [4, 8, 12, 16, 32, 64]) {
    if (buf.length <= skip) continue;
    const slice = buf.subarray(skip);
    push(slice);
    for (const fn of [tryGunzip, tryInflate, tryInflateRaw]) {
      try {
        push(fn(slice));
      } catch {
        /* ignore */
      }
    }
  }

  return out;
}

function tryPanelsFromBuffer(buf) {
  const panels = layoutPreviewPanels(extractProjectPanels(buf));
  if (!panels.length) return null;
  return buildPreviewGlbFromPanels(panels, { productName: "b3d-preview", previewLayout: "flat" });
}

const ASSEMBLY_GLB_SOURCES = new Set([
  "raw_glb",
  "embedded_glb",
  "decompressed_glb",
  "decompressed_embedded_glb"
]);

const SCAN_ASSEMBLY_SOURCES = new Set(["bazis", "enver_3dscan", "bazis_b3d_decode"]);

function panelsFromScanDocument(scan) {
  return (scan?.panels || []).map((p) => {
    const dims = resolveScanPanelDimensions(p);
    return {
      code: normalizePartCode(p.code || p.partNo) || String(p.partNo || p.code || ""),
      partName: p.name || `Деталь ${p.code || p.partNo || ""}`,
      lengthMm: dims.lengthMm,
      widthMm: dims.widthMm,
      thicknessMm: dims.thicknessMm,
      colorFactor: p.colorFactor ?? null
    };
  });
}

/** Усі панелі для GLB: .project + додаткові з ENVER_3dscan. */
function mergeProjectAndScanPanels(projectPanels, scan) {
  const byCode = new Map();
  for (const p of projectPanels) {
    const code = normalizePartCode(p.code);
    if (code) byCode.set(code, p);
  }
  for (const sp of scan?.panels || []) {
    const code = normalizePartCode(sp.code || sp.partNo);
    if (!code || byCode.has(code)) continue;
    const dims = resolveScanPanelDimensions(sp);
    if (dims.lengthMm > 0 && dims.widthMm > 0) {
      byCode.set(code, {
        code,
        partName: sp.name || `Деталь ${code}`,
        lengthMm: dims.lengthMm,
        widthMm: dims.widthMm,
        thicknessMm: dims.thicknessMm,
        colorFactor: sp.colorFactor ?? null
      });
    }
  }
  return [...byCode.values()];
}

function _tryPanelsFromProjectBuffer(projectBuffer, { productName: _productName = "" } = {}) {
  const panels = layoutPreviewPanels(extractProjectPanels(projectBuffer));
  if (!panels.length) return null;
  return buildPreviewGlbFromPanels(panels, { productName: _productName, previewLayout: "flat" });
}

/**
 * GLB для перегляду з файлів пакета.
 * Повна збірка: GLB у .b3d, хвіст ENVER3 у .b3d (скрипт Базіс), або enver-assembly.json + .project.
 */
export function extractPackagePreviewGlb({
  b3dBuffer = null,
  projectBuffer = null,
  assemblyJsonBuffer = null,
  scanJsonBuffer = null,
  productName = ""
} = {}) {
  const projectPanels = projectBuffer?.length ? extractProjectPanels(projectBuffer) : [];

  const fused = fuseBazisPackage({
    b3dBuffer,
    projectBuffer,
    scanJsonBuffer: scanJsonBuffer?.length
      ? scanJsonBuffer
      : assemblyJsonBuffer?.length
        ? assemblyJsonBuffer
        : null,
    productName
  });

  let assemblyExport = fused.assemblyExport || null;
  if (!assemblyExport && assemblyJsonBuffer?.length) {
    try {
      assemblyExport = parseAssemblyExportJson(assemblyJsonBuffer.toString("utf8"));
    } catch {
      /* ignore */
    }
  }
  if (!assemblyExport && b3dBuffer?.length) {
    assemblyExport = extractEnverAssemblyFromB3d(b3dBuffer);
  }

  if (assemblyExport) {
    const assemblyPanels = projectPanels.length
      ? mergeProjectAndScanPanels(projectPanels, fused.scan)
      : panelsFromScanDocument(fused.scan);
    if (assemblyPanels.length) {
      const { missing } = layoutAssemblyPanels(assemblyPanels, assemblyExport);
      const useMixed = missing.length > 0;
      try {
        const built = useMixed
          ? buildMixedPreviewGlb(assemblyPanels, assemblyExport, { productName })
          : buildAssemblyGlbFromProject(assemblyPanels, assemblyExport, { productName });
        const missingCodes = built.missingCodes || missing;
        const assembledCount = assemblyPanels.length - missingCodes.length;
        const scanSource = fused.scan?.source;
        const glbSource =
          scanSource === "enver3_compat"
            ? "b3d_enver3_assembly"
            : SCAN_ASSEMBLY_SOURCES.has(scanSource)
              ? "b3d_enver_3dscan_assembly"
              : assemblyJsonBuffer?.length
                ? "assembly_json"
                : "b3d_enver3_assembly";
        return {
          buffer: built.buffer,
          source: glbSource,
          panelCount: built.panelCount,
          assembledCount,
          layout: assembledCount > 0 ? "assembly" : "flat",
          missingCodes,
          isPartialAssembly: missingCodes.length > 0,
          exportedAt: assemblyExport.exportedAt || fused.scan?.exportedAt || null,
          productName: assemblyExport.productName || productName || null,
          enver3dscan: fused.stats || null
        };
      } catch {
        /* fallback нижче */
      }
    }
  }

  if (b3dBuffer?.length) {
    try {
      const fromB3d = extractGlbFromB3d(b3dBuffer, { productName });
      return {
        ...fromB3d,
        layout: ASSEMBLY_GLB_SOURCES.has(fromB3d.source) ? "assembly" : "flat"
      };
    } catch {
      /* fallback на .project */
    }
  }

  if (projectPanels.length || fused.parts?.length) {
    const layoutPanels =
      projectPanels.length > 0
        ? projectPanels
        : fused.parts.map((p) => ({
            code: p.partNo,
            partName: p.partName,
            lengthMm: Number(p.length) || 100,
            widthMm: Number(p.width) || 100,
            thicknessMm: Number(p.thickness) || 18
          }));
    const fromProject = buildPreviewGlbFromPanels(layoutPreviewPanels(layoutPanels), {
      productName,
      previewLayout: "flat"
    });
    return {
      buffer: fromProject.buffer,
      source: fused.scan ? "enver_3dscan_flat" : "project_panels",
      panelCount: fromProject.panelCount,
      layout: "flat",
      enver3dscan: fused.stats || null
    };
  }

  const err = new Error(
    "Не вдалося зібрати 3D-превʼю — додайте .project (Базіс) і .b3d, або запустіть scripts/enver-3dscan-export.js"
  );
  err.code = "NO_PREVIEW";
  throw err;
}

/**
 * Витягує GLB для перегляду з файлу GibLab .b3d.
 * Порядок: сирий GLB → вбудований GLB → розпакований GLB → панелі з XML усередині .b3d.
 */
export function extractGlbFromB3d(buffer, { productName: _productName = "" } = {}) {
  if (!buffer?.length) {
    const err = new Error("Порожній файл .b3d");
    err.code = "EMPTY_B3D";
    throw err;
  }

  if (isGlbBuffer(buffer)) {
    return { buffer, source: "raw_glb", panelCount: null };
  }

  const embedded = findEmbeddedGlb(buffer);
  if (embedded) {
    return { buffer: embedded, source: "embedded_glb", panelCount: null };
  }

  for (const candidate of decompressB3dCandidates(buffer)) {
    if (isGlbBuffer(candidate)) {
      return { buffer: candidate, source: "decompressed_glb", panelCount: null };
    }
    const nested = findEmbeddedGlb(candidate);
    if (nested) {
      return { buffer: nested, source: "decompressed_embedded_glb", panelCount: null };
    }
    try {
      const fromPanels = tryPanelsFromBuffer(candidate);
      if (fromPanels) {
        return {
          buffer: fromPanels.buffer,
          source: "b3d_xml_panels",
          panelCount: fromPanels.panelCount
        };
      }
    } catch {
      /* ignore */
    }
  }

  try {
    const fromPanels = tryPanelsFromBuffer(buffer);
    if (fromPanels) {
      return {
        buffer: fromPanels.buffer,
        source: "b3d_xml_panels",
        panelCount: fromPanels.panelCount
      };
    }
  } catch {
    /* ignore */
  }

  const err = new Error(
    "Не вдалося отримати 3D-модель з .b3d — перевірте, що файл експортовано з GibLab"
  );
  err.code = "B3D_NO_MODEL";
  throw err;
}
