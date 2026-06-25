import { api, apiUrl, getStoredToken } from "./api.js";
import { createPartViewerLazy as createPartViewer } from "./part-viewer-lazy.js";
import { createScannerInputListener, getStationName, setStationName } from "./scanner-input.js";
import { escapeHtml, $ } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { CNC_PROBLEM_REASONS } from "@enver/shared/production/constructive-package.js";

/** Етапи, де оператор сканує деталі за штрихкодом. */
export const PART_SCAN_OPERATOR_STAGES = ["cutting", "edging", "drilling", "assembly"];

export function isPartScanStage(stageKey) {
  return PART_SCAN_OPERATOR_STAGES.includes(stageKey);
}

/** Кнопка «Сканувати» в компактній шапці operator.html / Android APK. */
export function syncOperatorClientScanButton(stageKey) {
  const btn = $("#operatorClientScanBtn");
  if (!btn) return;
  btn.hidden = !isPartScanStage(stageKey);
}

let scannerListener = null;
let viewer = null;
let recentScans = [];

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
  const station = getStationName();
  return api.scanPart(code, station);
}

function renderPartDetail(data, { showCncActions = false, closeLabel = "← Сканування" } = {}) {
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
      <div class="part-detail-meta">
        <p><strong>${escapeHtml(data.order?.orderNumber || "")}</strong> · ${escapeHtml(data.position?.item || "")}</p>
        <p>${escapeHtml(p.blockCode || "—")} · №${escapeHtml(p.partNo)} · ${escapeHtml(p.partName)}</p>
        <p>${escapeHtml(p.material)} · ${escapeHtml(p.length)}×${escapeHtml(p.width)} ${escapeHtml(p.thickness)}</p>
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
  const station = getStationName();
  return `
    <section class="op-part-scan" id="operatorPartScan" aria-label="Сканування деталі">
      <div class="op-part-scan-head">
        <h3 class="op-part-scan-title">Сканування деталі</h3>
        <p class="op-part-scan-hint">Піднесіть штрихридер до етикетки — деталь зʼявиться у 3D з підсвіткою</p>
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
      <div class="op-part-scan-station">
        <label>Робоче місце
          <input type="text" id="operatorStationInput" value="${escapeHtml(station)}" placeholder="CNC-1"/>
        </label>
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
    .replace('id="operatorStationInput"', 'id="stationNameInput"')
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
    await viewer.loadModel(url, getStoredToken());
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

function bindPartDetail(detailEl, data, { showCncActions = false, onClose, scanInput } = {}) {
  if (!detailEl) return;

  const container = detailEl.querySelector("[data-part-viewer]");
  void mountViewer(container, data);

  detailEl.querySelector("[data-part-scan-close]")?.addEventListener("click", () => {
    viewer?.destroy();
    viewer = null;
    detailEl.hidden = true;
    detailEl.innerHTML = "";
    onClose?.();
    scanInput?.focus();
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
      const station = getStationName();
      try {
        if (action === "problem") {
          const reason = window.prompt(
            `Причина проблеми:\n${CNC_PROBLEM_REASONS.join("\n")}`,
            "Інше"
          );
          if (!reason) return;
          await api.partCncProblem(data.part.id, { reason, station });
        } else if (action === "start") {
          await api.partCncStart(data.part.id, { station });
        } else if (action === "finish") {
          await api.partCncFinish(data.part.id, { station });
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
      detailEl.innerHTML = renderPartDetail(data, { showCncActions, closeLabel });
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
  stationInput,
  showCncActions = false,
  closeLabel = "Згорнути"
}) {
  scannerListener?.destroy();
  if (!scanInput) return;

  const onScan = (code) =>
    handleScan(code, { statusEl, detailEl, scanInput, showCncActions, closeLabel });

  scannerListener = createScannerInputListener({
    target: document,
    scanField: scanInput,
    onScan,
    onManualSubmit: onScan
  });

  scanInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = e.target.value.trim();
      if (v) onScan(v);
      e.target.value = "";
    }
  });

  manualBtn?.addEventListener("click", () => {
    const v = window.prompt("Введіть код вручну:");
    if (v) onScan(v.trim());
  });

  stationInput?.addEventListener("change", (e) => {
    setStationName(e.target.value);
  });

  cameraBtn?.addEventListener("click", () => {
    void startCameraScan({ statusEl, onScan });
  });
}

/** Привʼязка вбудованої зони сканування в панелі оператора. */
export function bindOperatorScanPanel(stageKey) {
  if (!isPartScanStage(stageKey)) {
    scannerListener?.destroy();
    scannerListener = null;
    return;
  }

  bindScanControls({
    scanInput: $("#operatorScanInput"),
    statusEl: $("#operatorScanStatus"),
    detailEl: $("#operatorPartScanDetail"),
    manualBtn: $("#operatorScanManualBtn"),
    cameraBtn: $("#operatorScanCameraBtn"),
    stationInput: $("#operatorStationInput"),
    showCncActions: stageKey === "cutting",
    closeLabel: "Згорнути"
  });
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

export function bindPartScanView() {
  bindScanControls({
    scanInput: $("#scanInput"),
    statusEl: $("#scanStatus"),
    detailEl: $("#partScanDetail"),
    manualBtn: $("#scanManualBtn"),
    cameraBtn: $("#scanCameraBtn"),
    stationInput: $("#stationNameInput"),
    showCncActions: true,
    closeLabel: "← Сканування"
  });
}

async function startCameraScan({ statusEl, onScan }) {
  try {
    const { BrowserMultiFormatReader } = await import("@zxing/browser");
    const reader = new BrowserMultiFormatReader();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment" }
    });

    const modal = document.createElement("div");
    modal.className = "scan-camera-modal";
    modal.innerHTML = `<div class="scan-camera-inner"><video id="scanCameraVideo" playsinline autoplay muted></video><button type="button" class="btn" id="scanCameraClose">Закрити</button></div>`;
    document.body.appendChild(modal);
    const v = modal.querySelector("#scanCameraVideo");
    v.srcObject = stream;
    await v.play();

    const cleanup = () => {
      try {
        reader.reset();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
      modal.remove();
      $("#operatorScanInput")?.focus();
      $("#scanInput")?.focus();
    };

    modal.querySelector("#scanCameraClose")?.addEventListener("click", cleanup);

    if (statusEl) statusEl.textContent = "Наведіть камеру на штрихкод…";
    reader.decodeFromVideoDevice(undefined, v, (result) => {
      if (result) {
        cleanup();
        onScan(result.getText());
      }
    });
  } catch (err) {
    if (statusEl)
      statusEl.textContent = "Камера недоступна — дозволіть доступ або введіть код вручну";
    toastError(err.message || "Камера недоступна");
  }
}

export function destroyPartScanView() {
  scannerListener?.destroy();
  scannerListener = null;
  viewer?.destroy();
  viewer = null;
}
