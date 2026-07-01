/** Сканування штрихкоду/QR камерою планшета (BarcodeDetector API). */

let activeSession = null;

function ensureOverlay() {
  let root = document.getElementById("enverCameraScanner");
  if (root) return root;

  root = document.createElement("div");
  root.id = "enverCameraScanner";
  root.className = "enver-camera-scanner";
  root.hidden = true;
  root.innerHTML = `
    <div class="enver-camera-scanner__backdrop" data-camera-close></div>
    <div class="enver-camera-scanner__panel" role="dialog" aria-modal="true" aria-label="Сканування камерою">
      <video class="enver-camera-scanner__video" id="enverCameraScannerVideo" playsinline muted autoplay></video>
      <div class="enver-camera-scanner__frame" aria-hidden="true"></div>
      <p class="enver-camera-scanner__hint">Наведіть камеру на етикетку деталі</p>
      <button type="button" class="btn btn-primary enver-camera-scanner__close" data-camera-close>Закрити</button>
      <p class="enver-camera-scanner__error" id="enverCameraScannerError" role="alert" hidden></p>
    </div>`;
  document.body.appendChild(root);
  return root;
}

function stopStream(stream) {
  stream?.getTracks?.().forEach((track) => track.stop());
}

function closeCameraScanner() {
  const root = document.getElementById("enverCameraScanner");
  if (activeSession) {
    stopStream(activeSession.stream);
    activeSession.abort?.abort();
    activeSession = null;
  }
  const video = root?.querySelector("#enverCameraScannerVideo");
  if (video) video.srcObject = null;
  if (root) root.hidden = true;
}

function showCameraError(message) {
  const errEl = document.getElementById("enverCameraScannerError");
  if (errEl) {
    errEl.textContent = message;
    errEl.hidden = !message;
  }
}

function mapCameraError(err) {
  const name = err?.name || "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Немає доступу до камери. Дозвольте камеру в налаштуваннях браузера.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "Камера не знайдена на цьому пристрої.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Камера зайнята іншою програмою.";
  }
  return err?.message || "Не вдалося відкрити камеру.";
}

async function detectFromVideo(video, detector) {
  if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
  try {
    const codes = await detector.detect(video);
    const value = codes?.[0]?.rawValue?.trim();
    return value || null;
  } catch {
    return null;
  }
}

/**
 * Відкрити fullscreen overlay і сканувати код камерою.
 * @param {{ onScan: (code: string) => void, onError?: (message: string) => void }} opts
 */
export async function openCameraBarcodeScanner({ onScan, onError } = {}) {
  if (typeof window === "undefined") return false;

  if (!("BarcodeDetector" in window)) {
    const msg =
      "Камера-сканер недоступний у цьому браузері. Використайте HID-сканер або ручний ввід.";
    onError?.(msg);
    return false;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    onError?.("Камера недоступна у цьому браузері.");
    return false;
  }

  closeCameraScanner();

  const root = ensureOverlay();
  root.hidden = false;
  showCameraError("");

  const video = root.querySelector("#enverCameraScannerVideo");
  const abort = new AbortController();
  activeSession = { stream: null, abort };

  const onClose = () => closeCameraScanner();
  root.querySelectorAll("[data-camera-close]").forEach((btn) => {
    btn.addEventListener("click", onClose, { once: true, signal: abort.signal });
  });

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" }
      },
      audio: false
    });
  } catch (err) {
    closeCameraScanner();
    onError?.(mapCameraError(err));
    return false;
  }

  activeSession.stream = stream;
  video.srcObject = stream;
  await video.play().catch(() => {});

  let detector;
  try {
    detector = new BarcodeDetector({
      formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix"]
    });
  } catch (err) {
    closeCameraScanner();
    onError?.(err?.message || "BarcodeDetector недоступний у цьому браузері.");
    return false;
  }

  let handled = false;
  const tick = async () => {
    if (handled || !activeSession) return;
    const code = await detectFromVideo(video, detector);
    if (code) {
      handled = true;
      closeCameraScanner();
      onScan?.(code);
      return;
    }
    if (activeSession) {
      activeSession.raf = requestAnimationFrame(tick);
    }
  };
  activeSession.raf = requestAnimationFrame(tick);

  return true;
}

export function destroyCameraBarcodeScanner() {
  closeCameraScanner();
}
