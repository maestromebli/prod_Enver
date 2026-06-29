import "./styles/design-system.css";
import "./styles/tokens.css";
import "./styles/brand-logo.css";
import "./styles/viewer-window.css";
import "./styles/part-viewer.css";
import { api, apiUrl, getStoredToken } from "./api.js";
import { mountModelViewer } from "./part-viewer-mount.js";
import { order3dFileUrl } from "./order-3d/order-3d-api.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";

let viewer = null;
let currentPart = null;

function resolveHighlightTarget(part) {
  return resolvePartHighlightMesh(part);
}

function modelFileUrl(viewerUrl) {
  if (!viewerUrl) return null;
  const token = getStoredToken();
  const q = token
    ? (viewerUrl.includes("?") ? "&" : "?") + `access_token=${encodeURIComponent(token)}`
    : "";
  return (
    apiUrl(viewerUrl.startsWith("http") ? viewerUrl : viewerUrl) +
    (viewerUrl.startsWith("http") ? "" : q)
  );
}

function setError(message) {
  const el = document.getElementById("viewerError");
  const loading = document.getElementById("viewerLoading");
  if (loading) loading.hidden = true;
  if (el) {
    el.textContent = message;
    el.hidden = !message;
  }
}

function setTitle(text) {
  const el = document.getElementById("viewerTitle");
  if (el) el.textContent = text || "3D модель";
  document.title = text ? `${text} — ENVER 3D` : "ENVER — 3D перегляд";
}

function bindToolbar() {
  const toolbar = document.getElementById("viewerToolbar");
  toolbar?.removeAttribute("hidden");
  toolbar?.querySelectorAll("[data-viewer-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.viewerAction;
      const target = currentPart ? resolveHighlightTarget(currentPart) : null;
      if (action === "isolate" && target) viewer?.isolatePart?.(target.meshName);
      if (action === "all") viewer?.showAll?.();
      if (action === "reset") viewer?.resetCamera?.();
    });
  });
  document.getElementById("viewerCloseBtn")?.addEventListener("click", () => window.close());
}

async function highlightPart(part) {
  if (!part || !viewer) return;
  currentPart = part;
  const target = resolveHighlightTarget(part);
  if (!target) return;
  viewer.highlightPart({ meshName: target.meshName, nodeId: target.nodeId, ghost: true });
  const label = [part.partNo ? `№${part.partNo}` : "", part.partName].filter(Boolean).join(" · ");
  if (label) setTitle(label);
}

async function mountFromScanData(container, data) {
  if (!data?.model?.viewerUrl) {
    setError("3D модель для цієї деталі недоступна");
    return;
  }
  const loading = document.getElementById("viewerLoading");
  viewer = await mountModelViewer(container, {
    url: modelFileUrl(data.model.viewerUrl),
    token: getStoredToken(),
    format: data.model.viewerFormat || "glb",
    parts: data.model.parts || []
  });
  loading?.remove();
  currentPart = data.part;
  const title = [
    data.order?.orderNumber,
    data.position?.item,
    data.part?.partNo ? `№${data.part.partNo}` : "",
    data.part?.partName
  ]
    .filter(Boolean)
    .join(" · ");
  setTitle(title || "3D модель");
  await highlightPart(data.part);
  bindToolbar();
}

async function loadPartMode(partId) {
  const container = document.getElementById("viewerMount");
  if (!container) return;
  const data = await api.getPart(partId);
  await mountFromScanData(container, data);
}

async function loadOrderMode(orderId, positionId, highlightPartId) {
  const container = document.getElementById("viewerMount");
  const loading = document.getElementById("viewerLoading");
  if (!container) return;

  const assetData = await api.getOrder3DAsset(orderId);
  const asset = assetData?.asset;
  const isReady =
    asset && (asset.status === "READY" || asset.status === "PARTIAL_READY") && asset.webModelUrl;
  if (!isReady) {
    setError("3D модель замовлення ще не готова");
    return;
  }

  const parts = [];
  if (positionId) {
    try {
      const pkg = await api.getConstructivePackageLatest(positionId);
      if (pkg?.parts?.length) parts.push(...pkg.parts);
    } catch {
      /* optional */
    }
  }

  viewer = await mountModelViewer(container, {
    url: order3dFileUrl(orderId, asset.id, "web-model"),
    token: getStoredToken(),
    format: asset.webModelFormat || "glb",
    parts
  });
  loading?.remove();
  setTitle("3D модель замовлення");
  bindToolbar();

  if (highlightPartId) {
    try {
      const data = await api.getPart(highlightPartId);
      await highlightPart(data.part);
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  if (!getStoredToken()) {
    setError("Увійдіть у панель оператора, потім відкрийте 3D знову");
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const partId = Number(params.get("partId")) || null;
  const orderId = Number(params.get("orderId")) || null;
  const positionId = Number(params.get("positionId")) || null;

  window.addEventListener("message", (e) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === "enver:highlight-part" && e.data.part) {
      void highlightPart(e.data.part);
    }
  });

  try {
    if (partId && orderId) {
      await loadOrderMode(orderId, positionId, partId);
    } else if (partId) {
      await loadPartMode(partId);
    } else if (orderId) {
      await loadOrderMode(orderId, positionId, null);
    } else {
      setError("Не вказано деталь або замовлення для перегляду");
    }
  } catch (err) {
    setError(err.message || "Не вдалося завантажити 3D");
  }
}

main();
