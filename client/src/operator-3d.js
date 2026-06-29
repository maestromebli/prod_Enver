import { api, getStoredToken } from "./api.js";
import { createPartViewerLazy } from "./part-viewer-lazy.js";
import { order3dFileUrl } from "./order-3d/order-3d-api.js";
import { resolveHighlightTarget } from "./part-scan.js";

let viewer = null;
let loadSeq = 0;

export function destroyOperatorOrder3d() {
  viewer?.destroy?.();
  viewer = null;
}

export function getOperatorOrder3dViewer() {
  return viewer;
}

export function highlightOperatorOrder3dPart(part) {
  if (!viewer || !part) return false;
  const target = resolveHighlightTarget(part);
  if (!target) return false;
  viewer.highlightPart({ meshName: target.meshName, nodeId: target.nodeId, ghost: true });
  return true;
}

export async function bindOperatorOrder3d() {
  destroyOperatorOrder3d();

  const mount = document.getElementById("operatorOrder3dMount");
  const section = document.getElementById("operatorOrder3dSection");
  if (!mount || !section) return;

  const orderId = Number(mount.dataset.orderId) || 0;
  const positionId = Number(mount.dataset.positionId) || 0;
  if (!orderId) {
    section.hidden = true;
    return;
  }

  const seq = ++loadSeq;
  section.hidden = false;
  mount.innerHTML = `<p class="op-order-3d-loading enver-meta">Завантаження 3D…</p>`;

  try {
    const data = await api.getOrder3DAsset(orderId);
    if (seq !== loadSeq) return;

    const asset = data?.asset;
    const isReady =
      asset && (asset.status === "READY" || asset.status === "PARTIAL_READY") && asset.webModelUrl;

    if (!isReady) {
      section.hidden = true;
      mount.innerHTML = "";
      return;
    }

    mount.innerHTML = `<div class="part-viewer-3d op-order-3d-viewer" data-part-viewer></div>`;
    const resetBtn = document.getElementById("operatorOrder3dResetCam");
    if (resetBtn) resetBtn.hidden = false;

    viewer = await createPartViewerLazy(mount.querySelector("[data-part-viewer]"));
    const url = order3dFileUrl(orderId, asset.id, "web-model");
    await viewer.loadModel(url, getStoredToken(), { format: asset.webModelFormat || "glb" });

    if (positionId) {
      try {
        const pkg = await api.getConstructivePackageLatest(positionId);
        if (seq === loadSeq && pkg?.parts?.length) {
          viewer.setPartCatalog(pkg.parts);
        }
      } catch {
        /* каталог необовʼязковий */
      }
    }
  } catch {
    if (seq === loadSeq) {
      section.hidden = true;
      mount.innerHTML = "";
    }
  }
}
