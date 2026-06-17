import {
  emitRoleNotifications,
  ensureDesktopPermissionIfEnabled,
  getNotificationConfigForCurrentRole,
  notificationWindowOptions,
  reminderSnapshot,
  updateNotificationConfigForCurrentRole
} from "./role-notifications.js";
import { ROLES } from "./users-constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

export function formatNotifyWindowLabel(hours) {
  if (hours === 168) return "7 днів";
  return `${hours} год`;
}

export function notificationsSectionHtml() {
  const cfg = getNotificationConfigForCurrentRole();
  const options = notificationWindowOptions();
  const roleLabel =
    ROLES.find((r) => r.id === state.currentUser?.role)?.label || state.currentUser?.role || "—";

  return `
    <div class="settings-section settings-section--notify">
      <div class="settings-section-header">
        <h2>Сповіщення</h2>
      </div>
      <p class="settings-hint">
        Персональні налаштування для облікового запису
        <strong>${escapeHtml(state.currentUser?.name || "")}</strong>
        (${escapeHtml(roleLabel)}). Зберігаються у цьому браузері.
      </p>
      <div class="settings-notify-form">
        <div class="form-field">
          <label for="notifyWindowHours">Вікно «нових» елементів</label>
          <select id="notifyWindowHours" data-notify-window>
            ${options
              .map(
                (h) =>
                  `<option value="${h}" ${cfg.windowHours === h ? "selected" : ""}>${escapeHtml(formatNotifyWindowLabel(h))}</option>`
              )
              .join("")}
          </select>
          <p class="settings-field-hint">
            У лічильники на дашборді, у цеху та в панелі оператора потрапляють лише замовлення й завдання,
            створені за цей період і ще не переглянуті вами.
          </p>
        </div>
        <label class="checkbox-label settings-notify-check">
          <input type="checkbox" data-notify-sound ${cfg.soundEnabled ? "checked" : ""} />
          Звуковий сигнал при появі нових
        </label>
        <label class="checkbox-label settings-notify-check">
          <input type="checkbox" data-notify-desktop ${cfg.desktopEnabled ? "checked" : ""} />
          Сповіщення на робочому столі (потрібен дозвіл браузера)
        </label>
      </div>
    </div>
  `;
}

let actionsBound = false;

export function bindNotificationSettingsActions(onChange = () => {}) {
  if (actionsBound) return;
  actionsBound = true;

  document.addEventListener("change", async (e) => {
    if (!e.target.closest(".settings-notify-form")) return;

    if (e.target.matches("[data-notify-window]")) {
      updateNotificationConfigForCurrentRole({ windowHours: Number(e.target.value) });
      await emitRoleNotifications(reminderSnapshot());
      onChange();
      return;
    }

    if (e.target.matches("[data-notify-sound]")) {
      updateNotificationConfigForCurrentRole({ soundEnabled: e.target.checked });
      await emitRoleNotifications(reminderSnapshot());
      return;
    }

    if (e.target.matches("[data-notify-desktop]")) {
      updateNotificationConfigForCurrentRole({ desktopEnabled: e.target.checked });
      if (e.target.checked) {
        const perm = await ensureDesktopPermissionIfEnabled();
        if (perm !== "granted") {
          updateNotificationConfigForCurrentRole({ desktopEnabled: false });
          e.target.checked = false;
        }
      }
      await emitRoleNotifications(reminderSnapshot());
    }
  });
}
