import { api, apiUrl, getStoredToken } from "./api.js";
import { createPartViewerLazy as createPartViewer } from "./part-viewer-lazy.js";
import { createScannerInputListener } from "./scanner-input.js";
import { escapeHtml, $ } from "./utils.js";
import { iconSvg } from "./icons.js";
import { toastError, toastSuccess } from "./toast.js";
import {
  CNC_PROBLEM_REASONS,
  formatPartDimensionsMm
} from "@enver/shared/production/constructive-package.js";

/** Етапи зі скануванням етикеток (верстат і етапи працюють без штрихкодів у системі). */
export const PART_SCAN_OPERATOR_STAGES = [];

export function isPartScanStage(stageKey) {
  return PART_SCAN_OPERATOR_STAGES.includes(stageKey);
}

/** Кнопки сканування в компактній шапці operator.html / Android APK. */
export function syncOperatorClientScanButtons(stageKey) {
  const show = isPartScanStage(stageKey);
  $("#operatorClientScanBtn")?.toggleAttribute("hidden", !show);
  $("#operatorClientCameraBtn")?.toggleAttribute("hidden", !show);
}

/** @deprecated використовуйте syncOperatorClientScanButtons */
export function syncOperatorClientScanButton(stageKey) {
  syncOperatorClientScanButtons(stageKey);
}

/** Помітні кнопки сканування над панеллю дій (планшет / APK). */
export function renderOperatorScanActionButton(stageKey) {
  if (!isPartScanStage(stageKey)) return "";
  if (!document.body?.classList.contains("operator-client-mode")) return "";
  return `
    <div class="op-work-scan-row">
      <button
        type="button"
        class="op-work-scan-btn enver-pressable"
        id="operatorWorkScanBtn"
        title="Сканування штрихридером"
      >
        <span class="op-scan-glyph" aria-hidden="true">${iconSvg("barcode")}</span>
        <span>Штрихридер</span>
      </button>
      <button
        type="button"
        class="op-work-scan-btn op-work-scan-btn--camera enver-pressable"
        id="operatorWorkCameraBtn"
        title="Сканування камерою"
      >
        <span class="op-camera-glyph" aria-hidden="true">${iconSvg("camera")}</span>
        <span>Камера</span>
      </button>
    </div>`;
}

let scannerListener = null;
let viewer = null;
let recentScans = [];
let scanControlsAbort = null;
let cameraScanCleanup = null;

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

async function lookupBarcode(code) {
  return api.scanPart(code);
}

function renderPartDetail(data, { showCncActions = false, closeLabel = "← Назад" } = {}) {
  const p = data.part;
  const unmapped = !data.model?.mapped;
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
    <section class="op-part-scan" id="operatorPartScan" aria-label="Сканування деталі">
      <div class="op-part-scan-head">
        <div class="op-part-scan-head-row">
          <button type="button" class="btn btn-sm op-part-scan-back" id="operatorPartScanBackBtn" hidden>← Назад</button>
          <h3 class="op-part-scan-title">Сканування деталі</h3>
        </div>
        <p class="op-part-scan-hint">Штрихридер, камера або ручний ввід — деталь зʼявиться у 3D з підсвіткою</p>
      </div>
      <div class="op-part-scan-bar">
        <input
          type="text"
          id="operatorScanInput"
          class="scan-input op-scan-input"
          placeholder="Очікую сканування…"
          autocomplete="off"
          inputmode="none"
        />
        <p class="part-scan-status" id="operatorScanStatus" aria-live="polite">Режим сканера активний</p>
      </div>
      <div class="op-part-scan-actions">
        <button type="button" class="btn scan-btn" id="operatorScanManualBtn">Ввести вручну</button>
        <button type="button" class="btn scan-btn" id="operatorScanCameraBtn">Камера</button>
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
    if (data.part.modelMeshName || data.part.modelNodeId) {
      viewer.highlightPart({
        meshName: data.part.modelMeshName || data.part.modelNodeId,
        ghost: true
      });
    }
  } catch {
    toastError("Не вдалося завантажити 3D модель");
  }
}

function setScanDetailOpen(open) {
  $("#operatorPartScan")?.classList.toggle("is-detail-open", open);
  const panelBack = $("#operatorPartScanBackBtn") || $("#partScanBackBtn");
  if (panelBack) panelBack.hidden = !open;
  const headerBack = $("#operatorClientBackBtn");
  if (headerBack) headerBack.hidden = !open;
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
      if (action === "isolate") viewer?.isolatePart(data.part.modelMeshName);
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
  { statusEl, detailEl, scanInput, showCncActions = false, closeLabel = "Згорнути" } = {}
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
          if (statusEl) statusEl.textContent = "Режим сканера активний";
        }
      });
      detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
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

  if (!scanInput) return;

  const onScan = (code) =>
    handleScan(code, { statusEl, detailEl, scanInput, showCncActions, closeLabel });

  const onBackFromDetail = () => {
    if (!detailEl || detailEl.hidden) return;
    closePartScanDetail(detailEl, {
      onClose: () => {
        if (statusEl) statusEl.textContent = "Режим сканера активний";
      },
      scanInput
    });
  };

  scannerListener = createScannerInputListener({
    target: document,
    scanField: scanInput,
    onScan,
    onManualSubmit: onScan
  });

  scanInput.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        const v = e.target.value.trim();
        if (v) onScan(v);
        e.target.value = "";
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

  $("#operatorPartScanBackBtn")?.addEventListener("click", onBackFromDetail, { signal });
  $("#partScanBackBtn")?.addEventListener("click", onBackFromDetail, { signal });
  $("#operatorClientBackBtn")?.addEventListener("click", onBackFromDetail, { signal });

  cameraBtn?.addEventListener(
    "click",
    () => {
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
}

/** Фокус на полі сканування (кнопка в шапці панелі). */
export function focusOperatorScanInput() {
  const section = $("#operatorPartScan");
  const input = $("#operatorScanInput");
  if (!section || !input) {
    toastError("Сканування доступне на етапах: порізка, поклейка, присадка, збірка");
    return;
  }
  section.scrollIntoView({ behavior: "smooth", block: "nearest" });
  input.focus();
}

/** Відкрити сканування камерою (кнопки в шапці / робочій зоні). */
export function openOperatorCameraScan(stageKey) {
  if (!isPartScanStage(stageKey)) {
    toastError("Сканування доступне на етапах: порізка, поклейка, присадка, збірка");
    return;
  }
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
  $("#operatorPartScan")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
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
  cameraScanCleanup?.();
  cameraScanCleanup = null;
  viewer?.destroy();
  viewer = null;
  setScanDetailOpen(false);
}
