import {
  desktopPermissionLabel,
  emitRoleNotifications,
  ensureDesktopPermissionIfEnabled,
  getDesktopPermissionStatus,
  getNotificationConfigForCurrentRole,
  markAllRoleNotificationsSeen,
  notificationWindowOptions,
  playNotificationTestSound,
  reminderSnapshot,
  updateNotificationConfigForCurrentRole
} from "./role-notifications.js";
import { godmodeNotificationCount } from "./godmode-notifications.js";
import { ROLES } from "./users-constants.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

export function formatNotifyWindowLabel(hours) {
  if (hours === 168) return "7 днів";
  return `${hours} год`;
}

function notifyCounterCard(label, value, hint) {
  const active = value > 0;
  return `
    <div class="notify-counter-card ${active ? "notify-counter-card--active" : ""}">
      <span class="notify-counter-value">${value}</span>
      <span class="notify-counter-label">${escapeHtml(label)}</span>
      <span class="notify-counter-hint">${escapeHtml(hint)}</span>
    </div>`;
}

export function notificationsSectionHtml() {
  const cfg = getNotificationConfigForCurrentRole();
  const options = notificationWindowOptions();
  const snap = reminderSnapshot();
  const gnCount = godmodeNotificationCount();
  const desktopStatus = getDesktopPermissionStatus();
  const roleLabel =
    ROLES.find((r) => r.id === state.currentUser?.role)?.label || state.currentUser?.role || "—";

  return `
    <div class="settings-section settings-section--notify">
      <div class="settings-section-header">
        <h2>Сповіщення</h2>
      </div>
      <p class="settings-hint">
        Персональні налаштування для
        <strong>${escapeHtml(state.currentUser?.name || "")}</strong>
        (${escapeHtml(roleLabel)}). Зберігаються у цьому браузері.
      </p>

      <div class="notify-status-grid" aria-label="Поточні лічильники">
        ${notifyCounterCard("Нові замовлення", snap.newOrders, "вкладка «Замовлення»")}
        ${notifyCounterCard("Виробничі задачі", snap.newProduction, "цех і позиції")}
        ${notifyCounterCard("Потребує уваги", snap.attentionAlerts, "дашборд і GODMODE")}
        ${state.operatorStage ? notifyCounterCard("Черга оператора", snap.newOperator, "панель цеху") : ""}
        ${notifyCounterCard("Системні", gnCount, "дзвіночок у шапці")}
      </div>

      <div class="notify-actions-row">
        <button type="button" class="btn btn-sm" data-notify-mark-seen>
          Позначити все переглянутим
        </button>
        <button type="button" class="btn btn-sm btn-ghost" data-notify-test-sound ${cfg.soundEnabled ? "" : "disabled"}>
          Перевірити звук
        </button>
      </div>

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
            У лічильники потрапляють замовлення, задачі та позиції, створені за цей період і ще не
            переглянуті вами.
          </p>
        </div>

        <fieldset class="notify-channel-fieldset">
          <legend>Канали сповіщень</legend>
          <label class="checkbox-label settings-notify-check">
            <input type="checkbox" data-notify-sound ${cfg.soundEnabled ? "checked" : ""} />
            Звуковий сигнал при появі нових
          </label>
          <label class="checkbox-label settings-notify-check">
            <input type="checkbox" data-notify-desktop ${cfg.desktopEnabled ? "checked" : ""} />
            Сповіщення на робочому столі
          </label>
          <p class="settings-field-hint">
            Дозвіл браузера:
            <strong data-notify-desktop-status>${escapeHtml(desktopPermissionLabel(desktopStatus))}</strong>
            ${
              desktopStatus !== "granted" && desktopStatus !== "unsupported"
                ? '<button type="button" class="btn btn-sm btn-ghost" data-notify-request-desktop>Запросити дозвіл</button>'
                : ""
            }
          </p>
        </fieldset>

        <details class="notify-help-details">
          <summary>Що саме сповіщає ENVER</summary>
          <ul class="notify-help-list">
            <li><strong>Лічильники</strong> — нові замовлення, задачі в цеху, черга оператора, блокери GODMODE.</li>
            <li><strong>Звук</strong> — лише коли число нових елементів зростає під час роботи (не при оновленні сторінки).</li>
            <li><strong>Дзвіночок</strong> — системні сповіщення (проблеми, AI, прострочення) з сервера.</li>
            <li><strong>Налаштування системи</strong> — користувачі, доступи, ШІ — через ⚙ у шапці (якщо є доступ).</li>
          </ul>
        </details>
      </div>
    </div>
  `;
}

let actionsBound = false;

function refreshDesktopStatusLabel() {
  const el = document.querySelector("[data-notify-desktop-status]");
  if (el) el.textContent = desktopPermissionLabel();
}

export function bindNotificationSettingsActions(onChange = () => {}) {
  if (actionsBound) return;
  actionsBound = true;

  document.addEventListener("change", async (e) => {
    if (!e.target.closest(".settings-notify-form")) return;

    if (e.target.matches("[data-notify-window]")) {
      updateNotificationConfigForCurrentRole({ windowHours: Number(e.target.value) });
      await emitRoleNotifications(reminderSnapshot(), { silent: true });
      onChange();
      return;
    }

    if (e.target.matches("[data-notify-sound]")) {
      updateNotificationConfigForCurrentRole({ soundEnabled: e.target.checked });
      const testBtn = document.querySelector("[data-notify-test-sound]");
      if (testBtn) testBtn.disabled = !e.target.checked;
      await emitRoleNotifications(reminderSnapshot(), { silent: true });
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
      refreshDesktopStatusLabel();
      await emitRoleNotifications(reminderSnapshot(), { silent: true });
      onChange();
    }
  });

  document.addEventListener("click", async (e) => {
    if (!e.target.closest(".settings-section--notify")) return;

    if (e.target.closest("[data-notify-mark-seen]")) {
      markAllRoleNotificationsSeen();
      await emitRoleNotifications(reminderSnapshot(), { silent: true });
      onChange();
      return;
    }

    if (e.target.closest("[data-notify-test-sound]")) {
      playNotificationTestSound();
      return;
    }

    if (e.target.closest("[data-notify-request-desktop]")) {
      const perm = await ensureDesktopPermissionIfEnabled();
      if (perm === "granted") {
        updateNotificationConfigForCurrentRole({ desktopEnabled: true });
        const desktopCb = document.querySelector("[data-notify-desktop]");
        if (desktopCb) desktopCb.checked = true;
      }
      refreshDesktopStatusLabel();
      onChange();
    }
  });
}
