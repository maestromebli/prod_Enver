import { escapeHtml, $ } from "./utils.js";
import { iconSvg } from "./icons.js";
import { constructivePackageFileUrl, getStoredToken } from "./api.js";
import {
  has3dPreviewFile,
  preview3dLayout,
  preview3dLayoutLabel,
  findPackagePreview3dFile,
  preview3dLoadFormat
} from "@enver/shared/production/constructive-package.js";

let previewViewer = null;

function renderPreviewCaption(detail) {
  const layout = preview3dLayout(detail);
  if (layout === "assembly") {
    const hasWrl = (detail?.files || []).some((f) => f.kind === "wrl_model");
    const fromEnver3 = (detail?.files || []).some((f) => f.kind === "b3d");
    if (hasWrl) {
      return `<p class="b3d-preview-caption enver-meta">Повна 3D-збірка з VRML експорту Базіс (.wrl)</p>`;
    }
    return `<p class="b3d-preview-caption enver-meta">${
      fromEnver3
        ? "Повна 3D-збірка з координат Базіс (ENVER3 у .b3d)"
        : "Повна 3D-збірка"
    }</p>`;
  }
  if (layout === "flat") {
    return `<p class="b3d-preview-caption b3d-preview-caption--flat enver-meta">Розкладка деталей — GibLab .b3d не містить координат збірки. Запустіть у Базісі скрипт <strong>enver-b3d-assembly-export.js</strong> на експортованому .b3d (додає ENVER3), потім перезавантажте файл у пакет. Або завантажте <strong>.wrl</strong> з Базіс.</p>`;
  }
  return "";
}

function renderEmptyState(detail) {
  const hasB3d = (detail?.files || []).some((f) => f.kind === "b3d");
  if (has3dPreviewFile(detail)) return "";

  if (hasB3d) {
    return `<div class="b3d-preview-empty" id="b3dPreviewEmpty">
      ${iconSvg("cube3d", "enver-icon enver-icon--3d")}
      <strong>3D ще не готово</strong>
      <p>Додайте <strong>.project</strong> (Базіс) разом із .b3d — зʼявиться розкладка деталей. Для повної збірки — скрипт <strong>enver-b3d-assembly-export.js</strong> у Базісі або експорт <strong>.wrl</strong>.</p>
    </div>`;
  }

  return `<div class="b3d-preview-empty" id="b3dPreviewEmpty">
    ${iconSvg("cube3d", "enver-icon enver-icon--3d")}
    <strong>Немає 3D-моделі</strong>
    <p>Завантажте <strong>.project</strong> + <strong>.b3d</strong> (GibLab) або <strong>.wrl</strong> (VRML з Базіс). Для збірки з .b3d — скрипт <strong>enver-b3d-assembly-export.js</strong>.</p>
  </div>`;
}

export function renderB3dPreviewModal(detail) {
  const previewFile = findPackagePreview3dFile(detail);
  const b3dFile = (detail?.files || []).find((f) => f.kind === "b3d");
  const wrlFile = (detail?.files || []).find((f) => f.kind === "wrl_model");
  const title =
    previewFile?.originalName || wrlFile?.originalName || b3dFile?.originalName || "Перегляд 3D";
  const layout = preview3dLayout(detail);
  const modeLabel = preview3dLayoutLabel(layout);

  return `
    <div class="modal-backdrop open" id="b3dPreviewModal">
      <div class="modal b3d-preview-modal" role="dialog" aria-label="Перегляд 3D моделі">
        <header class="b3d-preview-head">
          <div>
            <h2>${escapeHtml(modeLabel)}</h2>
            <p class="enver-meta">${escapeHtml(title)}</p>
          </div>
          <button type="button" class="btn btn-sm" id="closeB3dPreviewBtn">Закрити</button>
        </header>
        <div class="b3d-preview-body">
          ${renderPreviewCaption(detail)}
          ${
            previewFile
              ? '<div id="b3dPreviewViewer3d" class="part-viewer-3d b3d-preview-viewer"></div>'
              : renderEmptyState(detail)
          }
        </div>
      </div>
    </div>`;
}

export async function openB3dPreviewModal(positionId, detail) {
  document.body.insertAdjacentHTML("beforeend", renderB3dPreviewModal(detail));

  $("#closeB3dPreviewBtn")?.addEventListener("click", closeB3dPreviewModal);
  $("#b3dPreviewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "b3dPreviewModal") closeB3dPreviewModal();
  });

  const previewFile = findPackagePreview3dFile(detail);
  if (!previewFile || !detail?.package?.id) return;

  const container = $("#b3dPreviewViewer3d");
  if (!container) return;

  container.insertAdjacentHTML(
    "beforeend",
    `<p class="b3d-preview-loading enver-meta">Завантаження моделі…</p>`
  );

  try {
    const { createPartViewerLazy } = await import("./part-viewer-lazy.js");
    previewViewer = await createPartViewerLazy(container);
    const token = getStoredToken();
    const url = constructivePackageFileUrl(positionId, detail.package.id, previewFile.id);
    const format = preview3dLoadFormat(previewFile);
    await previewViewer.loadModel(url, token, { format });
    container.querySelector(".b3d-preview-loading")?.remove();
  } catch {
    container.querySelector(".b3d-preview-loading")?.remove();
    container.insertAdjacentHTML(
      "beforeend",
      `<div class="b3d-preview-empty">
        ${iconSvg("cube3d", "enver-icon enver-icon--3d")}
        <strong>Помилка завантаження</strong>
        <p>Не вдалося відобразити 3D-модель.</p>
      </div>`
    );
  }
}

function closeB3dPreviewModal() {
  previewViewer?.destroy();
  previewViewer = null;
  $("#b3dPreviewModal")?.remove();
}
