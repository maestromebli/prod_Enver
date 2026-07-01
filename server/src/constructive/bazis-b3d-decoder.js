/**
 * Декодер Bazis .b3d (BZ85): zlib, словник полів, панелі з бінарного потоку.
 * Формат закритий — евристики + злиття з .project для повноти.
 */

import {
  ENVER_3DSCAN_FORMAT_VERSION,
  ENVER_3DSCAN_KIND,
  normalizePartCode,
  parseEnver3dscanJson
} from "../../../shared/production/enver-3dscan.js";
import { collectPrintableStrings } from "./parsers/manifest-text.js";
import { decompressB3dCandidates, scanZlibBlocks } from "./b3d-glb-extractor.js";

export const BAZIS_B3D_MAGIC = "BZ85";

export const BAZIS_IMPORTANT_FIELDS = [
  "ID",
  "DirX",
  "DirY",
  "DirZ",
  "MinX",
  "MinY",
  "MinZ",
  "MaxX",
  "MaxY",
  "MaxZ",
  "Width",
  "Height",
  "Depth",
  "Length",
  "Pos1",
  "Pos2",
  "Contour",
  "Hole",
  "Holes",
  "TriData",
  "Furniture",
  "Model",
  "Obj",
  "Objs",
  "Name",
  "ArtPos",
  "Butts",
  "Mat",
  "Data",
  "Edges",
  "Thickness",
  "Thick"
];

const STANDARD_PANEL_THICKNESSES = new Set([16, 18, 19, 22, 25, 36]);
const SHEET_MIN_MM = 2000;

function isSheetSize(lengthMm, widthMm) {
  const a = Math.max(lengthMm, widthMm);
  const b = Math.min(lengthMm, widthMm);
  return a >= SHEET_MIN_MM && b >= 1200;
}

function isNearIntegerMm(v, eps = 0.2) {
  return Number.isFinite(v) && Math.abs(v - Math.round(v)) <= eps;
}

function isPlausibleFieldName(name) {
  return name && name.length <= 64 && /^[A-Za-z_][A-Za-z0-9._-]*$/.test(name);
}

/** Словник полів: [u32 len][ascii name]… */
export function parseFieldDictionary(data, startOffset = 0) {
  const entries = [];
  let offset = startOffset;

  while (offset + 4 < data.length && entries.length < 120) {
    const length = data.readUInt32LE(offset);
    if (length < 1 || length > 64) break;

    const strStart = offset + 4;
    const strEnd = strStart + length;
    if (strEnd > data.length) break;

    const raw = data.subarray(strStart, strEnd);
    if (raw.includes(0)) break;

    const name = raw.toString("ascii");
    if (!isPlausibleFieldName(name)) break;

    entries.push({ name, offset });
    offset = strEnd;
  }

  if (entries.length < 8) return null;

  const known = entries.filter((e) => BAZIS_IMPORTANT_FIELDS.includes(e.name)).length;
  if (known < 4) return null;

  return {
    entries,
    dataStartOffset: offset,
    knownFieldCount: known
  };
}

export function findFieldDictionaryInPayloads(payloads) {
  let best = null;
  let bestScore = 0;

  for (const payload of payloads) {
    for (const start of [0, 4, 8, 16, 32, 64, 78, 92, 100, 128]) {
      if (start >= payload.length) continue;
      const parsed = parseFieldDictionary(payload, start);
      if (!parsed) continue;
      const score = parsed.knownFieldCount * 10 + parsed.entries.length;
      if (score > bestScore) {
        bestScore = score;
        best = { ...parsed, payloadStart: start };
      }
    }
  }

  return best;
}

function roundDim(v) {
  return Math.round(Number(v) * 10) / 10;
}

function isPanelThickness(v) {
  const t = Math.round(v);
  return STANDARD_PANEL_THICKNESSES.has(t);
}

/** Пари float64 (довжина × ширина) з типовою товщиною поруч. */
export function extractPanelPairsFromBinary(
  data,
  { minPanels = 2, maxPanels = 80, minOccurrences = 2 } = {}
) {
  const candidates = new Map();

  for (let offset = 0; offset < data.length - 24; offset += 8) {
    const length = data.readDoubleLE(offset);
    const width = data.readDoubleLE(offset + 8);
    if (!Number.isFinite(length) || !Number.isFinite(width)) continue;
    if (length < 100 || length > 4000 || width < 100 || width > 4000) continue;
    if (
      Math.abs(length - Math.round(length)) > 0.05 ||
      Math.abs(width - Math.round(width)) > 0.05
    ) {
      continue;
    }

    let thickness = 18;
    for (const tOff of [16, 24, -8]) {
      const tPos = offset + tOff;
      if (tPos < 0 || tPos + 8 > data.length) continue;
      const tVal = data.readDoubleLE(tPos);
      if (!Number.isFinite(tVal)) continue;
      const tRound = Math.round(tVal);
      if (isPanelThickness(tRound)) {
        thickness = tRound;
        break;
      }
    }

    const key = `${roundDim(length)}:${roundDim(width)}:${thickness}`;
    candidates.set(key, (candidates.get(key) || 0) + 1);
  }

  const ranked = [...candidates.entries()].sort(
    (a, b) => b[1] - a[1] || Number(b[0]) - Number(a[0])
  );
  const panels = [];

  for (const [key, count] of ranked) {
    if (count < minOccurrences) continue;
    const [length, width, thickness] = key.split(":").map(Number);
    if (isSheetSize(length, width)) continue;
    panels.push({
      lengthMm: length,
      widthMm: width,
      thicknessMm: thickness,
      source: "b3d_binary_pair",
      confidence: Math.min(0.7, 0.35 + count * 0.05)
    });
    if (panels.length >= maxPanels) break;
  }

  return panels.length >= minPanels ? panels : [];
}

/** int32 трійки (L × W × товщина) — частий Bazis-варіант. */
export function extractPanelIntPairs(data, { minPanels = 2, maxPanels = 60 } = {}) {
  const candidates = new Map();

  for (let offset = 0; offset < data.length - 12; offset += 4) {
    const length = data.readInt32LE(offset);
    const width = data.readInt32LE(offset + 4);
    const thick = data.readInt32LE(offset + 8);
    if (length < 100 || length > 4000 || width < 100 || width > 4000) continue;
    if (!isPanelThickness(thick)) continue;
    if (isSheetSize(length, width)) continue;
    const key = `${length}x${width}x${thick}`;
    candidates.set(key, (candidates.get(key) || 0) + 1);
  }

  const panels = [...candidates.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maxPanels)
    .map(([key, count]) => {
      const [lengthMm, widthMm, thicknessMm] = key.split("x").map(Number);
      return {
        lengthMm,
        widthMm,
        thicknessMm,
        source: "b3d_int_triplet",
        confidence: Math.min(0.65, 0.3 + count * 0.08)
      };
    });

  return panels.length >= minPanels ? panels : [];
}

function sanitizeGabMin(minX, minY, minZ) {
  if ([minX, minY, minZ].every((v) => v === 0)) return [0, 0, 0];
  if ([minX, minY, minZ].every(isPlausibleGabMinCoord)) return [minX, minY, minZ];
  return [0, 0, 0];
}

function scanGabMinMaxAtOffset(data, offset, read, stride = 8, { requireIntegerMm = false } = {}) {
  const minX = read(offset);
  const minY = read(offset + stride);
  const minZ = read(offset + stride * 2);
  const maxX = read(offset + stride * 3);
  const maxY = read(offset + stride * 4);
  const maxZ = read(offset + stride * 5);

  if (![minX, minY, minZ, maxX, maxY, maxZ].every(Number.isFinite)) return null;
  if (requireIntegerMm && ![minX, minY, minZ, maxX, maxY, maxZ].every(isNearIntegerMm)) {
    return null;
  }
  if (![maxX, maxY, maxZ].every(isPlausibleMmCoord)) return null;

  const [safeMinX, safeMinY, safeMinZ] = sanitizeGabMin(minX, minY, minZ);
  if (maxX <= safeMinX || maxY <= safeMinY || maxZ <= safeMinZ) return null;

  const sx = maxX - safeMinX;
  const sy = maxY - safeMinY;
  const sz = maxZ - safeMinZ;
  if (sx < 30 || sy < 30 || sz < 5) return null;
  if (sx > 4000 || sy > 4000 || sz > 4000) return null;

  const sorted = [sx, sy, sz].sort((a, b) => a - b);
  if (sorted[0] < 8 || sorted[0] > 50) return null;
  if (sorted[1] < 80 || sorted[2] < 80) return null;
  if (isSheetSize(sorted[2], sorted[1])) return null;

  return {
    gabMinMm: [safeMinX, safeMinY, safeMinZ],
    gabMaxMm: [maxX, maxY, maxZ],
    centerMm: [(safeMinX + maxX) / 2, (safeMinY + maxY) / 2, (safeMinZ + maxZ) / 2],
    sizeMm: [sx, sy, sz],
    lengthMm: Math.round(Math.max(sx, sy)),
    widthMm: Math.round(Math.min(sx, sy)),
    thicknessMm: Math.round(sorted[0]),
    minMaxOffset: offset,
    source: "b3d_gab_minmax",
    confidence: 0.75
  };
}

/** XML <part …/> усередині розпакованого блоку. */
export function extractXmlPanelsFromBuffer(data) {
  const text = data.toString("utf8");
  if (!/<part\b/i.test(text)) return [];

  const panels = [];
  const seen = new Set();
  const re = /<part\b[^>]*>/gi;
  const attrRe = /(\w+)\s*=\s*"([^"]*)"/gi;

  let match;
  while ((match = re.exec(data))) {
    const tag = match[0];
    const attrs = {};
    let am;
    while ((am = attrRe.exec(tag))) {
      attrs[am[1].toLowerCase()] = am[2];
    }
    attrRe.lastIndex = 0;

    const code = attrs.code || attrs.number || attrs.id || "";
    if (!code || seen.has(code)) continue;
    seen.add(code);

    const lengthMm = Number(attrs.dl || attrs.length || attrs.l || 0);
    const widthMm = Number(attrs.dw || attrs.width || attrs.w || 0);
    const thicknessMm = Number(attrs.dz || attrs.thickness || attrs.thick || attrs.t || 18);

    if (lengthMm <= 0 || widthMm <= 0) continue;

    panels.push({
      code: normalizePartCode(code),
      name: attrs.name || `Деталь ${code}`,
      lengthMm,
      widthMm,
      thicknessMm: thicknessMm > 0 ? thicknessMm : 18,
      source: "b3d_embedded_xml",
      confidence: 0.9
    });
  }

  return panels;
}

/** Width × Height × Depth (float64/float32) — для Bazis з полями WHD. */
export function scanWidthHeightDepthPanels(data, { maxPanels = 40 } = {}) {
  const candidates = new Map();

  const pushTriplet = (w, h, d, source) => {
    if (![w, h, d].every(Number.isFinite)) return;
    if (!isNearIntegerMm(w) || !isNearIntegerMm(h) || !isNearIntegerMm(d)) return;
    const rw = Math.round(w);
    const rh = Math.round(h);
    const rd = Math.round(d);
    if (rw < 50 || rh < 50 || rw > 4000 || rh > 4000) return;
    if (!isPanelThickness(rd)) return;
    if (isSheetSize(rw, rh)) return;
    const key = `${rw}x${rh}x${rd}`;
    const prev = candidates.get(key) || { count: 0, source };
    candidates.set(key, { ...prev, count: prev.count + 1, source });
  };

  for (let offset = 0; offset < data.length - 24; offset += 8) {
    pushTriplet(
      data.readDoubleLE(offset),
      data.readDoubleLE(offset + 8),
      data.readDoubleLE(offset + 16),
      "b3d_whd_f64"
    );
  }
  for (let offset = 0; offset < data.length - 12; offset += 4) {
    pushTriplet(
      data.readFloatLE(offset),
      data.readFloatLE(offset + 4),
      data.readFloatLE(offset + 8),
      "b3d_whd_f32"
    );
  }

  return [...candidates.entries()]
    .filter(([, meta]) => meta.count >= 1)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, maxPanels)
    .map(([key, meta]) => {
      const [lengthMm, widthMm, thicknessMm] = key.split("x").map(Number);
      return {
        lengthMm,
        widthMm,
        thicknessMm,
        source: meta.source,
        confidence: Math.min(0.72, 0.4 + meta.count * 0.06)
      };
    });
}

/** Типорозміри з тексту (2800×2070×18, 800x600). */
export function extractDimensionHintsFromStrings(strings = []) {
  const panels = [];
  const seen = new Set();
  const re3 = /(\d{3,4})\s*[xX×хХ]\s*(\d{3,4})\s*[xX×хХ]\s*(\d{1,2})\b/g;
  const re2 = /(\d{3,4})\s*[xX×хХ]\s*(\d{3,4})\b/g;

  for (const text of strings) {
    let m;
    while ((m = re3.exec(text))) {
      const lengthMm = Number(m[1]);
      const widthMm = Number(m[2]);
      const thicknessMm = Number(m[3]);
      if (!isPanelThickness(thicknessMm)) continue;
      if (isSheetSize(lengthMm, widthMm)) continue;
      const key = `${lengthMm}x${widthMm}x${thicknessMm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      panels.push({
        lengthMm,
        widthMm,
        thicknessMm,
        source: "b3d_string_dim",
        confidence: 0.45
      });
    }
    while ((m = re2.exec(text))) {
      const lengthMm = Number(m[1]);
      const widthMm = Number(m[2]);
      if (lengthMm < 100 || widthMm < 100) continue;
      if (isSheetSize(lengthMm, widthMm)) continue;
      const key = `${lengthMm}x${widthMm}x18`;
      if (seen.has(key)) continue;
      seen.add(key);
      panels.push({
        lengthMm,
        widthMm,
        thicknessMm: 18,
        source: "b3d_string_dim",
        confidence: 0.35
      });
    }
  }

  return panels;
}

function extractProductNameFromStrings(strings = []) {
  for (const s of strings) {
    const order = s.match(/product\.order\s*=\s*["']?([^"']{3,80})/i);
    if (order) return order[1].trim();
    const name = s.match(/<good\b[^>]*\bname\s*=\s*"([^"]{3,80})"/i);
    if (name) return name[1].trim();
    if (/^[A-ZА-ЯІЇЄ]-\d{2,4}\s+.{3,60}$/.test(s)) return s.trim();
  }
  return "";
}

function dedupeGabPanels(raw) {
  const bySize = new Map();
  for (const p of raw) {
    const key = [p.lengthMm, p.widthMm, p.thicknessMm].join("x");
    const prev = bySize.get(key);
    if (!prev || (p.confidence || 0) > (prev.confidence || 0)) bySize.set(key, p);
  }
  return [...bySize.values()];
}

/** MinX…MaxZ — float64 і (обережно) float32 для Pos1/Pos2 моделей. */
export function scanGabMinMaxPanels(data, { maxPanels = 120, allowFloat32 = false } = {}) {
  const raw = [];

  const readers = [
    { step: 1, read: (o) => data.readDoubleLE(o), stride: 8, requireIntegerMm: false }
  ];
  if (allowFloat32) {
    readers.push({
      step: 8,
      read: (o) => data.readFloatLE(o),
      stride: 4,
      requireIntegerMm: true
    });
  }

  for (const { step, read, stride, requireIntegerMm } of readers) {
    const span = stride * 6;
    for (let offset = 0; offset < data.length - span; offset += step) {
      const panel = scanGabMinMaxAtOffset(data, offset, read, stride, { requireIntegerMm });
      if (panel) raw.push(panel);
    }
  }

  const uniq = dedupeGabPanels(raw);
  return uniq.slice(0, maxPanels);
}

function isPlausibleMmCoord(v) {
  if (!Number.isFinite(v) || Math.abs(v) > 50000) return false;
  if (v === 0) return true;
  if (Math.abs(v) < 1) return false;
  return true;
}

function isPlausibleGabMinCoord(v) {
  if (!Number.isFinite(v) || Math.abs(v) > 50000) return false;
  if (v === 0) return true;
  return Math.abs(v) >= 1 && isNearIntegerMm(v, 1);
}

function normalizeVec3(v) {
  const len = Math.hypot(v[0], v[1], v[2]);
  if (!Number.isFinite(len) || len < 1e-9 || len > 1e6) return null;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function isOrthonormalAxes(axisX, axisY, axisZ, { maxDot = 0.08 } = {}) {
  const dot = (a, b) => Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]);
  if (dot(axisX, axisY) > maxDot || dot(axisX, axisZ) > maxDot || dot(axisY, axisZ) > maxDot) {
    return false;
  }
  const cross = [
    axisX[1] * axisY[2] - axisX[2] * axisY[1],
    axisX[2] * axisY[0] - axisX[0] * axisY[2],
    axisX[0] * axisY[1] - axisX[1] * axisY[0]
  ];
  return dot(cross, axisZ) >= 0.5;
}

/** Три послідовні vec3 (DirX, DirY, DirZ) у Bazis .b3d — зазвичай float32. */
export function readOrthonormalAxesF32(data, offset) {
  if (!data || offset < 0 || offset + 36 > data.length) return null;
  const axisX = normalizeVec3([
    data.readFloatLE(offset),
    data.readFloatLE(offset + 4),
    data.readFloatLE(offset + 8)
  ]);
  const axisY = normalizeVec3([
    data.readFloatLE(offset + 12),
    data.readFloatLE(offset + 16),
    data.readFloatLE(offset + 20)
  ]);
  const axisZ = normalizeVec3([
    data.readFloatLE(offset + 24),
    data.readFloatLE(offset + 28),
    data.readFloatLE(offset + 32)
  ]);
  if (!axisX || !axisY || !axisZ) return null;
  if (!isOrthonormalAxes(axisX, axisY, axisZ)) return null;
  return { axisX, axisY, axisZ };
}

/** float64 vec3 — рідше, але перевіряємо для повноти. */
export function readOrthonormalAxesF64(data, offset) {
  if (!data || offset < 0 || offset + 72 > data.length) return null;
  const axisX = normalizeVec3([
    data.readDoubleLE(offset),
    data.readDoubleLE(offset + 8),
    data.readDoubleLE(offset + 16)
  ]);
  const axisY = normalizeVec3([
    data.readDoubleLE(offset + 24),
    data.readDoubleLE(offset + 32),
    data.readDoubleLE(offset + 40)
  ]);
  const axisZ = normalizeVec3([
    data.readDoubleLE(offset + 48),
    data.readDoubleLE(offset + 56),
    data.readDoubleLE(offset + 64)
  ]);
  if (!axisX || !axisY || !axisZ) return null;
  if (!isOrthonormalAxes(axisX, axisY, axisZ)) return null;
  return { axisX, axisY, axisZ };
}

const DIR_LINK_PREFERRED_DELTAS = [139, 144, 148, 152, 304, 308, -574, -560, -548];

function scoreDirLinkDelta(delta) {
  let score = 500 - Math.min(Math.abs(delta), 450);
  for (const preferred of DIR_LINK_PREFERRED_DELTAS) {
    score += Math.max(0, 200 - Math.abs(delta - preferred));
  }
  if (delta > 48) score += 40;
  return score;
}

/**
 * Шукає DirX/DirY/DirZ поруч із блоком MinX…MaxZ у бінарному потоці Bazis.
 * Осі можуть бути до або після габаритів (типові зміщення ~+139 або ~+304 байт).
 */
export function findOrthonormalAxesNearMinMax(data, minMaxOffset, { usedDirOffsets = null } = {}) {
  if (!data?.length || minMaxOffset == null || minMaxOffset < 0) return null;

  let best = null;
  const searchFrom = Math.max(0, minMaxOffset - 640);
  const searchTo = Math.min(data.length - 36, minMaxOffset + 840);

  for (let off = searchFrom; off <= searchTo; off += 1) {
    if (off >= minMaxOffset && off <= minMaxOffset + 48) continue;
    if (usedDirOffsets?.has(off)) continue;

    const f32 = readOrthonormalAxesF32(data, off);
    if (!f32) continue;

    const delta = off - minMaxOffset;
    const score = scoreDirLinkDelta(delta);
    if (!best || score > best.score) {
      best = { ...f32, score, dirOffset: off, dirDelta: delta, dirSource: "b3d_dir_f32" };
    }

    const f64 = readOrthonormalAxesF64(data, off);
    if (!f64) continue;
    const f64Score = scoreDirLinkDelta(delta) - 20;
    if (!best || f64Score > best.score) {
      best = {
        ...f64,
        score: f64Score,
        dirOffset: off,
        dirDelta: delta,
        dirSource: "b3d_dir_f64"
      };
    }
  }

  if (!best) return null;
  return {
    axisX: best.axisX,
    axisY: best.axisY,
    axisZ: best.axisZ,
    dirOffset: best.dirOffset,
    dirSource: best.dirSource
  };
}

/** Зіставляє панелі з GabMinMax і найближчі ортонормовані осі в тому ж записі об'єкта. */
export function linkPanelsWithNearbyDirs(panels, data) {
  if (!data?.length) return panels;
  const usedDirOffsets = new Set();

  return panels.map((panel) => {
    if (!panel.centerMm || panel.minMaxOffset == null) return panel;
    const dirs = findOrthonormalAxesNearMinMax(data, panel.minMaxOffset, { usedDirOffsets });
    if (!dirs) return panel;
    if (dirs.dirOffset != null) usedDirOffsets.add(dirs.dirOffset);
    return {
      ...panel,
      axisX: dirs.axisX,
      axisY: dirs.axisY,
      axisZ: dirs.axisZ,
      dirSource: dirs.dirSource
    };
  });
}

function thicknessAxisFromSize(sizeMm) {
  const [sx, sy, sz] = sizeMm;
  const sorted = [
    { v: sx, axis: "x" },
    { v: sy, axis: "y" },
    { v: sz, axis: "z" }
  ].sort((a, b) => a.v - b.v);
  return sorted[0].axis;
}

function fallbackAxesFromSize(sizeMm) {
  return {
    axisX: [1, 0, 0],
    axisY: [0, 1, 0],
    axisZ: [0, 0, 1],
    thicknessAxis: thicknessAxisFromSize(sizeMm)
  };
}

function poseFromGab(panel, data = null) {
  const [sx, sy, sz] = panel.sizeMm;
  if (panel.axisX && panel.axisY && panel.axisZ) {
    return {
      centerMm: panel.centerMm,
      sizeMm: [sx, sy, sz],
      axisX: panel.axisX,
      axisY: panel.axisY,
      axisZ: panel.axisZ,
      thicknessAxis: thicknessAxisFromSize([sx, sy, sz]),
      dirSource: panel.dirSource
    };
  }

  const fromDirs =
    data && panel.minMaxOffset != null
      ? findOrthonormalAxesNearMinMax(data, panel.minMaxOffset)
      : null;

  if (fromDirs) {
    return {
      centerMm: panel.centerMm,
      sizeMm: [sx, sy, sz],
      axisX: fromDirs.axisX,
      axisY: fromDirs.axisY,
      axisZ: fromDirs.axisZ,
      thicknessAxis: thicknessAxisFromSize([sx, sy, sz]),
      dirSource: fromDirs.dirSource
    };
  }

  return {
    centerMm: panel.centerMm,
    sizeMm: [sx, sy, sz],
    ...fallbackAxesFromSize([sx, sy, sz])
  };
}

function collectPayloads(buffer) {
  const blocks = scanZlibBlocks(buffer, { maxBlocks: 16 });
  const payloads = blocks.map((b) => b.data);
  if (!payloads.length) payloads.push(buffer);
  return { blocks, payloads, candidates: decompressB3dCandidates(buffer) };
}

function rankPanels(panels) {
  return [...panels].sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

function dedupePanels(panels) {
  const out = [];
  for (const p of panels) {
    const key = [
      p.code || "",
      Math.round(p.lengthMm || 0),
      Math.round(p.widthMm || 0),
      Math.round(p.thicknessMm || 18),
      p.centerMm ? p.centerMm.map((v) => Math.round(v)).join() : ""
    ].join("|");
    if (out.some((x) => x._key === key)) continue;
    out.push({ ...p, _key: key });
  }
  return out.map(({ _key, ...rest }) => rest);
}

/**
 * Повний аналіз Bazis .b3d без .project.
 * @returns {{ isBazis: boolean, fieldDictionary, importantFields, panels, strings, warnings, stats }}
 */
export function analyzeBazisB3dBuffer(buffer) {
  const warnings = [];
  if (!buffer?.length) {
    return { isBazis: false, panels: [], warnings: ["Порожній буфер"], stats: {} };
  }

  const isBazis = buffer.length >= 4 && buffer.toString("ascii", 0, 4) === BAZIS_B3D_MAGIC;
  if (!isBazis) warnings.push("Файл без magic BZ85 — застосовано евристичний аналіз");

  const { blocks, payloads, candidates } = collectPayloads(buffer);
  const fieldDictionary = findFieldDictionaryInPayloads(payloads);
  const importantFields = fieldDictionary
    ? fieldDictionary.entries.map((e) => e.name).filter((n) => BAZIS_IMPORTANT_FIELDS.includes(n))
    : [];

  const hasMinMax = ["MinX", "MaxX", "MinY", "MaxY", "MinZ", "MaxZ"].every((f) =>
    importantFields.includes(f)
  );
  const hasPos = importantFields.includes("Pos1") && importantFields.includes("Pos2");
  const hasWhd =
    importantFields.includes("Width") &&
    importantFields.includes("Height") &&
    importantFields.includes("Depth");

  const collected = [];
  let gabCount = 0;

  for (const payload of payloads) {
    collected.push(...extractXmlPanelsFromBuffer(payload));
  }

  if (hasMinMax || hasPos) {
    for (const payload of payloads) {
      const gab = linkPanelsWithNearbyDirs(
        scanGabMinMaxPanels(payload, {
          allowFloat32: hasPos && !hasMinMax
        }),
        payload
      );
      gabCount += gab.length;
      for (const p of gab) {
        collected.push({ ...p, _posePayload: payload });
      }
    }
  }

  if (hasWhd || hasPos) {
    for (const payload of payloads) {
      collected.push(...scanWidthHeightDepthPanels(payload));
    }
  }

  const strings = [];
  for (const src of [buffer, ...payloads.slice(0, 4)]) {
    strings.push(...collectPrintableStrings(src));
  }
  collected.push(...extractDimensionHintsFromStrings(strings));

  const skipBinaryPairs = gabCount >= 2;
  if (!skipBinaryPairs) {
    for (const payload of [...payloads, ...candidates]) {
      collected.push(...extractPanelIntPairs(payload, { minPanels: 1 }));
      const pairs = extractPanelPairsFromBinary(payload, { minPanels: 1, minOccurrences: 2 });
      for (const p of pairs) {
        collected.push({ ...p, code: "", name: "" });
      }
    }
  }

  const productNameHint = extractProductNameFromStrings(strings);

  const artPosCodes = new Set();
  for (const s of strings) {
    const m = s.match(/\bArtPos\s*[:=]\s*(\d+)/i) || s.match(/\bпоз\.?\s*(\d{1,6})\b/i);
    if (m) artPosCodes.add(m[1]);
    const block = s.match(/(?:^|[^A-ZА-Я0-9])([BВБ]\d+[-_.]\d+)/i);
    if (block) artPosCodes.add(block[1].replace(/^[^\d]*/, ""));
  }

  let panels = dedupePanels(rankPanels(collected));

  if (!panels.length) {
    warnings.push(
      "Не вдалося витягти панелі з .b3d — додайте .project або експортуйте ENVER_3dscan з Базіс"
    );
  } else if (!hasMinMax && !panels.some((p) => p.centerMm)) {
    warnings.push(
      "Панелі з .b3d без координат збірки (Pos1/MinX) — 3D буде плоскою розкладкою або наближеною"
    );
  }

  panels = panels.map((p, idx) => {
    const code = p.code || normalizePartCode([...artPosCodes][idx] || String(idx + 1));
    const posePayload = p._posePayload || null;
    const { _posePayload, ...panelBase } = p;
    const withPose = panelBase.centerMm
      ? { ...poseFromGab(panelBase, posePayload), ...panelBase }
      : panelBase;
    return {
      ...withPose,
      code,
      partNo: String(code),
      name: panelBase.name || `Деталь ${code}`,
      meshName: panelBase.meshName || `panel-${code}`
    };
  });

  return {
    isBazis,
    fieldDictionary,
    importantFields,
    hasMinMax,
    hasPos,
    hasWhd,
    productNameHint,
    panels,
    strings: [...new Set(strings)].slice(0, 500),
    warnings,
    stats: {
      b3dBytes: buffer.length,
      zlibBlocks: blocks.length,
      dictionaryFields: fieldDictionary?.entries?.length || 0,
      decodedPanelCount: panels.length,
      posedPanelCount: panels.filter((p) => p.centerMm && p.axisX).length,
      posedWithDirsCount: panels.filter((p) => p.dirSource).length,
      gabPanelCount: gabCount
    }
  };
}

/** Побудувати документ ENVER_3dscan з декодованого .b3d. */
export function buildEnver3dscanFromB3dDecode(b3dBuffer, { productName = "" } = {}) {
  const analysis = analyzeBazisB3dBuffer(b3dBuffer);
  if (!analysis.panels.length) {
    return { scan: null, analysis };
  }

  const resolvedName = productName || analysis.productNameHint || "";

  const panels = analysis.panels.map((p) => ({
    code: p.code,
    partNo: p.partNo || p.code,
    name: p.name,
    thicknessMm: p.thicknessMm || 18,
    lengthMm: p.lengthMm || null,
    widthMm: p.widthMm || null,
    centerMm: p.centerMm || null,
    sizeMm:
      p.sizeMm || (p.lengthMm && p.widthMm ? [p.lengthMm, p.widthMm, p.thicknessMm || 18] : null),
    axisX: p.axisX || null,
    axisY: p.axisY || null,
    axisZ: p.axisZ || null,
    dirSource: p.dirSource || null,
    gabMinMm: p.gabMinMm || null,
    gabMaxMm: p.gabMaxMm || null,
    meshName: p.meshName,
    holes: p.holes || [],
    bazisOperations: p.bazisOperations || [],
    source: p.source || "b3d_decode"
  }));

  const scan = parseEnver3dscanJson({
    kind: ENVER_3DSCAN_KIND,
    version: ENVER_3DSCAN_FORMAT_VERSION,
    source: "bazis_b3d_decode",
    exportedAt: new Date().toISOString(),
    productName: resolvedName,
    panels,
    meta: {
      derivedFrom: "b3d_decode",
      importantFields: analysis.importantFields,
      decodeStats: analysis.stats
    }
  });

  return { scan, analysis };
}

export function isBazisB3dBuffer(buffer) {
  return buffer?.length >= 4 && buffer.toString("ascii", 0, 4) === BAZIS_B3D_MAGIC;
}
