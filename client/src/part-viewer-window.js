/** Відкриття 3D у окремому вікні (панель оператора, скан). */

import { apiUrl } from "./api.js";
import { isNativeOperatorShell } from "./operator-native.js";

const VIEWER_WINDOW_NAME = "enver-3d-viewer";
const VIEWER_RETURN_KEY = "enver_viewer_return";
const VIEWER_SCAN_KEY = "enver_viewer_scan";
const VIEWER_FEATURES =
  "popup=yes,width=1360,height=900,menubar=no,toolbar=no,location=no,status=no";

let viewerPopup = null;

function isMobileLikeDevice() {
  return (
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ||
    (navigator.maxTouchPoints > 1 && window.innerWidth < 1200)
  );
}

/** Синхронно відкрити вікно (до await) — інакше браузер блокує popup. */
export function prepareViewerPopup() {
  if (isNativeOperatorShell()) return null;
  if (viewerPopup && !viewerPopup.closed) {
    return viewerPopup;
  }
  try {
    viewerPopup = window.open("about:blank", VIEWER_WINDOW_NAME);
    return viewerPopup;
  } catch {
    return null;
  }
}

export function closePreparedViewerPopup(popup = viewerPopup) {
  try {
    if (popup && !popup.closed) popup.close();
  } catch {
    /* ignore */
  }
  if (popup === viewerPopup) viewerPopup = null;
}

function openUrlWithFallback(href) {
  let popup = window.open(href, VIEWER_WINDOW_NAME, VIEWER_FEATURES);
  if (!popup) popup = window.open(href, "_blank");
  if (!popup) {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return null;
  }
  return popup;
}

export function buildViewerUrl({ partId = null, orderId = null, positionId = null } = {}) {
  const url = new URL("/viewer.html", window.location.origin);
  if (partId) url.searchParams.set("partId", String(partId));
  if (orderId) url.searchParams.set("orderId", String(orderId));
  if (positionId) url.searchParams.set("positionId", String(positionId));
  return url.toString();
}

/** Повний URL 3D-файлу (як у viewer-app) для prefetch і mount. */
export function resolveViewerModelUrl(viewerUrl, token = null) {
  if (!viewerUrl) return null;
  let url = apiUrl(viewerUrl);
  if (token && !url.includes("access_token=")) {
    url += (url.includes("?") ? "&" : "?") + `access_token=${encodeURIComponent(token)}`;
  }
  return url;
}

function markViewerReturnPath() {
  try {
    sessionStorage.setItem(
      VIEWER_RETURN_KEY,
      `${window.location.pathname}${window.location.search}${window.location.hash}`
    );
  } catch {
    /* ignore */
  }
}

/** Закрити 3D (popup або повернення в APK/WebView). */
export function closeViewerWindow() {
  if (isNativeOperatorShell() || sessionStorage.getItem(VIEWER_RETURN_KEY)) {
    const ret = sessionStorage.getItem(VIEWER_RETURN_KEY) || "/operator.html";
    sessionStorage.removeItem(VIEWER_RETURN_KEY);
    window.location.assign(ret);
    return;
  }
  try {
    window.close();
  } catch {
    /* ignore */
  }
}

function stashViewerScanPayload(scanPayload, partId) {
  if (!scanPayload?.model?.viewerUrl) return;
  try {
    sessionStorage.setItem(
      VIEWER_SCAN_KEY,
      JSON.stringify({ partId: partId || scanPayload.part?.id || null, payload: scanPayload })
    );
  } catch {
    /* ignore */
  }
}

export function openViewerWindow(params = {}, { preparedPopup = null, scanPayload = null } = {}) {
  const href = buildViewerUrl(params);

  if (isNativeOperatorShell()) {
    markViewerReturnPath();
    stashViewerScanPayload(scanPayload, params.partId);
    window.location.assign(href);
    return null;
  }

  let popup = preparedPopup && !preparedPopup.closed ? preparedPopup : null;

  if (popup) {
    popup.location.replace(href);
    try {
      popup.focus();
    } catch {
      /* ignore */
    }
    viewerPopup = popup;
    return popup;
  }

  if (viewerPopup && !viewerPopup.closed) {
    viewerPopup.location.replace(href);
    viewerPopup.focus?.();
    return viewerPopup;
  }

  if (isMobileLikeDevice()) {
    const opened = openUrlWithFallback(href);
    if (opened) {
      viewerPopup = opened;
      return opened;
    }
    window.location.assign(href);
    return null;
  }

  popup = openUrlWithFallback(href);
  viewerPopup = popup;
  return popup;
}

/** Після скану деталі — лише partId (модель з пакета або order-3d через API getPart). */
export function openPartScanViewerWindow(scanData, options = {}) {
  const partId = scanData?.part?.id;
  if (!partId) return null;
  const positionId = scanData?.position?.id || scanData?.part?.positionId || null;
  return openViewerWindow({ partId, positionId }, { ...options, scanPayload: scanData });
}

export function openOrderViewerWindow(orderId, positionId = null) {
  if (!orderId) return null;
  return openViewerWindow({ orderId, positionId });
}

export function highlightPartInViewerWindow(part, extras = {}) {
  if (!part || !viewerPopup || viewerPopup.closed) return false;
  try {
    viewerPopup.postMessage(
      {
        type: "enver:highlight-part",
        part,
        cadGeometry: extras.cadGeometry || null
      },
      window.location.origin
    );
    viewerPopup.focus();
    return true;
  } catch {
    return false;
  }
}

export function isViewerWindowOpen() {
  return Boolean(viewerPopup && !viewerPopup.closed);
}
