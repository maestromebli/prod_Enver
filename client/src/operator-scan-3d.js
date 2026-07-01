/** 3D при скануванні / кліку на Android: збірка зверху, окрема деталь знизу. */

import { api, getStoredToken } from "./api.js";
import { mountPartDetailStripViewer, resolvePartDetailModelContext } from "./part-viewer-mount.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import {
  formatEdgeCodeLabel,
  formatPartDetailSummary,
  formatProjectEdgeMask
} from "@enver/shared/production/part-detail-display.js";
import { formatPartDimensionsMm } from "@enver/shared/production/constructive-package.js";
import { resolveViewerModelUrl } from "./part-viewer-window.js";
import { getOperatorOrder3dViewer, highlightOperatorOrder3dPart } from "./operator-3d.js";
import { escapeHtml } from "./utils.js";
import { renderMappingStatusBadge } from "./3d/enver-3d-space.js";
import { renderEnver3dToolbarHtml, bindEnver3dToolbar } from "./3d/enver-3d-toolbar.js";

let stripDetailViewer = null;
let stripModelCtx = null;
let stripToolbarAbort = null;
let pendingOperatorScan = null;

export function destroyOperatorPartDetailStrip() {
  stripToolbarAbort?.abort();
  stripToolbarAbort = null;
  stripDetailViewer?.destroy?.();
  stripDetailViewer = null;
  const strip = document.getElementById("operatorPartDetailStrip");
  const mount = document.getElementById("operatorPartDetail3dMount");
  const toolbar = document.getElementById("operatorPartDetail3dToolbar");
  const info = document.getElementById("operatorPartDetailInfo");
  if (mount) mount.innerHTML = "";
  if (toolbar) toolbar.remove();
  if (info) info.innerHTML = "";
  if (strip) strip.hidden = true;
}

export function clearPendingOperatorScan() {
  pendingOperatorScan = null;
}

export function setOperatorPartDetailModelContext(ctx) {
  stripModelCtx = ctx;
}

function rememberPendingOperatorScan(data) {
  pendingOperatorScan = data?.part ? data : null;
}

function formatEdgeLabel(part, cadGeometry) {
  if (cadGeometry?.edgeMaskSource === "project" && cadGeometry.edgeMask) {
    return formatProjectEdgeMask(cadGeometry.edgeMask);
  }
  return formatEdgeCodeLabel(part?.edgeCode || part?.edge_code);
}

function formatDims(part, cadGeometry) {
  const panel = cadGeometry?.panelMm;
  if (panel?.dx) return `${panel.dx} × ${panel.dy} × ${panel.dz} мм`;
  return formatPartDimensionsMm(part);
}

function renderHoleRows(cadGeometry) {
  const holes = cadGeometry?.holes || [];
  if (!holes.length) return "";
  const items = holes
    .slice(0, 14)
    .map((h) => {
      const d = h.diameterMm ? `Ø${h.diameterMm}` : "Ø?";
      const pos =
        h.xMm != null && h.yMm != null
          ? `${h.xMm}×${h.yMm}`
          : h.yMm != null && h.zMm != null
            ? `Y${h.yMm} Z${h.zMm}`
            : "—";
      return `<li>${escapeHtml(d)} · ${escapeHtml(pos)} мм</li>`;
    })
    .join("");
  const more =
    holes.length > 14 ? `<li class="enver-meta">…ще ${holes.length - 14} отворів</li>` : "";
  return `<ul class="op-part-detail-holes">${items}${more}</ul>`;
}

function renderPartInfoHtml(data) {
  const p = data.part;
  const cad = data.cadGeometry;
  const summary = formatPartDetailSummary(p);
  const pdfUrl = data.model?.assemblyPdfUrl
    ? resolveViewerModelUrl(data.model.assemblyPdfUrl, getStoredToken())
    : null;

  const mappingBadge = data.model?.mappingStatus
    ? renderMappingStatusBadge(data.model.mappingStatus, data.model.mappingHint)
    : "";

  return `
    <p class="op-part-detail-title"><strong>${escapeHtml(p.partName || "Деталь")}</strong> · №${escapeHtml(p.partNo)}</p>
    ${mappingBadge ? `<p class="op-part-detail-mapping">${mappingBadge}</p>` : ""}
    <dl class="op-part-detail-meta">
      <div><dt>Обʼєкт</dt><dd>${escapeHtml(data.position?.item || data.order?.orderNumber || "—")}</dd></div>
      <div><dt>Блок</dt><dd>${escapeHtml(p.blockCode || "—")}</dd></div>
      <div><dt>Матеріал</dt><dd>${escapeHtml(p.material || "—")}</dd></div>
      <div><dt>Розміри</dt><dd>${escapeHtml(formatDims(p, cad))}</dd></div>
      <div><dt>Кромка</dt><dd>${escapeHtml(formatEdgeLabel(p, cad))}</dd></div>
      ${
        summary.drillingOps?.length
          ? `<div><dt>Сверління</dt><dd>${summary.drillingOps.length} програм</dd></div>`
          : ""
      }
      ${cad?.holeCount ? `<div><dt>Отвори</dt><dd>${cad.holeCount}</dd></div>` : ""}
    </dl>
    ${renderHoleRows(cad)}
    ${
      pdfUrl
        ? `<a class="btn btn-sm" href="${escapeHtml(pdfUrl)}" target="_self" rel="noopener">Креслення збірки</a>`
        : ""
    }`;
}

/** Розмітка нижньої панелі скану — лише дії, без дублювання 3D. */
export function renderScanPartDetailLayout(_data) {
  return `
    <div class="part-detail-card part-detail-card--scan-meta">
      <p class="enver-meta op-scan-detail-hint">Деталь на 3D-панелі нижче · збірка зверху</p>
    </div>`;
}

function resolveModelContext(data) {
  const token = getStoredToken();
  const assemblyCtx = data?.model?.viewerUrl
    ? {
        modelUrl: resolveViewerModelUrl(data.model.viewerUrl, token),
        format: data.model.viewerFormat || "glb",
        parts: data.model.parts || []
      }
    : stripModelCtx;

  const detailCtx = resolvePartDetailModelContext(data?.part, {
    modelPayload: data?.model,
    token,
    assemblyCtx
  });
  if (detailCtx) return detailCtx;

  return assemblyCtx;
}

function mountScanDetailToolbar(mount, viewer) {
  stripToolbarAbort?.abort();
  stripToolbarAbort = new AbortController();
  const { signal } = stripToolbarAbort;

  let toolbar = document.getElementById("operatorPartDetail3dToolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "operatorPartDetail3dToolbar";
    toolbar.className = "op-scan-detail-toolbar enver-3d-toolbar";
    toolbar.innerHTML = renderEnver3dToolbarHtml({
      compact: true,
      showFullscreen: false,
      showParts: false,
      showAdvanced: true
    });
    mount.before(toolbar);
  }

  bindEnver3dToolbar(toolbar, viewer, { signal });
}

function assemblyFallbackFromCtx(modelCtx, data) {
  const token = getStoredToken();
  if (data?.model?.viewerUrl) {
    return {
      modelUrl: resolveViewerModelUrl(data.model.viewerUrl, token),
      format: data.model.viewerFormat || "glb",
      parts: data.model.parts || []
    };
  }
  if (stripModelCtx?.modelUrl) return stripModelCtx;
  if (modelCtx?.isPartModel === false) return modelCtx;
  return null;
}

async function mountStripDetailViewer(part, cadGeometry, modelCtx, data) {
  const mount = document.getElementById("operatorPartDetail3dMount");
  if (!mount || !part || !modelCtx?.modelUrl) return null;

  stripDetailViewer = await mountPartDetailStripViewer(mount, {
    part,
    cadGeometry,
    modelCtx,
    assemblyFallback: assemblyFallbackFromCtx(modelCtx, data),
    token: getStoredToken(),
    pickable: true,
    existingViewer: stripDetailViewer,
    loadingClass: "op-part-detail-3d-loading"
  });

  if (stripDetailViewer) {
    mountScanDetailToolbar(mount, stripDetailViewer);
  }
  return stripDetailViewer;
}

/** Показати окрему деталь знизу (скан або клік на збірці). */
export async function showOperatorPartDetail(data) {
  if (!data?.part) return false;

  const strip = document.getElementById("operatorPartDetailStrip");
  const info = document.getElementById("operatorPartDetailInfo");
  if (!strip || !info) return false;

  let payload = data;
  if ((!data.cadGeometry || !data.cadGeometry.holes?.length) && data.part.id) {
    try {
      payload = await api.getPart(data.part.id);
    } catch {
      /* optional */
    }
  }

  const modelCtx = resolveModelContext(payload);
  if (!modelCtx?.modelUrl && !payload.model?.partModelUrl) return false;

  strip.hidden = false;
  info.innerHTML = renderPartInfoHtml(payload);
  await mountStripDetailViewer(payload.part, payload.cadGeometry, modelCtx, payload);
  strip.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

const MESH_NOT_FOUND_WARNING =
  "3D-модель відкрита, але ця деталь не знайдена в збірці. Перевірте mapping `.project` + `.b3d` або натисніть «Перевірити 3D-звʼязку» у пакеті конструктива.";

/** Підсвітити деталь на загальній 3D-моделі в панелі роботи. */
export async function applyScanToAssembly3d(data) {
  if (!data?.part) {
    return { ok: false, meshName: null, reason: "no_part", mappingStatus: "missing" };
  }
  const viewer = getOperatorOrder3dViewer();
  if (viewer) {
    if (data.cadGeometry) viewer.setCadGeometry?.(data.cadGeometry);
    const hint = resolvePartHighlightMesh(data.part);
    if (viewer.showPartOnAssemblyResult) {
      const result = viewer.showPartOnAssemblyResult(data.part, hint);
      return {
        ok: result.ok,
        meshName: result.meshName,
        mappingStatus: result.mappingStatus,
        reason: result.reason || ""
      };
    }
    const mesh = viewer.showPartOnAssembly?.(data.part, hint);
    if (mesh) {
      return {
        ok: true,
        meshName: mesh.name || hint?.meshName,
        mappingStatus: data.model?.mappingStatus || "exact",
        reason: "mesh_found"
      };
    }
    return {
      ok: false,
      meshName: hint?.meshName || null,
      mappingStatus: data.model?.mappingStatus || "missing",
      reason: "mesh_not_found"
    };
  }
  const highlighted = highlightOperatorOrder3dPart(data.part, { cadGeometry: data.cadGeometry });
  return highlighted?.ok
    ? highlighted
    : { ok: false, meshName: null, reason: "viewer_not_ready", mappingStatus: "missing" };
}

/** Повторно застосувати останній скан після завантаження збірки. */
export async function reapplyPendingOperatorScan3d() {
  if (!pendingOperatorScan?.part) return false;
  await applyScanToAssembly3d(pendingOperatorScan);
  const strip = document.getElementById("operatorPartDetailStrip");
  if (strip && !strip.hidden) {
    await showOperatorPartDetail(pendingOperatorScan);
  }
  return true;
}

/** Після скану: підсвітка зверху + деталь знизу. */
export async function bindScanPartDetail3d(_detailEl, data) {
  const { openOperatorOrder3d } = await import("./operator-3d.js");
  await openOperatorOrder3d({ silent: true });
  rememberPendingOperatorScan(data);
  const assemblyResult = await applyScanToAssembly3d(data);
  await showOperatorPartDetail(data);

  let meshHighlightWarning = "";
  if (data?.model?.viewerUrl && !assemblyResult.ok) {
    if (assemblyResult.mappingStatus === "ambiguous") {
      meshHighlightWarning =
        "Знайдено кілька можливих mesh для цієї деталі. Потрібна перевірка конструктора.";
    } else {
      meshHighlightWarning = MESH_NOT_FOUND_WARNING;
    }
  }

  return { assemblyResult, meshHighlightWarning };
}
