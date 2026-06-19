import { api } from "./api.js";
import { readBrowserFolderLogText } from "./browser-folder-reader.js";
import { getBrowserFolderHandle, putBrowserFolderHandle } from "./browser-folder-store.js";

const CALLBACKS = new Map();
let callbackSeq = 0;

export const BROWSER_PATH_PREFIX = "browser://";

let capsCache = null;

function isAndroidNative() {
  return typeof window.EnverNative?.pickFolder === "function";
}

function browserPickerSupported() {
  return typeof window.showDirectoryPicker === "function";
}

export function isBrowserPickedPath(path) {
  return String(path || "")
    .trim()
    .startsWith(BROWSER_PATH_PREFIX);
}

export function browserPathStorageKey(path) {
  const raw = String(path || "").trim();
  if (!raw.startsWith(BROWSER_PATH_PREFIX)) return null;
  return raw.slice(BROWSER_PATH_PREFIX.length) || null;
}

/** Значення для збереження на сервері з поля вводу. */
export function resolvePathInputValue(input) {
  if (!input) return "";
  const browserKey = input.dataset?.browserKey;
  if (browserKey) return `${BROWSER_PATH_PREFIX}${browserKey}`;
  return input.value.trim();
}

export async function fetchFolderPickerCapabilities({ refresh = false } = {}) {
  if (capsCache && !refresh) return capsCache;

  let serverWindows = false;
  try {
    const data = await api.getOperatorFolderPickerCapabilities();
    serverWindows = Boolean(data?.windowsDialog);
  } catch {
    serverWindows = false;
  }

  capsCache = {
    android: isAndroidNative(),
    windowsDialog: serverWindows,
    browserDialog: browserPickerSupported()
  };
  return capsCache;
}

export function folderPickerCapabilities() {
  return (
    capsCache || {
      android: isAndroidNative(),
      windowsDialog: false,
      browserDialog: browserPickerSupported()
    }
  );
}

async function pickFolderAndroid(title) {
  const callbackId = `fp_${Date.now()}_${++callbackSeq}`;
  const promise = new Promise((resolve, reject) => {
    CALLBACKS.set(callbackId, { resolve, reject });
    setTimeout(() => {
      if (!CALLBACKS.has(callbackId)) return;
      CALLBACKS.delete(callbackId);
      reject(new Error("Час вибору папки вичерпано"));
    }, 120_000);
  });

  try {
    window.EnverNative.pickFolder(callbackId, title || "Оберіть папку");
  } catch (err) {
    CALLBACKS.delete(callbackId);
    throw err;
  }

  return promise;
}

async function pickFolderWindowsServer(title) {
  const data = await api.pickOperatorFolder({ title });
  const path = String(data?.path || "").trim();
  if (!path) throw new Error("Папку не обрано");
  return path;
}

async function pickFolderBrowser({ storageKey }) {
  if (!browserPickerSupported()) {
    throw new Error(
      "Браузер не підтримує вибір папки. Спробуйте Chrome або Edge, або введіть мережевий шлях вручну."
    );
  }

  const key = storageKey || `pick_${Date.now()}`;
  let handle;
  try {
    handle = await window.showDirectoryPicker({
      mode: "read",
      startIn: "documents"
    });
  } catch (err) {
    if (err?.name === "AbortError") throw new Error("Скасовано");
    throw err;
  }

  await putBrowserFolderHandle(key, handle);
  return { path: `${BROWSER_PATH_PREFIX}${key}`, label: handle.name, storageKey: key };
}

/** Викликається з Android WebView після вибору папки. */
window.__enverOnFolderPicked = (callbackId, pickedPath) => {
  const cb = CALLBACKS.get(callbackId);
  if (!cb) return;
  CALLBACKS.delete(callbackId);
  const path = String(pickedPath || "").trim();
  if (!path) {
    cb.reject(new Error("Папку не обрано"));
    return;
  }
  cb.resolve(path);
};

/**
 * Відкриває вибір папки:
 * - Android APK — системний провідник
 * - Windows + сервер ENVER на цьому ПК — діалог PowerShell на сервері
 * - Браузер (Chrome/Edge) — папка на комп'ютері користувача, сканування через «Сканувати логи»
 */
export async function pickFolderPath({ title = "Оберіть папку", storageKey } = {}) {
  if (isAndroidNative()) {
    return pickFolderAndroid(title);
  }

  const caps = await fetchFolderPickerCapabilities();

  if (caps.windowsDialog) {
    try {
      return { path: await pickFolderWindowsServer(title), label: null, storageKey: null };
    } catch (err) {
      if (err.status !== 501 && err.status !== 409) throw err;
      if (!caps.browserDialog) {
        throw new Error(
          err.status === 409
            ? "Скасовано"
            : "Діалог Windows на сервері недоступний. Введіть шлях вручну або відкрийте сайт у Chrome/Edge для вибору папки на цьому ПК."
        );
      }
    }
  }

  if (caps.browserDialog) {
    return pickFolderBrowser({ storageKey });
  }

  throw new Error(
    "Вибір папки недоступний. Використайте Chrome/Edge на цьому ПК, додаток Android або введіть мережевий шлях вручну."
  );
}

/** Сканує папку, обрану в браузері, і надсилає логи на сервер. */
export async function ingestBrowserPickedFolder(stageKey, path) {
  const key = browserPathStorageKey(path);
  if (!key) throw new Error("Невірний шлях папки браузера");
  const text = await readBrowserFolderLogText(key);
  return api.ingestOperatorBrowserLogs(stageKey, { text });
}

/** Підставляє зручну назву в поле після завантаження збереженого browser:// шляху. */
export async function applyBrowserPathDisplay(input, path) {
  if (!input) return;
  const key = browserPathStorageKey(path);
  if (!key) {
    delete input.dataset.browserKey;
    input.value = path || "";
    return;
  }
  input.dataset.browserKey = key;
  const handle = await getBrowserFolderHandle(key);
  input.value = handle?.name ? `[Цей ПК] ${handle.name}` : `[Цей ПК] ${key}`;
}

/**
 * Прив'язує кнопку «Обрати папку» до поля шляху.
 */
export function bindFolderPickButton({ button, input, title, storageKey, onPicked }) {
  if (!button || !input) return;

  const key = storageKey || input.id || "folder";

  button.addEventListener("click", async () => {
    const prev = button.textContent;
    button.disabled = true;
    button.textContent = "Відкривається…";
    try {
      const result = await pickFolderPath({ title, storageKey: key });
      const path = typeof result === "string" ? result : result.path;
      const label = typeof result === "string" ? null : result.label;
      const browserKey = typeof result === "string" ? null : result.storageKey;

      if (browserKey) {
        input.dataset.browserKey = browserKey;
        input.value = label ? `[Цей ПК] ${label}` : path;
      } else {
        delete input.dataset.browserKey;
        input.value = path;
      }

      input.dispatchEvent(new Event("input", { bubbles: true }));
      onPicked?.(path);
    } catch (err) {
      if (err.message !== "Скасовано" && err.message !== "Папку не обрано") {
        const { toastError } = await import("./toast.js");
        toastError(err.message || "Не вдалося обрати папку");
      }
    } finally {
      button.disabled = false;
      button.textContent = prev;
    }
  });
}
