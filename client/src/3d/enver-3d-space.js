/**
 * Фасад 3D-простору ENVER — re-export для operator / constructive / viewer.
 */
export {
  MAPPING_STATUS_LABELS,
  MAPPING_STATUS_CSS,
  PRODUCTION_STATUS_COLORS,
  CAMERA_PRESET_IDS,
  DIAGNOSTICS_READINESS_API
} from "./enver-3d-types.js";

export { tintMaterialForStatus, pulseEmissiveIntensity } from "./enver-3d-materials.js";
export { createCameraAnimator, EXTENDED_CAMERA_PRESETS } from "./enver-3d-camera.js";
export { buildHighlightResult, detectAmbiguousMeshes } from "./enver-3d-selection.js";
export { renderEnver3dToolbarHtml, bindEnver3dToolbar } from "./enver-3d-toolbar.js";

import { MAPPING_STATUS_LABELS, MAPPING_STATUS_CSS } from "./enver-3d-types.js";
import { escapeHtml } from "../utils.js";

/** HTML-бейдж статусу 3D-звʼязки. */
export function renderMappingStatusBadge(status, hint = "") {
  const label = MAPPING_STATUS_LABELS[status] || status || "—";
  const cls = MAPPING_STATUS_CSS[status] || "enver-3d-badge--missing";
  const title = hint ? ` title="${escapeHtml(hint)}"` : "";
  return `<span class="enver-3d-badge ${cls}"${title}>${escapeHtml(label)}</span>`;
}
