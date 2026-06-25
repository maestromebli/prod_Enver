import { deriveCurrentStage } from "@enver/shared/production/position-logic.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { escapeHtml } from "./utils.js";
import { toastSuccess } from "./toast.js";

function operatorStage(position) {
  return deriveCurrentStage(position) || position.currentStage || "cutting";
}

function operatorUrl(position) {
  const stage = operatorStage(position);
  const params = new URLSearchParams({ position: String(position.id), stage });
  return `${window.location.origin}/operator.html?${params.toString()}`;
}

/** Звʼязок позиції з панеллю оператора та скануванням деталей. */
export function renderPositionOperatorPanel(position) {
  const stage = operatorStage(position);
  const url = operatorUrl(position);
  const qrHref = `/api/positions/${position.id}/qr?stage=${encodeURIComponent(stage)}`;

  return `
    <section class="position-operator-panel card">
      <h3 class="drawer-section-title">Оператор / цех</h3>
      <p class="enver-meta">Етап: <strong>${escapeHtml(stageLabel(stage))}</strong> · прогрес ${position.progress ?? 0}%</p>
      <div class="constructive-actions">
        <a class="btn btn-sm btn-primary" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
          Відкрити панель оператора
        </a>
        <button type="button" class="btn btn-sm" data-copy-operator-link="${position.id}">Скопіювати посилання</button>
        <a class="btn btn-sm" href="${escapeHtml(qrHref)}" target="_blank" rel="noopener noreferrer">QR-код етапу</a>
      </div>
      <p class="enver-meta">Оператор може сканувати етикетки деталей у 3D-перегляді після release ЧПК.</p>
    </section>`;
}

export function bindPositionOperatorPanel(root, position) {
  if (!root || !position?.id) return;
  root
    .querySelector(`[data-copy-operator-link="${position.id}"]`)
    ?.addEventListener("click", async () => {
      const url = operatorUrl(position);
      try {
        await navigator.clipboard.writeText(url);
        toastSuccess("Посилання скопійовано");
      } catch {
        window.prompt("Посилання для оператора:", url);
      }
    });
}
