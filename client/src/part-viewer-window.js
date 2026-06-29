/** Відкриття 3D у окремому вікні (панель оператора, скан). */

const VIEWER_WINDOW_NAME = "enver-3d-viewer";
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

export function openViewerWindow(params = {}, { preparedPopup = null } = {}) {
  const href = buildViewerUrl(params);
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
  return openViewerWindow({ partId, positionId }, options);
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
