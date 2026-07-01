/** Діагностика звʼязки деталі конструктива з mesh/node 3D-моделі. */

import { normalizeBazisScanCode, resolvePartHighlightMesh } from "./bazis-operation-code.js";

function str(v) {
  return String(v ?? "").trim();
}

function stripLeadingZeros(value) {
  const s = str(value);
  if (!s) return "";
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : s.replace(/^0+/, "") || s;
}

function normKey(value) {
  return str(value).toLowerCase();
}

/** @typedef {'exact' | 'fallback' | 'ambiguous' | 'missing'} MappingStatus */

/**
 * @param {Record<string, unknown>} part
 * @returns {{
 *   mappingStatus: MappingStatus,
 *   mappingConfidence: number,
 *   mappingHint: string,
 *   resolvedMeshName: string | null,
 *   resolvedNodeId: string | null,
 *   fallbackKey: string | null
 * }}
 */
export function resolvePartMappingStatus(part) {
  if (!part) {
    return {
      mappingStatus: "missing",
      mappingConfidence: 0,
      mappingHint: "Деталь не передана",
      resolvedMeshName: null,
      resolvedNodeId: null,
      fallbackKey: null
    };
  }

  const modelNodeId = str(part.modelNodeId || part.model_node_id);
  const modelMeshName = str(part.modelMeshName || part.model_mesh_name);

  if (modelNodeId || modelMeshName) {
    return {
      mappingStatus: "exact",
      mappingConfidence: 100,
      mappingHint: "3D звʼязано",
      resolvedMeshName: modelMeshName || modelNodeId,
      resolvedNodeId: modelNodeId || modelMeshName,
      fallbackKey: null
    };
  }

  const hint = resolvePartHighlightMesh(part);
  if (!hint?.meshName && !hint?.nodeId) {
    return {
      mappingStatus: "missing",
      mappingConfidence: 0,
      mappingHint: "Ця деталь ще не звʼязана з 3D-моделлю. Показано тільки картку деталі.",
      resolvedMeshName: null,
      resolvedNodeId: null,
      fallbackKey: null
    };
  }

  const partCode = str(part.partCode || part.part_code);
  const blockCode = str(part.blockCode || part.block_code);
  const partNo = str(part.partNo || part.part_no);
  const composite = blockCode && partNo ? `${blockCode}-${partNo}` : "";
  const codes = Array.isArray(part.bazisOperationCodes)
    ? part.bazisOperationCodes
    : Array.isArray(part.bazis_operation_codes)
      ? part.bazis_operation_codes
      : [];

  let mappingConfidence = 50;
  let mappingHint = "Деталь знайдена за резервною логікою. Перевірте підсвітку.";
  let fallbackKey = hint.meshName || hint.nodeId;

  if (
    partCode &&
    (normKey(hint.meshName) === normKey(`panel-${partCode}`) ||
      normKey(hint.nodeId) === normKey(partCode))
  ) {
    mappingConfidence = 75;
    mappingHint = "Резервна звʼязка за partCode. Перевірте підсвітку.";
    fallbackKey = partCode;
  } else if (
    composite &&
    (normKey(hint.meshName) === normKey(composite) || normKey(hint.nodeId) === normKey(composite))
  ) {
    mappingConfidence = 70;
    mappingHint = "Резервна звʼязка за blockCode-partNo. Перевірте підсвітку.";
    fallbackKey = composite;
  } else if (partNo && normKey(hint.meshName) === normKey(`panel-${partNo}`)) {
    mappingConfidence = 50;
    mappingHint = "Резервна звʼязка за partNo. Перевірте підсвітку.";
    fallbackKey = partNo;
  } else if (codes.length) {
    mappingConfidence = 55;
    mappingHint = "Резервна звʼязка за кодом Bazis. Перевірте підсвітку.";
    fallbackKey = normalizeBazisScanCode(codes[0]) || fallbackKey;
  }

  return {
    mappingStatus: "fallback",
    mappingConfidence,
    mappingHint,
    resolvedMeshName: hint.meshName || null,
    resolvedNodeId: hint.nodeId || null,
    fallbackKey
  };
}

/**
 * @param {Array<Record<string, unknown>>} parts
 * @param {Array<Record<string, unknown>>} [manifestNodes]
 * @param {Array<Record<string, unknown>>} [ambiguousParts]
 */
export function summarizeMappingDiagnostics(parts = [], manifestNodes = [], ambiguousParts = []) {
  const nodeCount = manifestNodes.length;
  const ambiguousByPartId = new Map((ambiguousParts || []).map((a) => [Number(a.partId), a]));
  let exact = 0;
  let fallback = 0;
  let missing = 0;
  let ambiguous = 0;
  const unmapped = [];

  for (const part of parts) {
    const ambiguousHit = ambiguousByPartId.get(Number(part.id));
    if (ambiguousHit) {
      ambiguous += 1;
      unmapped.push({
        partNo: str(part.partNo || part.part_no),
        partName: str(part.partName || part.part_name),
        material: str(part.material),
        dimensions: [part.length, part.width, part.thickness]
          .filter((v) => v != null && v !== "")
          .join(" × "),
        reason: "Неоднозначна звʼязка — кілька можливих mesh",
        fallbackKey: ambiguousHit.meshName || ambiguousHit.nodeId || null,
        mappingStatus: "ambiguous"
      });
      continue;
    }

    const status = resolvePartMappingStatus(part);
    if (status.mappingStatus === "exact") exact += 1;
    else if (status.mappingStatus === "fallback") fallback += 1;
    else missing += 1;

    if (status.mappingStatus !== "exact") {
      unmapped.push({
        partNo: str(part.partNo || part.part_no),
        partName: str(part.partName || part.part_name),
        material: str(part.material),
        dimensions: [part.length, part.width, part.thickness]
          .filter((v) => v != null && v !== "")
          .join(" × "),
        reason: status.mappingStatus === "missing" ? "Немає ключів для mesh" : status.mappingHint,
        fallbackKey: status.fallbackKey,
        mappingStatus: status.mappingStatus
      });
    }
  }

  const total = parts.length || 0;
  const mappingQuality = total
    ? Math.round(((exact + fallback * 0.6 - ambiguous * 0.25) / total) * 100) / 100
    : 0;
  const exactRatio = total ? exact / total : 0;
  const linkedRatio = total ? (exact + fallback) / total : 0;

  let readinessStatus = "Не готово";
  if (exactRatio >= 0.9 && ambiguous === 0) readinessStatus = "Готово";
  else if (linkedRatio >= 0.8) readinessStatus = "Потрібна перевірка";

  return {
    totalParts: total,
    meshNodeCount: nodeCount,
    exactCount: exact,
    fallbackCount: fallback,
    missingCount: missing,
    ambiguousCount: ambiguous,
    mappingQuality: Math.max(0, Math.min(1, mappingQuality)),
    readinessStatus,
    unmappedParts: unmapped
  };
}

export { stripLeadingZeros, normKey };
