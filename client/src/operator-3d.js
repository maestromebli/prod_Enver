import { api } from "./api.js";
import { highlightPartInViewerWindow, openOrderViewerWindow } from "./part-viewer-window.js";

let order3dReady = false;
let order3dOrderId = null;
let order3dPositionId = null;

export function destroyOperatorOrder3d() {
  order3dReady = false;
  order3dOrderId = null;
  order3dPositionId = null;
  const section = document.getElementById("operatorOrder3dSection");
  const mount = document.getElementById("operatorOrder3dMount");
  if (section) section.hidden = true;
  if (mount) mount.innerHTML = "";
}

export function getOperatorOrder3dViewer() {
  return null;
}

export function highlightOperatorOrder3dPart(part) {
  return highlightPartInViewerWindow(part);
}

export function openOperatorOrder3dWindow() {
  if (!order3dReady || !order3dOrderId) return null;
  const popup = openOrderViewerWindow(order3dOrderId, order3dPositionId);
  if (!popup) {
    import("./toast.js").then(({ toastError }) => {
      toastError("Дозвольте спливаючі вікна для 3D перегляду");
    });
  }
  return popup;
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
  mount.innerHTML = `<p class="op-order-3d-hint enver-meta">3D модель відкривається в окремому вікні</p>`;
  if (openBtn) openBtn.hidden = true;

  try {
    const data = await api.getOrder3DAsset(orderId);
    const asset = data?.asset;
    const isReady =
      asset && (asset.status === "READY" || asset.status === "PARTIAL_READY") && asset.webModelUrl;

    if (!isReady) {
      section.hidden = true;
      mount.innerHTML = "";
      return;
    }

    order3dReady = true;
    order3dOrderId = orderId;
    order3dPositionId = positionId || null;
    if (openBtn) openBtn.hidden = false;
  } catch {
    section.hidden = true;
    mount.innerHTML = "";
  }
}
