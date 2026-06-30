import { order3dFileUrl } from "./order-3d-api.js";
import { api } from "../api.js";
import { state } from "../state.js";
import { DEFAULT_PART_VIEWER_THEME } from "../part-viewer-mount.js";

let viewerInstance = null;

async function loadOrderConstructiveParts(order) {
  if (!order?.id) return [];
  const { getWorkPositions } = await import("@enver/shared/production/order-position-model.js");
  const related = state.positions.filter((p) => p.orderId === order.id);
  const work = getWorkPositions(order, related);
  const parts = [];
  for (const pos of work) {
    try {
      const detail = await api.getConstructivePackageLatest(pos.id);
      if (detail?.parts?.length) parts.push(...detail.parts);
    } catch {
      /* пакет може бути відсутній */
    }
  }
  return parts;
}

export async function mountOrder3DViewer(container, { orderId, asset, order, parts } = {}) {
  if (!container || !asset?.webModelUrl) return null;

  container.innerHTML = `<p class="order-3d-viewer-loading enver-meta">Завантаження 3D…</p>`;

  try {
    viewerInstance?.destroy?.();
    const { mountModelViewer } = await import("../part-viewer-mount.js");
    const { getStoredToken } = await import("../api.js");
    const url = order3dFileUrl(orderId, asset.id, "web-model");
    const catalog = parts?.length ? parts : await loadOrderConstructiveParts(order);

    container.innerHTML = "";
    viewerInstance = await mountModelViewer(container, {
      url,
      token: getStoredToken(),
      format: asset.webModelFormat || "glb",
      parts: catalog,
      theme: DEFAULT_PART_VIEWER_THEME,
      viewerOptions: { pickable: false }
    });
    return viewerInstance;
  } catch (err) {
    const msg = err?.message?.includes("геометрії")
      ? "VRML без видимої геометрії"
      : "Не вдалося завантажити 3D-модель";
    container.innerHTML = `<p class="order-3d-viewer-error">${msg}</p>`;
    return null;
  }
}

export function destroyOrder3DViewer() {
  viewerInstance?.destroy?.();
  viewerInstance = null;
}

export function resetOrder3DViewerCamera() {
  viewerInstance?.resetCamera?.();
}

export async function enterOrder3DViewerFullscreen(container) {
  const el = container?.closest(".order-3d-viewer-wrap") || container;
  if (!el) return;
  if (document.fullscreenElement) {
    await document.exitFullscreen();
  } else {
    await el.requestFullscreen?.();
  }
}
