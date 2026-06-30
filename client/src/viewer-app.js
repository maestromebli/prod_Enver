import "./styles/design-system.css";
import "./styles/tokens.css";
import "./styles/brand-logo.css";
import "./styles/viewer-window.css";
import "./styles/part-viewer.css";
import { api, getStoredToken } from "./api.js";
import { mountModelViewer } from "./part-viewer-mount.js";
import { order3dFileUrl } from "./order-3d/order-3d-api.js";
import { resolvePartHighlightMesh } from "@enver/shared/production/bazis-operation-code.js";
import {
  formatEdgeCodeLabel,
  formatProjectEdgeMask,
  formatPartDetailSummary
} from "@enver/shared/production/part-detail-display.js";
import { closeViewerWindow, resolveViewerModelUrl } from "./part-viewer-window.js";
import { isNativeOperatorShell } from "./operator-native.js";
import { warmPartViewerChunk } from "./part-viewer-prefetch.js";

const HOLE_FACE_LABELS = {
  panel: "лице",
  bottom: "торець низ",
  top: "торець верх",
  left: "бік ліво",
  right: "бік право"
};

function formatHoleListItem(hole) {
  const d = hole.diameterMm ? `Ø${hole.diameterMm}` : "Ø?";
  const face = HOLE_FACE_LABELS[hole.face] || hole.kind || "отвір";
  const pos =
    hole.xMm != null && hole.yMm != null
      ? `${hole.xMm}×${hole.yMm}`
      : hole.yMm != null && hole.zMm != null
        ? `Y${hole.yMm} Z${hole.zMm}`
        : "—";
  return `<li><span class="viewer-hole-d">${escapeHtml(d)}</span> <span class="viewer-hole-face">${escapeHtml(face)}</span> ${escapeHtml(pos)} мм</li>`;
}

let viewer = null;
let currentPart = null;
let currentCadGeometry = null;
let cadFlags = { section: false, measure: false, wireframe: false, axes: false };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function resolveHighlightTarget(part) {
  return resolvePartHighlightMesh(part);
}

function modelFileUrl(viewerUrl) {
  return resolveViewerModelUrl(viewerUrl, getStoredToken());
}

function hideLoading() {
  const loading = document.getElementById("viewerLoading");
  if (loading) loading.hidden = true;
}

function setError(message) {
  hideLoading();
  const el = document.getElementById("viewerError");
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

function formatPartDims(part, cadGeometry) {
  const panel = cadGeometry?.panelMm;
  const dims = panel?.dx
    ? [panel.dx, panel.dy, panel.dz]
    : [part?.length, part?.width, part?.thickness];
  const text = dims.filter((v) => v != null && v !== "").join(" × ");
  return text ? `${text} мм` : "";
}

function formatEdgeLabel(part, cadGeometry) {
  if (cadGeometry?.edgeMaskSource === "project" && cadGeometry.edgeMask) {
    return formatProjectEdgeMask(cadGeometry.edgeMask);
  }
  return formatEdgeCodeLabel(part?.edgeCode || part?.edge_code);
}

function renderDrillingOpsList(part) {
  const { drillingOps } = formatPartDetailSummary(part);
  if (!drillingOps?.length) return "";
  return `
    <div class="viewer-hole-list viewer-hole-list--drill-ops">
      <h3 class="viewer-hole-list-title">Програми сверління (${drillingOps.length})</h3>
      <ul class="viewer-hole-items viewer-drill-ops">${drillingOps
        .map((code) => `<li><code>${escapeHtml(code)}</code></li>`)
        .join("")}</ul>
    </div>
  `;
}

function renderHoleList(cadGeometry, part) {
  const holes = cadGeometry?.holes || [];
  const edgeMask = cadGeometry?.edgeMask;
  const edgeLabel = edgeMask?.some(Boolean)
    ? cadGeometry?.edgeMaskSource === "project"
      ? formatProjectEdgeMask(edgeMask)
      : formatEdgeCodeLabel(part?.edgeCode || part?.edge_code)
    : "";
  const sections = [];

  if (holes.length) {
    sections.push(`
      <div class="viewer-hole-list">
        <h3 class="viewer-hole-list-title">Кріплення (${holes.length})</h3>
        <ul class="viewer-hole-items">${holes.map(formatHoleListItem).join("")}</ul>
      </div>
    `);
  }

  const drillOpsHtml = renderDrillingOpsList(part);
  if (drillOpsHtml) sections.push(drillOpsHtml);

  if (edgeMask?.some(Boolean)) {
    sections.push(`
      <div class="viewer-hole-list viewer-hole-list--edge">
        <h3 class="viewer-hole-list-title">Вирізи кромки</h3>
        <p class="viewer-edge-cutout">${escapeHtml(edgeLabel)}</p>
      </div>
    `);
  }

  return sections.join("");
}

function populateSidebar(data) {
  const sidebar = document.getElementById("viewerSidebar");
  const meta = document.getElementById("viewerMeta");
  const holesEl = document.getElementById("viewerHoles");
  if (!sidebar || !meta) return;

  const part = data?.part;
  if (!part) {
    sidebar.hidden = true;
    return;
  }

  const cad = data.cadGeometry;
  const summary = formatPartDetailSummary(part);
  const rows = [
    ["Деталь", part.partName],
    ["№", part.partNo ? `№${part.partNo}` : ""],
    ["Розміри", formatPartDims(part, cad)],
    ["Матеріал", part.material || part.materialName],
    ["Кромка", formatEdgeLabel(part, cad)],
    ["CAD", cad?.holeCount ? `${cad.holeCount} отворів · Bazis` : ""],
    ["Сверління", summary.drillingOps?.length ? `${summary.drillingOps.length} програм` : ""],
    ["Замовлення", data.order?.orderNumber],
    ["Позиція", data.position?.item]
  ].filter(([, value]) => value);

  meta.innerHTML = rows
    .map(
      ([label, value]) =>
        `<div class="viewer-meta-row"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`
    )
    .join("");

  const pdfUrl = data.model?.assemblyPdfUrl
    ? resolveViewerModelUrl(data.model.assemblyPdfUrl, getStoredToken())
    : null;
  const pdfTarget = isNativeOperatorShell() ? "_self" : "_blank";
  const pdfLink = pdfUrl
    ? `<p class="viewer-pdf-link"><a class="btn btn-sm" href="${escapeHtml(pdfUrl)}" target="${pdfTarget}" rel="noopener">Креслення збірки (PDF)</a></p>`
    : "";

  if (holesEl) {
    holesEl.innerHTML = renderHoleList(cad, part) + pdfLink;
    const hasDrillInfo =
      Boolean(cad?.holes?.length) ||
      Boolean(cad?.edgeMask?.some(Boolean)) ||
      Boolean(summary.drillingOps?.length) ||
      Boolean(pdfUrl);
    holesEl.hidden = !hasDrillInfo;
  }

  sidebar.hidden = false;
}

function setToolbarActive(action) {
  document.querySelectorAll("[data-viewer-action]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.viewerAction === action);
  });
}

async function showPartOnAssembly(part) {
  if (!part || !viewer) return null;
  currentPart = part;
  const target = resolveHighlightTarget(part);
  let mesh = null;
  for (let attempt = 0; attempt < 12; attempt++) {
    mesh = viewer.showPartOnAssembly?.(part, target);
    if (mesh) break;
    await new Promise((r) => requestAnimationFrame(r));
    if (attempt > 2) await new Promise((r) => setTimeout(r, 40));
  }
  if (!mesh && viewer.showPartDetail) {
    viewer.showPartDetail(part, target);
    setToolbarActive("detail");
  } else {
    setToolbarActive("ghost");
  }
  const label = [part.partNo ? `№${part.partNo}` : "", part.partName].filter(Boolean).join(" · ");
  if (label) setTitle(label);
  return mesh;
}

async function highlightPartGhost(part) {
  await showPartOnAssembly(part);
}

async function showPartDetailView(part) {
  if (!part || !viewer) return;
  currentPart = part;
  const target = resolveHighlightTarget(part);
  if (target?.meshName && viewer.showPartDetail) {
    viewer.showPartDetail(part, target);
    setToolbarActive("detail");
  } else {
    await highlightPartGhost(part);
  }
  const label = [part.partNo ? `№${part.partNo}` : "", part.partName].filter(Boolean).join(" · ");
  if (label) setTitle(label);
}

function toggleFullscreen() {
  const root = document.querySelector(".viewer-window-body") || document.documentElement;
  if (document.fullscreenElement) {
    void document.exitFullscreen?.();
    return;
  }
  void root.requestFullscreen?.();
}

function applyCadGeometry(cadGeometry) {
  currentCadGeometry = cadGeometry || null;
  viewer?.setCadGeometry?.(currentCadGeometry);
}

async function applyPartHighlight(payload = {}) {
  const part = payload.part;
  if (!part) return;

  let cadGeometry = payload.cadGeometry || null;
  let sidebarData = payload;

  if ((!cadGeometry || !cadGeometry.holes?.length) && part.id) {
    try {
      const data = await api.getPart(part.id);
      cadGeometry = data.cadGeometry || cadGeometry;
      sidebarData = data;
    } catch {
      /* optional */
    }
  }

  currentPart = part;
  applyCadGeometry(cadGeometry);
  populateSidebar(sidebarData);
  await showPartOnAssembly(part);
}

function toggleCadFlag(flag, action) {
  cadFlags[flag] = !cadFlags[flag];
  action(cadFlags[flag]);
  document
    .querySelector(`[data-viewer-action="${flag}"]`)
    ?.classList.toggle("is-active", cadFlags[flag]);
}

function bindToolbar() {
  const toolbar = document.getElementById("viewerToolbar");
  toolbar?.removeAttribute("hidden");
  toolbar?.querySelectorAll("[data-viewer-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.viewerAction;
      const target = currentPart ? resolveHighlightTarget(currentPart) : null;

      if (action === "detail" && currentPart) void showPartDetailView(currentPart);
      if (action === "ghost" && currentPart) void highlightPartGhost(currentPart);
      if (action === "isolate" && target) {
        viewer?.isolatePart?.(target.meshName);
        setToolbarActive("isolate");
      }
      if (action === "all") {
        viewer?.showAll?.();
        setToolbarActive("all");
      }
      if (action === "fit") viewer?.fitToView?.();
      if (action === "reset") viewer?.resetCamera?.();
      if (action === "fullscreen") toggleFullscreen();
      if (action === "section") {
        toggleCadFlag("section", (on) => viewer?.setSectionEnabled?.(on));
      }
      if (action === "measure") {
        toggleCadFlag("measure", (on) => viewer?.setMeasureEnabled?.(on));
      }
      if (action === "wireframe") {
        toggleCadFlag("wireframe", (on) => viewer?.setWireframe?.(on));
      }
      if (action === "axes") {
        toggleCadFlag("axes", (on) => viewer?.setAxesVisible?.(on));
      }
    });
  });
  document.getElementById("viewerCloseBtn")?.addEventListener("click", () => closeViewerWindow());
}

function bindHotkeys() {
  window.addEventListener("keydown", (e) => {
    if (e.target?.matches?.("input, textarea, select")) return;
    const key = e.key.toLowerCase();
    const target = currentPart ? resolveHighlightTarget(currentPart) : null;

    if (key === "r") {
      e.preventDefault();
      viewer?.resetCamera?.();
    }
    if (key === "f") {
      e.preventDefault();
      viewer?.fitToView?.();
    }
    if (key === "d" && currentPart) {
      e.preventDefault();
      void showPartDetailView(currentPart);
    }
    if (key === "g" && currentPart) {
      e.preventDefault();
      void highlightPartGhost(currentPart);
    }
    if (key === "i" && target) {
      e.preventDefault();
      viewer?.isolatePart?.(target.meshName);
      setToolbarActive("isolate");
    }
    if (key === "a") {
      e.preventDefault();
      viewer?.showAll?.();
      setToolbarActive("all");
    }
    if (key === "m") {
      e.preventDefault();
      toggleCadFlag("measure", (on) => viewer?.setMeasureEnabled?.(on));
    }
    if (key === "x") {
      e.preventDefault();
      toggleCadFlag("section", (on) => viewer?.setSectionEnabled?.(on));
    }
    if (key === "w") {
      e.preventDefault();
      toggleCadFlag("wireframe", (on) => viewer?.setWireframe?.(on));
    }
    if (key === "escape" && document.fullscreenElement) {
      void document.exitFullscreen?.();
    }
  });
}

function initViewerShell() {
  const tablet =
    isNativeOperatorShell() ||
    /Android|iPad|Tablet/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1280);
  if (tablet) {
    document.body.classList.add("viewer-tablet-mode");
    document.documentElement.classList.add("viewer-tablet-mode");
  }
  void warmPartViewerChunk();
}

async function mountFromScanData(container, data) {
  if (!data?.model?.viewerUrl) {
    setError("3D модель для цієї деталі недоступна");
    return;
  }
  viewer = await mountModelViewer(container, {
    url: modelFileUrl(data.model.viewerUrl),
    token: getStoredToken(),
    format: data.model.viewerFormat || "glb",
    parts: data.model.parts || [],
    theme: "studio"
  });
  hideLoading();
  document.getElementById("viewerLoading")?.remove();
  currentPart = data.part;
  applyCadGeometry(data.cadGeometry);
  const title = [
    data.order?.orderNumber,
    data.position?.item,
    data.part?.partNo ? `№${data.part.partNo}` : "",
    data.part?.partName
  ]
    .filter(Boolean)
    .join(" · ");
  setTitle(title || "3D модель");
  populateSidebar(data);
  await showPartOnAssembly(data.part);
  bindToolbar();
  bindHotkeys();
}

async function loadPartMode(partId) {
  const container = document.getElementById("viewerMount");
  if (!container) return;
  const data = await api.getPart(partId);
  await mountFromScanData(container, data);
}

async function loadFromSessionCache() {
  const raw = sessionStorage.getItem("enver_viewer_scan");
  if (!raw) return false;
  sessionStorage.removeItem("enver_viewer_scan");

  let cached;
  try {
    cached = JSON.parse(raw);
  } catch {
    return false;
  }

  const payload = cached?.payload;
  if (!payload?.model?.viewerUrl) return false;

  const params = new URLSearchParams(window.location.search);
  const urlPartId = Number(params.get("partId")) || null;
  const cachedPartId = Number(cached.partId) || payload.part?.id || null;
  if (urlPartId && cachedPartId && urlPartId !== cachedPartId) return false;

  const container = document.getElementById("viewerMount");
  if (!container) return false;
  await mountFromScanData(container, payload);
  return true;
}

async function loadOrderMode(orderId, positionId, highlightPartId) {
  const container = document.getElementById("viewerMount");
  if (!container) return;

  const assetData = await api.getOrder3DAsset(orderId);
  const asset = assetData?.asset;
  const isReady =
    asset && (asset.status === "READY" || asset.status === "PARTIAL_READY") && asset.webModelUrl;
  if (!isReady) {
    if (highlightPartId) {
      await loadPartMode(highlightPartId);
      return;
    }
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
    parts,
    theme: "studio"
  });
  hideLoading();
  document.getElementById("viewerLoading")?.remove();
  setTitle("3D модель замовлення");
  bindToolbar();
  bindHotkeys();

  if (highlightPartId) {
    try {
      const data = await api.getPart(highlightPartId);
      await applyPartHighlight({ part: data.part, cadGeometry: data.cadGeometry, ...data });
    } catch {
      /* ignore */
    }
  }
}

async function main() {
  initViewerShell();

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
    if (e.data?.type === "enver:highlight-part") {
      void applyPartHighlight(e.data);
    }
  });

  try {
    if (await loadFromSessionCache()) return;

    if (partId) {
      await loadPartMode(partId);
    } else if (orderId) {
      await loadOrderMode(orderId, positionId, partId);
    } else {
      setError("Не вказано деталь або замовлення для перегляду");
    }
  } catch (err) {
    setError(err.message || "Не вдалося завантажити 3D");
  }
}

main();
