import { api } from "./api.js";
import { canViewSettings, isAdmin } from "./auth.js";
import { state } from "./state.js";
import { OPERATOR_STAGES, ROLES, stageLabel } from "./users-constants.js";
import { DEFAULT_PERMISSIONS } from "@enver/shared/production/permissions.js";
import { directoriesSectionHtml, handleDirectoriesClick } from "./settings-directories.js";
import { bindClientsActions, clientsSectionHtml, loadClientsInfo } from "./settings-clients.js";
import {
  bindNotificationSettingsActions,
  notificationsSectionHtml
} from "./settings-notifications.js";
import {
  automationSectionHtml,
  bindAutomationSettingsActions,
  loadAutomationSettings
} from "./settings-automation.js";
import { runSave } from "./save-flow.js";
import { renderSettingsSaveBanner, runSettingsSave } from "./settings-save-feedback.js";
import { $, escapeHtml } from "./utils.js";
import { closeGodmodeNotifyPanel } from "./godmode-notifications.js";
import { notifyUiChanged } from "./ui-persistence.js";

let users = [];
let permissions = {};
let aiSettings = {
  enabled: true,
  openaiModel: "gpt-4o-mini",
  hasApiKey: false,
  hasEnvKey: false,
  openaiApiKeyMasked: "",
  useLearningMemory: true,
  usePdfVision: true,
  visionModel: ""
};
let aiSettingsLoadError = "";
let recentAiAnalyses = [];
let aiLearningSummary = null;
let aiRules = [];

function mergeAiSettings(data) {
  if (!data || typeof data !== "object") return;
  aiSettings = {
    enabled: data.enabled !== false,
    openaiModel: data.openaiModel || aiSettings.openaiModel || "gpt-4o-mini",
    hasApiKey: Boolean(data.hasApiKey),
    hasEnvKey: Boolean(data.hasEnvKey),
    useLearningMemory: data.useLearningMemory !== false,
    usePdfVision: data.usePdfVision !== false,
    visionModel: data.visionModel || "",
    openaiApiKeyMasked: data.openaiApiKeyMasked || aiSettings.openaiApiKeyMasked || ""
  };
  if (aiSettings.hasApiKey || aiSettings.hasEnvKey) {
    aiSettingsLoadError = "";
  }
}

export async function loadSettingsData() {
  const [u, p] = await Promise.all([api.getUsers(), api.getPermissions()]);
  if (!Array.isArray(u)) throw new Error("Некоректна відповідь сервера: користувачі");
  if (!p || typeof p !== "object") throw new Error("Некоректна відповідь сервера: доступи");
  users = u;
  permissions = p;

  try {
    await loadClientsInfo();
  } catch {
    /* посилання на клієнти — з поточного origin */
  }

  if (!isAdmin()) return;

  try {
    mergeAiSettings(await api.getAiSettings());
    aiSettingsLoadError = "";
    if (isAdmin()) {
      try {
        recentAiAnalyses = await api.getRecentAiAnalyses();
      } catch {
        recentAiAnalyses = [];
      }
      try {
        [aiLearningSummary, aiRules] = await Promise.all([
          api.getAiLearningSummary(),
          api.getAiRules()
        ]);
      } catch {
        aiLearningSummary = null;
        aiRules = [];
      }
      try {
        await loadAutomationSettings();
      } catch {
        /* automation settings optional until first save */
      }
    }
  } catch (err) {
    aiSettingsLoadError =
      err.message ||
      "Не вдалося завантажити статус ключа. Перезапустіть сервер (npm run dev) і відкрийте http://localhost:3000";
  }
}

/** Лише налаштування ШІ — без повного перезавантаження вкладки. */
export async function refreshAiSettingsFromServer() {
  const ai = await api.getAiSettings();
  mergeAiSettings(ai);
  aiSettingsLoadError = "";
}

const SETTINGS_SECTION_META = {
  users: { title: "Налаштування", subtitle: "Користувачі та облікові записи" },
  access: { title: "Налаштування", subtitle: "Ролі та доступи" },
  directories: { title: "Налаштування", subtitle: "Довідники системи" },
  clients: { title: "Налаштування", subtitle: "Посилання для клієнтів" },
  notifications: { title: "Сповіщення", subtitle: "Звук, лічильники нових і дозволи браузера" },
  ai: { title: "Налаштування", subtitle: "ШІ та навчання ENVER" }
};

export function getSettingsHeaderMeta(section = state.settingsSection) {
  return SETTINGS_SECTION_META[section] || SETTINGS_SECTION_META.users;
}

export function navigateToNotificationSettings({ returnView } = {}) {
  if (!state.currentUser) return;
  closeGodmodeNotifyPanel();
  if (returnView !== undefined) {
    state.settingsReturnView = returnView;
  } else if (state.view !== "settings") {
    state.settingsReturnView = state.view;
  }
  state.view = "settings";
  state.settingsSection = "notifications";
  notifyUiChanged();
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function openSettings(section = "users") {
  if (!canViewSettings()) return;
  closeGodmodeNotifyPanel();
  state.settingsReturnView = null;
  state.view = "settings";
  state.settingsSection = section;
  notifyUiChanged();
  window.scrollTo({ top: 0, behavior: "auto" });
}

export function closeSettings() {
  state.view = state.settingsReturnView || "main";
  state.settingsReturnView = null;
}

function usersSectionHtml() {
  const rows = users
    .map((u) => {
      const stages =
        u.role === "operator" ? (u.stages || []).map((k) => stageLabel(k)).join(", ") || "—" : "—";
      return `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td><code>${escapeHtml(u.login)}</code></td>
          <td>${escapeHtml(ROLES.find((r) => r.id === u.role)?.label || u.role)}</td>
          <td>${escapeHtml(stages)}</td>
          <td>${u.active ? '<span class="badge green">Активний</span>' : '<span class="badge gray">Вимкнено</span>'}</td>
          <td class="actions-cell">
            <button type="button" class="btn btn-sm" data-edit-user="${u.id}">Змінити</button>
            ${
              u.login !== "admin"
                ? `<button type="button" class="btn btn-sm btn-danger" data-delete-user="${u.id}">Видалити</button>`
                : ""
            }
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    
    <div class="settings-section">
      <div class="settings-section-header">
        <h2>Користувачі</h2>
        <button type="button" class="btn btn-primary btn-sm" id="addUserBtn">+ Користувач</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Ім'я</th>
              <th>Логін</th>
              <th>Роль</th>
              <th>Етапи</th>
              <th>Статус</th>
              <th>Дії</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6" class="empty">Немає користувачів</td></tr>'}</tbody>
        </table>
      </div>
      <p class="settings-hint settings-demo-hint" hidden>Демо: <code>admin</code>/<code>admin</code>; начальник виробництва <code>virobnytstvo</code>/<code>1234</code>; оператори <code>porizka</code>, <code>krayka</code>, <code>prisadka</code>, <code>zbirka</code> — <code>1234</code>.</p>
    </div>
  `;
}

function accessSectionHtml() {
  const roleBlocks = ROLES.map((role) => {
    const p = permissions[role.id] || {};
    const stageChecks = OPERATOR_STAGES.map(
      (s) => `
        <label class="checkbox-label">
          <input type="checkbox" data-perm-role="${role.id}" data-perm-stage="${s.key}" ${(p.stages || []).includes(s.key) ? "checked" : ""} />
          ${escapeHtml(s.label)}
        </label>
      `
    ).join("");

    const adminNote =
      role.id === "admin"
        ? '<p class="settings-hint">Роль адміністратора завжди має повний доступ (суперадмін).</p>'
        : "";

    return `
      <div class="access-card" data-role="${role.id}">
        <h3>${escapeHtml(role.label)}</h3>
        ${adminNote}
        <div class="access-grid">
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canViewSettings" ${p.canViewSettings ? "checked" : ""} /> Налаштування</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canManageUsers" ${p.canManageUsers ? "checked" : ""} /> Користувачі</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canManageAccess" ${p.canManageAccess ? "checked" : ""} /> Доступи</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canEditOrders" ${p.canEditOrders ? "checked" : ""} /> Замовлення</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canEditPositions" ${p.canEditPositions ? "checked" : ""} /> Позиції</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canUseOperatorPanel" ${p.canUseOperatorPanel ? "checked" : ""} /> Панель оператора (огляд)</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canViewProductionFloor" ${p.canViewProductionFloor ? "checked" : ""} /> Вкладка «Цех зараз»</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canManageConstructorDesk" ${p.canManageConstructorDesk ? "checked" : ""} /> Стіл конструктора (керування)</label>
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canWorkConstructorDesk" ${p.canWorkConstructorDesk ? "checked" : ""} /> Робоча сторінка конструктора</label>
        </div>
        <div class="access-stages">
          <div class="access-stages-title">Етапи</div>
          
          
          <div class="access-stage-checks">${stageChecks}</div>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div class="settings-section">
      <div class="settings-section-header">
        <h2>Доступи за ролями</h2>
        <button type="button" class="btn btn-primary btn-sm" id="savePermissionsBtn">Зберегти доступи</button>
      </div>
      <div class="access-roles">${roleBlocks}</div>
    </div>
  `;
}

function aiSectionHtml() {
  if (!isAdmin()) {
    return `
    <div class="settings-section">
      <h2>ШІ — OpenAI</h2>
      <p class="settings-hint" style="color:#b91c1c">
        Збереження API-ключа доступне лише користувачу з роллю <strong>адміністратор</strong>.
        Увійдіть як <code>admin</code> або зверніться до адміністратора.
      </p>
    </div>`;
  }

  const hasKey = Boolean(aiSettings.hasApiKey);
  const hasEnv = Boolean(aiSettings.hasEnvKey);
  const canTest = hasKey || hasEnv;
  const statusBadge = hasKey
    ? '<span class="badge green">Ключ у базі</span>'
    : hasEnv
      ? '<span class="badge orange">Лише в .env — натисніть «Зберегти»</span>'
      : aiSettingsLoadError
        ? '<span class="badge orange">Статус невідомий</span>'
        : '<span class="badge gray">Ключ не збережено</span>';

  return `
    <div class="settings-section ai-settings-page">
      <div class="settings-section-header">
        <h2>ШІ — OpenAI</h2>
        ${statusBadge}
      </div>
      ${
        aiSettingsLoadError
          ? `<p class="form-error visible ai-settings-load-error">${escapeHtml(aiSettingsLoadError)}</p>`
          : ""
      }
      <p class="settings-hint">
        Ключ використовується для <strong>аналізу конструкторських файлів</strong> та покращення підказок у системі.
      </p>

      <form class="ai-settings-card" id="aiSettingsForm">
        <label class="checkbox-label ai-enable-row">
          <input type="checkbox" id="aiEnabled" ${aiSettings.enabled !== false ? "checked" : ""} />
          Увімкнути ШІ-аналіз
        </label>

        <label class="checkbox-label ai-enable-row">
          <input type="checkbox" id="aiUseLearning" ${aiSettings.useLearningMemory !== false ? "checked" : ""} />
          Використовувати досвід ENVER у підказках
        </label>

        <label class="checkbox-label ai-enable-row">
          <input type="checkbox" id="aiUsePdfVision" ${aiSettings.usePdfVision !== false ? "checked" : ""} />
          Vision OCR для сканованих PDF (потрібен poppler у Docker)
        </label>

        <div class="form-field">
          <label for="aiApiKey">API ключ OpenAI</label>
          <p class="field-hint">Отримайте на <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a></p>
          <div class="ai-key-row">
            <input
              id="aiApiKey"
              type="password"
              class="ai-key-input"
              placeholder="${hasKey ? "Вставте новий ключ, щоб замінити" : "sk-proj-…"}"
              autocomplete="off"
              spellcheck="false"
            />
            <button type="button" class="btn btn-sm" id="aiKeyToggleBtn" aria-label="Показати ключ">Показати</button>
          </div>
          ${
            hasKey
              ? `<p class="field-hint">У базі: <code>${escapeHtml(aiSettings.openaiApiKeyMasked || "••••")}</code> — залиште поле порожнім, щоб не змінювати ключ.</p>`
              : hasEnv
                ? `<p class="field-hint">Ключ є в <code>.env</code> — вставте його сюди і натисніть «Зберегти», щоб записати в базу.</p>`
                : ""
          }
        </div>

        <div class="form-field">
          <label for="aiModel">Модель</label>
          <input id="aiModel" type="text" value="${escapeHtml(aiSettings.openaiModel || "gpt-4o-mini")}" placeholder="gpt-4o-mini" />
          <p class="field-hint">Рекомендовано: <code>gpt-4o-mini</code> — швидко й економно.</p>
        </div>

        <div class="ai-settings-actions">
          <button type="submit" class="btn btn-primary" id="saveAiSettingsBtn">Зберегти</button>
          <button type="button" class="btn" id="testAiSettingsBtn" ${canTest ? "" : "disabled"}>Перевірити ключ</button>
          ${hasKey ? '<button type="button" class="btn btn-danger btn-sm" id="clearAiKeyBtn">Видалити ключ</button>' : ""}
        </div>
        <p class="form-error" id="aiSettingsError" role="alert"></p>
      </form>

      <div class="ai-feedback-card ai-learning-admin">
        <h3>Навчання AI</h3>
        ${
          aiLearningSummary?.stats
            ? `<ul class="ai-learning-stats">
            <li>Оцінених: ${aiLearningSummary.stats.ratedGood + aiLearningSummary.stats.ratedPartial + aiLearningSummary.stats.ratedBad}</li>
            <li>Корекцій: ${aiLearningSummary.stats.corrections}</li>
            <li>Подій: ${aiLearningSummary.stats.totalEvents}</li>
          </ul>`
            : ""
        }
        ${
          aiLearningSummary?.patterns?.length
            ? `<div class="ai-learning-patterns"><h4>Часті уроки</h4><ul>${aiLearningSummary.patterns
                .map((p) => `<li>${escapeHtml(p.message)} (${p.count}×)</li>`)
                .join("")}</ul></div>`
            : '<p class="settings-hint">Патерни зʼявляться після кількох корекцій команди.</p>'
        }
        <h4>Правила ENVER</h4>
        ${
          aiRules.length
            ? `<ul class="ai-rules-list">${aiRules
                .map(
                  (r) =>
                    `<li class="ai-rule-item ${r.enabled ? "" : "ai-rule-item--off"}">
                  <strong>${escapeHtml(r.title || "Правило")}</strong>
                  <p>${escapeHtml(r.rule_text)}</p>
                  <small>${escapeHtml(r.applies_to || "усі вироби")}</small>
                  <button type="button" class="btn btn-sm ai-rule-toggle" data-rule-id="${r.id}" data-enabled="${r.enabled ? "0" : "1"}">${r.enabled ? "Вимкнути" : "Увімкнути"}</button>
                </li>`
                )
                .join("")}</ul>`
            : '<p class="settings-hint">Правил ще немає.</p>'
        }
        <form class="ai-rule-form" id="aiRuleForm">
          <input type="text" name="title" placeholder="Назва правила" required />
          <textarea name="ruleText" rows="2" placeholder="Текст правила для AI" required></textarea>
          <input type="text" name="appliesTo" placeholder="Застосовується до (шафа, кухня…)" />
          <button type="submit" class="btn btn-sm btn-primary">Додати правило</button>
        </form>
      </div>

      <div class="ai-feedback-card">
        <h3>Історія аналізів і навчання</h3>
        <p class="settings-hint">Позначте аналіз як коректний або додайте корекцію — наступні запити врахують останні приклади.</p>
        ${
          recentAiAnalyses.length
            ? `<ul class="ai-analysis-list">
                ${recentAiAnalyses
                  .map(
                    (a) => `
                  <li class="ai-analysis-item">
                    <div class="ai-analysis-meta">
                      <strong>#${a.id}</strong> · ${escapeHtml(a.orderNumber || "—")} · ${escapeHtml(a.item || "—")}
                      <br><small>${escapeHtml(a.fileName || "")} · ${escapeHtml(a.createdAt || "")}</small>
                    </div>
                    <p class="ai-analysis-summary">${escapeHtml(a.summary || "—")}</p>
                    <form class="ai-feedback-form" data-analysis-id="${a.id}">
                      <select name="rating" class="ai-feedback-rating">
                        <option value="correct">Коректний</option>
                        <option value="needs_fix">Потребує правки</option>
                      </select>
                      <textarea name="correction" rows="2" placeholder="Корекція для навчання (опційно)"></textarea>
                      <button type="submit" class="btn btn-sm">Зберегти відгук</button>
                    </form>
                  </li>`
                  )
                  .join("")}
              </ul>`
            : '<p class="settings-hint">Ще немає збережених аналізів конструктивів.</p>'
        }
      </div>
    </div>
  `;
}

const SETTINGS_STICKY_SAVE = {
  access: { target: "#savePermissionsBtn", label: "Зберегти доступи" },
  ai: { target: "#saveAiSettingsBtn", label: "Зберегти ШІ" },
  automation: { target: "#saveAutomationSettingsBtn", label: "Зберегти автоматизацію" },
  directories: { target: "#saveAllDirectoriesBtn", label: "Зберегти всі" }
};

function renderSettingsStickyBar(section, { limited = false } = {}) {
  if (limited) return "";
  const cfg = SETTINGS_STICKY_SAVE[section];
  if (!cfg) return "";
  if (section === "ai" && !isAdmin()) return "";
  if (section === "automation" && !isAdmin()) return "";
  if (section === "directories" && !isAdmin()) return "";

  return `
    <div class="enver-sticky-bar settings-sticky-bar" role="region" aria-label="Збереження">
      <div class="enver-sticky-bar-text">
        <span class="enver-sticky-bar-kicker">Налаштування</span>
        <strong>${escapeHtml(cfg.label)}</strong>
      </div>
      <div class="enver-sticky-bar-actions">
        <button type="button" class="enver-sticky-bar-cta" data-settings-sticky-trigger="${escapeHtml(cfg.target)}">${escapeHtml(cfg.label)}</button>
      </div>
    </div>`;
}

export function renderSettingsView() {
  const limited = !canViewSettings();
  let section = state.settingsSection;
  if (limited) section = "notifications";
  if (section === "ai" && !isAdmin()) section = limited ? "notifications" : "users";
  if (section === "automation" && !isAdmin()) section = limited ? "notifications" : "users";

  const nav = limited
    ? [["notifications", "Сповіщення"]]
    : [
        ["users", "Користувачі"],
        ["access", "Доступи"],
        ["directories", "Довідники"],
        ["clients", "Клієнти"],
        ["notifications", "Сповіщення"],
        ...(isAdmin()
          ? [
              ["ai", "ШІ"],
              ["automation", "Автоматизація"]
            ]
          : [])
      ];

  const sectionHtml =
    section === "notifications"
      ? notificationsSectionHtml()
      : section === "users"
        ? usersSectionHtml()
        : section === "access"
          ? accessSectionHtml()
          : section === "clients"
            ? clientsSectionHtml()
            : section === "directories"
              ? directoriesSectionHtml()
              : section === "ai"
                ? aiSectionHtml()
                : section === "automation"
                  ? automationSectionHtml()
                  : notificationsSectionHtml();

  const stickyBar = renderSettingsStickyBar(section, { limited });

  return `
    <div class="settings-page${stickyBar ? " enver-screen--sticky-mobile" : ""}">
      <div class="settings-top">
        <button type="button" class="btn" id="settingsBackBtn">← Назад</button>
      </div>
      <div class="settings-nav">
        ${nav
          .map(
            ([key, label]) =>
              `<button type="button" class="settings-nav-btn ${section === key ? "active" : ""}" data-settings-section="${key}">${escapeHtml(label)}</button>`
          )
          .join("")}
      </div>
      ${renderSettingsSaveBanner()}
      ${sectionHtml}
      ${stickyBar}
    </div>
  `;
}

function collectPermissionsFromDom() {
  const result = { ...permissions };
  for (const role of ROLES) {
    const base = { ...(result[role.id] || {}), stages: [] };
    document.querySelectorAll(`[data-perm-role="${role.id}"][data-perm-key]`).forEach((el) => {
      base[el.dataset.permKey] = el.checked;
    });
    document.querySelectorAll(`[data-perm-role="${role.id}"][data-perm-stage]`).forEach((el) => {
      if (el.checked) base.stages.push(el.dataset.permStage);
    });
    if (role.id === "admin") {
      Object.assign(base, DEFAULT_PERMISSIONS.admin);
    }
    if (role.id === "production") {
      Object.assign(base, DEFAULT_PERMISSIONS.production);
    }
    result[role.id] = base;
  }
  return result;
}

function openUserModal(user = null) {
  const backdrop = $("#userModal");
  if (!backdrop) return;
  $("#userModalTitle").textContent = user ? "Редагування користувача" : "Новий користувач";
  $("#userId").value = user?.id ?? "";
  $("#userName").value = user?.name ?? "";
  $("#userLogin").value = user?.login ?? "";
  $("#userPassword").value = "";
  $("#userPassword").placeholder = user ? "Залиште порожнім, щоб не змінювати" : "Пароль";
  $("#userRole").value = user?.role ?? "operator";
  $("#userActive").checked = user?.active !== false;
  backdrop.querySelectorAll("[data-user-stage]").forEach((cb) => {
    cb.checked = (user?.stages || []).includes(cb.value);
  });
  $("#userStagesField").style.display = $("#userRole").value === "operator" ? "block" : "none";
  backdrop.classList.add("open");
  backdrop.setAttribute("aria-hidden", "false");
}

function closeUserModal() {
  const el = $("#userModal");
  el?.classList.remove("open");
  el?.setAttribute("aria-hidden", "true");
}

export function initSettingsUi(onChange) {
  if (document.getElementById("userModal")) return;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal-backdrop" id="userModal" aria-hidden="true">
      <div class="modal modal-md" role="dialog">
        <div class="modal-header">
          <h2 id="userModalTitle">Користувач</h2>
          <button type="button" class="modal-close" id="closeUserModal">×</button>
        </div>
        <form id="userForm">
          <div class="modal-body">
            <p class="form-error" id="userFormError"></p>
            <input type="hidden" id="userId" />
            <div class="form-field"><label for="userName">Ім'я</label><input id="userName" required /></div>
            <div class="form-field"><label for="userLogin">Логін</label><input id="userLogin" required autocomplete="username" /></div>
            
            <div class="form-field"><label for="userPassword">Пароль</label><input id="userPassword" type="password" autocomplete="new-password" /></div>
            <div class="form-field">
              <label for="userRole">Роль</label>
              <select id="userRole">${ROLES.map((r) => `<option value="${r.id}">${escapeHtml(r.label)}</option>`).join("")}</select>
            </div>
            <div class="form-field" id="userStagesField">
              <label>Етапи оператора</label>
              <div class="stage-checkboxes">
                ${OPERATOR_STAGES.map((s) => `<label class="checkbox-label"><input type="checkbox" data-user-stage value="${s.key}" /> ${escapeHtml(s.label)}</label>`).join("")}
              </div>
            </div>
            <label class="checkbox-label"><input type="checkbox" id="userActive" checked /> Активний</label>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn" id="cancelUserBtn">Скасувати</button>
            <button type="submit" class="btn btn-primary">Зберегти</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild || wrap);

  $("#userRole")?.addEventListener("change", () => {
    $("#userStagesField").style.display = $("#userRole").value === "operator" ? "block" : "none";
  });
  $("#closeUserModal")?.addEventListener("click", closeUserModal);
  $("#cancelUserBtn")?.addEventListener("click", closeUserModal);
  $("#userModal")?.addEventListener("click", (e) => {
    if (e.target.id === "userModal") closeUserModal();
  });

  $("#userForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("#userFormError");
    err.textContent = "";
    err.classList.remove("visible");
    const id = $("#userId").value;
    const stages = [];
    document.querySelectorAll("[data-user-stage]:checked").forEach((cb) => stages.push(cb.value));
    const body = {
      name: $("#userName").value.trim(),
      login: $("#userLogin").value.trim(),
      role: $("#userRole").value,
      stages,
      active: $("#userActive").checked
    };
    const password = $("#userPassword").value;
    if (password) body.password = password;
    else if (!id) {
      err.textContent = "Вкажіть пароль";
      err.classList.add("visible");
      return;
    }
    const submitBtn = $("#userForm")?.querySelector('[type="submit"]');
    await runSave(id ? "Користувач" : "Новий користувач", {
      submitEl: submitBtn,
      saveFn: () => (id ? api.updateUser(Number(id), body) : api.createUser(body)),
      successMessage: id ? "Користувача збережено" : "Користувача створено",
      onSuccess: async () => {
        closeUserModal();
        await loadSettingsData();
        onChange();
      },
      onError: (ex) => {
        err.textContent = ex.message;
        err.classList.add("visible");
      }
    }).catch(() => {});
  });
}

let settingsActionsBound = false;
let settingsOnChange = () => {};

export function bindSettingsActions(onChange) {
  settingsOnChange = onChange;
  bindClientsActions();
  bindNotificationSettingsActions(onChange);
  bindAutomationSettingsActions(onChange);
  if (settingsActionsBound) return;
  settingsActionsBound = true;

  document.addEventListener("submit", (e) => {
    if (e.target?.id === "aiSettingsForm") {
      e.preventDefault();
      saveAiSettingsFromDom();
      return;
    }
    const feedbackForm = e.target?.closest?.(".ai-feedback-form");
    if (feedbackForm) {
      e.preventDefault();
      const analysisId = Number(feedbackForm.dataset.analysisId);
      const rating = feedbackForm.querySelector('[name="rating"]')?.value || "";
      const correctionText = feedbackForm.querySelector('[name="correction"]')?.value?.trim() || "";
      runSettingsSave("Відгук ШІ", {
        saveFn: () =>
          api.submitAiFeedback({ analysisId, rating, correctionText, rememberCorrection: true }),
        successMessage: "Відгук збережено",
        onSuccess: async () => {
          await loadSettingsData();
          settingsOnChange();
        }
      }).catch(() => {});
      return;
    }
    if (e.target?.id === "aiRuleForm") {
      e.preventDefault();
      const form = e.target;
      runSettingsSave("Правило AI", {
        saveFn: () =>
          api.createAiRule({
            title: form.title?.value?.trim(),
            ruleText: form.ruleText?.value?.trim(),
            appliesTo: form.appliesTo?.value?.trim()
          }),
        successMessage: "Правило додано",
        onSuccess: async () => {
          await loadSettingsData();
          settingsOnChange();
        }
      }).catch(() => {});
    }
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".settings-page") && !e.target.closest("#userModal")) return;

    if (handleDirectoriesClick(e, settingsOnChange)) return;

    const sectionBtn = e.target.closest("[data-settings-section]");
    if (sectionBtn) {
      const next = sectionBtn.dataset.settingsSection;
      state.settingsSection = next;
      if (next === "directories") {
        api
          .getDirectories()
          .then((d) => {
            state.directories = d;
            settingsOnChange();
          })
          .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
        return;
      }
      settingsOnChange();
      return;
    }

    if (e.target.closest("#settingsBackBtn")) {
      closeSettings();
      settingsOnChange();
      return;
    }

    const stickySave = e.target.closest("[data-settings-sticky-trigger]");
    if (stickySave) {
      const target = document.querySelector(stickySave.dataset.settingsStickyTrigger);
      if (target) target.click();
      return;
    }

    if (e.target.closest("#addUserBtn")) {
      openUserModal();
      return;
    }

    const editBtn = e.target.closest("[data-edit-user]");
    if (editBtn) {
      openUserModal(users.find((u) => u.id === Number(editBtn.dataset.editUser)));
      return;
    }

    const delBtn = e.target.closest("[data-delete-user]");
    if (delBtn) {
      e.preventDefault();
      if (!confirm("Видалити користувача?")) return;
      runSave("Користувач", {
        saveFn: () => api.deleteUser(Number(delBtn.dataset.deleteUser)),
        successMessage: "Користувача видалено",
        onSuccess: async () => {
          await loadSettingsData();
          settingsOnChange();
        }
      }).catch(() => {});
      return;
    }

    if (e.target.closest("#savePermissionsBtn")) {
      runSettingsSave("Доступи", {
        onReload: () => settingsOnChange(),
        saveFn: () => api.updatePermissions(collectPermissionsFromDom()),
        onSuccess: (p) => {
          permissions = p;
          return loadSettingsData();
        }
      }).catch(() => {});
      return;
    }

    if (e.target.closest("#clearAiKeyBtn")) {
      if (!confirm("Видалити збережений API ключ OpenAI?")) return;
      runSettingsSave("ШІ", {
        onReload: () => settingsOnChange(),
        saveFn: () =>
          api.updateAiSettings({
            enabled: document.querySelector("#aiEnabled")?.checked ?? true,
            openaiModel: document.querySelector("#aiModel")?.value,
            clearApiKey: true
          }),
        onSuccess: async (ai) => {
          mergeAiSettings(ai);
          const input = document.querySelector("#aiApiKey");
          if (input) input.value = "";
          try {
            await refreshAiSettingsFromServer();
          } catch {
            /* PUT уже оновив hasApiKey */
          }
          settingsOnChange();
        }
      }).catch(() => {});
      return;
    }

    if (e.target.closest(".ai-rule-toggle")) {
      const btn = e.target.closest(".ai-rule-toggle");
      const id = Number(btn.dataset.ruleId);
      const enabled = btn.dataset.enabled === "1";
      runSettingsSave("Правило AI", {
        saveFn: () => api.updateAiRule(id, { enabled }),
        successMessage: enabled ? "Правило увімкнено" : "Правило вимкнено",
        onSuccess: async () => {
          await loadSettingsData();
          settingsOnChange();
        }
      }).catch(() => {});
      return;
    }

    if (e.target.closest("#testAiSettingsBtn")) {
      const errEl = document.querySelector("#aiSettingsError");
      if (errEl) {
        errEl.textContent = "";
        errEl.classList.remove("visible");
      }
      runSettingsSave("Перевірка OpenAI", {
        onReload: () => settingsOnChange(),
        saveFn: () => api.testAiSettings()
      }).catch((ex) => {
        if (errEl) {
          errEl.textContent = ex.message;
          errEl.classList.add("visible");
        }
      });
      return;
    }

    if (e.target.closest("#aiKeyToggleBtn")) {
      const input = document.querySelector("#aiApiKey");
      const btn = document.querySelector("#aiKeyToggleBtn");
      if (!input || !btn) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.textContent = show ? "Приховати" : "Показати";
      btn.setAttribute("aria-label", show ? "Приховати ключ" : "Показати ключ");
    }
  });
}

function saveAiSettingsFromDom() {
  if (!isAdmin()) {
    import("./toast.js").then(({ toastError }) =>
      toastError("Збереження ключа доступне лише адміністратору")
    );
    return;
  }

  const errEl = document.querySelector("#aiSettingsError");
  const saveBtn = document.querySelector("#saveAiSettingsBtn");
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.remove("visible");
  }

  const rawKey = document.querySelector("#aiApiKey")?.value?.trim() ?? "";
  const body = {
    enabled: document.querySelector("#aiEnabled")?.checked,
    openaiModel: document.querySelector("#aiModel")?.value?.trim(),
    useLearningMemory: document.querySelector("#aiUseLearning")?.checked !== false,
    usePdfVision: document.querySelector("#aiUsePdfVision")?.checked !== false
  };

  if (rawKey) {
    if (rawKey.includes("…") || rawKey.includes("...") || /\*{2,}/.test(rawKey)) {
      const msg = "Вставте повний ключ sk-…, а не маску з підказки";
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.add("visible");
      }
      import("./toast.js").then(({ toastError }) => toastError(msg));
      return;
    }
    if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(rawKey)) {
      const msg = "Некоректний ключ: очікується sk-… (повний ключ з platform.openai.com)";
      if (errEl) {
        errEl.textContent = msg;
        errEl.classList.add("visible");
      }
      import("./toast.js").then(({ toastError }) => toastError(msg));
      return;
    }
    body.openaiApiKey = rawKey;
  } else if (!aiSettings.hasApiKey && !aiSettings.hasEnvKey) {
    const msg = "Вкажіть API ключ OpenAI (sk-…)";
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.add("visible");
    }
    import("./toast.js").then(({ toastError }) => toastError(msg));
    return;
  }

  runSettingsSave("ШІ", {
    submitEl: saveBtn,
    onReload: () => settingsOnChange(),
    saveFn: () => api.updateAiSettings(body),
    onSuccess: async (ai) => {
      mergeAiSettings(ai);
      const input = document.querySelector("#aiApiKey");
      if (input) input.value = "";
      try {
        await refreshAiSettingsFromServer();
      } catch {
        /* PUT уже оновив hasApiKey */
      }
      settingsOnChange();
    }
  }).catch((ex) => {
    if (errEl) {
      errEl.textContent = ex.message;
      errEl.classList.add("visible");
    }
  });
}
