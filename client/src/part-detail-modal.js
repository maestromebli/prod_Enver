import { escapeHtml, $ } from "./utils.js";
import { constructivePackageFileUrl, getStoredToken } from "./api.js";
import {
  findPackagePreview3dFile,
  formatPartDimensionsMm,
  preview3dLoadFormat
} from "@enver/shared/production/constructive-package.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import { formatPartDetailSummary } from "@enver/shared/production/part-detail-display.js";

let detailViewer = null;

function renderOperationList(codes, emptyLabel) {
  if (!codes?.length) {
    return `<p class="enver-meta part-detail-empty">${escapeHtml(emptyLabel)}</p>`;
  }
  return `<ul class="part-detail-ops">${codes
    .map((c) => `<li><code>${escapeHtml(c)}</code></li>`)
    .join("")}</ul>`;
}

export function renderPartDetailModal(part, { positionLabel = "" } = {}) {
  const summary = formatPartDetailSummary(part);
  const title = [part.blockCode, part.partNo ? `№${part.partNo}` : "", part.partName]
    .filter(Boolean)
    .join(" · ");

  return `
    <div class="modal-backdrop open" id="partDetailModal">
      <div class="modal part-detail-modal" role="dialog" aria-label="Деталь ${escapeHtml(part.partName || "")}">
        <header class="part-detail-head">
          <div>
            <h2>${escapeHtml(title || "Деталь")}</h2>
            ${positionLabel ? `<p class="enver-meta">${escapeHtml(positionLabel)}</p>` : ""}
            <p class="enver-meta">${escapeHtml(part.material || "")} · ${escapeHtml(formatPartDimensionsMm(part))}</p>
          </div>
          <button type="button" class="btn btn-sm" id="closePartDetailBtn">Закрити</button>
        </header>
        <div class="part-detail-body">
          <div class="part-detail-viewer-col">
            <div id="partDetailViewer3d" class="part-viewer-3d part-detail-viewer"></div>
            <p class="enver-meta part-detail-viewer-hint">Зелені ребра — сторони з кромкою · Помаранчеві точки — зони сверління</p>
          </div>
          <aside class="part-detail-aside">
            <section class="part-detail-section part-detail-section--edge">
              <h3>Кромка</h3>
              <p class="part-detail-edge-code">${escapeHtml(summary.edgeLabel)}</p>
              ${
                summary.edgedSides
                  ? `<p class="enver-meta">${summary.edgedSides} стор. кромкується</p>`
                  : ""
              }
            </section>
            <section class="part-detail-section part-detail-section--drill">
              <h3>Сверління</h3>
              ${renderOperationList(summary.drillingOps, "Немає окремих програм сверління")}
            </section>
            <section class="part-detail-section part-detail-section--ops">
              <h3>Операції ЧПК (лице 1)</h3>
              ${renderOperationList(summary.edgingOps, "Немає програм кромки / вертикалі")}
            </section>
            <div class="part-detail-toolbar-actions">
              <button type="button" class="btn btn-sm" id="partDetailResetCam">Скинути камеру</button>
            </div>
          </aside>
        </div>
      </div>
    </div>`;
}

function closePartDetailModal() {
  detailViewer?.destroy?.();
  detailViewer = null;
  $("#partDetailModal")?.remove();
}

/**
 * Відкриває деталь окремо: ізольований 3D, кромка та сверління.
 */
export async function openPartDetailModal(positionId, detail, part) {
  if (!part || !detail?.package?.id) return;

  const previewFile = findPackagePreview3dFile(detail);
  if (!previewFile) return;

  document.body.insertAdjacentHTML(
    "beforeend",
    renderPartDetailModal(part, {
      positionLabel: detail.positionItem || ""
    })
  );

  $("#closePartDetailBtn")?.addEventListener("click", closePartDetailModal);
  $("#partDetailModal")?.addEventListener("click", (e) => {
    if (e.target.id === "partDetailModal") closePartDetailModal();
  });
  $("#partDetailResetCam")?.addEventListener("click", () => detailViewer?.resetCamera?.());

  const container = $("#partDetailViewer3d");
  if (!container) return;

  container.insertAdjacentHTML(
    "beforeend",
    `<p class="b3d-preview-loading enver-meta">Завантаження деталі…</p>`
  );

  try {
    const { mountModelViewer } = await import("./part-viewer-mount.js");
    detailViewer = await mountModelViewer(container, {
      url: constructivePackageFileUrl(positionId, detail.package.id, previewFile.id),
      token: getStoredToken(),
      format: preview3dLoadFormat(previewFile),
      parts: detail.parts || []
    });
    container.querySelector(".b3d-preview-loading")?.remove();

    const target = resolvePartHighlightMesh(part);
    if (target && detailViewer?.showPartDetail) {
      detailViewer.showPartDetail(part, target);
    } else if (target) {
      detailViewer?.isolatePart?.(target.meshName);
    }
  } catch {
    container.querySelector(".b3d-preview-loading")?.remove();
    container.insertAdjacentHTML(
      "beforeend",
      `<p class="form-error visible">Не вдалося завантажити 3D деталі</p>`
    );
  }
}
