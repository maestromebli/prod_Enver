import { api, apiUrl, getStoredToken } from "./api.js";
import { createPartViewerLazy as createPartViewer } from "./part-viewer-lazy.js";
import {
  createScannerInputListener,
  getStationName,
  setStationName,
  STATION_STORAGE_KEY
} from "./scanner-input.js";
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { CNC_PROBLEM_REASONS } from "@enver/shared/production/constructive-package.js";
import { $ } from "./utils.js";

let scannerListener = null;
let viewer = null;
let lastScan = null;
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

export function renderPartScanView() {
  const station = getStationName();
  return `
    <div class="part-scan-screen">
      <header class="part-scan-header">
        <h1 class="part-scan-title">Сканування деталі</h1>
        <p class="part-scan-hint">Піднесіть сканер до штрихкоду на деталі</p>
      </header>
      <div class="part-scan-input-wrap">
        <input type="text" id="scanInput" class="scan-input" placeholder="Очікую сканування…" autocomplete="off" autofocus />
        <p class="part-scan-status" id="scanStatus" aria-live="polite">Режим сканера активний</p>
      </div>
      <div class="part-scan-actions">
        <button type="button" class="btn btn-lg scan-btn" id="scanManualBtn">Ввести вручну</button>
        <button type="button" class="btn btn-lg scan-btn" id="scanCameraBtn">Сканувати камерою</button>
      </div>
      <div class="part-scan-station">
        <label>Назва робочого місця
          <input type="text" id="stationNameInput" value="${escapeHtml(station)}" placeholder="CNC-1"/>
        </label>
      </div>
      <section class="part-scan-recent" id="scanRecent">
        ${recentScans.length ? recentScans.map((s) => `<div class="scan-recent-item">${escapeHtml(s)}</div>`).join("") : "<p class='enver-meta'>Останні сканування зʼявляться тут</p>"}
      </section>
      <div id="partScanDetail" class="part-scan-detail" hidden></div>
    </div>`;
}

function renderPartDetail(data) {
  const p = data.part;
  const unmapped = !data.model?.mapped;
  return `
    <div class="part-detail-card">
      <div class="part-detail-meta">
        <p><strong>${escapeHtml(data.order?.orderNumber || "")}</strong> · ${escapeHtml(data.position?.item || "")}</p>
        <p>${escapeHtml(p.blockCode || "—")} · №${escapeHtml(p.partNo)} · ${escapeHtml(p.partName)}</p>
        <p>${escapeHtml(p.material)} · ${escapeHtml(p.length)}×${escapeHtml(p.width)} ${escapeHtml(p.thickness)}</p>
        ${p.edgeCode ? `<p>Кромка: ${escapeHtml(p.edgeCode)}</p>` : ""}
        <p class="part-cnc-status">ЧПК: ${escapeHtml(p.cncStatus || "—")}</p>
        ${unmapped ? `<p class="part-scan-warning">Ця деталь ще не звʼязана з 3D-моделлю.</p>` : ""}
      </div>
      <div id="partViewer3d" class="part-viewer-3d"></div>
      <div class="part-detail-actions">
        <button type="button" class="btn btn-lg btn-primary" data-cnc-action="start">Почати</button>
        <button type="button" class="btn btn-lg btn-primary" data-cnc-action="finish">Готово</button>
        <button type="button" class="btn btn-lg btn-danger" data-cnc-action="problem">Проблема</button>
        <button type="button" class="btn btn-lg" data-viewer-action="isolate">Тільки деталь</button>
        <button type="button" class="btn btn-lg" data-viewer-action="all">Весь виріб</button>
        <button type="button" class="btn btn-lg" data-viewer-action="reset">Скинути камеру</button>
        ${data.model?.assemblyPdfUrl ? `<a class="btn btn-lg" href="${escapeHtml(data.model.assemblyPdfUrl)}" target="_blank" rel="noopener">Креслення</a>` : ""}
        <button type="button" class="btn btn-lg" id="closePartDetail">← Сканування</button>
      </div>
    </div>`;
}

async function handleScan(code) {
  const status = $("#scanStatus");
  if (status) status.textContent = "Пошук…";
  try {
    const data = await lookupBarcode(code);
    lastScan = data;
    recentScans = [code, ...recentScans.filter((c) => c !== code)].slice(0, 5);
    playScanFeedback();
    toastSuccess("Деталь знайдено");
    if (status) status.textContent = "Деталь знайдено";

    const detail = $("#partScanDetail");
    if (detail) {
      detail.hidden = false;
      detail.innerHTML = renderPartDetail(data);
      bindPartDetail(data);
    }
    $("#scanInput")?.focus();
  } catch (err) {
    if (status) status.textContent = err.message || "Помилка";
    if (err.message?.includes("fetch") || err.message?.includes("мереж")) {
      toastError("Немає зʼєднання, спробуйте ще раз");
    } else {
      toastError(err.message || "Деталь не знайдено");
    }
    $("#scanInput")?.focus();
  }
}

function bindPartDetail(data) {
  viewer?.destroy();
  const detailEl = $("#partScanDetail");
  const container = $("#partViewer3d");
  if (container && data.model?.viewerUrl) {
    viewer = createPartViewer(container);
    const url = modelFileUrl(data.model.viewerUrl);
    viewer
      .loadModel(url, getStoredToken())
      .then(() => {
        if (data.part.modelMeshName || data.part.modelNodeId) {
          viewer.highlightPart({
            meshName: data.part.modelMeshName || data.part.modelNodeId,
            ghost: true
          });
        }
      })
      .catch(() => {});
  }

  $("#closePartDetail")?.addEventListener("click", () => {
    viewer?.destroy();
    viewer = null;
    const detail = $("#partScanDetail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
    $("#scanInput")?.focus();
  });

  detailEl?.querySelectorAll("[data-viewer-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.viewerAction;
      if (action === "isolate") viewer?.isolatePart(data.part.modelMeshName);
      if (action === "all") viewer?.showAll();
      if (action === "reset") viewer?.resetCamera();
    });
  });

  detailEl?.querySelectorAll("[data-cnc-action]").forEach((btn) => {
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

export function bindPartScanView() {
  scannerListener?.destroy();
  scannerListener = createScannerInputListener({
    target: $("#scanInput"),
    onScan: (code) => handleScan(code),
    onManualSubmit: (code) => handleScan(code)
  });

  $("#scanInput")?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = e.target.value.trim();
      if (v) handleScan(v);
      e.target.value = "";
    }
  });

  $("#scanManualBtn")?.addEventListener("click", () => {
    const v = window.prompt("Введіть код вручну:");
    if (v) handleScan(v.trim());
  });

  $("#stationNameInput")?.addEventListener("change", (e) => {
    setStationName(e.target.value);
  });

  $("#scanCameraBtn")?.addEventListener("click", () => {
    void startCameraScan();
  });

  requestAnimationFrame(() => $("#scanInput")?.focus());
}

async function startCameraScan() {
  const status = $("#scanStatus");
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
      $("#scanInput")?.focus();
    };

    modal.querySelector("#scanCameraClose")?.addEventListener("click", cleanup);

    if (status) status.textContent = "Наведіть камеру на штрихкод…";
    reader.decodeFromVideoDevice(undefined, v, (result) => {
      if (result) {
        cleanup();
        handleScan(result.getText());
      }
    });
  } catch (err) {
    if (status) status.textContent = "Камера недоступна — дозволіть доступ або введіть код вручну";
    toastError(err.message || "Камера недоступна");
  }
}

export function destroyPartScanView() {
  scannerListener?.destroy();
  scannerListener = null;
  viewer?.destroy();
  viewer = null;
}
