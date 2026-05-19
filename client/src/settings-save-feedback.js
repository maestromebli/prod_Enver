import { runSave } from "./save-flow.js";
import { escapeHtml } from "./utils.js";

let feedback = null;

export function isSettingsSaveInFlight() {
  return Boolean(feedback?.type === "saving");
}

export function setSettingsSaveFeedback(type, message) {
  if (!message) {
    feedback = null;
    return;
  }
  feedback = { type, message, at: Date.now() };
}

export function clearSettingsSaveFeedback() {
  feedback = null;
}

export function renderSettingsSaveBanner() {
  if (!feedback) return "";
  const isError = feedback.type === "error";
  const isSaving = feedback.type === "saving";
  const cls = isError
    ? "settings-save-banner--error"
    : isSaving
      ? "settings-save-banner--saving"
      : "settings-save-banner--success";
  const icon = isError ? "✕" : isSaving ? "…" : "✓";
  return `
    <div class="settings-save-banner ${cls}" role="status" aria-live="polite">
      <span class="settings-save-banner-icon" aria-hidden="true">${icon}</span>
      <span>${escapeHtml(feedback.message)}</span>
    </div>
  `;
}

export async function runSettingsSave(label, { saveFn, onSuccess, onReload, submitEl }) {
  setSettingsSaveFeedback("saving", `${label}: збереження…`);

  try {
    const result = await runSave(label, {
      saveFn,
      onSuccess,
      submitEl,
      successMessage: `${label}: успішно збережено`
    });
    setSettingsSaveFeedback("success", `${label}: успішно збережено`);
    if (onReload) onReload();
    return result;
  } catch (err) {
    const msg = `${label}: не збережено — ${err.message || "помилка"}`;
    setSettingsSaveFeedback("error", msg);
    if (onReload) onReload();
    throw err;
  }
}
