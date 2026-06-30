import { api } from "./api.js";
import { escapeHtml } from "./utils.js";
import { runSettingsSave } from "./settings-save-feedback.js";

let automationSettings = {
  autoCreateTasksFromAi: true,
  autoCreateTasksOnPackageApprove: true,
  autoCreateTasksMinConfidence: 0.85,
  autoCreateTasksRequireSafeQuality: true,
  autoCreateTasksShadowMode: false,
  assignRulesEnabled: false,
  assignRules: { assembly: { directory: "Збирачі", strategy: "round_robin" } },
  productionWebhookEnabled: false,
  productionWebhookUrl: "",
  overdueDigestEnabled: false,
  overdueDigestHourKyiv: 9,
  overdueDigestWebhookUrl: "",
  overdueDigestSendWhenEmpty: false,
  procurementWebhookEnabled: false,
  procurementWebhookUrl: "",
  stalledStageCheckEnabled: true,
  stalledStageHours: 8,
  autoCompleteStageOnFullScan: true,
  blockAutoHandoffOnPartialB3d: true,
  autoSelectNextJob: true,
  autoStartStageOnOpen: true,
  lastOverdueDigestDate: ""
};

let automationMetrics = null;

export function mergeAutomationSettings(data) {
  if (!data || typeof data !== "object") return;
  automationSettings = {
    autoCreateTasksFromAi: data.autoCreateTasksFromAi !== false,
    autoCreateTasksOnPackageApprove: data.autoCreateTasksOnPackageApprove !== false,
    autoCreateTasksMinConfidence: Number(data.autoCreateTasksMinConfidence) || 0.85,
    autoCreateTasksRequireSafeQuality: data.autoCreateTasksRequireSafeQuality !== false,
    autoCreateTasksShadowMode: data.autoCreateTasksShadowMode === true,
    assignRulesEnabled: data.assignRulesEnabled === true,
    assignRules: data.assignRules || automationSettings.assignRules,
    productionWebhookEnabled: data.productionWebhookEnabled === true,
    productionWebhookUrl: data.productionWebhookUrl || "",
    overdueDigestEnabled: data.overdueDigestEnabled === true,
    overdueDigestHourKyiv: Number(data.overdueDigestHourKyiv) || 9,
    overdueDigestWebhookUrl: data.overdueDigestWebhookUrl || "",
    overdueDigestSendWhenEmpty: data.overdueDigestSendWhenEmpty === true,
    procurementWebhookEnabled: data.procurementWebhookEnabled === true,
    procurementWebhookUrl: data.procurementWebhookUrl || "",
    stalledStageCheckEnabled: data.stalledStageCheckEnabled !== false,
    stalledStageHours: Number(data.stalledStageHours) || 8,
    autoCompleteStageOnFullScan: data.autoCompleteStageOnFullScan !== false,
    blockAutoHandoffOnPartialB3d: data.blockAutoHandoffOnPartialB3d !== false,
    autoSelectNextJob: data.autoSelectNextJob !== false,
    autoStartStageOnOpen: data.autoStartStageOnOpen !== false,
    lastOverdueDigestDate: data.lastOverdueDigestDate || ""
  };
}

export async function loadAutomationSettings() {
  const data = await api.getAutomationSettings();
  mergeAutomationSettings(data);
  try {
    automationMetrics = await api.getAutomationMetrics();
  } catch {
    automationMetrics = null;
  }
  return automationSettings;
}

function hourOptions(selected) {
  return Array.from({ length: 24 }, (_, hour) => {
    const label = `${String(hour).padStart(2, "0")}:00 (Київ)`;
    return `<option value="${hour}" ${hour === selected ? "selected" : ""}>${label}</option>`;
  }).join("");
}

function metricsBlockHtml() {
  const m = automationMetrics;
  if (!m) return "";
  const tasks = m.autoCreateTasks || {};
  const failed = Array.isArray(m.recentFailedWebhooks) ? m.recentFailedWebhooks : [];
  const failedList =
    failed.length > 0
      ? `<ul class="automation-failed-list">${failed
          .map(
            (row) =>
              `<li><code>${escapeHtml(row.event)}</code> — ${escapeHtml(row.last_error || "помилка")} <button type="button" class="btn btn-sm" data-retry-webhook="${row.id}">Повторити</button></li>`
          )
          .join("")}</ul>`
      : "";
  return `
    <div class="automation-metrics-card">
      <h3 class="enver-section-title">Метрики (останні ${m.windowDays || 7} дн.)</h3>
      <ul class="automation-metrics-list">
        <li>Автозадачі застосовано: <strong>${tasks.applied || 0}</strong> (${tasks.ratePercent || 0}%)</li>
        <li>Shadow / пропущено: ${tasks.shadow || 0} / ${tasks.skipped || 0}</li>
        <li>Невдалі webhook: <strong>${m.failedWebhooks || 0}</strong></li>
      </ul>
      ${failedList}
    </div>`;
}

export function automationSectionHtml() {
  const s = automationSettings;
  const anyOn =
    s.autoCreateTasksFromAi ||
    s.overdueDigestEnabled ||
    s.procurementWebhookEnabled ||
    s.productionWebhookEnabled ||
    s.assignRulesEnabled;
  return `
    <div class="settings-section automation-settings-page">
      <div class="settings-section-header">
        <h2>Автоматизація</h2>
        <span class="badge ${anyOn ? "green" : "gray"}">
          ${anyOn ? "Увімкнено" : "Вимкнено"}
        </span>
      </div>
      <p class="settings-hint">
        Фонові дії та webhook (n8n, Make, Zapier). Події: <code>position_ready_for_production</code>,
        <code>stage_completed</code>, <code>ai_analysis_needs_review</code>, <code>stage_stalled</code>.
      </p>
      ${metricsBlockHtml()}

      <form class="automation-settings-card" id="automationSettingsForm">
        <h3 class="enver-section-title">ШІ → задачі цеху</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCreateTasksFromAi" ${s.autoCreateTasksFromAi ? "checked" : ""} />
          Автоматично створювати задачі після ШІ
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCreateTasksOnPackageApprove" ${s.autoCreateTasksOnPackageApprove ? "checked" : ""} />
          Автозадачі після підтвердження пакета начальником
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCreateTasksRequireSafeQuality" ${s.autoCreateTasksRequireSafeQuality ? "checked" : ""} />
          Вимагати <code>safeToCreateTasks</code> від аналізу
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCreateTasksShadowMode" ${s.autoCreateTasksShadowMode ? "checked" : ""} />
          Shadow mode — лише логувати, не застосовувати
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="blockAutoHandoffOnPartialB3d" ${s.blockAutoHandoffOnPartialB3d ? "checked" : ""} />
          Блокувати автопередачу при PARTIAL_READY 3D без ENVER3
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

        <h3 class="enver-section-title">Призначення збиральника</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="assignRulesEnabled" ${s.assignRulesEnabled ? "checked" : ""} />
          Auto-assign з довідника «Збирачі» (round-robin)
        </label>

        <h3 class="enver-section-title">Оператор / цех</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="autoCompleteStageOnFullScan" ${s.autoCompleteStageOnFullScan ? "checked" : ""} />
          Пропонувати завершити етап після скану всіх деталей
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="autoSelectNextJob" ${s.autoSelectNextJob ? "checked" : ""} />
          Оператор: автоматично обирати наступну позицію в черзі
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="autoStartStageOnOpen" ${s.autoStartStageOnOpen ? "checked" : ""} />
          Оператор: автостарт «Почав» при виборі позиції
        </label>
        <label class="checkbox-label">
          <input type="checkbox" id="stalledStageCheckEnabled" ${s.stalledStageCheckEnabled ? "checked" : ""} />
          Webhook для завислих етапів і відсутнього assign
        </label>
        <div class="form-field">
          <label for="stalledStageHours">Годин «В роботі» до сповіщення</label>
          <input id="stalledStageHours" type="number" min="1" max="72" value="${escapeHtml(String(s.stalledStageHours))}" />
        </div>

        <h3 class="enver-section-title">Webhook — виробництво</h3>
        <label class="checkbox-label">
          <input type="checkbox" id="productionWebhookEnabled" ${s.productionWebhookEnabled ? "checked" : ""} />
          Увімкнути production webhook
        </label>
        <div class="form-field">
          <label for="productionWebhookUrl">Production webhook URL</label>
          <input
            id="productionWebhookUrl"
            type="url"
            placeholder="https://hooks.example.com/production"
            value="${escapeHtml(s.productionWebhookUrl)}"
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
    autoCreateTasksOnPackageApprove: Boolean(
      document.getElementById("autoCreateTasksOnPackageApprove")?.checked
    ),
    autoCreateTasksRequireSafeQuality: Boolean(
      document.getElementById("autoCreateTasksRequireSafeQuality")?.checked
    ),
    autoCreateTasksShadowMode: Boolean(
      document.getElementById("autoCreateTasksShadowMode")?.checked
    ),
    autoCreateTasksMinConfidence: Number(
      document.getElementById("autoCreateTasksMinConfidence")?.value
    ),
    assignRulesEnabled: Boolean(document.getElementById("assignRulesEnabled")?.checked),
    blockAutoHandoffOnPartialB3d: Boolean(
      document.getElementById("blockAutoHandoffOnPartialB3d")?.checked
    ),
    productionWebhookEnabled: Boolean(document.getElementById("productionWebhookEnabled")?.checked),
    productionWebhookUrl: document.getElementById("productionWebhookUrl")?.value?.trim() || "",
    autoCompleteStageOnFullScan: Boolean(
      document.getElementById("autoCompleteStageOnFullScan")?.checked
    ),
    autoSelectNextJob: Boolean(document.getElementById("autoSelectNextJob")?.checked),
    autoStartStageOnOpen: Boolean(document.getElementById("autoStartStageOnOpen")?.checked),
    stalledStageCheckEnabled: Boolean(document.getElementById("stalledStageCheckEnabled")?.checked),
    stalledStageHours: Number(document.getElementById("stalledStageHours")?.value),
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
    const retryBtn = e.target.closest("[data-retry-webhook]");
    if (retryBtn) {
      const id = Number(retryBtn.dataset.retryWebhook);
      if (!id) return;
      runSettingsSave("Повтор webhook", {
        saveFn: () => api.retryAutomationWebhook(id),
        successMessage: "Webhook надіслано повторно",
        onSuccess: async () => {
          automationMetrics = await api.getAutomationMetrics();
          onChange?.();
        }
      }).catch(() => {});
      return;
    }
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
