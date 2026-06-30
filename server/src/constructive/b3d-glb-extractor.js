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
  productName = ""
} = {}) {
  const projectPanels = projectBuffer?.length ? extractProjectPanels(projectBuffer) : [];

  let assemblyExport = null;
  if (assemblyJsonBuffer?.length) {
    try {
      assemblyExport = parseAssemblyExportJson(assemblyJsonBuffer.toString("utf8"));
    } catch {
      /* ignore */
    }
  }
  if (!assemblyExport && b3dBuffer?.length) {
    assemblyExport = extractEnverAssemblyFromB3d(b3dBuffer);
  }

  if (assemblyExport && projectPanels.length) {
    const { missing } = layoutAssemblyPanels(projectPanels, assemblyExport);
    const useMixed = missing.length > 0;
    try {
      const built = useMixed
        ? buildMixedPreviewGlb(projectPanels, assemblyExport, { productName })
        : buildAssemblyGlbFromProject(projectPanels, assemblyExport, { productName });
      const missingCodes = built.missingCodes || missing;
      const assembledCount = projectPanels.length - missingCodes.length;
      return {
        buffer: built.buffer,
        source: assemblyJsonBuffer?.length ? "assembly_json" : "b3d_enver3_assembly",
        panelCount: built.panelCount,
        assembledCount,
        layout: assembledCount > 0 ? "assembly" : "flat",
        missingCodes,
        isPartialAssembly: missingCodes.length > 0,
        exportedAt: assemblyExport.exportedAt || null,
        productName: assemblyExport.productName || productName || null
      };
    } catch {
      /* fallback нижче */
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

  if (projectPanels.length) {
    const fromProject = buildPreviewGlbFromPanels(layoutPreviewPanels(projectPanels), {
      productName,
      previewLayout: "flat"
    });
    return {
      buffer: fromProject.buffer,
      source: "project_panels",
      panelCount: fromProject.panelCount,
      layout: "flat"
    };
  }

  const err = new Error(
    "Не вдалося зібрати 3D-превʼю — додайте .project (Базіс) і .b3d з ENVER3 (скрипт enver-b3d-assembly-export.js)"
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
