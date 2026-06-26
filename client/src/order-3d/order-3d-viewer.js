import { order3dFileUrl } from "./order-3d-api.js";

let viewerInstance = null;

export async function mountOrder3DViewer(container, { orderId, asset }) {
  if (!container || !asset?.webModelUrl) return null;

  container.innerHTML = `<p class="order-3d-viewer-loading enver-meta">Завантаження 3D…</p>`;

  try {
    const { createPartViewerLazy } = await import("../part-viewer-lazy.js");
    viewerInstance?.destroy?.();
    container.innerHTML = "";
    const viewer = await createPartViewerLazy(container);
    const url = order3dFileUrl(orderId, asset.id, "web-model");
    const token = (await import("../api.js")).getStoredToken();
    const format = asset.webModelFormat || "glb";
    await viewer.loadModel(url, token, { format });
    viewerInstance = viewer;
    return viewer;
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
