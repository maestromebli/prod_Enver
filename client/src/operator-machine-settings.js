import { api } from "./api.js";
import {
  applyBrowserPathDisplay,
  bindFolderPickButton,
  fetchFolderPickerCapabilities,
  folderPickerCapabilities,
  ingestBrowserPickedFolder,
  isBrowserPickedPath,
  resolvePathInputValue
} from "./folder-picker.js";
import { runSave } from "./save-flow.js";
import { escapeHtml } from "./utils.js";
import { toastError } from "./toast.js";

const PARSER_OPTIONS = [
  { id: "kdt", label: "KDT Saw (папка .txt)" },
  { id: "generic", label: "Загальний (файл)" },
  { id: "biesse", label: "Biesse" },
  { id: "homag", label: "Homag" },
  { id: "scm", label: "SCM" }
];

const SUBFOLDER_PRESETS = [
  { id: "meta.json", label: "meta.json (об'єкт, клієнт, KDT-шляхи)" },
  { id: "giblab", label: "giblab (деталі, матеріал)" },
  { id: "kdt", label: "kdt (програми порізки)" },
  { id: "kdtsaw", label: "kdtsaw" }
];

let modalReady = false;
let currentStageKey = "cutting";
let onSavedCallback = () => {};

function $(id) {
  return document.getElementById(id);
}

function parserHint(profile) {
  return profile === "kdt"
    ? "Папка з логами KDT на сервері ENVER (усі .txt рекурсивно)"
    : "Один текстовий файл логу на сервері ENVER";
}

function pathPickerHint() {
  const caps = folderPickerCapabilities();
  if (caps.android && caps.windowsDialog) {
    return "Оберіть папку: на Android — провідник пристрою; на Windows-сервері — мережевий діалог.";
  }
  if (caps.android) {
    return "Натисніть «Обрати папку» — відкриється провідник Android.";
  }
  if (caps.windowsDialog) {
    return "«Обрати папку» — діалог Windows на ПК з ENVER-сервером (диск або \\\\NAS\\...).";
  }
  if (caps.browserDialog) {
    return "«Обрати папку» — папка на цьому комп'ютері (Chrome/Edge). Потім «Сканувати логи» для імпорту .txt.";
  }
  return "Введіть мережевий шлях вручну або відкрийте сайт у Chrome/Edge на ПК з логами.";
}

function pathPickerRow({ inputId, pickId, label, hint }) {
  return `
    <div class="form-field">
      <label for="${inputId}">${escapeHtml(label)}</label>
      ${hint ? `<p class="field-hint">${escapeHtml(hint)}</p>` : ""}
      <p class="field-hint op-ms-picker-hint">${escapeHtml(pathPickerHint())}</p>
      <div class="op-ms-path-row">
        <input id="${inputId}" type="text" class="op-ms-path-display" readonly placeholder="Папку ще не обрано" />
        <button type="button" class="btn btn-primary op-ms-pick-btn" id="${pickId}">Обрати папку</button>
      </div>
      <button type="button" class="op-ms-manual-toggle" data-manual-for="${inputId}">Ввести шлях вручну (мережа)</button>
    </div>
  `;
}

function renderSubfolderChecks(selected = []) {
  const set = new Set(selected.map((s) => String(s).toLowerCase()));
  return SUBFOLDER_PRESETS.map(
    (p) => `
      <label class="checkbox-label op-ms-subfolder">
        <input type="checkbox" data-op-ms-subfolder value="${escapeHtml(p.id)}" ${set.has(p.id.toLowerCase()) ? "checked" : ""} />
        ${escapeHtml(p.label)}
      </label>
    `
  ).join("");
}

function collectSubfolders() {
  const picked = [];
  document.querySelectorAll("[data-op-ms-subfolder]:checked").forEach((el) => {
    picked.push(el.value);
  });
  const extra = ($("opMsSubfoldersExtra")?.value || "")
    .split(/[,;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return [...new Set([...picked, ...extra])];
}

async function fillForm(config) {
  const profile = config.parserProfile || "kdt";
  $("opMsParser").value = profile;
  $("opMsLogPath").value = config.logPath || "";
  delete $("opMsLogPath").dataset.browserKey;
  if (isBrowserPickedPath(config.logPath)) {
    await applyBrowserPathDisplay($("opMsLogPath"), config.logPath);
  }
  $("opMsPathHint").textContent = parserHint(profile);
  $("opMsProjectsRoot").value = config.projectsRootPath || "";
  delete $("opMsProjectsRoot").dataset.browserKey;
  if (isBrowserPickedPath(config.projectsRootPath)) {
    await applyBrowserPathDisplay($("opMsProjectsRoot"), config.projectsRootPath);
  }
  $("opMsWatch").checked = Boolean(config.watchEnabled);
  $("opMsAi").checked = config.aiMatchingEnabled !== false;
  $("opMsStatus").textContent = config.lastMatchSummary
    ? `${config.lastProgress ?? 0}% · ${config.lastMatchSummary}`
    : "Ще не налаштовано";

  const subs = config.aiSourceSubfolders || [];
  const presetIds = new Set(SUBFOLDER_PRESETS.map((p) => p.id.toLowerCase()));
  const extras = subs.filter((s) => !presetIds.has(String(s).toLowerCase()));
  const wrap = $("opMsSubfolders");
  if (wrap) wrap.innerHTML = renderSubfolderChecks(subs);
  if ($("opMsSubfoldersExtra")) $("opMsSubfoldersExtra").value = extras.join(", ");
}

export function initOperatorMachineSettingsModal() {
  if (modalReady) return;
  modalReady = true;

  const wrap = document.createElement("div");
  wrap.innerHTML = `
    <div class="modal-backdrop op-machine-settings-modal" id="opMachineSettingsModal" aria-hidden="true">
      <div class="modal modal-lg op-ms-card" role="dialog" aria-labelledby="opMsTitle">
        <div class="modal-header">
          <h2 id="opMsTitle">Логи станка та ШІ</h2>
          <button type="button" class="modal-close" id="opMsClose" aria-label="Закрити">×</button>
        </div>
        <form id="opMachineSettingsForm" class="op-ms-body">
          <p class="op-ms-intro">
            Оберіть папку через «Обрати папку»: на цьому ПК (Chrome/Edge), Android або Windows-сервер у мережі.
            Для папки з браузера натисніть «Сканувати логи» після збереження.
          </p>

          <section class="op-ms-section">
            <h3>Парсер логів</h3>
            <div class="form-field">
              <label for="opMsParser">Профіль парсера</label>
              <select id="opMsParser">
                ${PARSER_OPTIONS.map((p) => `<option value="${p.id}">${escapeHtml(p.label)}</option>`).join("")}
              </select>
            </div>
            <p class="field-hint" id="opMsPathHint"></p>
            ${pathPickerRow({
              inputId: "opMsLogPath",
              pickId: "opMsPickLogPath",
              label: "Папка або файл логів",
              hint: "KDT — папка з .txt; інші профілі — один файл логу."
            })}
            <div class="op-ms-checks">
              <label class="checkbox-label">
                <input type="checkbox" id="opMsWatch" />
                Стежити за логами (опитування кожні 3 с)
              </label>
              <label class="checkbox-label">
                <input type="checkbox" id="opMsAi" checked />
                Увімкнути ШІ-зіставлення з чергою
              </label>
            </div>
          </section>

          <section class="op-ms-section">
            <h3>Папки проєктів</h3>
            ${pathPickerRow({
              inputId: "opMsProjectsRoot",
              pickId: "opMsPickProjectsRoot",
              label: "Корінь папок замовлень",
              hint: "Та сама коренева папка, що в агенті (inbox / active / done)."
            })}
            <div class="form-field">
              <label>Підпапки для аналізу ШІ</label>
              <p class="field-hint">Файли з цих підпапок кожного проєкту порівнюються з логом станка.</p>
              <div class="op-ms-subfolders" id="opMsSubfolders"></div>
              <label class="op-ms-extra-label" for="opMsSubfoldersExtra">Додаткові (через кому)</label>
              <input id="opMsSubfoldersExtra" type="text" placeholder="xml, programs" autocomplete="off" />
            </div>
          </section>

          <p class="op-ms-status" id="opMsStatus" aria-live="polite"></p>
          <p class="form-error" id="opMsError" role="alert"></p>

          <div class="modal-footer op-ms-footer">
            <button type="button" class="btn" id="opMsCancel">Скасувати</button>
            <button type="button" class="btn" id="opMsScan">Сканувати логи</button>
            <button type="submit" class="btn btn-primary" id="opMsSave">Зберегти</button>
          </div>
        </form>
      </div>
    </div>
  `;
  document.body.appendChild(wrap.firstElementChild);

  bindFolderPickButton({
    button: $("opMsPickLogPath"),
    input: $("opMsLogPath"),
    title: "Папка або файл логів станка",
    storageKey: "opMsLogPath"
  });
  bindFolderPickButton({
    button: $("opMsPickProjectsRoot"),
    input: $("opMsProjectsRoot"),
    title: "Корінь папок замовлень",
    storageKey: "opMsProjectsRoot"
  });

  document.getElementById("opMachineSettingsForm")?.addEventListener("click", (e) => {
    const toggle = e.target.closest("[data-manual-for]");
    if (!toggle) return;
    const input = document.getElementById(toggle.dataset.manualFor);
    if (!input) return;
    const manual = input.dataset.manual === "1";
    input.dataset.manual = manual ? "0" : "1";
    input.readOnly = manual;
    toggle.textContent = manual ? "Ввести шлях вручну (мережа)" : "Лише вибір папки";
    if (!manual) input.focus();
  });

  $("opMsParser")?.addEventListener("change", () => {
    const profile = $("opMsParser").value;
    $("opMsPathHint").textContent = parserHint(profile);
  });

  $("opMsClose")?.addEventListener("click", closeOperatorMachineSettings);
  $("opMsCancel")?.addEventListener("click", closeOperatorMachineSettings);
  $("opMachineSettingsModal")?.addEventListener("click", (e) => {
    if (e.target.id === "opMachineSettingsModal") closeOperatorMachineSettings();
  });

  $("opMsScan")?.addEventListener("click", async () => {
    const btn = $("opMsScan");
    const logPath = resolvePathInputValue($("opMsLogPath"));
    await runSave("Сканування", {
      submitEl: btn,
      saveFn: async () => {
        if (isBrowserPickedPath(logPath)) {
          return ingestBrowserPickedFolder(currentStageKey, logPath);
        }
        return api.scanOperatorMachineLogs(currentStageKey, { fullScan: false });
      },
      successMessage: "Сканування завершено",
      onSuccess: async (result) => {
        $("opMsStatus").textContent = result?.message || "Готово";
        onSavedCallback();
      }
    }).catch(() => {});
  });

  $("opMachineSettingsForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = $("opMsError");
    err.textContent = "";
    err.classList.remove("visible");

    const body = {
      logPath: resolvePathInputValue($("opMsLogPath")),
      parserProfile: $("opMsParser").value,
      watchEnabled: $("opMsWatch").checked,
      aiMatchingEnabled: $("opMsAi").checked,
      projectsRootPath: resolvePathInputValue($("opMsProjectsRoot")),
      aiSourceSubfolders: collectSubfolders()
    };

    await runSave("Налаштування", {
      submitEl: $("opMsSave"),
      saveFn: () => api.updateOperatorMachineConfig(currentStageKey, body),
      successMessage: "Налаштування збережено",
      onSuccess: async (config) => {
        fillForm(config);
        closeOperatorMachineSettings();
        onSavedCallback();
      },
      onError: (ex) => {
        err.textContent = ex.message;
        err.classList.add("visible");
      }
    }).catch(() => {});
  });
}

export function closeOperatorMachineSettings() {
  const modal = $("opMachineSettingsModal");
  modal?.classList.remove("open");
  modal?.setAttribute("aria-hidden", "true");
}

export async function openOperatorMachineSettings(stageKey = "cutting", onSaved = () => {}) {
  initOperatorMachineSettingsModal();
  currentStageKey = stageKey;
  onSavedCallback = onSaved;

  try {
    await fetchFolderPickerCapabilities({ refresh: true });
    document.querySelectorAll(".op-ms-picker-hint").forEach((el) => {
      el.textContent = pathPickerHint();
    });

    const config = await api.getOperatorMachineConfig(stageKey);
    await fillForm(config);
    const modal = $("opMachineSettingsModal");
    modal?.classList.add("open");
    modal?.setAttribute("aria-hidden", "false");
  } catch (err) {
    toastError(err.message || "Не вдалося завантажити налаштування");
  }
}

export function canShowOperatorMachineSettings(stageKey) {
  return stageKey === "cutting";
}
