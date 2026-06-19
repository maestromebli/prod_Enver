import { api } from "./api.js";
import { readBrowserFolderLogFiles } from "./browser-folder-reader.js";
import {
  getBrowserFolderFiles,
  getBrowserFolderHandle,
  putBrowserFolderFiles,
  putBrowserFolderHandle
} from "./browser-folder-store.js";

const CALLBACKS = new Map();
let callbackSeq = 0;

export const BROWSER_PATH_PREFIX = "browser://";

let capsCache = null;

function isAndroidNative() {
  return typeof window.EnverNative?.pickFolder === "function";
}

function browserPickerSupported() {
  return (
    typeof window.showDirectoryPicker === "function" ||
    typeof document.createElement("input").webkitdirectory !== "undefined"
  );
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

export function isUncPath(rawPath) {
  const s = String(rawPath || "").trim();
  return s.startsWith("\\\\") || /^\/\/[^/\\]/.test(s);
}

export function normalizeUncPath(rawPath) {
  let s = String(rawPath || "").trim();
  if (!s) return "";
  if (s.startsWith("//")) {
    s = `\\\\${s.slice(2).replace(/\//g, "\\")}`;
  } else {
    s = s.replace(/\//g, "\\");
  }
  return s.replace(/\\+$/, "");
}

/** Значення для збереження на сервері з поля вводу. */
export function resolvePathInputValue(input) {
  if (!input) return "";
  const raw = input.value.trim();
  if (isUncPath(raw) || /^[a-zA-Z]:[\\/]/.test(raw)) {
    delete input.dataset.browserKey;
    return isUncPath(raw) ? normalizeUncPath(raw) : raw;
  }
  const browserKey = input.dataset?.browserKey;
  if (browserKey) return `${BROWSER_PATH_PREFIX}${browserKey}`;
  return raw;
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
  const key = storageKey || `pick_${Date.now()}`;

  if (typeof window.showDirectoryPicker === "function") {
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

  if (typeof document.createElement("input").webkitdirectory !== "undefined") {
    return pickFolderViaWebkitInput(key);
  }

  throw new Error(
    "Браузер не підтримує вибір папки. Спробуйте Chrome або Edge, або введіть мережевий шлях вручну."
  );
}

function pickFolderViaWebkitInput(storageKey) {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.webkitdirectory = true;
    input.multiple = true;
    input.style.display = "none";
    document.body.appendChild(input);

    const cleanup = () => {
      input.remove();
    };

    input.addEventListener("change", async () => {
      const files = [...(input.files || [])];
      cleanup();
      if (!files.length) {
        reject(new Error("Скасовано"));
        return;
      }
      try {
        const rootName = files[0].webkitRelativePath?.split("/")[0] || "папка";
        await putBrowserFolderFiles(storageKey, files);
        resolve({
          path: `${BROWSER_PATH_PREFIX}${storageKey}`,
          label: rootName,
          storageKey
        });
      } catch (err) {
        reject(err);
      }
    });

    input.addEventListener("cancel", () => {
      cleanup();
      reject(new Error("Скасовано"));
    });

    input.click();
  });
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

  // Windows-сервер ENVER у мережі — діалог може обрати \\NAS\share
  if (caps.windowsDialog) {
    try {
      const path = await pickFolderWindowsServer(title);
      return { path, label: null, storageKey: null };
    } catch (err) {
      if (err.status === 409) throw new Error("Скасовано");
      if (!caps.browserDialog) throw err;
    }
  }

  // Хмарний ENVER або fallback — папка на ПК користувача (Chrome/Edge)
  if (caps.browserDialog) {
    try {
      return await pickFolderBrowser({ storageKey });
    } catch (err) {
      if (err.message === "Скасовано" || err.message === "Папку не обрано") throw err;
      throw err;
    }
  }

  throw new Error(
    "Вибір папки недоступний. Введіть мережевий шлях вручну (наприклад \\\\192.168.1.203\\KDTsaw) або відкрийте сайт у Chrome/Edge на Windows-ПК."
  );
}

export function validateMachineLogPathForServer(logPath, caps = folderPickerCapabilities()) {
  const p = String(logPath || "").trim();
  if (!p || isBrowserPickedPath(p)) return null;
  if (isUncPath(p) && !caps.windowsDialog) {
    return (
      "Не вводьте \\\\192.168.1.203\\KDTsaw вручну на хмарному ENVER. " +
      "На цьому Windows-ПК натисніть «Обрати папку» у Chrome і виберіть шару KDTsaw."
    );
  }
  return null;
}

/** Сканує папку, обрану в браузері (рекурсивно всі .txt), і надсилає логи на сервер. */
export async function ingestBrowserPickedFolder(stageKey, path, { upload, fullScan = false } = {}) {
  const key = browserPathStorageKey(path);
  if (!key) throw new Error("Невірний шлях папки браузера");
  const files = await readBrowserFolderLogFiles(key);
  const body = { files, fullScan };
  if (upload) return upload(stageKey, body);
  return api.ingestOperatorBrowserLogs(stageKey, body);
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
  if (handle?.name) {
    input.value = `[Цей ПК] ${handle.name}`;
    return;
  }
  const files = await getBrowserFolderFiles(key);
  if (files?.length) {
    const rootName = files[0].name?.split("/")[0] || key;
    input.value = `[Цей ПК] ${rootName}`;
    return;
  }
  input.value = `[Цей ПК] ${key}`;
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
