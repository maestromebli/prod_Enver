import { api, apiUrl, getStoredToken } from "./api.js";
import { state } from "./state.js";
import { createPartViewerLazy as createPartViewer } from "./part-viewer-lazy.js";
import { createScannerInputListener } from "./scanner-input.js";
import { escapeHtml, $ } from "./utils.js";
import { iconSvg } from "./icons.js";
import { toastError, toastSuccess } from "./toast.js";
import {
  CNC_PROBLEM_REASONS,
  formatPartDimensionsMm
} from "@enver/shared/production/constructive-package.js";
import {
  resolvePartHighlightMesh,
  normalizeBazisScanCode
} from "@enver/shared/production/bazis-operation-code.js";

/** Етапи зі скануванням етикеток деталей. */
export const PART_SCAN_OPERATOR_STAGES = ["cutting", "edging", "drilling", "assembly"];

/** Імʼя mesh для підсвітки деталі в GLB (panel-{code} з Bazis / order-3d). */
export function resolveHighlightTarget(part) {
  return resolvePartHighlightMesh(part);
}

export function isPartScanStage(stageKey) {
  return PART_SCAN_OPERATOR_STAGES.includes(stageKey);
}

/** Кнопка «Сканувати» в компактній шапці operator.html / Android APK. */
export function syncOperatorClientScanButtons(stageKey) {
  const show = isPartScanStage(stageKey);
  $("#operatorClientScanBtn")?.toggleAttribute("hidden", !show);
}

/** @deprecated використовуйте syncOperatorClientScanButtons */
export function syncOperatorClientScanButton(stageKey) {
  syncOperatorClientScanButtons(stageKey);
}

/** @deprecated кнопки сканування лише в шапці та всередині панелі сканування */
export function renderOperatorScanActionButton(_stageKey) {
  return "";
}

let scannerListener = null;
let viewer = null;
let recentScans = [];
let scanControlsAbort = null;
let cameraScanCleanup = null;
let lastScanBindConfig = null;

function playScanFeedback() {
  if (navigator.vibrate) navigator.vibrate(40);
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

function cleanScanCode(raw) {
  let code = String(raw || "").trim();
  if (!code) return "";
  code = [...code]
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      if (c <= 0x1f) return false;
      return c !== 0x200b && c !== 0x200c && c !== 0x200d && c !== 0xfeff;
    })
    .join("")
    .trim();
  const normalized = normalizeBazisScanCode(code);
  return normalized || code;
}

async function lookupBarcode(code) {
  const cleaned = cleanScanCode(code);
  if (!cleaned) throw new Error("Введіть код");
  const positionId =
    state.operatorSelectedPositionId || state.operatorActiveSession?.position_id || null;
  const pos = positionId
    ? state.operatorQueue.find((p) => p.id === positionId) || state.operatorJobDetail?.position
    : null;
  const orderId = pos?.orderId || state.operatorJobDetail?.position?.orderId || null;
  return api.scanPart(cleaned, { positionId, orderId });
}

function renderPartDetail(data, { showCncActions = false, closeLabel = "← Назад" } = {}) {
  const p = data.part;
  const unmapped = Boolean(data.model?.viewerUrl) && !resolveHighlightTarget(p);
  const cncActions = showCncActions
    ? `
        <button type="button" class="btn btn-lg btn-primary" data-cnc-action="start">Почати</button>
        <button type="button" class="btn btn-lg btn-primary" data-cnc-action="finish">Готово</button>
        <button type="button" class="btn btn-lg btn-danger" data-cnc-action="problem">Проблема</button>`
    : "";

  return `
    <div class="part-detail-card">
      <div class="part-detail-toolbar">
        <button type="button" class="btn btn-sm part-scan-back" data-part-scan-close>${escapeHtml(closeLabel)}</button>
      </div>
      <div class="part-detail-meta">
        <p><strong>${escapeHtml(data.order?.orderNumber || "")}</strong> · ${escapeHtml(data.position?.item || "")}</p>
        <p>${escapeHtml(p.blockCode || "—")} · №${escapeHtml(p.partNo)} · ${escapeHtml(p.partName)}</p>
        <p>${escapeHtml(p.material)} · ${escapeHtml(formatPartDimensionsMm(p))}</p>
        ${p.edgeCode ? `<p>Кромка: ${escapeHtml(p.edgeCode)}</p>` : ""}
        ${showCncActions ? `<p class="part-cnc-status">ЧПК: ${escapeHtml(p.cncStatus || "—")}</p>` : ""}
        ${unmapped ? `<p class="part-scan-warning">Ця деталь ще не звʼязана з 3D-моделлю.</p>` : ""}
      </div>
      <div class="part-viewer-3d" data-part-viewer></div>
      <div class="part-detail-actions">
        ${cncActions}
        <button type="button" class="btn btn-lg" data-viewer-action="isolate">Тільки деталь</button>
        <button type="button" class="btn btn-lg" data-viewer-action="all">Весь виріб</button>
        <button type="button" class="btn btn-lg" data-viewer-action="reset">Скинути камеру</button>
        ${data.model?.assemblyPdfUrl ? `<a class="btn btn-lg" href="${escapeHtml(data.model.assemblyPdfUrl)}" target="_blank" rel="noopener">Креслення</a>` : ""}
        <button type="button" class="btn btn-lg" data-part-scan-close>${escapeHtml(closeLabel)}</button>
      </div>
    </div>`;
}

/** Вбудована зона сканування в панелі оператора (порізка, поклейка, присадка, збірка). */
export function renderOperatorScanPanel(stageKey) {
  if (!isPartScanStage(stageKey)) return "";
  return `
    <section class="op-part-scan" id="operatorPartScan" aria-label="Сканування деталі" hidden>
      <div class="op-part-scan-head">
        <div class="op-part-scan-head-row">
          <button type="button" class="btn btn-sm op-part-scan-back" id="operatorPartScanBackBtn">← Назад</button>
          <h3 class="op-part-scan-title">Сканування деталі</h3>
        </div>
        <p class="op-part-scan-hint">Оберіть штрихридер або камеру — після сканування деталь підсвітиться у 3D</p>
      </div>
      <div class="op-part-scan-mode" role="group" aria-label="Спосіб сканування">
        <button type="button" class="btn scan-btn op-part-scan-mode-btn is-active" id="operatorScanModeScanner" aria-pressed="true">
          <span class="op-scan-glyph" aria-hidden="true">${iconSvg("barcode")}</span>
          Штрихридер
        </button>
        <button type="button" class="btn scan-btn op-part-scan-mode-btn" id="operatorScanModeCamera" aria-pressed="false">
          <span class="op-camera-glyph" aria-hidden="true">${iconSvg("camera")}</span>
          Камера
        </button>
      </div>
      <div class="op-part-scan-bar" id="operatorScanScannerPane">
        <input
          type="text"
          id="operatorScanInput"
          class="scan-input op-scan-input"
          placeholder="Очікую сканування…"
          autocomplete="off"
          inputmode="none"
        />
        <p class="part-scan-status" id="operatorScanStatus" aria-live="polite">Наведіть штрихридер на етикетку</p>
      </div>
      <div class="op-part-scan-actions">
        <button type="button" class="btn scan-btn" id="operatorScanManualBtn">Ввести вручну</button>
        <button type="button" class="btn scan-btn" id="operatorScanCameraBtn">Відкрити камеру</button>
      </div>
      <div id="operatorPartScanDetail" class="op-part-scan-result" hidden></div>
    </section>`;
}

/** Повноекранний режим (застарілий, лишено для сумісності). */
export function renderPartScanView() {
  return renderOperatorScanPanel("cutting")
    .replace('id="operatorScanInput"', 'id="scanInput"')
    .replace('id="operatorScanStatus"', 'id="scanStatus"')
    .replace('id="operatorScanManualBtn"', 'id="scanManualBtn"')
    .replace('id="operatorScanCameraBtn"', 'id="scanCameraBtn"')
    .replace('id="operatorPartScanBackBtn"', 'id="partScanBackBtn"')
    .replace('id="operatorPartScanDetail"', 'id="partScanDetail"')
    .replace('class="op-part-scan"', 'class="part-scan-screen"');
}

async function mountViewer(container, data) {
  viewer?.destroy();
  viewer = null;
  if (!container || !data.model?.viewerUrl) return;
  try {
    viewer = await createPartViewer(container);
    const url = modelFileUrl(data.model.viewerUrl);
    await viewer.loadModel(url, getStoredToken(), { format: data.model.viewerFormat || "glb" });
    const catalog = data.model?.parts;
    if (Array.isArray(catalog) && catalog.length) {
      viewer.setPartCatalog(catalog);
    }
    const target = resolveHighlightTarget(data.part);
    if (target) {
      viewer.highlightPart({
        meshName: target.meshName,
        nodeId: target.nodeId,
        ghost: true
      });
    }
  } catch {
    toastError("Не вдалося завантажити 3D модель");
  }
}

function syncOperatorScanButtonState(open) {
  for (const id of ["operatorScanBtn", "operatorClientScanBtn"]) {
    const btn = $(`#${id}`);
    if (!btn) continue;
    btn.classList.toggle("is-active", open);
    btn.setAttribute("aria-pressed", String(open));
  }
}

function setScanPanelOpen(open) {
  const section = $("#operatorPartScan");
  if (!section) return;
  section.hidden = !open;
  section.classList.toggle("is-scan-open", open);
  const panelBack = $("#operatorPartScanBackBtn") || $("#partScanBackBtn");
  if (panelBack) panelBack.hidden = !open;
  const headerBack = $("#operatorClientBackBtn");
  if (headerBack) headerBack.hidden = !open;
  syncOperatorScanButtonState(open);
  if (!open) {
    scannerListener?.destroy();
    scannerListener = null;
    cameraScanCleanup?.();
    cameraScanCleanup = null;
  }
}

function setScanDetailOpen(open) {
  $("#operatorPartScan")?.classList.toggle("is-detail-open", open);
}

function attachScannerListener(config) {
  scannerListener?.destroy();
  const { scanInput, onScan } = config;
  if (!scanInput || $("#operatorPartScan")?.hidden) {
    scannerListener = null;
    return;
  }
  scannerListener = createScannerInputListener({
    target: document,
    scanField: scanInput,
    onScan,
    onManualSubmit: onScan
  });
}

function setScanMode(mode) {
  const isCamera = mode === "camera";
  $("#operatorScanScannerPane")?.toggleAttribute("hidden", isCamera);
  $("#operatorScanModeScanner")?.classList.toggle("is-active", !isCamera);
  $("#operatorScanModeCamera")?.classList.toggle("is-active", isCamera);
  $("#operatorScanModeScanner")?.setAttribute("aria-pressed", String(!isCamera));
  $("#operatorScanModeCamera")?.setAttribute("aria-pressed", String(isCamera));
  const statusEl = $("#operatorScanStatus");
  if (statusEl && !isCamera) {
    statusEl.textContent = "Наведіть штрихридер на етикетку";
  }
  if (!isCamera) {
    $("#operatorScanInput")?.focus();
  }
}

function closePartScanDetail(detailEl, { onClose, scanInput } = {}) {
  viewer?.destroy();
  viewer = null;
  if (detailEl) {
    detailEl.hidden = true;
    detailEl.innerHTML = "";
  }
  setScanDetailOpen(false);
  onClose?.();
  scanInput?.focus();
}

function bindPartDetail(detailEl, data, { showCncActions = false, onClose, scanInput } = {}) {
  if (!detailEl) return;

  const container = detailEl.querySelector("[data-part-viewer]");
  void mountViewer(container, data);

  detailEl.querySelectorAll("[data-part-scan-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closePartScanDetail(detailEl, { onClose, scanInput });
    });
  });

  detailEl.querySelectorAll("[data-viewer-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.viewerAction;
      const target = resolveHighlightTarget(data.part);
      if (action === "isolate" && target) viewer?.isolatePart(target.meshName);
      if (action === "all") viewer?.showAll();
      if (action === "reset") viewer?.resetCamera();
    });
  });

  if (!showCncActions) return;

  detailEl.querySelectorAll("[data-cnc-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.cncAction;
      try {
        if (action === "problem") {
          const reason = window.prompt(
            `Причина проблеми:\n${CNC_PROBLEM_REASONS.join("\n")}`,
            "Інше"
          );
          if (!reason) return;
          await api.partCncProblem(data.part.id, { reason });
        } else if (action === "start") {
          await api.partCncStart(data.part.id, {});
        } else if (action === "finish") {
          await api.partCncFinish(data.part.id, {});
        }
        toastSuccess("Збережено");
      } catch (err) {
        toastError(err.message);
      }
    });
  });
}

async function handleScan(
  code,
  {
    statusEl,
    detailEl,
    scanInput,
    showCncActions = false,
    closeLabel: _closeLabel = "Згорнути"
  } = {}
) {
  if (statusEl) statusEl.textContent = "Пошук…";
  try {
    const data = await lookupBarcode(code);
    recentScans = [code, ...recentScans.filter((c) => c !== code)].slice(0, 5);
    playScanFeedback();
    toastSuccess("Деталь знайдено");
    if (statusEl) statusEl.textContent = `Знайдено: ${data.part.partName || code}`;

    if (detailEl) {
      detailEl.hidden = false;
      detailEl.innerHTML = renderPartDetail(data, { showCncActions, closeLabel: "← Назад" });
      setScanDetailOpen(true);
      bindPartDetail(detailEl, data, {
        showCncActions,
        scanInput,
        onClose: () => {
          if (statusEl) statusEl.textContent = "Наведіть штрихридер на етикетку";
        }
      });
      detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    const { highlightOperatorOrder3dPart } = await import("./operator-3d.js");
    highlightOperatorOrder3dPart(data.part);
    scanInput?.focus();
  } catch (err) {
    if (statusEl) statusEl.textContent = err.message || "Помилка";
    if (err.message?.includes("fetch") || err.message?.includes("мереж")) {
      toastError("Немає зʼєднання, спробуйте ще раз");
    } else {
      toastError(err.message || "Деталь не знайдено");
    }
    scanInput?.focus();
  }
}

function bindScanControls({
  scanInput,
  statusEl,
  detailEl,
  manualBtn,
  cameraBtn,
  showCncActions = false,
  closeLabel = "← Назад"
}) {
  scannerListener?.destroy();
  scanControlsAbort?.abort();
  scanControlsAbort = new AbortController();
  const { signal } = scanControlsAbort;

  lastScanBindConfig = {
    scanInput,
    statusEl,
    detailEl,
    manualBtn,
    cameraBtn,
    showCncActions,
    closeLabel
  };

  const onScanBack = () => handleOperatorScanBack();
  $("#operatorPartScanBackBtn")?.addEventListener("click", onScanBack, { signal });
  $("#partScanBackBtn")?.addEventListener("click", onScanBack, { signal });
  $("#operatorClientBackBtn")?.addEventListener("click", onScanBack, { signal });

  if (!scanInput) return;

  const onScan = (code) =>
    handleScan(code, { statusEl, detailEl, scanInput, showCncActions, closeLabel });

  attachScannerListener({ scanInput, onScan });

  scanInput.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const v = cleanScanCode(e.target.value);
        e.target.value = "";
        if (v) onScan(v);
      }
    },
    { signal }
  );

  manualBtn?.addEventListener(
    "click",
    () => {
      const v = window.prompt("Введіть код вручну:");
      if (v) onScan(v.trim());
    },
    { signal }
  );

  $("#operatorScanModeScanner")?.addEventListener(
    "click",
    () => {
      setScanMode("scanner");
      attachScannerListener({ scanInput, onScan });
    },
    { signal }
  );

  $("#operatorScanModeCamera")?.addEventListener(
    "click",
    () => {
      setScanMode("camera");
      scannerListener?.destroy();
      scannerListener = null;
      void startCameraScan({ statusEl, onScan });
    },
    { signal }
  );

  cameraBtn?.addEventListener(
    "click",
    () => {
      setScanMode("camera");
      void startCameraScan({ statusEl, onScan });
    },
    { signal }
  );
}

/** Привʼязка вбудованої зони сканування в панелі оператора. */
export function bindOperatorScanPanel(stageKey) {
  if (!isPartScanStage(stageKey)) {
    scannerListener?.destroy();
    scannerListener = null;
    scanControlsAbort?.abort();
    scanControlsAbort = null;
    lastScanBindConfig = null;
    closeOperatorScanPanel();
    return;
  }

  bindScanControls({
    scanInput: $("#operatorScanInput"),
    statusEl: $("#operatorScanStatus"),
    detailEl: $("#operatorPartScanDetail"),
    manualBtn: $("#operatorScanManualBtn"),
    cameraBtn: $("#operatorScanCameraBtn"),
    showCncActions: stageKey === "cutting",
    closeLabel: "← Назад"
  });
  setScanDetailOpen(false);
  setScanPanelOpen(false);
}

/** Відкрити режим сканування (кнопка «Сканувати» в шапці). */
export function openOperatorScanPanel() {
  const section = $("#operatorPartScan");
  const input = $("#operatorScanInput");
  if (!section || !input) {
    toastError("Сканування доступне на етапах: порізка, поклейка, присадка, збірка");
    return;
  }
  setScanPanelOpen(true);
  setScanMode("scanner");
  if (lastScanBindConfig) {
    const onScan = (code) =>
      handleScan(code, {
        statusEl: lastScanBindConfig.statusEl,
        detailEl: lastScanBindConfig.detailEl,
        scanInput: lastScanBindConfig.scanInput,
        showCncActions: lastScanBindConfig.showCncActions,
        closeLabel: lastScanBindConfig.closeLabel
      });
    attachScannerListener({ scanInput: input, onScan });
  }
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  input.focus();
}

/** Чи відкрита панель сканування. */
export function isOperatorScanPanelOpen() {
  const section = $("#operatorPartScan");
  return Boolean(section && !section.hidden);
}

/** Відкрити або згорнути панель сканування (кнопка «Сканувати»). */
export function toggleOperatorScanPanel() {
  if (isOperatorScanPanelOpen()) {
    closeOperatorScanPanel();
  } else {
    openOperatorScanPanel();
  }
}

/** Закрити режим сканування. */
export function closeOperatorScanPanel() {
  const detailEl = $("#operatorPartScanDetail") || $("#partScanDetail");
  closePartScanDetail(detailEl, {
    onClose: () => {
      const statusEl = $("#operatorScanStatus") || $("#scanStatus");
      if (statusEl) statusEl.textContent = "Наведіть штрихридер на етикетку";
    },
    scanInput: $("#operatorScanInput") || $("#scanInput")
  });
  setScanPanelOpen(false);
}

/** Кнопка «Назад» у скануванні: з деталі → до сканера, зі сканера → до черги. */
export function handleOperatorScanBack() {
  const detailEl = $("#operatorPartScanDetail") || $("#partScanDetail");
  const statusEl = $("#operatorScanStatus") || $("#scanStatus");
  const scanInput = $("#operatorScanInput") || $("#scanInput");

  if (detailEl && !detailEl.hidden) {
    closePartScanDetail(detailEl, {
      onClose: () => {
        if (statusEl) statusEl.textContent = "Наведіть штрихридер на етикетку";
      },
      scanInput
    });
    return;
  }
  if (isOperatorScanPanelOpen()) {
    closeOperatorScanPanel();
  }
}

/** @deprecated використовуйте toggleOperatorScanPanel */
export function focusOperatorScanInput() {
  toggleOperatorScanPanel();
}

/** Відкрити сканування камерою (кнопка всередині панелі сканування). */
export function openOperatorCameraScan(stageKey) {
  if (!isPartScanStage(stageKey)) {
    toastError("Сканування доступне на етапах: порізка, поклейка, присадка, збірка");
    return;
  }
  openOperatorScanPanel();
  setScanMode("camera");
  const statusEl = $("#operatorScanStatus") || $("#scanStatus");
  const detailEl = $("#operatorPartScanDetail") || $("#partScanDetail");
  const scanInput = $("#operatorScanInput") || $("#scanInput");
  const onScan = (code) =>
    handleScan(code, {
      statusEl,
      detailEl,
      scanInput,
      showCncActions: stageKey === "cutting",
      closeLabel: "← Назад"
    });
  scannerListener?.destroy();
  scannerListener = null;
  void startCameraScan({ statusEl, onScan });
}

export function bindPartScanView() {
  bindScanControls({
    scanInput: $("#scanInput"),
    statusEl: $("#scanStatus"),
    detailEl: $("#partScanDetail"),
    manualBtn: $("#scanManualBtn"),
    cameraBtn: $("#scanCameraBtn"),
    showCncActions: true,
    closeLabel: "← Назад"
  });
}

async function startCameraScan({ statusEl, onScan }) {
  if (cameraScanCleanup) {
    cameraScanCleanup();
    cameraScanCleanup = null;
  }

  let handled = false;
  let frameId = 0;
  let reader = null;
  let stream = null;
  let modal = null;

  const cleanup = () => {
    cameraScanCleanup = null;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = 0;
    try {
      reader?.reset();
    } catch {
      /* ignore */
    }
    stream?.getTracks().forEach((t) => t.stop());
    modal?.remove();
    $("#operatorScanInput")?.focus();
    $("#scanInput")?.focus();
  };

  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    reader = new BrowserMultiFormatReader();
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" } }
    });

    modal = document.createElement("div");
    modal.className = "scan-camera-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-label", "Сканування штрихкоду камерою");
    modal.innerHTML = `
      <div class="scan-camera-inner">
        <div class="scan-camera-viewport">
          <video id="scanCameraVideo" playsinline autoplay muted></video>
          <div class="scan-camera-frame" aria-hidden="true"></div>
        </div>
        <p class="scan-camera-hint">Наведіть штрихкод у рамку</p>
        <button type="button" class="btn scan-camera-close" id="scanCameraClose">Закрити</button>
      </div>`;
    document.body.appendChild(modal);
    const video = modal.querySelector("#scanCameraVideo");
    video.srcObject = stream;
    await video.play();

    const onDetected = (text) => {
      if (handled) return;
      const code = String(text || "").trim();
      if (!code) return;
      handled = true;
      cleanup();
      onScan(code);
    };

    modal.querySelector("#scanCameraClose")?.addEventListener("click", cleanup);
    modal.addEventListener("click", (e) => {
      if (e.target === modal) cleanup();
    });

    cameraScanCleanup = cleanup;

    if (statusEl) statusEl.textContent = "Наведіть камеру на штрихкод…";

    if (typeof window.BarcodeDetector !== "undefined") {
      const detector = new window.BarcodeDetector({
        formats: ["code_128", "code_39", "ean_13", "ean_8", "qr_code", "data_matrix"]
      });
      const tick = async () => {
        if (handled) return;
        if (video.videoWidth) {
          try {
            const codes = await detector.detect(video);
            if (codes?.length) {
              onDetected(codes[0].rawValue);
              return;
            }
          } catch {
            /* fallback до ZXing */
          }
        }
        frameId = requestAnimationFrame(tick);
      };
      frameId = requestAnimationFrame(tick);
    } else {
      reader.decodeFromVideoElement(video, (result) => {
        if (result) onDetected(result.getText());
      });
    }
  } catch (err) {
    cleanup();
    if (statusEl)
      statusEl.textContent = "Камера недоступна — дозволіть доступ або введіть код вручну";
    toastError(err.message || "Камера недоступна");
  }
}

export function destroyPartScanView() {
  scannerListener?.destroy();
  scannerListener = null;
  scanControlsAbort?.abort();
  scanControlsAbort = null;
  lastScanBindConfig = null;
  cameraScanCleanup?.();
  cameraScanCleanup = null;
  viewer?.destroy();
  viewer = null;
  setScanDetailOpen(false);
  setScanPanelOpen(false);
}
