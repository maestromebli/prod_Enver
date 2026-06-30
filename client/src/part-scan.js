import { api } from "./api.js";
import { state } from "./state.js";
import { createScannerInputListener } from "./scanner-input.js";
import { escapeHtml, $ } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import {
  CNC_PROBLEM_REASONS,
  formatPartDimensionsMm
} from "@enver/shared/production/constructive-package.js";
import {
  resolvePartHighlightMesh,
  normalizeBazisScanCode
} from "@enver/shared/production/bazis-operation-code.js";
import {
  highlightPartInViewerWindow,
  openPartScanViewerWindow,
  prepareViewerPopup,
  closePreparedViewerPopup
} from "./part-viewer-window.js";
import { isNativeOperatorShell } from "./operator-native.js";
import { prefetchViewerModel, warmPartViewerChunk } from "./part-viewer-prefetch.js";
import { resolveViewerModelUrl } from "./part-viewer-window.js";
import { getStoredToken } from "./api.js";

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
  for (const id of [
    "operatorClientCameraBtn",
    "operatorWorkCameraBtn",
    "operatorScanCameraBtn",
    "operatorScanModeCamera"
  ]) {
    document.getElementById(id)?.remove();
  }
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
let recentScans = [];
let scanControlsAbort = null;
let lastScanBindConfig = null;

function playScanFeedback() {
  if (navigator.vibrate) navigator.vibrate(40);
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
  const pdfUrl = data.model?.assemblyPdfUrl
    ? resolveViewerModelUrl(data.model.assemblyPdfUrl, getStoredToken())
    : null;
  const pdfTarget = isNativeOperatorShell() ? "_self" : "_blank";
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
        ${data.model?.viewerUrl ? `<p class="part-scan-3d-hint enver-meta">3D на панелі роботи — натисніть кнопку нижче для підсвітки деталі</p>` : ""}
      </div>
      <div class="part-detail-actions">
        ${cncActions}
        ${data.model?.viewerUrl ? `<button type="button" class="btn btn-lg btn-primary" data-open-3d>Показати на 3D</button>` : ""}
        ${pdfUrl ? `<a class="btn btn-lg" href="${escapeHtml(pdfUrl)}" target="${pdfTarget}" rel="noopener">Креслення</a>` : ""}
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
        <p class="op-part-scan-hint">Після сканування деталь підсвітиться на 3D-моделі в панелі роботи</p>
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
    .replace('id="operatorPartScanBackBtn"', 'id="partScanBackBtn"')
    .replace('id="operatorPartScanDetail"', 'id="partScanDetail"')
    .replace('class="op-part-scan"', 'class="part-scan-screen"');
}

function syncOperatorScanButtonState(open) {
  for (const id of ["operatorScanBtn", "operatorClientScanBtn"]) {
    const btn = $(`#${id}`);
    if (!btn) continue;
    btn.classList.toggle("is-active", open);
    btn.setAttribute("aria-pressed", String(open));
  }
}

function closePartScanDetail(detailEl, { onClose, scanInput } = {}) {
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

  detailEl.querySelectorAll("[data-part-scan-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closePartScanDetail(detailEl, { onClose, scanInput });
    });
  });

  detailEl.querySelector("[data-open-3d]")?.addEventListener("click", async () => {
    const { highlightOperatorOrder3dPart, getOperatorOrder3dViewer } =
      await import("./operator-3d.js");
    const section = document.getElementById("operatorOrder3dSection");
    if (getOperatorOrder3dViewer() && data.part && highlightOperatorOrder3dPart(data.part)) {
      section?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    openPartScanViewerWindow(data);
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

async function handleScan(
  code,
  {
    statusEl,
    detailEl,
    scanInput,
    showCncActions = false,
    closeLabel: _closeLabel = "Згорнути",
    preparedPopup = null
  } = {}
) {
  if (statusEl) statusEl.textContent = "Пошук…";
  let popup = preparedPopup;
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

    if (data.model?.viewerUrl) {
      const token = getStoredToken();
      const modelUrl = resolveViewerModelUrl(data.model.viewerUrl, token);
      if (modelUrl) void prefetchViewerModel(modelUrl, token);
      void warmPartViewerChunk();
      const opened = openPartScanViewerWindow(data, { preparedPopup: popup });
      popup = null;
      if (!opened && !isNativeOperatorShell()) {
        toastError("Натисніть «Відкрити 3D» або дозвольте нові вкладки");
      }
    } else {
      if (popup) closePreparedViewerPopup(popup);
      popup = null;
      highlightPartInViewerWindow(data.part, { cadGeometry: data.cadGeometry });
    }

    scanInput?.focus();
  } catch (err) {
    if (popup) closePreparedViewerPopup(popup);
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
    showCncActions,
    closeLabel
  };

  const onScanBack = () => handleOperatorScanBack();
  $("#operatorPartScanBackBtn")?.addEventListener("click", onScanBack, { signal });
  $("#partScanBackBtn")?.addEventListener("click", onScanBack, { signal });
  $("#operatorClientBackBtn")?.addEventListener("click", onScanBack, { signal });

  if (!scanInput) return;

  const onScan = (code) => {
    const preparedPopup = prepareViewerPopup();
    void handleScan(code, {
      statusEl,
      detailEl,
      scanInput,
      showCncActions,
      closeLabel,
      preparedPopup
    });
  };

  attachScannerListener({ scanInput, onScan });

  scanInput.addEventListener(
    "input",
    (e) => {
      const v = cleanScanCode(e.target.value);
      if (v && v !== e.target.value) e.target.value = v;
    },
    { signal }
  );

  scanInput.addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const preparedPopup = prepareViewerPopup();
        const v = cleanScanCode(e.target.value);
        e.target.value = "";
        if (v) {
          void handleScan(v, {
            statusEl,
            detailEl,
            scanInput,
            showCncActions,
            closeLabel,
            preparedPopup
          });
        } else {
          closePreparedViewerPopup(preparedPopup);
        }
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
  void warmPartViewerChunk();
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

export function bindPartScanView() {
  bindScanControls({
    scanInput: $("#scanInput"),
    statusEl: $("#scanStatus"),
    detailEl: $("#partScanDetail"),
    manualBtn: $("#scanManualBtn"),
    showCncActions: true,
    closeLabel: "← Назад"
  });
}

export function destroyPartScanView() {
  scannerListener?.destroy();
  scannerListener = null;
  scanControlsAbort?.abort();
  scanControlsAbort = null;
  lastScanBindConfig = null;
  setScanDetailOpen(false);
  setScanPanelOpen(false);
}
