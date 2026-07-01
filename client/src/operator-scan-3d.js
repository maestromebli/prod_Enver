/** 3D при скануванні / кліку на Android: збірка зверху, окрема деталь знизу. */

import { api, getStoredToken } from "./api.js";
import { mountModelViewer, DEFAULT_PART_VIEWER_THEME } from "./part-viewer-mount.js";
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

let stripDetailViewer = null;
let stripModelCtx = null;
let pendingOperatorScan = null;

export function destroyOperatorPartDetailStrip() {
  stripDetailViewer?.destroy?.();
  stripDetailViewer = null;
  const strip = document.getElementById("operatorPartDetailStrip");
  const mount = document.getElementById("operatorPartDetail3dMount");
  const info = document.getElementById("operatorPartDetailInfo");
  if (mount) mount.innerHTML = "";
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

  return `
    <p class="op-part-detail-title"><strong>${escapeHtml(p.partName || "Деталь")}</strong> · №${escapeHtml(p.partNo)}</p>
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
      <div class="part-detail-toolbar">
        <button type="button" class="btn btn-sm part-scan-back" data-part-scan-close>← Назад</button>
      </div>
      <p class="enver-meta op-scan-detail-hint">Деталь на 3D-панелі нижче · збірка зверху</p>
    </div>`;
}

function resolveModelContext(data) {
  if (data?.model?.viewerUrl) {
    return {
      modelUrl: resolveViewerModelUrl(data.model.viewerUrl, getStoredToken()),
      format: data.model.viewerFormat || "glb",
      parts: data.model.parts || []
    };
  }
  return stripModelCtx;
}

function ensureStripDetailView(viewer, part, target, cadGeometry) {
  if (!viewer || !part) return false;
  if (cadGeometry) viewer.setCadGeometry?.(cadGeometry);
  const mesh = viewer.showPartDetail?.(part, target);
  if (mesh) return true;

  const hint = target || resolvePartHighlightMesh(part);
  if (!hint?.meshName && !hint?.nodeId) return false;

  viewer.highlightPart?.({
    meshName: hint.meshName,
    nodeId: hint.nodeId,
    isolate: true,
    ghost: false
  });
  return true;
}

async function mountStripDetailViewer(part, cadGeometry, modelCtx) {
  const mount = document.getElementById("operatorPartDetail3dMount");
  if (!mount || !part || !modelCtx?.modelUrl) return null;

  const target = resolvePartHighlightMesh(part);
  stripDetailViewer?.destroy?.();
  stripDetailViewer = null;
  mount.innerHTML = `<p class="enver-meta op-part-detail-3d-loading">3D деталі…</p>`;

  try {
    stripDetailViewer = await mountModelViewer(mount, {
      url: modelCtx.modelUrl,
      token: getStoredToken(),
      format: modelCtx.format,
      parts: modelCtx.parts,
      theme: DEFAULT_PART_VIEWER_THEME,
      detailOnly: true,
      initialPart: part,
      initialPartHint: target,
      cadGeometry,
      viewerOptions: { pickable: false, detailOnly: true }
    });
    ensureStripDetailView(stripDetailViewer, part, target, cadGeometry);
    return stripDetailViewer;
  } catch {
    mount.innerHTML = `<p class="enver-meta">3D деталі недоступна</p>`;
    return null;
  }
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
  if (!modelCtx?.modelUrl) return false;

  strip.hidden = false;
  info.innerHTML = renderPartInfoHtml(payload);
  await mountStripDetailViewer(payload.part, payload.cadGeometry, modelCtx);
  strip.scrollIntoView({ behavior: "smooth", block: "nearest" });
  return true;
}

/** Підсвітити деталь на загальній 3D-моделі в панелі роботи. */
export async function applyScanToAssembly3d(data) {
  if (!data?.part) return false;
  const viewer = getOperatorOrder3dViewer();
  if (viewer) {
    if (data.cadGeometry) viewer.setCadGeometry?.(data.cadGeometry);
    const mesh = viewer.showPartOnAssembly?.(data.part, resolvePartHighlightMesh(data.part));
    if (mesh) return true;
    const hint = resolvePartHighlightMesh(data.part);
    if (hint?.meshName || hint?.nodeId) {
      viewer.highlightPart?.({
        meshName: hint.meshName,
        nodeId: hint.nodeId,
        ghost: true,
        isolate: false
      });
      return true;
    }
    return false;
  }
  return highlightOperatorOrder3dPart(data.part, { cadGeometry: data.cadGeometry });
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

/** @deprecated використовуйте showOperatorPartDetail */
export function destroyScanPartDetailViewer() {
  destroyOperatorPartDetailStrip();
}

/** Після скану: підсвітка зверху + деталь знизу. */
export async function bindScanPartDetail3d(_detailEl, data) {
  rememberPendingOperatorScan(data);
  await applyScanToAssembly3d(data);
  await showOperatorPartDetail(data);
}
