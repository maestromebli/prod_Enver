/** 3D при скануванні на Android / operator-client: збірка зверху, деталь знизу. */

import { getStoredToken } from "./api.js";
import { mountModelViewer } from "./part-viewer-mount.js";
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

let detailViewer = null;
let _detailMountEl = null;

export function destroyScanPartDetailViewer() {
  detailViewer?.destroy?.();
  detailViewer = null;
  _detailMountEl = null;
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
    .slice(0, 12)
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
    holes.length > 12 ? `<li class="enver-meta">…ще ${holes.length - 12} отворів</li>` : "";
  return `<ul class="op-scan-part-holes">${items}${more}</ul>`;
}

/** Розмітка нижньої панелі: 3D деталі + метадані. */
export function renderScanPartDetailLayout(data) {
  const p = data.part;
  const cad = data.cadGeometry;
  const summary = formatPartDetailSummary(p);
  const pdfUrl = data.model?.assemblyPdfUrl
    ? resolveViewerModelUrl(data.model.assemblyPdfUrl, getStoredToken())
    : null;

  return `
    <div class="op-scan-part-workspace">
      <div class="op-scan-part-3d-wrap">
        <div id="operatorScanPart3dMount" class="op-scan-part-3d part-viewer-3d" role="img" aria-label="3D деталі"></div>
      </div>
      <div class="op-scan-part-info">
        <p class="op-scan-part-title"><strong>${escapeHtml(p.partName || "Деталь")}</strong> · №${escapeHtml(p.partNo)}</p>
        <dl class="op-scan-part-meta">
          <div><dt>Обʼєкт</dt><dd>${escapeHtml(data.position?.item || data.order?.orderNumber || "—")}</dd></div>
          <div><dt>Блок</dt><dd>${escapeHtml(p.blockCode || "—")}</dd></div>
          <div><dt>Матеріал</dt><dd>${escapeHtml(p.material || "—")}</dd></div>
          <div><dt>Товщина / розміри</dt><dd>${escapeHtml(formatDims(p, cad))}</dd></div>
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
        }
      </div>
    </div>`;
}

async function mountPartDetailViewer(container, data) {
  if (!container || !data?.model?.viewerUrl) return null;

  destroyScanPartDetailViewer();
  _detailMountEl = container;

  const token = getStoredToken();
  const url = resolveViewerModelUrl(data.model.viewerUrl, token);
  detailViewer = await mountModelViewer(container, {
    url,
    token,
    format: data.model.viewerFormat || "glb",
    parts: data.model.parts || [],
    theme: "studio",
    viewerOptions: { pickable: false }
  });

  if (data.cadGeometry) detailViewer.setCadGeometry?.(data.cadGeometry);
  const target = resolvePartHighlightMesh(data.part);
  detailViewer.showPartDetail?.(data.part, target);
  return detailViewer;
}

/** Підсвітити деталь на загальній 3D-моделі в панелі роботи. */
export async function applyScanToAssembly3d(data) {
  if (!data?.part) return false;
  const viewer = getOperatorOrder3dViewer();
  if (viewer) {
    if (data.cadGeometry) viewer.setCadGeometry?.(data.cadGeometry);
    viewer.showPartOnAssembly?.(data.part, resolvePartHighlightMesh(data.part));
    document.getElementById("operatorOrder3dSection")?.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
    return true;
  }
  return highlightOperatorOrder3dPart(data.part);
}

/** Змонтувати 3D деталі в панелі результату скану. */
export async function bindScanPartDetail3d(detailEl, data) {
  if (!detailEl || !data?.model?.viewerUrl) return;
  const mount = detailEl.querySelector("#operatorScanPart3dMount");
  if (!mount) return;
  mount.innerHTML = `<p class="enver-meta op-scan-part-3d-loading">3D деталі…</p>`;
  try {
    await mountPartDetailViewer(mount, data);
  } catch {
    mount.innerHTML = `<p class="enver-meta">3D деталі недоступна</p>`;
  }
}
