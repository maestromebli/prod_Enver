/**
 * ENVER_3dscan — розширений блок у хвості Bazis .b3d або sidecar .enver-3dscan.json.
 * Містить збірку, геометрію панелей, кромку, отвори та коди операцій Bazis.
 */

import { normalizeBazisScanCode, partNoFromBazisOperationCode } from "./bazis-operation-code.js";

/** 6 байт у хвості .b3d (як ENVER3). */
export const ENVER_3DSCAN_MAGIC = "EN3DSC";
export const ENVER_3DSCAN_FORMAT_VERSION = 2;
export const ENVER_3DSCAN_KIND = "ENVER_3dscan";

export function normalizePartCode(code) {
  const s = String(code ?? "").trim();
  if (!s) return "";
  const n = Number(s);
  if (Number.isFinite(n)) return String(n);
  return s.replace(/^0+/, "") || s;
}

function normalizeVec3(v) {
  if (!Array.isArray(v) || v.length < 3) return null;
  const x = Number(v[0]);
  const y = Number(v[1]);
  const z = Number(v[2]);
  if (![x, y, z].every(Number.isFinite)) return null;
  const len = Math.hypot(x, y, z);
  if (len < 1e-9) return null;
  return [x / len, y / len, z / len];
}

function normalizeHole(hole) {
  if (!hole || typeof hole !== "object") return null;
  const diameterMm = hole.diameterMm != null ? Number(hole.diameterMm) : null;
  const xMm = hole.xMm != null ? Number(hole.xMm) : null;
  const yMm = hole.yMm != null ? Number(hole.yMm) : null;
  const zMm = hole.zMm != null ? Number(hole.zMm) : null;
  const depthMm = hole.depthMm != null ? Number(hole.depthMm) : null;
  if (diameterMm == null && xMm == null && yMm == null) return null;
  return {
    kind: hole.kind ? String(hole.kind) : hole.face ? String(hole.face) : "hole",
    face: hole.face ? String(hole.face) : "panel",
    diameterMm: Number.isFinite(diameterMm) ? diameterMm : null,
    xMm: Number.isFinite(xMm) ? xMm : null,
    yMm: Number.isFinite(yMm) ? yMm : null,
    zMm: Number.isFinite(zMm) ? zMm : null,
    depthMm: Number.isFinite(depthMm) ? depthMm : null,
    name: hole.name ? String(hole.name) : ""
  };
}

/** Нормалізує один рядок панелі з ENVER_3dscan. */
export function normalizeEnver3dscanPanel(row) {
  if (!row || row.code == null) return null;
  const code = normalizePartCode(row.code);
  if (!code) return null;

  const centerMm = row.centerMm || row.center || row.positionMm;
  const axisX = normalizeVec3(row.axisX);
  const axisY = normalizeVec3(row.axisY);
  const axisZ = normalizeVec3(row.axisZ);
  const sizeMm = row.sizeMm || row.size;
  const gabMinMm = row.gabMinMm || row.gabMin;
  const gabMaxMm = row.gabMaxMm || row.gabMax;

  const hasPose =
    Array.isArray(centerMm) &&
    centerMm.length >= 3 &&
    axisX &&
    axisY &&
    axisZ &&
    [centerMm[0], centerMm[1], centerMm[2]].every(Number.isFinite);

  const holes = (row.holes || []).map(normalizeHole).filter(Boolean);
  const bazisOperations = (row.bazisOperations || row.bazisOperationCodes || [])
    .map(normalizeBazisScanCode)
    .filter(Boolean);

  let edgeMask = null;
  if (Array.isArray(row.edgeMask) && row.edgeMask.length === 4) {
    edgeMask = row.edgeMask.map(Boolean);
  }

  return {
    code,
    partNo: row.partNo != null ? String(row.partNo) : partNoFromBazisOperationCode(code) || code,
    name: row.name ? String(row.name) : "",
    artPos: row.artPos != null ? String(row.artPos) : "",
    blockCode: row.blockCode ? String(row.blockCode) : "",
    material: row.material ? String(row.material) : "",
    thicknessMm: row.thicknessMm != null ? Number(row.thicknessMm) : null,
    lengthMm: row.lengthMm != null ? Number(row.lengthMm) : null,
    widthMm: row.widthMm != null ? Number(row.widthMm) : null,
    centerMm: hasPose ? centerMm.map(Number) : null,
    sizeMm: Array.isArray(sizeMm) ? sizeMm.map(Number) : null,
    gabMinMm: Array.isArray(gabMinMm) ? gabMinMm.map(Number) : null,
    gabMaxMm: Array.isArray(gabMaxMm) ? gabMaxMm.map(Number) : null,
    axisX: axisX || null,
    axisY: axisY || null,
    axisZ: axisZ || null,
    edgeCode: row.edgeCode ? String(row.edgeCode) : "",
    edgeMask,
    holes,
    holeCount: holes.length || Number(row.holeCount) || 0,
    bazisOperations,
    contourMm: Array.isArray(row.contourMm) ? row.contourMm : null,
    meshName: row.meshName ? String(row.meshName) : `panel-${code}`,
    colorFactor: row.colorFactor != null ? Number(row.colorFactor) : null
  };
}

/** Парсинг JSON документа ENVER_3dscan. */
export function parseEnver3dscanJson(data) {
  const raw = typeof data === "string" ? JSON.parse(data) : data;
  const panels = (raw?.panels || []).map(normalizeEnver3dscanPanel).filter(Boolean);
  return {
    kind: ENVER_3DSCAN_KIND,
    version: Number(raw?.version) || ENVER_3DSCAN_FORMAT_VERSION,
    source: raw?.source || "bazis",
    exportedAt: raw?.exportedAt || null,
    productName: raw?.productName || null,
    projectFile: raw?.projectFile || null,
    b3dFile: raw?.b3dFile || null,
    panels,
    materials: Array.isArray(raw?.materials) ? raw.materials : [],
    hardware: Array.isArray(raw?.hardware) ? raw.hardware : [],
    skipped: Array.isArray(raw?.skipped) ? raw.skipped : [],
    meta: raw?.meta && typeof raw.meta === "object" ? raw.meta : {}
  };
}

function readTailBlock(buffer, magicAscii, maxJson = 80_000_000) {
  if (!buffer?.length) return null;
  const magic = Buffer.from(magicAscii, "ascii");
  const idx = buffer.lastIndexOf(magic);
  if (idx < 0 || idx + 14 > buffer.length) return null;
  const version = buffer.readUInt32LE(idx + 6);
  const jsonLen = buffer.readUInt32LE(idx + 10);
  if (jsonLen <= 0 || jsonLen > maxJson || idx + 14 + jsonLen > buffer.length) return null;
  try {
    const json = buffer.toString("utf8", idx + 14, idx + 14 + jsonLen);
    return { idx, version, payload: JSON.parse(json) };
  } catch {
    return null;
  }
}

/** Витягти ENVER_3dscan з хвоста .b3d. */
export function extractEnver3dscanFromB3d(buffer) {
  const block = readTailBlock(buffer, ENVER_3DSCAN_MAGIC);
  if (!block) return null;
  try {
    return parseEnver3dscanJson(block.payload);
  } catch {
    return null;
  }
}

export function isEnver3dscanSidecarName(name = "") {
  const lower = String(name).toLowerCase();
  return (
    lower === "enver-3dscan.json" ||
    lower.endsWith(".enver-3dscan.json") ||
    lower === "enver_3dscan.json"
  );
}

/** Прибрати ENVER3 / EN3DSC хвости перед дописом нового блоку. */
export function stripEnverTails(buffer) {
  let base = buffer;
  for (const magic of [ENVER_3DSCAN_MAGIC, "ENVER3"]) {
    const idx = base.lastIndexOf(Buffer.from(magic, "ascii"));
    if (idx >= 0) base = base.subarray(0, idx);
  }
  return base;
}

export function appendEnver3dscanToB3d(b3dBuffer, scanDocument) {
  const doc = parseEnver3dscanJson(scanDocument);
  const json = Buffer.from(JSON.stringify(doc), "utf8");
  const tail = Buffer.alloc(14 + json.length);
  Buffer.from(ENVER_3DSCAN_MAGIC, "ascii").copy(tail, 0);
  tail.writeUInt32LE(ENVER_3DSCAN_FORMAT_VERSION, 6);
  tail.writeUInt32LE(json.length, 10);
  json.copy(tail, 14);
  const base = stripEnverTails(b3dBuffer);
  return Buffer.concat([base, tail]);
}

/** Чи схожий буфер на Bazis BZ85 .b3d. */
export function isBazisB3dBuffer(buffer) {
  return buffer?.length >= 4 && buffer.toString("ascii", 0, 4) === "BZ85";
}

/** Індекс панелей ENVER_3dscan за кодом. */
export function indexEnver3dscanPanels(scan) {
  const map = new Map();
  if (!scan?.panels?.length) return map;
  for (const panel of scan.panels) {
    const keys = new Set(
      [normalizePartCode(panel.code), panel.artPos, panel.partNo].filter(Boolean)
    );
    for (const k of keys) {
      if (!map.has(k)) map.set(k, panel);
    }
  }
  return map;
}
