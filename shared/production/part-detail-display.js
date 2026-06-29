import { countEdgedSides } from "./stage-metrics.js";
import { normalizeBazisScanCode, partNoFromBazisOperationCode } from "./bazis-operation-code.js";

/** Підписи сторін кромки (4-значний код Базіс). */
export const EDGE_SIDE_LABELS = ["Сторона 1", "Сторона 2", "Сторона 3", "Сторона 4"];

/** Маска сторін кромки з edge_code (4 цифри 0/1). */
export function edgeSideMask(edgeCode) {
  const code = String(edgeCode || "").trim();
  const digits = code.replace(/\D/g, "");
  if (digits.length >= 4) {
    return [...digits.slice(0, 4)].map((d) => d !== "0");
  }
  if (!digits.length || /^0+$/i.test(digits)) return [false, false, false, false];
  const sides = countEdgedSides(edgeCode);
  if (!sides) return [false, false, false, false];
  return EDGE_SIDE_LABELS.map((_, i) => i < sides);
}

/** Людський підпис коду кромки. */
export function formatEdgeCodeLabel(edgeCode) {
  const code = String(edgeCode || "").trim();
  if (!code || /^0+$/i.test(code) || /^(none|немає|—|-)$/i.test(code)) {
    return "Без кромки";
  }
  const mask = edgeSideMask(code);
  const active = mask.map((on, i) => (on ? EDGE_SIDE_LABELS[i] : null)).filter(Boolean);
  if (!active.length) return `Код ${code}`;
  return `${code} — ${active.join(", ")}`;
}

/** Номер «лиця» операції Bazis (0010X002X1 → 1). */
export function operationFaceIndexFromCode(code) {
  const n = normalizeBazisScanCode(code);
  const m = n.match(/X(\d+)$/i);
  return m ? Number(m[1]) : 0;
}

/**
 * Розділяє коди операцій деталі: лице 1 — кромка/вертикаль, лице 2+ — сверління торця.
 * @param {{ partNo?, bazisOperationCodes? }} part
 */
export function splitPartBazisOperations(part = {}) {
  const partNo = String(part.partNo || "").trim();
  const codes = (part.bazisOperationCodes || [])
    .map(normalizeBazisScanCode)
    .filter(Boolean)
    .filter((code) => !partNo || partNoFromBazisOperationCode(code) === partNo);

  const edging = [];
  const drilling = [];
  for (const code of codes) {
    const face = operationFaceIndexFromCode(code);
    if (face === 1) edging.push(code);
    else if (face >= 2) drilling.push(code);
    else edging.push(code);
  }
  return { edging, drilling, all: codes };
}

/** Короткий підсумок для картки деталі. */
export function formatPartDetailSummary(part = {}) {
  const edge = formatEdgeCodeLabel(part.edgeCode || part.edge_code);
  const { edging, drilling } = splitPartBazisOperations(part);
  return {
    edgeLabel: edge,
    edgedSides: edgeSideMask(part.edgeCode || part.edge_code).filter(Boolean).length,
    edgingOps: edging,
    drillingOps: drilling
  };
}
