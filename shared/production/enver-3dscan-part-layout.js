/**
 * Розкладка панелі ENVER_3dscan для окремого 3D-перегляду деталі (пласко на столі, Y-up).
 */

import { normalizePartCode } from "./enver-3dscan.js";

const MM = 0.001;

/** Розміри панелі в мм з полів scan або part-рядка. */
export function resolveScanPanelDimensions(panel = {}, part = null) {
  let lengthMm = Number(panel.lengthMm) || 0;
  let widthMm = Number(panel.widthMm) || 0;
  let thicknessMm = Number(panel.thicknessMm) || 0;

  const size = panel.sizeMm;
  if (Array.isArray(size) && size.length >= 3) {
    const sx = Math.abs(Number(size[0]) || 0);
    const sy = Math.abs(Number(size[1]) || 0);
    const sz = Math.abs(Number(size[2]) || 0);
    const dims = [sx, sy, sz].filter((n) => n > 0).sort((a, b) => b - a);
    if (dims.length >= 2) {
      if (!lengthMm) lengthMm = dims[0];
      if (!widthMm) widthMm = dims[1];
      if (!thicknessMm && dims[2]) thicknessMm = dims[2];
    }
  }

  if ((!lengthMm || !widthMm) && Array.isArray(panel.gabMinMm) && Array.isArray(panel.gabMaxMm)) {
    const dx = Math.abs(Number(panel.gabMaxMm[0]) - Number(panel.gabMinMm[0]));
    const dy = Math.abs(Number(panel.gabMaxMm[1]) - Number(panel.gabMinMm[1]));
    const dz = Math.abs(Number(panel.gabMaxMm[2]) - Number(panel.gabMinMm[2]));
    const dims = [dx, dy, dz].filter((n) => n > 0).sort((a, b) => b - a);
    if (dims.length >= 2) {
      if (!lengthMm) lengthMm = dims[0];
      if (!widthMm) widthMm = dims[1];
      if (!thicknessMm && dims[2]) thicknessMm = dims[2];
    }
  }

  if (part) {
    if (!lengthMm) lengthMm = Number(part.length) || 0;
    if (!widthMm) widthMm = Number(part.width) || 0;
    if (!thicknessMm) thicknessMm = Number(part.thickness) || 0;
  }

  if (!thicknessMm) thicknessMm = 18;
  if (!lengthMm) lengthMm = 100;
  if (!widthMm) widthMm = 100;

  return { lengthMm, widthMm, thicknessMm };
}

/** Панель для buildPreviewGlbFromPanels — деталь по центру, товщина по Y. */
export function layoutScanPanelForDetail(panel = {}, part = null) {
  const code =
    normalizePartCode(panel.code || panel.partNo) ||
    normalizePartCode(part?.partCode || part?.part_code) ||
    normalizePartCode(part?.partNo || part?.part_no) ||
    "0";
  const { lengthMm, widthMm, thicknessMm } = resolveScanPanelDimensions(panel, part);
  const sx = lengthMm * MM;
  const sy = thicknessMm * MM;
  const sz = widthMm * MM;

  return {
    code,
    partName: panel.name || part?.partName || part?.part_name || `Деталь ${code}`,
    colorFactor: panel.colorFactor ?? null,
    lengthMm,
    widthMm,
    thicknessMm,
    position: { x: 0, y: sy / 2, z: 0 },
    scale: { x: sx, y: sy, z: sz },
    rotation: null
  };
}

function partLookupKeys(part) {
  const keys = new Set();
  for (const raw of [
    part?.partCode,
    part?.part_code,
    part?.partNo,
    part?.part_no,
    part?.modelNodeId,
    part?.model_node_id
  ]) {
    const n = normalizePartCode(raw);
    if (n) keys.add(n);
  }
  const mesh = part?.modelMeshName || part?.model_mesh_name;
  if (mesh) keys.add(String(mesh));
  return keys;
}

/** Знайти панель ENVER_3dscan для рядка constructive_parts. */
export function findScanPanelForPart(scan, part) {
  if (!scan?.panels?.length || !part) return null;
  const keys = partLookupKeys(part);
  const meshName = part.modelMeshName || part.model_mesh_name;

  for (const panel of scan.panels) {
    const code = normalizePartCode(panel.code);
    if (code && keys.has(code)) return panel;
    const pno = normalizePartCode(panel.partNo);
    if (pno && keys.has(pno)) return panel;
    if (meshName && panel.meshName === meshName) return panel;
    if (meshName && code && meshName === `panel-${code}`) return panel;
  }
  return null;
}
