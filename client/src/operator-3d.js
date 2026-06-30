import { api, constructivePackageFileUrl, getStoredToken } from "./api.js";
import { mountModelViewer } from "./part-viewer-mount.js";
import { resolve3dPreviewContext } from "@enver/shared/production/resolve-3d-preview.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import { order3dFileUrl } from "./order-3d/order-3d-api.js";
import {
  highlightPartInViewerWindow,
  openOrderViewerWindow,
  resolveViewerModelUrl
} from "./part-viewer-window.js";
import { prefetchViewerModel, warmPartViewerChunk } from "./part-viewer-prefetch.js";
import { isNativeOperatorShell } from "./operator-native.js";
import { renderPreview3dBadge, renderPreview3dUpgradeBanner } from "./preview-3d-ui.js";
import { escapeHtml } from "./utils.js";

let viewerInstance = null;
let order3dOrderId = null;
let order3dPositionId = null;
let toolbarAbort = null;

export function destroyOperatorOrder3d() {
  toolbarAbort?.abort();
  toolbarAbort = null;
  viewerInstance?.destroy?.();
  viewerInstance = null;
  order3dOrderId = null;
  order3dPositionId = null;
  const section = document.getElementById("operatorOrder3dSection");
  const mount = document.getElementById("operatorOrder3dMount");
  const badge = document.getElementById("operatorOrder3dBadge");
  const toolbar = document.getElementById("operatorOrder3dToolbar");
  if (section) section.hidden = true;
  if (mount) mount.innerHTML = "";
  if (badge) badge.remove();
  toolbar?.remove();
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

/** Prefetch 3D моделі при виборі завдання — швидше відкриття після скану. */
export async function prefetchOperatorOrder3d(orderId, positionId) {
  if (!orderId) return;
  void warmPartViewerChunk();
  try {
    const ctx = await loadOperator3dContext(orderId, positionId);
    if (!ctx?.modelUrl) return;
    const token = getStoredToken();
    void prefetchViewerModel(resolveViewerModelUrl(ctx.modelUrl, token), token);
  } catch {
    /* ignore */
  }
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

function renderPartsList(viewer) {
  const meshes = viewer?.listMeshes?.() || [];
  if (!meshes.length) return "";
  return meshes
    .map(
      (m) => `
    <label class="op-order-3d-part-row">
      <input type="checkbox" data-mesh-visible="${escapeHtml(m.name)}" ${m.visible ? "checked" : ""} />
      <span class="op-order-3d-part-label">${escapeHtml(m.label)}</span>
      <button type="button" class="op-order-3d-part-ghost" data-mesh-ghost="${escapeHtml(m.name)}" aria-pressed="${m.transparent ? "true" : "false"}" title="Прозорість">◐</button>
    </label>`
    )
    .join("");
}

function syncPartsPanel(panel, viewer) {
  if (!panel || !viewer) return;
  panel.innerHTML = renderPartsList(viewer);
}

function bindOperator3dToolbar(section, viewer) {
  toolbarAbort?.abort();
  toolbarAbort = new AbortController();
  const { signal } = toolbarAbort;

  const toolbar = section.querySelector("#operatorOrder3dToolbar");
  if (!toolbar) return;

  const partsPanel = toolbar.querySelector("#operatorOrder3dParts");
  syncPartsPanel(partsPanel, viewer);

  toolbar.addEventListener(
    "click",
    (e) => {
      const camBtn = e.target.closest("[data-3d-camera]");
      if (camBtn) {
        viewer.setCameraPreset?.(camBtn.dataset["3dCamera"]);
        return;
      }
      const actionBtn = e.target.closest("[data-3d-action]");
      if (!actionBtn) return;
      const action = actionBtn.dataset["3dAction"];
      if (action === "fit") viewer.fitToView?.();
      if (action === "drawing") {
        const on = !actionBtn.classList.contains("is-active");
        actionBtn.classList.toggle("is-active", on);
        viewer.setDrawingMode?.(on);
      }
      if (action === "all") {
        viewer.showAll?.();
        viewer.resetMeshVisibility?.();
        syncPartsPanel(partsPanel, viewer);
      }
      if (action === "parts-toggle") {
        const panel = partsPanel;
        if (!panel) return;
        const open = panel.hidden;
        panel.hidden = !open;
        panel.classList.toggle("is-open", open);
        if (open) syncPartsPanel(panel, viewer);
      }
    },
    { signal }
  );

  partsPanel?.addEventListener(
    "change",
    (e) => {
      const input = e.target.closest("[data-mesh-visible]");
      if (!input) return;
      viewer.setMeshVisible?.(input.dataset.meshVisible, input.checked);
    },
    { signal }
  );

  partsPanel?.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest("[data-mesh-ghost]");
      if (!btn) return;
      const name = btn.dataset.meshGhost;
      const on = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(on));
      viewer.setMeshTransparent?.(name, on);
    },
    { signal }
  );
}

function mountOperator3dToolbar(section) {
  if (!isNativeOperatorShell()) return;
  section.classList.add("op-order-3d--native");

  let toolbar = section.querySelector("#operatorOrder3dToolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "operatorOrder3dToolbar";
    toolbar.className = "op-order-3d-toolbar";
    toolbar.innerHTML = `
      <div class="op-order-3d-toolbar-row">
        <button type="button" class="btn btn-sm" data-3d-camera="iso" title="Ізометрія">3D</button>
        <button type="button" class="btn btn-sm" data-3d-camera="top" title="Зверху">↑</button>
        <button type="button" class="btn btn-sm" data-3d-camera="bottom" title="Знизу">↓</button>
        <button type="button" class="btn btn-sm" data-3d-camera="front" title="Спереду">▣</button>
        <button type="button" class="btn btn-sm" data-3d-action="drawing" title="Креслення">⬚</button>
        <button type="button" class="btn btn-sm" data-3d-action="fit" title="Вмістити">◎</button>
        <button type="button" class="btn btn-sm" data-3d-action="all" title="Показати все">⊞</button>
        <button type="button" class="btn btn-sm" data-3d-action="parts-toggle" title="Деталі">☰</button>
      </div>
      <div id="operatorOrder3dParts" class="op-order-3d-parts" hidden></div>
    `;
    const viewerWrap = section.querySelector("#operatorOrder3dViewer");
    if (viewerWrap) viewerWrap.before(toolbar);
    else section.appendChild(toolbar);
  }
}

export function highlightOperatorOrder3dPart(part, { cadGeometry = null } = {}) {
  if (viewerInstance && part) {
    if (cadGeometry) viewerInstance.setCadGeometry?.(cadGeometry);
    const target = resolvePartHighlightMesh(part);
    if (viewerInstance.showPartOnAssembly) {
      viewerInstance.showPartOnAssembly(part, target);
    } else {
      viewerInstance.highlightPart({
        meshName: target?.meshName || part.modelMeshName,
        nodeId: target?.nodeId || part.modelNodeId
      });
    }
    return true;
  }
  return highlightPartInViewerWindow(part, { cadGeometry });
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

  void prefetchOperatorOrder3d(orderId, positionId);

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

    mountOperator3dToolbar(section);

    const container = document.getElementById("operatorOrder3dViewer");
    const token = getStoredToken();
    const modelUrl = resolveViewerModelUrl(ctx.modelUrl, token);
    void prefetchViewerModel(modelUrl, token);

    viewerInstance = await mountModelViewer(container, {
      url: modelUrl,
      token,
      format: ctx.format,
      parts: ctx.parts,
      theme: "studio",
      viewerOptions: { pickable: true }
    });

    bindOperator3dToolbar(section, viewerInstance);

    if (openBtn) {
      openBtn.hidden = false;
      openBtn.textContent = isNativeOperatorShell() ? "Повний 3D" : "На весь екран";
    }
  } catch {
    section.hidden = true;
    mount.innerHTML = "";
    viewerInstance = null;
  }
}
