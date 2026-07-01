import { resolvePartMappingStatus } from "@enver/shared/production/part-model-mapping.js";

/**
 * Стандартизований результат підсвітки деталі в збірці.
 * @param {object} params
 */
export function buildHighlightResult({
  ok,
  mesh = null,
  meshName = null,
  nodeId = null,
  part = null,
  mappingStatus = null,
  reason = null
}) {
  const mapping = part && !mappingStatus ? resolvePartMappingStatus(part) : null;
  const status = mappingStatus || mapping?.mappingStatus || (ok ? "exact" : "missing");

  return {
    ok: Boolean(ok),
    meshName: mesh?.name || meshName || null,
    nodeId: nodeId || mesh?.name || mapping?.resolvedNodeId || null,
    partId: part?.id ?? null,
    mappingStatus: status,
    mappingConfidence: mapping?.mappingConfidence ?? (ok ? 100 : 0),
    mappingHint: mapping?.mappingHint ?? null,
    reason:
      reason || (ok ? "mesh_found" : status === "ambiguous" ? "ambiguous_mesh" : "mesh_not_found")
  };
}

/**
 * @param {import('three').Object3D} model
 * @param {(part: object) => THREE.Mesh[]} meshesForPart
 * @param {object} part
 * @param {object | null} targetHint
 * @param {(hint: object) => THREE.Mesh | null} resolveMesh
 */
export function detectAmbiguousMeshes(model, meshesForPart, part, targetHint, resolveMesh) {
  if (!model || !part) return false;
  const fromHint = resolveMesh(targetHint || {});
  if (fromHint) return false;
  const targets = meshesForPart(part);
  return targets.length > 1;
}
