/** Відкриття 3D у окремому вікні (панель оператора, скан). */

const VIEWER_WINDOW_NAME = "enver-3d-viewer";
const VIEWER_FEATURES =
  "popup=yes,width=1360,height=900,menubar=no,toolbar=no,location=no,status=no";

let viewerPopup = null;

export function buildViewerUrl({ partId = null, orderId = null, positionId = null } = {}) {
  const url = new URL("/viewer.html", window.location.origin);
  if (partId) url.searchParams.set("partId", String(partId));
  if (orderId) url.searchParams.set("orderId", String(orderId));
  if (positionId) url.searchParams.set("positionId", String(positionId));
  return url.toString();
}

export function openViewerWindow(params = {}) {
  const href = buildViewerUrl(params);
  if (viewerPopup && !viewerPopup.closed) {
    viewerPopup.location.replace(href);
    viewerPopup.focus();
  } else {
    viewerPopup = window.open(href, VIEWER_WINDOW_NAME, VIEWER_FEATURES);
  }
  return viewerPopup;
}

export function openPartScanViewerWindow(scanData) {
  const partId = scanData?.part?.id;
  if (!partId) return null;
  const orderId = scanData?.order?.id || scanData?.part?.orderId || null;
  const positionId = scanData?.position?.id || scanData?.part?.positionId || null;
  return openViewerWindow({ partId, orderId, positionId });
}

export function openOrderViewerWindow(orderId, positionId = null) {
  if (!orderId) return null;
  return openViewerWindow({ orderId, positionId });
}

export function highlightPartInViewerWindow(part) {
  if (!part || !viewerPopup || viewerPopup.closed) return false;
  try {
    viewerPopup.postMessage({ type: "enver:highlight-part", part }, window.location.origin);
    viewerPopup.focus();
    return true;
  } catch {
    return false;
  }
}

export function isViewerWindowOpen() {
  return Boolean(viewerPopup && !viewerPopup.closed);
}
