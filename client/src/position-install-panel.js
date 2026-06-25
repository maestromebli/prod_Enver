import { canEditPositions } from "./auth.js";
import { openInstallScheduleModal } from "./install-schedule-modal.js";
import { READY_STATUS, ON_INSTALL_STATUS } from "./install-utils.js";
import { escapeHtml } from "./utils.js";

/** Вкладка «Монтаж» у картці позиції замовлення. */
export function renderPositionInstallPanel(position) {
  const installDate = position.installDate || "";
  const installEnd = position.installDateEnd || position.installEndDate || "";
  const installer = position.installer || "";
  const status = position.positionStatus || "";
  const ready =
    status === READY_STATUS ||
    status === ON_INSTALL_STATUS ||
    String(status).toLowerCase().includes("встановлення");

  const range =
    installDate && installEnd && installEnd !== installDate
      ? `${escapeHtml(installDate)} — ${escapeHtml(installEnd)}`
      : installDate
        ? escapeHtml(installDate)
        : "—";

  return `
    <section class="position-install-panel card">
      <h3 class="drawer-section-title">Монтаж</h3>
      <div class="order-install-summary">
        <div class="order-install-stat">
          <span class="enver-kpi-value">${range}</span>
          <span class="enver-kpi-label">Дата монтажу</span>
        </div>
        <div class="order-install-stat">
          <span class="enver-kpi-value">${installer ? escapeHtml(installer) : "—"}</span>
          <span class="enver-kpi-label">Монтажник</span>
        </div>
        <div class="order-install-stat">
          <span class="enver-kpi-value">${escapeHtml(status || "—")}</span>
          <span class="enver-kpi-label">Статус позиції</span>
        </div>
      </div>
      ${
        ready && !installDate
          ? `<p class="order-install-hint">Позиція готова — заплануйте дату монтажу.</p>`
          : !installDate
            ? `<p class="order-install-hint enver-meta">Монтаж можна запланувати після завершення пакування.</p>`
            : ""
      }
      ${
        canEditPositions()
          ? `<button type="button" class="btn btn-sm btn-primary" data-schedule-install="${position.id}">
              ${installDate ? "Змінити дату монтажу" : "Запланувати монтаж"}
            </button>`
          : ""
      }
    </section>`;
}

export function bindPositionInstallPanel(root, position, { onSaved } = {}) {
  if (!root || !position?.id) return;
  root.querySelector(`[data-schedule-install="${position.id}"]`)?.addEventListener("click", () => {
    openInstallScheduleModal({
      positionId: position.id,
      onSaved: () => onSaved?.()
    });
  });
}
