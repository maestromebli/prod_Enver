import { escapeHtml } from "../utils.js";
import { iconSvg } from "../icons.js";
import { renderOrder3DUploadZone } from "./order-3d-upload.js";
import { renderOrder3DStatusCard } from "./order-3d-status-card.js";
import { renderOrder3DFilesCard } from "./order-3d-files-card.js";
import {
  canDelete3DAsset,
  canRetry3DConversion,
  canUpload3DAsset,
  canDownloadWebModel
} from "./order-3d-permissions.js";
import { order3dFileUrl } from "./order-3d-api.js";

export function renderOrder3DTab(order, asset) {
  const orderId = order.id;
  const hasAsset = Boolean(asset?.id);
  const isReady =
    (asset?.status === "READY" || asset?.status === "PARTIAL_READY") && asset?.webModelUrl;
  const isConverting = asset?.status === "CONVERTING";
  const isFailed = asset?.status === "FAILED";
  const isManual =
    asset?.status === "NEED_MANUAL_CHECK" || asset?.status === "NEED_MANUAL_RESEARCH";

  if (!hasAsset) {
    return `<section class="order-3d-tab" data-order-3d-tab>
      <div class="order-3d-empty">
        ${iconSvg("cube3d", "enver-icon enver-icon--3d order-3d-empty-icon")}
        <h3 class="enver-section-title">3D модель</h3>
        <p class="order-3d-empty-text">Завантажте файл БАЗІС .b3d</p>
        <p class="enver-meta">Система збереже оригінал, проаналізує B3D і створить .glb для перегляду в браузері</p>
      </div>
      ${renderOrder3DUploadZone()}
    </section>`;
  }

  const toolbar = isReady
    ? `<div class="order-3d-toolbar">
        <button type="button" class="btn btn-sm" data-order-3d-fullscreen>На весь екран</button>
        <button type="button" class="btn btn-sm" data-order-3d-reset-cam>Скинути камеру</button>
        ${
          canDownloadWebModel() && asset.webModelUrl
            ? `<a class="btn btn-sm" href="${escapeHtml(order3dFileUrl(orderId, asset.id, "web-model"))}" download>Завантажити web-модель</a>`
            : ""
        }
      </div>`
    : "";

  const actions = [];
  if (isFailed && canRetry3DConversion()) {
    actions.push(
      `<button type="button" class="btn btn-sm btn-primary" data-order-3d-retry>Повторити обробку</button>`
    );
  }
  if ((isFailed || isManual) && canUpload3DAsset()) {
    actions.push(
      `<button type="button" class="btn btn-sm" data-order-3d-reupload>Завантажити новий файл</button>`
    );
  }
  if (isManual && canUpload3DAsset()) {
    actions.push(
      `<button type="button" class="btn btn-sm" data-order-3d-glb-upload>Завантажити .glb</button>`
    );
  }
  if (isFailed && canUpload3DAsset()) {
    actions.push(
      `<button type="button" class="btn btn-sm btn-link" data-order-3d-constructor>Передати конструктору</button>`
    );
  }
  if (canDelete3DAsset()) {
    actions.push(
      `<button type="button" class="btn btn-sm btn-danger" data-order-3d-delete>Видалити</button>`
    );
  }

  return `<section class="order-3d-tab" data-order-3d-tab data-order-3d-asset-id="${asset.id}">
    <div class="order-3d-layout">
      <div class="order-3d-main">
        ${renderOrder3DStatusCard(asset, orderId)}
        ${
          isReady
            ? `<div class="order-3d-viewer-wrap card">
                <div id="order3dViewer" class="order-3d-viewer part-viewer-3d"></div>
                ${toolbar}
              </div>`
            : isConverting
              ? ""
              : renderOrder3DUploadZone()
        }
        ${actions.length ? `<div class="order-3d-actions">${actions.join("")}</div>` : ""}
      </div>
      ${renderOrder3DFilesCard(orderId, asset)}
    </div>
    <input type="file" id="order3dGlbInput" accept=".glb,.gltf" hidden />
    <input type="file" id="order3dReuploadInput" accept=".b3d,.glb,.gltf,.obj,.wrl,.stl,.jpg,.png" hidden />
  </section>`;
}
