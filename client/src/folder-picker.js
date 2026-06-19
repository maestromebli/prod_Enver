import { api } from "./api.js";

const CALLBACKS = new Map();
let callbackSeq = 0;

function isAndroidNative() {
  return typeof window.EnverNative?.pickFolder === "function";
}

export function folderPickerCapabilities() {
  return {
    android: isAndroidNative(),
    windowsDialog: !isAndroidNative()
  };
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
 * Відкриває нативний вибір папки:
 * - Android APK — системний провідник (локальна пам'ять / мережеві сховища)
 * - Windows — діалог на ПК з ENVER-сервером (локальний диск або \\NAS\...)
 */
export async function pickFolderPath({ title = "Оберіть папку" } = {}) {
  if (isAndroidNative()) {
    return pickFolderAndroid(title);
  }

  try {
    return await pickFolderWindowsServer(title);
  } catch (err) {
    if (err.status === 501 || err.status === 409) {
      throw new Error(
        err.status === 409
          ? "Скасовано"
          : "Вибір папки доступний у додатку Android або на Windows-ПК з ENVER-сервером"
      );
    }
    throw err;
  }
}

/**
 * Прив'язує кнопку «Обрати папку» до поля шляху.
 */
export function bindFolderPickButton({ button, input, title, onPicked }) {
  if (!button || !input) return;

  button.addEventListener("click", async () => {
    const prev = button.textContent;
    button.disabled = true;
    button.textContent = "Відкривається…";
    try {
      const path = await pickFolderPath({ title });
      input.value = path;
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
