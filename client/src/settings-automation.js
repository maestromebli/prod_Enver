import { api } from "./api.js";
import { escapeHtml } from "./utils.js";
import { runSettingsSave } from "./settings-save-feedback.js";

let automationSettings = {
  autoCreateTasksFromAi: false,
  autoCreateTasksMinConfidence: 0.8,
  autoCreateTasksRequireSafeQuality: true,
  overdueDigestEnabled: false,
  overdueDigestHourKyiv: 9,
  overdueDigestWebhookUrl: "",
  overdueDigestSendWhenEmpty: false,
  procurementWebhookEnabled: false,
  procurementWebhookUrl: "",
  lastOverdueDigestDate: ""
};

export function mergeAutomationSettings(data) {
  if (!data || typeof data !== "object") return;
  automationSettings = {
    autoCreateTasksFromAi: data.autoCreateTasksFromAi === true,
    autoCreateTasksMinConfidence: Number(data.autoCreateTasksMinConfidence) || 0.8,
    autoCreateTasksRequireSafeQuality: data.autoCreateTasksRequireSafeQuality !== false,
    overdueDigestEnabled: data.overdueDigestEnabled === true,
    overdueDigestHourKyiv: Number(data.overdueDigestHourKyiv) || 9,
    overdueDigestWebhookUrl: data.overdueDigestWebhookUrl || "",
    overdueDigestSendWhenEmpty: data.overdueDigestSendWhenEmpty === true,
    procurementWebhookEnabled: data.procurementWebhookEnabled === true,
    procurementWebhookUrl: data.procurementWebhookUrl || "",
    lastOverdueDigestDate: data.lastOverdueDigestDate || ""
  };
}

export async function loadAutomationSettings() {
  const data = await api.getAutomationSettings();
  mergeAutomationSettings(data);
  return automationSettings;
}

function hourOptions(selected) {
  return Array.from({ length: 24 }, (_, hour) => {
    const label = `${String(hour).padStart(2, "0")}:00 (Київ)`;
    return `<option value="${hour}" ${hour === selected ? "selected" : ""}>${label}</option>`;
  }).join("");
}

export function automationSectionHtml() {
  const s = automationSettings;
  return `
    <div class="settings-section automation-settings-page">
      <div class="settings-section-header">
        <h2>Автоматизація</h2>
        <span class="badge ${s.autoCreateTasksFromAi || s.overdueDigestEnabled || s.procurementWebhookEnabled ? "green" : "gray"}">
          ${s.autoCreateTasksFromAi || s.overdueDigestEnabled || s.procurementWebhookEnabled ? "Увімкнено частково" : "Вимкнено"}
        </span>
      </div>
      <p class="settings-hint">
        Фонові дії та зовнішні webhook (n8n, Make, Zapier). Email-ескалації підключайте через webhook у вашій автоматизації.
      </p>

      <form class="automation-settings-card" id="automationSettingsForm">
        <h3 class="enver-section-title">ШІ → задачі цеху</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCreateTasksFromAi" ${s.autoCreateTasksFromAi ? "checked" : ""} />
          Автоматично створювати задачі після ШІ (лише коли якість безпечна)
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCreateTasksRequireSafeQuality" ${s.autoCreateTasksRequireSafeQuality ? "checked" : ""} />
          Вимагати <code>safeToCreateTasks</code> від аналізу
        </label>
        <div class="form-field">
          <label for="autoCreateTasksMinConfidence">Мінімальна впевненість етапу</label>
          <input
            id="autoCreateTasksMinConfidence"
            type="number"
            min="0.5"
            max="1"
            step="0.05"
            value="${escapeHtml(String(s.autoCreateTasksMinConfidence))}"
          />
        </div>

        <h3 class="enver-section-title">Дайджест прострочок</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="overdueDigestEnabled" ${s.overdueDigestEnabled ? "checked" : ""} />
          Щоденний webhook зі списком прострочених позицій
        </label>
        <div class="form-field">
          <label for="overdueDigestHourKyiv">Година надсилання (Europe/Kyiv)</label>
          <select id="overdueDigestHourKyiv">${hourOptions(s.overdueDigestHourKyiv)}</select>
        </div>
        <div class="form-field">
          <label for="overdueDigestWebhookUrl">Webhook URL</label>
          <input
            id="overdueDigestWebhookUrl"
            type="url"
            placeholder="https://hooks.example.com/overdue"
            value="${escapeHtml(s.overdueDigestWebhookUrl)}"
          />
        </div>
        <label class="checkbox-label">
          <input type="checkbox" id="overdueDigestSendWhenEmpty" ${s.overdueDigestSendWhenEmpty ? "checked" : ""} />
          Надсилати навіть якщо прострочок немає
        </label>
        ${
          s.lastOverdueDigestDate
            ? `<p class="field-hint">Останній дайджест: ${escapeHtml(s.lastOverdueDigestDate)}</p>`
            : ""
        }

        <h3 class="enver-section-title">Закупівля → постачальник</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="procurementWebhookEnabled" ${s.procurementWebhookEnabled ? "checked" : ""} />
          Webhook при створенні заявки з XLS
        </label>
        <div class="form-field">
          <label for="procurementWebhookUrl">Webhook URL</label>
          <input
            id="procurementWebhookUrl"
            type="url"
            placeholder="https://hooks.example.com/procurement"
            value="${escapeHtml(s.procurementWebhookUrl)}"
          />
        </div>

        <div class="automation-settings-actions">
          <button type="submit" class="btn btn-primary" id="saveAutomationSettingsBtn">Зберегти</button>
          <button type="button" class="btn" id="testOverdueDigestBtn">Тест дайджесту</button>
        </div>
        <p class="form-error" id="automationSettingsError" role="alert"></p>
      </form>
    </div>`;
}

function collectAutomationFromDom() {
  return {
    autoCreateTasksFromAi: Boolean(document.getElementById("autoCreateTasksFromAi")?.checked),
    autoCreateTasksRequireSafeQuality: Boolean(
      document.getElementById("autoCreateTasksRequireSafeQuality")?.checked
    ),
    autoCreateTasksMinConfidence: Number(
      document.getElementById("autoCreateTasksMinConfidence")?.value
    ),
    overdueDigestEnabled: Boolean(document.getElementById("overdueDigestEnabled")?.checked),
    overdueDigestHourKyiv: Number(document.getElementById("overdueDigestHourKyiv")?.value),
    overdueDigestWebhookUrl:
      document.getElementById("overdueDigestWebhookUrl")?.value?.trim() || "",
    overdueDigestSendWhenEmpty: Boolean(
      document.getElementById("overdueDigestSendWhenEmpty")?.checked
    ),
    procurementWebhookEnabled: Boolean(
      document.getElementById("procurementWebhookEnabled")?.checked
    ),
    procurementWebhookUrl: document.getElementById("procurementWebhookUrl")?.value?.trim() || ""
  };
}

let automationActionsBound = false;

export function bindAutomationSettingsActions(onChange) {
  if (automationActionsBound) return;
  automationActionsBound = true;

  document.addEventListener("submit", (e) => {
    if (e.target?.id !== "automationSettingsForm") return;
    e.preventDefault();
    const err = document.getElementById("automationSettingsError");
    err?.classList.remove("visible");
    runSettingsSave("Автоматизація", {
      saveFn: () => api.updateAutomationSettings(collectAutomationFromDom()),
      successMessage: "Налаштування автоматизації збережено",
      onSuccess: async (data) => {
        mergeAutomationSettings(data);
        onChange?.();
      },
      onError: (ex) => {
        if (err) {
          err.textContent = ex.message;
          err.classList.add("visible");
        }
      }
    }).catch(() => {});
  });

  document.addEventListener("click", (e) => {
    if (e.target?.id !== "testOverdueDigestBtn") return;
    runSettingsSave("Тест дайджесту", {
      saveFn: async () => {
        await api.updateAutomationSettings(collectAutomationFromDom());
        return api.testOverdueDigest();
      },
      successMessage: "Тестовий дайджест надіслано",
      onSuccess: async (data) => {
        mergeAutomationSettings(data);
        onChange?.();
      }
    }).catch(() => {});
  });
}
