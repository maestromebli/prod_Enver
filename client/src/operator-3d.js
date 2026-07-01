import { api, constructivePackageFileUrl, getStoredToken } from "./api.js";
import { mountModelViewer, DEFAULT_PART_VIEWER_THEME } from "./part-viewer-mount.js";
import { resolve3dPreviewContext } from "@enver/shared/production/resolve-3d-preview.js";
import { findPackagePreview3dFile } from "@enver/shared/production/constructive-package.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import { order3dFileUrl } from "./order-3d/order-3d-api.js";
import {
  highlightPartInViewerWindow,
  openOrderViewerWindow,
  resolveViewerModelUrl
} from "./part-viewer-window.js";
import { prefetchViewerModel, warmPartViewerChunk } from "./part-viewer-prefetch.js";
import { isNativeOperatorShell, isOperatorClientPage } from "./operator-native.js";
import { toastError } from "./toast.js";
import {
  destroyOperatorPartDetailStrip,
  reapplyPendingOperatorScan3d,
  setOperatorPartDetailModelContext,
  showOperatorPartDetail
} from "./operator-scan-3d.js";
import { renderPreview3dBadge, renderPreview3dUpgradeBanner } from "./preview-3d-ui.js";
import { escapeHtml } from "./utils.js";
import { renderEnver3dToolbarHtml, bindEnver3dToolbar } from "./3d/enver-3d-toolbar.js";
import { state } from "./state.js";

export function syncOperatorShow3dBtn() {
  const showBtn = document.getElementById("operatorShow3dBtn");
  if (!showBtn) return;
  const posSelected = Boolean(state.operatorSelectedPositionId);
  showBtn.hidden = !posSelected || state.operatorAssembly3dOpen;
}

/** Після ререндеру DOM — прибрати viewer, не монтувати 3D автоматично. */
export function resetOperatorOrder3dPanel() {
  destroyOperatorOrder3d();
  syncOperatorShow3dBtn();
}

/** Закрити 3D збірку (зміна завдання, скидання). */
export function closeOperatorAssembly3d() {
  state.operatorAssembly3dOpen = false;
  resetOperatorOrder3dPanel();
}

/** Відновити 3D після ререндеру, якщо оператор уже відкрив її (скан / кнопка). */
export async function restoreOperatorOrder3dIfNeeded() {
  if (!state.operatorAssembly3dOpen || !state.operatorSelectedPositionId) {
    syncOperatorShow3dBtn();
    return;
  }
  await openOperatorOrder3d({ silent: true });
}

let viewerInstance = null;
let order3dOrderId = null;
let order3dPositionId = null;
let toolbarAbort = null;
let bindGeneration = 0;

export function destroyOperatorOrder3d() {
  toolbarAbort?.abort();
  toolbarAbort = null;
  destroyOperatorPartDetailStrip();
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

async function loadOperator3dSourceData(orderId, positionId) {
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
  const previewFile = packageDetail?.package?.id ? findPackagePreview3dFile(packageDetail) : null;
  if (previewFile && packageDetail?.package?.id && positionId) {
    packageViewerUrl = constructivePackageFileUrl(
      positionId,
      packageDetail.package.id,
      previewFile.id
    );
  }

  return { orderAsset, packageDetail, packageViewerUrl };
}

function finalizeOperator3dContext(ctx, orderId, orderAsset, packageDetail) {
  if (!ctx?.available) return null;
  if (ctx.source === "order_3d" && orderAsset) {
    ctx.modelUrl = order3dFileUrl(orderId, orderAsset.id, "web-model");
  }
  ctx.parts = packageDetail?.parts || [];
  return ctx;
}

function buildOperator3dContexts({ orderAsset, packageDetail, packageViewerUrl, orderId }) {
  const primary = finalizeOperator3dContext(
    resolve3dPreviewContext({
      orderAsset,
      packageDetail,
      packageViewerUrl,
      preferConstructivePackage: true
    }),
    orderId,
    orderAsset,
    packageDetail
  );
  const alternate = finalizeOperator3dContext(
    resolve3dPreviewContext({
      orderAsset,
      packageDetail,
      packageViewerUrl,
      preferConstructivePackage: false
    }),
    orderId,
    orderAsset,
    packageDetail
  );
  const fallback =
    alternate?.modelUrl && alternate.modelUrl !== primary?.modelUrl ? alternate : null;
  return { primary, fallback };
}

async function loadOperator3dContext(orderId, positionId) {
  const source = await loadOperator3dSourceData(orderId, positionId);
  return buildOperator3dContexts({ ...source, orderId }).primary;
}

async function loadOperator3dContexts(orderId, positionId) {
  const source = await loadOperator3dSourceData(orderId, positionId);
  return buildOperator3dContexts({ ...source, orderId });
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

function syncDrawingToolbarButton(active) {
  const btn = document
    .getElementById("operatorOrder3dToolbar")
    ?.querySelector('[data-3d-action="drawing"]');
  btn?.classList.toggle("is-active", Boolean(active));
}

function bindOperator3dToolbar(section, viewer) {
  toolbarAbort?.abort();
  toolbarAbort = new AbortController();
  const { signal } = toolbarAbort;

  const toolbar = section.querySelector("#operatorOrder3dToolbar");
  if (!toolbar) return;

  const partsPanel = toolbar.querySelector("#operatorOrder3dParts");
  syncPartsPanel(partsPanel, viewer);

  bindEnver3dToolbar(toolbar.querySelector(".enver-3d-toolbar-row") || toolbar, viewer, {
    signal,
    partsPanel,
    onFullscreen: () => openOperatorOrder3dWindow()
  });

  toolbar.addEventListener(
    "click",
    (e) => {
      if (e.target.closest('[data-3d-action="all"]')) syncPartsPanel(partsPanel, viewer);
      if (e.target.closest('[data-3d-action="parts-toggle"]') && partsPanel && !partsPanel.hidden) {
        syncPartsPanel(partsPanel, viewer);
      }
      const drawingBtn = e.target.closest('[data-3d-action="drawing"]');
      if (drawingBtn) syncDrawingToolbarButton(drawingBtn.classList.contains("is-active"));
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
  section.classList.toggle("op-order-3d--native", isNativeOperatorShell());

  let toolbar = section.querySelector("#operatorOrder3dToolbar");
  if (!toolbar) {
    toolbar = document.createElement("div");
    toolbar.id = "operatorOrder3dToolbar";
    toolbar.className = "op-order-3d-toolbar enver-3d-toolbar";
    toolbar.innerHTML = `
      ${renderEnver3dToolbarHtml({ compact: false, showFullscreen: true, showParts: true, showAdvanced: true })}
      <div id="operatorOrder3dParts" class="op-order-3d-parts" hidden></div>
    `;
    const viewerWrap = section.querySelector("#operatorOrder3dViewer");
    if (viewerWrap) viewerWrap.before(toolbar);
    else section.appendChild(toolbar);
  }
}

export function highlightOperatorOrder3dPart(part, { cadGeometry = null } = {}) {
  if (viewerInstance && part) {
    syncDrawingToolbarButton(false);
    if (cadGeometry) viewerInstance.setCadGeometry?.(cadGeometry);
    const target = resolvePartHighlightMesh(part);
    if (viewerInstance.showPartOnAssemblyResult) {
      const result = viewerInstance.showPartOnAssemblyResult(part, target);
      return {
        ok: result.ok,
        meshName: result.meshName,
        mappingStatus: result.mappingStatus,
        reason: result.reason || ""
      };
    }
    if (viewerInstance.showPartOnAssembly) {
      const mesh = viewerInstance.showPartOnAssembly(part, target);
      if (mesh) {
        return {
          ok: true,
          meshName: mesh.name || target?.meshName,
          mappingStatus: "exact",
          reason: "mesh_found"
        };
      }
    }
    return {
      ok: false,
      meshName: target?.meshName || null,
      mappingStatus: "missing",
      reason: target?.meshName ? "mesh_not_found" : "no_mapping_hint"
    };
  }
  if (!viewerInstance) {
    if (isOperatorClientPage()) {
      return { ok: false, meshName: null, reason: "viewer_not_ready" };
    }
    const opened = highlightPartInViewerWindow(part, { cadGeometry });
    return opened
      ? { ok: true, meshName: null, reason: "popup" }
      : { ok: false, meshName: null, reason: "popup_blocked" };
  }
  return { ok: false, meshName: null, reason: "viewer_not_ready" };
}

async function handleAssemblyPartPick(part) {
  if (!part || !viewerInstance) return;
  const target = resolvePartHighlightMesh(part);
  viewerInstance.showPartOnAssembly?.(part, target);
  let payload = { part };
  if (part.id) {
    try {
      payload = await api.getPart(part.id);
    } catch {
      /* optional */
    }
  }
  if (payload.cadGeometry) viewerInstance.setCadGeometry?.(payload.cadGeometry);
  await showOperatorPartDetail(payload);
}

export async function openOperatorOrder3dWindow() {
  await openOperatorOrder3d();
  const section = document.getElementById("operatorOrder3dSection");
  const container = document.getElementById("operatorOrder3dViewer");
  section?.scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (container?.requestFullscreen) {
    void container.requestFullscreen().catch(() => {
      if (isOperatorClientPage()) {
        toastError("Повноекранний режим недоступний — масштабуйте жестами на панелі 3D");
        return;
      }
      if (order3dOrderId) openOrderViewerWindow(order3dOrderId, order3dPositionId);
    });
    return container;
  }

  if (isOperatorClientPage()) return section;
  if (!order3dOrderId) return null;
  return openOrderViewerWindow(order3dOrderId, order3dPositionId);
}

export async function openOperatorOrder3d({ silent = false } = {}) {
  const gen = ++bindGeneration;

  const mount = document.getElementById("operatorOrder3dMount");
  const section = document.getElementById("operatorOrder3dSection");
  const openBtn = document.getElementById("operatorOpen3dBtn");
  if (!mount || !section) return false;

  const orderId = Number(mount.dataset.orderId) || 0;
  const positionId = Number(mount.dataset.positionId) || 0;
  if (!orderId) {
    if (gen === bindGeneration) {
      state.operatorAssembly3dOpen = false;
      destroyOperatorOrder3d();
      syncOperatorShow3dBtn();
    }
    if (!silent) toastError("3D модель недоступна для цього завдання");
    return false;
  }

  destroyOperatorOrder3d();
  if (gen !== bindGeneration) return false;

  void prefetchOperatorOrder3d(orderId, positionId);

  section.hidden = false;
  mount.innerHTML = `<p class="op-order-3d-loading enver-meta">Завантаження 3D…</p>`;
  if (openBtn) openBtn.hidden = true;
  syncOperatorShow3dBtn();

  try {
    const { primary, fallback } = await loadOperator3dContexts(orderId, positionId);
    if (gen !== bindGeneration) return false;

    let ctx = primary;
    if (!ctx?.modelUrl) {
      state.operatorAssembly3dOpen = false;
      section.hidden = true;
      mount.innerHTML = "";
      syncOperatorShow3dBtn();
      if (!silent) toastError("3D модель недоступна для цього завдання");
      return false;
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
    await warmPartViewerChunk();
    if (gen !== bindGeneration) return false;

    const mountViewer = async (viewerCtx) => {
      const modelUrl = resolveViewerModelUrl(viewerCtx.modelUrl, token);
      void prefetchViewerModel(modelUrl, token);
      return mountModelViewer(container, {
        url: modelUrl,
        token,
        format: viewerCtx.format,
        parts: viewerCtx.parts,
        theme: DEFAULT_PART_VIEWER_THEME,
        viewerOptions: {
          pickable: true,
          onPartSelect: (part) => {
            if (!part) return;
            void handleAssemblyPartPick(part);
          }
        }
      });
    };

    setOperatorPartDetailModelContext({
      modelUrl: resolveViewerModelUrl(ctx.modelUrl, token),
      format: ctx.format,
      parts: ctx.parts
    });

    try {
      viewerInstance = await mountViewer(ctx);
    } catch (err) {
      if (!fallback?.modelUrl) throw err;
      ctx = fallback;
      updateOperator3dBadge(section, ctx);
      viewerInstance = await mountViewer(ctx);
      setOperatorPartDetailModelContext({
        modelUrl: resolveViewerModelUrl(ctx.modelUrl, token),
        format: ctx.format,
        parts: ctx.parts
      });
    }

    if (gen !== bindGeneration) {
      viewerInstance?.destroy?.();
      viewerInstance = null;
      return false;
    }

    if (!viewerInstance) throw new Error("3D viewer не ініціалізовано");

    bindOperator3dToolbar(section, viewerInstance);

    if (openBtn) {
      openBtn.hidden = false;
      openBtn.textContent = isNativeOperatorShell() ? "Повний 3D" : "На весь екран";
    }

    state.operatorAssembly3dOpen = true;
    syncOperatorShow3dBtn();
    void reapplyPendingOperatorScan3d();
    return true;
  } catch {
    if (gen !== bindGeneration) return false;
    state.operatorAssembly3dOpen = false;
    section.hidden = true;
    mount.innerHTML = "";
    viewerInstance = null;
    syncOperatorShow3dBtn();
    if (!silent) toastError("Не вдалося завантажити 3D модель");
    return false;
  }
}
