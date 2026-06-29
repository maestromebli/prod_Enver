import { api } from "../api.js";
import { state } from "../state.js";
import { toastSuccess } from "../toast.js";
import { runSave } from "../save-flow.js";
import { bindOrder3DUploadZone } from "./order-3d-upload.js";
import {
  destroyOrder3DViewer,
  enterOrder3DViewerFullscreen,
  mountOrder3DViewer,
  resetOrder3DViewerCamera
} from "./order-3d-viewer.js";
import { readFileAsBase64 } from "../file-upload-zone.js";

let pollTimer = null;

function cacheKey(orderId) {
  return String(orderId);
}

export function getCachedOrder3DAsset(orderId) {
  return state.ordersView.order3dAssets?.[cacheKey(orderId)] ?? null;
}

export function setCachedOrder3DAsset(orderId, asset) {
  state.ordersView.order3dAssets = {
    ...(state.ordersView.order3dAssets || {}),
    [cacheKey(orderId)]: asset
  };
}

export async function loadOrder3DAsset(orderId) {
  const data = await api.getOrder3DAsset(orderId);
  setCachedOrder3DAsset(orderId, data?.asset || null);
  return data?.asset || null;
}

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

function startPolling(orderId, onRefresh) {
  stopPolling();
  pollTimer = setInterval(async () => {
    try {
      const asset = await loadOrder3DAsset(orderId);
      if (!asset || asset.status !== "CONVERTING") {
        stopPolling();
        onRefresh?.({ contentOnly: true });
      }
    } catch {
      stopPolling();
    }
  }, 2000);
}

export function bindOrder3DTab(root, order, { onRefresh } = {}) {
  const orderId = order.id;
  const panel = root.querySelector("[data-order-3d-tab]");
  if (!panel) return;

  const asset = getCachedOrder3DAsset(orderId);

  if ((asset?.status === "READY" || asset?.status === "PARTIAL_READY") && asset?.webModelUrl) {
    const viewerEl = panel.querySelector("#order3dViewer");
    if (viewerEl) {
      mountOrder3DViewer(viewerEl, { orderId, asset, order });
    }
  }

  if (asset?.status === "CONVERTING") {
    startPolling(orderId, onRefresh);
  } else {
    stopPolling();
  }

  bindOrder3DUploadZone(panel, {
    onUpload: async (payload) => {
      await runSave("Завантаження 3D", {
        saveFn: () => api.uploadOrder3DAsset(orderId, payload),
        successMessage: "Файл завантажено",
        onSuccess: async (res) => {
          setCachedOrder3DAsset(orderId, res?.asset || null);
          await onRefresh?.({ contentOnly: true });
        }
      }).catch(() => {});
    }
  });

  panel.querySelector("[data-order-3d-fullscreen]")?.addEventListener("click", () => {
    enterOrder3DViewerFullscreen(panel.querySelector("#order3dViewer"));
  });

  panel.querySelector("[data-order-3d-reset-cam]")?.addEventListener("click", () => {
    resetOrder3DViewerCamera();
  });

  panel.querySelector("[data-order-3d-retry]")?.addEventListener("click", async () => {
    const assetId = Number(panel.dataset.order3dAssetId);
    await runSave("Повтор обробки", {
      saveFn: () => api.retryOrder3DConversion(orderId, assetId),
      successMessage: "Обробку перезапущено",
      onSuccess: async (res) => {
        setCachedOrder3DAsset(orderId, res?.asset || null);
        await onRefresh?.({ contentOnly: true });
      }
    }).catch(() => {});
  });

  panel.querySelector("[data-order-3d-delete]")?.addEventListener("click", async () => {
    const assetId = Number(panel.dataset.order3dAssetId);
    if (!assetId || !confirm("Видалити 3D-модель замовлення?")) return;
    await runSave("Видалення 3D", {
      saveFn: () => api.deleteOrder3DAsset(orderId, assetId),
      successMessage: "3D-модель видалено",
      onSuccess: async () => {
        setCachedOrder3DAsset(orderId, null);
        destroyOrder3DViewer();
        await onRefresh?.({ contentOnly: true });
      }
    }).catch(() => {});
  });

  panel.querySelector("[data-order-3d-reupload]")?.addEventListener("click", () => {
    panel.querySelector("#order3dReuploadInput")?.click();
  });

  panel.querySelector("#order3dReuploadInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const dataBase64 = await readFileAsBase64(file);
    await runSave("Завантаження 3D", {
      saveFn: () =>
        api.uploadOrder3DAsset(orderId, {
          fileName: file.name,
          mime: file.type || "application/octet-stream",
          dataBase64
        }),
      successMessage: "Файл завантажено",
      onSuccess: async (res) => {
        setCachedOrder3DAsset(orderId, res?.asset || null);
        await onRefresh?.({ contentOnly: true });
      }
    }).catch(() => {});
  });

  panel.querySelector("[data-order-3d-glb-upload]")?.addEventListener("click", () => {
    panel.querySelector("#order3dGlbInput")?.click();
  });

  panel.querySelector("#order3dGlbInput")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const assetId = Number(panel.dataset.order3dAssetId);
    const dataBase64 = await readFileAsBase64(file);
    await runSave("Завантаження GLB", {
      saveFn: () =>
        api.uploadOrder3DWebModel(orderId, assetId, {
          fileName: file.name,
          mime: file.type || "model/gltf-binary",
          dataBase64
        }),
      successMessage: "Web-модель завантажено",
      onSuccess: async (res) => {
        setCachedOrder3DAsset(orderId, res?.asset || null);
        await onRefresh?.({ contentOnly: true });
      }
    }).catch(() => {});
  });

  panel.querySelector("[data-order-3d-constructor]")?.addEventListener("click", async () => {
    const { openConstructorDeskForAssignment } = await import("../constructor-desk.js");
    await openConstructorDeskForAssignment({ orderId });
    toastSuccess("Відкрито стіл конструктора");
  });
}

export function teardownOrder3DTab() {
  stopPolling();
  destroyOrder3DViewer();
}
