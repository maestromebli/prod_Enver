import { api, constructivePackageFileUrl, getStoredToken } from "./api.js";
import { mountModelViewer } from "./part-viewer-mount.js";
import { resolve3dPreviewContext } from "@enver/shared/production/resolve-3d-preview.js";
import { order3dFileUrl } from "./order-3d/order-3d-api.js";
import {
  highlightPartInViewerWindow,
  openOrderViewerWindow,
  resolveViewerModelUrl
} from "./part-viewer-window.js";
import { renderPreview3dBadge, renderPreview3dUpgradeBanner } from "./preview-3d-ui.js";
import { escapeHtml } from "./utils.js";

let viewerInstance = null;
let order3dOrderId = null;
let order3dPositionId = null;

export function destroyOperatorOrder3d() {
  viewerInstance?.destroy?.();
  viewerInstance = null;
  order3dOrderId = null;
  order3dPositionId = null;
  const section = document.getElementById("operatorOrder3dSection");
  const mount = document.getElementById("operatorOrder3dMount");
  const badge = document.getElementById("operatorOrder3dBadge");
  if (section) section.hidden = true;
  if (mount) mount.innerHTML = "";
  if (badge) badge.remove();
}

export function getOperatorOrder3dViewer() {
  return viewerInstance;
}

async function loadOperator3dContext(orderId, positionId) {
  let orderAsset = null;
  let packageDetail = null;

  try {
    const data = await api.getOrder3DAsset(orderId);
    orderAsset = data?.asset || null;
  } catch {
    /* немає order-3d */
  }

  if (positionId) {
    try {
      packageDetail = await api.getConstructivePackageLatest(positionId);
    } catch {
      /* немає пакета */
    }
  }

  let packageViewerUrl = null;
  const previewFile = packageDetail?.package?.id
    ? resolve3dPreviewContext({ orderAsset, packageDetail }).packageFile
    : null;
  if (previewFile && packageDetail?.package?.id && positionId) {
    packageViewerUrl = constructivePackageFileUrl(
      positionId,
      packageDetail.package.id,
      previewFile.id
    );
  }

  const ctx = resolve3dPreviewContext({ orderAsset, packageDetail, packageViewerUrl });
  if (!ctx.available) return null;

  if (ctx.source === "order_3d" && orderAsset) {
    ctx.modelUrl = order3dFileUrl(orderId, orderAsset.id, "web-model");
  }

  ctx.parts = packageDetail?.parts || [];
  return ctx;
}

function updateOperator3dBadge(section, ctx) {
  let badge = document.getElementById("operatorOrder3dBadge");
  const head = section?.querySelector(".op-order-3d-head");
  if (!head || !ctx?.layout) return;

  const html = renderPreview3dBadge(ctx.layout, ctx.layoutLabel);
  if (!html) return;

  if (!badge) {
    badge = document.createElement("span");
    badge.id = "operatorOrder3dBadge";
    badge.className = "op-order-3d-badge";
    const title = head.querySelector(".op-section-title");
    if (title?.parentElement) {
      title.insertAdjacentElement("afterend", badge);
    } else {
      head.prepend(badge);
    }
  }
  badge.innerHTML = html;
}

export function highlightOperatorOrder3dPart(part) {
  if (viewerInstance && part) {
    viewerInstance.highlightPart({
      part,
      meshName: part.modelMeshName,
      nodeId: part.modelNodeId
    });
    return true;
  }
  return highlightPartInViewerWindow(part);
}

export function openOperatorOrder3dWindow() {
  const container = document.getElementById("operatorOrder3dViewer");
  if (container?.requestFullscreen) {
    void container.requestFullscreen().catch(() => {
      if (order3dOrderId) openOrderViewerWindow(order3dOrderId, order3dPositionId);
    });
    return container;
  }
  if (!order3dOrderId) return null;
  return openOrderViewerWindow(order3dOrderId, order3dPositionId);
}

export async function bindOperatorOrder3d() {
  destroyOperatorOrder3d();

  const mount = document.getElementById("operatorOrder3dMount");
  const section = document.getElementById("operatorOrder3dSection");
  const openBtn = document.getElementById("operatorOpen3dBtn");
  if (!mount || !section) return;

  const orderId = Number(mount.dataset.orderId) || 0;
  const positionId = Number(mount.dataset.positionId) || 0;
  if (!orderId) {
    section.hidden = true;
    return;
  }

  section.hidden = false;
  mount.innerHTML = `<p class="op-order-3d-loading enver-meta">Завантаження 3D…</p>`;
  if (openBtn) openBtn.hidden = true;

  try {
    const ctx = await loadOperator3dContext(orderId, positionId);
    if (!ctx?.modelUrl) {
      section.hidden = true;
      mount.innerHTML = "";
      return;
    }

    order3dOrderId = orderId;
    order3dPositionId = positionId || null;

    updateOperator3dBadge(section, ctx);

    mount.innerHTML = `
      ${renderPreview3dUpgradeBanner(ctx.upgradeHint)}
      <div id="operatorOrder3dViewer" class="op-order-3d-viewer part-viewer-3d" role="img" aria-label="${escapeHtml(ctx.layoutLabel || "3D модель")}"></div>
    `;

    const container = document.getElementById("operatorOrder3dViewer");
    const token = getStoredToken();
    viewerInstance = await mountModelViewer(container, {
      url: resolveViewerModelUrl(ctx.modelUrl, token),
      token,
      format: ctx.format,
      parts: ctx.parts,
      theme: "studio",
      viewerOptions: { pickable: true }
    });

    if (openBtn) {
      openBtn.hidden = false;
      openBtn.textContent = "На весь екран";
    }
  } catch {
    section.hidden = true;
    mount.innerHTML = "";
    viewerInstance = null;
  }
}
