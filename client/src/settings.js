import { api } from "./api.js";
import { canViewSettings } from "./auth.js";
import { state } from "./state.js";
import { OPERATOR_STAGES, ROLES, stageLabel } from "./users-constants.js";
import { directoriesSectionHtml, handleDirectoriesClick } from "./settings-directories.js";
import { $, escapeHtml } from "./utils.js";

let users = [];
let permissions = {};
let machineConfig = [];
let aiSettings = { enabled: true, openaiModel: "gpt-4o-mini", hasApiKey: false };

export async function loadSettingsData() {
  const [u, p, m, ai] = await Promise.all([
    api.getUsers(),
    api.getPermissions(),
    api.getMachineConfig(),
    api.getAiSettings().catch(() => aiSettings)
  ]);
  if (!Array.isArray(u)) throw new Error("Некоректна відповідь сервера: користувачі");
  if (!p || typeof p !== "object") throw new Error("Некоректна відповідь сервера: доступи");
  if (!Array.isArray(m)) throw new Error("Некоректна відповідь сервера: конфігурація станків");
  users = u;
  permissions = p;
  machineConfig = m;
  aiSettings = ai || aiSettings;
}

export function openSettings(section = "users") {
  if (!canViewSettings()) return;
  state.view = "settings";
  state.settingsSection = section;
}

export function closeSettings() {
  state.view = "main";
}

function usersSectionHtml() {
  const rows = users
    .map((u) => {
      const stages =
        u.role === "operator"
          ? (u.stages || []).map((k) => stageLabel(k)).join(", ") || "—"
          : "—";
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
      <p class="settings-hint settings-demo-hint" hidden>Демо: <code>admin</code>/<code>admin</code>; оператори <code>porizka</code>, <code>krayka</code>, <code>prisadka</code>, <code>zbirka</code> — <code>1234</code>.</p>
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
          <label class="checkbox-label"><input type="checkbox" data-perm-role="${role.id}" data-perm-key="canUseOperatorPanel" ${p.canUseOperatorPanel ? "checked" : ""} /> Панель оператора</label>
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


const PARSER_OPTIONS = [
  { id: "kdt", label: "KDT Saw (папка .txt)" },
  { id: "generic", label: "Загальний (файл)" },
  { id: "biesse", label: "Biesse" },
  { id: "homag", label: "Homag" },
  { id: "scm", label: "SCM" }
];

function machinesSectionHtml() {
  const stageCards = machineConfig
    .map((m) => {
      const profile = m.parserProfile || "generic";
      const isKdt = profile === "kdt";
      const pathHint = isKdt
        ? "Папка з логами KDT на сервері ENVER (усі .txt рекурсивно)"
        : "Один текстовий файл логу на сервері ENVER";
      const pathPlaceholder = isKdt
        ? "C:\\Users\\Administrator\\Desktop\\KDTSaw1"
        : "/var/log/stanok.log";

      return `
        <article class="machine-stage-card" data-stage-card="${escapeHtml(m.stageKey)}">
          <header class="machine-stage-card-head">
            <h3>${escapeHtml(stageLabel(m.stageKey))}</h3>
            <span class="machine-stage-progress">${m.lastProgress ?? 0}%</span>
          </header>
          <p class="field-hint machine-path-hint">${pathHint}</p>
          <div class="form-field">
            <label>Шлях до логів</label>
            <input
              class="machine-log-path"
              type="text"
              data-machine-log-path="${escapeHtml(m.stageKey)}"
              value="${escapeHtml(m.logPath || "")}"
              placeholder="${escapeHtml(pathPlaceholder)}"
              autocomplete="off"
              spellcheck="false"
            />
          </div>
          <div class="machine-stage-grid">
            <div class="form-field">
              <label>Парсер</label>
              <select class="machine-parser-profile" data-machine-parser="${escapeHtml(m.stageKey)}">
                ${PARSER_OPTIONS.map(
                  (p) =>
                    `<option value="${p.id}" ${profile === p.id ? "selected" : ""}>${escapeHtml(p.label)}</option>`
                ).join("")}
              </select>
            </div>
            <label class="checkbox-label">
              <input type="checkbox" data-machine-watch="${escapeHtml(m.stageKey)}" ${m.watchEnabled ? "checked" : ""} />
              Стежити
            </label>
            <label class="checkbox-label">
              <input type="checkbox" data-machine-ai="${escapeHtml(m.stageKey)}" ${m.aiMatchingEnabled !== false ? "checked" : ""} />
              AI
            </label>
          </div>
          <p class="machine-stage-status"><small>${escapeHtml(m.lastMatchSummary || "—")}</small></p>
          <div class="machine-actions-cell">
            <button type="button" class="btn btn-primary btn-sm" data-save-machine="${escapeHtml(m.stageKey)}">Зберегти</button>
            <button type="button" class="btn btn-sm" data-ingest-machine="${escapeHtml(m.stageKey)}">Сканувати</button>
            <button type="button" class="btn btn-sm" data-full-scan-machine="${escapeHtml(m.stageKey)}">Повне сканування</button>
          </div>
        </article>
      `;
    })
    .join("");

  return `
    <div class="settings-section machines-settings">
      <div class="settings-section-header">
        <h2>Логи станків</h2>
      </div>
      <p class="settings-hint">
        Окремий шлях для кожного етапу (на сервері ENVER). Порізка KDT: парсер <strong>KDT Saw</strong> + папка з .txt.
        OpenAI — вкладка <strong>ШІ</strong>.
      </p>
      <div class="machine-stage-list">${stageCards}</div>
      <div class="settings-subsection">
        <h3>Завантажити фрагмент логу</h3>
        <div class="machine-upload-row">
          <select id="machineUploadStage">
            ${OPERATOR_STAGES.map((s) => `<option value="${s.key}">${escapeHtml(s.label)}</option>`).join("")}
          </select>
          <textarea id="machineUploadText" rows="4" placeholder="Вставте рядки логу KDT або іншого станка…"></textarea>
          <button type="button" class="btn btn-sm" id="machineUploadBtn">Імпортувати</button>
        </div>
      </div>
      <p class="settings-hint">Ключ OpenAI — вкладка <strong>ШІ</strong>.</p>
      <details class="settings-hint-details">
        <summary>Опційно: зовнішній API станка</summary>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Етап</th><th>URL</th><th>Токен</th><th></th></tr></thead>
            <tbody>
              ${machineConfig
                .map(
                  (m) => `
                <tr>
                  <td>${escapeHtml(stageLabel(m.stageKey))}</td>
                  <td><input class="machine-url-input" type="url" data-machine-url="${escapeHtml(m.stageKey)}" value="${escapeHtml(m.apiUrl)}" /></td>
                  <td><input class="machine-token-input" type="password" data-machine-token="${escapeHtml(m.stageKey)}" value="${escapeHtml(m.apiToken)}" autocomplete="off" /></td>
                  <td><button type="button" class="btn btn-sm" data-save-machine-api="${escapeHtml(m.stageKey)}">Зберегти API</button></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  `;
}


function aiSectionHtml() {
  const hasKey = Boolean(aiSettings.hasApiKey);
  const statusBadge = hasKey
    ? '<span class="badge green">Ключ збережено</span>'
    : '<span class="badge gray">Ключ не налаштовано</span>';

  return `
    <div class="settings-section ai-settings-page">
      <div class="settings-section-header">
        <h2>ШІ — OpenAI</h2>
        ${statusBadge}
      </div>
      <p class="settings-hint">
        Ключ використовується для <strong>зіставлення рядків логу станка</strong> з позиціями замовлень у ENVER.
        Без ключа працює лише евристичне зіставлення (номер замовлення, виріб, токени з логу).
      </p>

      <div class="ai-settings-card">
        <label class="checkbox-label ai-enable-row">
          <input type="checkbox" id="aiEnabled" ${aiSettings.enabled !== false ? "checked" : ""} />
          Увімкнути AI-зіставлення
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
              ? `<p class="field-hint">Збережено: <code>${escapeHtml(aiSettings.openaiApiKeyMasked || "••••")}</code> — залиште поле порожнім, щоб не змінювати.</p>`
              : ""
          }
        </div>

        <div class="form-field">
          <label for="aiModel">Модель</label>
          <input id="aiModel" type="text" value="${escapeHtml(aiSettings.openaiModel || "gpt-4o-mini")}" placeholder="gpt-4o-mini" />
          <p class="field-hint">Рекомендовано: <code>gpt-4o-mini</code> — швидко й економно.</p>
        </div>

        <div class="ai-settings-actions">
          <button type="button" class="btn btn-primary" id="saveAiSettingsBtn">Зберегти</button>
          <button type="button" class="btn" id="testAiSettingsBtn" ${hasKey ? "" : "disabled"}>Перевірити ключ</button>
          ${hasKey ? '<button type="button" class="btn btn-danger btn-sm" id="clearAiKeyBtn">Видалити ключ</button>' : ""}
        </div>
        <p class="form-error" id="aiSettingsError" role="alert"></p>
        <p class="form-success" id="aiSettingsSuccess" hidden></p>
      </div>
    </div>
  `;
}

export function renderSettingsView() {
  const section = state.settingsSection;
  const nav = [
    ["users", "Користувачі"],
    ["access", "Доступи"],
    ["directories", "Довідники"],
    ["machines", "Станки"],
    ["ai", "ШІ"]
  ];

  const sectionHtml =
    section === "users"
      ? usersSectionHtml()
      : section === "access"
        ? accessSectionHtml()
        : section === "directories"
          ? directoriesSectionHtml()
          : section === "ai"
            ? aiSectionHtml()
            : machinesSectionHtml();

  return `
    <div class="settings-page">
      <div class="settings-top">
        <button type="button" class="btn" id="settingsBackBtn">← Назад</button>
        <h1>Налаштування</h1>
      </div>
      <div class="settings-nav">
        ${nav
          .map(
            ([key, label]) =>
              `<button type="button" class="settings-nav-btn ${section === key ? "active" : ""}" data-settings-section="${key}">${escapeHtml(label)}</button>`
          )
          .join("")}
      </div>
      ${sectionHtml}
    </div>
  `;
}

function collectMachineConfigFromDom(key) {
  return {
    logPath: document.querySelector(`[data-machine-log-path="${key}"]`)?.value ?? "",
    parserProfile: document.querySelector(`[data-machine-parser="${key}"]`)?.value ?? "generic",
    watchEnabled: document.querySelector(`[data-machine-watch="${key}"]`)?.checked ?? false,
    aiMatchingEnabled: document.querySelector(`[data-machine-ai="${key}"]`)?.checked ?? true,
    resetLogOffset: false
  };
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
      Object.assign(base, {
        canViewSettings: true,
        canManageUsers: true,
        canManageAccess: true,
        canEditOrders: true,
        canEditPositions: true,
        canUseOperatorPanel: true,
        stages: OPERATOR_STAGES.map((s) => s.key)
      });
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
    try {
      if (id) await api.updateUser(Number(id), body);
      else await api.createUser(body);
      closeUserModal();
      await loadSettingsData();
      onChange();
    } catch (ex) {
      err.textContent = ex.message;
      err.classList.add("visible");
    }
  });
}

let settingsActionsBound = false;
let settingsOnChange = () => {};

export function bindSettingsActions(onChange) {
  settingsOnChange = onChange;
  if (settingsActionsBound) return;
  settingsActionsBound = true;

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
      api.deleteUser(Number(delBtn.dataset.deleteUser))
        .then(() => loadSettingsData())
        .then(settingsOnChange)
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    if (e.target.closest("#savePermissionsBtn")) {
      api
        .updatePermissions(collectPermissionsFromDom())
        .then((p) => {
          permissions = p;
          import("./toast.js").then(({ toastSuccess }) => toastSuccess("Доступи збережено"));
          settingsOnChange();
        })
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    const saveMachine = e.target.closest("[data-save-machine]");
    if (saveMachine) {
      const key = saveMachine.dataset.saveMachine;
      api
        .updateMachineConfig(key, collectMachineConfigFromDom(key))
        .then(() => loadSettingsData())
        .then(() => {
          settingsOnChange();
          import("./toast.js").then(({ toastSuccess }) => toastSuccess("Збережено"));
        })
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    const saveMachineApi = e.target.closest("[data-save-machine-api]");
    if (saveMachineApi) {
      const key = saveMachineApi.dataset.saveMachineApi;
      api
        .updateMachineConfig(key, {
          apiUrl: document.querySelector(`[data-machine-url="${key}"]`)?.value ?? "",
          apiToken: document.querySelector(`[data-machine-token="${key}"]`)?.value ?? "",
          clearToken: !document.querySelector(`[data-machine-token="${key}"]`)?.value
        })
        .then(() => loadSettingsData())
        .then(() => import("./toast.js").then(({ toastSuccess }) => toastSuccess("API збережено")))
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    const ingestMachine = e.target.closest("[data-ingest-machine]");
    if (ingestMachine) {
      const key = ingestMachine.dataset.ingestMachine;
      api
        .ingestMachineLog(key)
        .then((r) => import("./toast.js").then(({ toastSuccess }) => toastSuccess(r.message || "Сканування завершено")))
        .then(() => loadSettingsData())
        .then(settingsOnChange)
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    const fullScanMachine = e.target.closest("[data-full-scan-machine]");
    if (fullScanMachine) {
      const key = fullScanMachine.dataset.fullScanMachine;
      if (!confirm("Повторно прочитати всі логи з початку для цього етапу?")) return;
      api
        .ingestMachineLog(key, { fullScan: true })
        .then((r) => import("./toast.js").then(({ toastSuccess }) => toastSuccess(r.message || "Готово")))
        .then(() => loadSettingsData())
        .then(settingsOnChange)
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    if (e.target.closest("#machineUploadBtn")) {
      const stage = document.querySelector("#machineUploadStage")?.value;
      const text = document.querySelector("#machineUploadText")?.value ?? "";
      api
        .uploadMachineLog(stage, text)
        .then((r) => import("./toast.js").then(({ toastSuccess }) => toastSuccess(r.message || "Імпортовано")))
        .then(() => loadSettingsData())
        .then(settingsOnChange)
        .catch((ex) => import("./toast.js").then(({ toastError }) => toastError(ex.message)));
      return;
    }

    if (e.target.closest("#saveAiSettingsBtn")) {
      saveAiSettingsFromDom();
      return;
    }

    if (e.target.closest("#clearAiKeyBtn")) {
      if (!confirm("Видалити збережений API ключ OpenAI?")) return;
      api
        .updateAiSettings({
          enabled: document.querySelector("#aiEnabled")?.checked ?? true,
          openaiModel: document.querySelector("#aiModel")?.value,
          clearApiKey: true
        })
        .then((ai) => {
          aiSettings = ai;
          const input = document.querySelector("#aiApiKey");
          if (input) input.value = "";
          return loadSettingsData();
        })
        .then(settingsOnChange)
        .then(() => import("./toast.js").then(({ toastSuccess }) => toastSuccess("Ключ видалено")))
        .catch((ex) => showAiSettingsError(ex.message));
      return;
    }

    if (e.target.closest("#testAiSettingsBtn")) {
      const errEl = document.querySelector("#aiSettingsError");
      const okEl = document.querySelector("#aiSettingsSuccess");
      if (errEl) {
        errEl.textContent = "";
        errEl.classList.remove("visible");
      }
      if (okEl) okEl.hidden = true;
      api
        .testAiSettings()
        .then((r) => {
          if (okEl) {
            okEl.textContent = r.message || "Ключ працює";
            okEl.hidden = false;
          }
          import("./toast.js").then(({ toastSuccess }) => toastSuccess(r.message || "Ключ працює"));
        })
        .catch((ex) => showAiSettingsError(ex.message));
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

function showAiSettingsError(message) {
  const errEl = document.querySelector("#aiSettingsError");
  if (errEl) {
    errEl.textContent = message;
    errEl.classList.add("visible");
  }
  import("./toast.js").then(({ toastError }) => toastError(message));
}

function saveAiSettingsFromDom() {
  const errEl = document.querySelector("#aiSettingsError");
  const okEl = document.querySelector("#aiSettingsSuccess");
  if (errEl) {
    errEl.textContent = "";
    errEl.classList.remove("visible");
  }
  if (okEl) okEl.hidden = true;

  const rawKey = document.querySelector("#aiApiKey")?.value?.trim() ?? "";
  const body = {
    enabled: document.querySelector("#aiEnabled")?.checked,
    openaiModel: document.querySelector("#aiModel")?.value?.trim()
  };
  if (rawKey) body.openaiApiKey = rawKey;

  return api
    .updateAiSettings(body)
    .then((ai) => {
      aiSettings = ai;
      const input = document.querySelector("#aiApiKey");
      if (input) input.value = "";
      return loadSettingsData();
    })
    .then(settingsOnChange)
    .then(() => import("./toast.js").then(({ toastSuccess }) => toastSuccess("Налаштування ШІ збережено")))
    .catch((ex) => showAiSettingsError(ex.message));
}
