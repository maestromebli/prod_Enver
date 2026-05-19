import { toastError, toastSuccess } from "./toast.js";

let saveInFlight = false;

export function isSaveInFlight() {
  return saveInFlight;
}

export function setSubmitLoading(submitEl, loading) {
  if (!submitEl) return;
  submitEl.disabled = loading;
  submitEl.classList.toggle("is-loading", loading);
  submitEl.setAttribute("aria-busy", loading ? "true" : "false");
}

/**
 * Уніфіковане збереження: toast про успіх/помилку та onSuccess (закриття форми, перехід).
 */
export async function runSave(label, options = {}) {
  const {
    saveFn,
    onSuccess,
    onError,
    onFinally,
    successMessage,
    errorMessage,
    submitEl,
    silent = false
  } = options;

  if (saveInFlight) {
    const busy = new Error("Зачекайте — попереднє збереження ще виконується");
    if (!silent) toastError(busy.message);
    throw busy;
  }

  saveInFlight = true;
  setSubmitLoading(submitEl, true);

  try {
    const result = await saveFn();
    if (!silent) {
      toastSuccess(successMessage || (label ? `${label}: збережено` : "Збережено"));
    }
    if (onSuccess) await onSuccess(result);
    return result;
  } catch (err) {
    const detail = err?.message || errorMessage || "Помилка збереження";
    if (!silent) {
      toastError(label ? `${label}: не збережено — ${detail}` : detail);
    }
    if (onError) onError(err);
    throw err;
  } finally {
    saveInFlight = false;
    setSubmitLoading(submitEl, false);
    if (onFinally) onFinally();
  }
}
