import { api } from "./api.js";
import { isAdmin } from "./auth.js";
import { runSettingsSave } from "./settings-save-feedback.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

/** Порядок і склад довідників у налаштуваннях */
export const DIRECTORY_KEYS = [
  "Менеджери",
  "Конструктори",
  "Збирачі",
  "Монтажники",
  "Типи виробів",
  "Статуси замовлення",
  "Статуси етапів",
  "Пріоритети"
];

function normalizeItems(items) {
  const seen = new Set();
  return items
    .map((s) => String(s).trim())
    .filter((s) => {
      if (!s || seen.has(s.toLowerCase())) return false;
      seen.add(s.toLowerCase());
      return true;
    });
}

function collectDirectoryItems(key) {
  const card = document.querySelector(`[data-directory="${CSS.escape(key)}"]`);
  if (!card) return [];
  return normalizeItems([...card.querySelectorAll("[data-dir-input]")].map((input) => input.value));
}

export function collectAllDirectoriesFromDom() {
  const result = { ...state.directories };
  for (const key of DIRECTORY_KEYS) {
    const card = document.querySelector(`[data-directory="${CSS.escape(key)}"]`);
    if (card) result[key] = collectDirectoryItems(key);
  }
  return result;
}

export async function saveDirectoryKey(key, { onReload } = {}) {
  const items = collectDirectoryItems(key);
  if (!items.length) {
    const { toastError } = await import("./toast.js");
    toastError("Додайте хоча б одне значення");
    return;
  }
  return runSettingsSave(`Довідник «${key}»`, {
    onReload,
    saveFn: () => api.updateDirectories({ [key]: items }),
    onSuccess: (updated) => {
      state.directories = updated;
    }
  });
}

export async function saveAllDirectories({ onReload } = {}) {
  const payload = collectAllDirectoriesFromDom();
  for (const key of DIRECTORY_KEYS) {
    if (!payload[key]?.length) {
      const { toastError } = await import("./toast.js");
      toastError(`Довідник «${key}» не може бути порожнім`);
      return;
    }
  }
  return runSettingsSave("Довідники", {
    onReload,
    saveFn: () => api.updateDirectories(payload),
    onSuccess: (updated) => {
      state.directories = updated;
    }
  });
}

function directoryItemRow(value, editable) {
  if (!editable) {
    return `<li class="directory-item directory-item--readonly"><span>${escapeHtml(value)}</span></li>`;
  }
  return `
    <li class="directory-item">
      <input type="text" class="directory-item-input" data-dir-input value="${escapeHtml(value)}" />
      <button type="button" class="btn btn-sm btn-danger" data-delete-dir-item title="Видалити">×</button>
    </li>
  `;
}

function directoryCard(key, items, editable) {
  const list = (items || []).map((item) => directoryItemRow(item, editable)).join("");

  const actions = editable
    ? `
        <button type="button" class="btn btn-sm btn-primary" data-save-directory="${escapeHtml(key)}">Зберегти</button>
      `
    : "";

  const addBtn = editable
    ? `<button type="button" class="btn btn-sm" data-add-dir-item data-directory="${escapeHtml(key)}">+ Додати</button>`
    : "";

  return `
    <div class="directory-card" data-directory="${escapeHtml(key)}">
      <div class="directory-card-header">
        <h3>${escapeHtml(key)}</h3>
        ${actions}
      </div>
      <ul class="directory-items">${list || ""}</ul>
      ${addBtn}
    </div>
  `;
}

export function directoriesSectionHtml() {
  const editable = isAdmin();
  const lists = state.directories;

  const cards = DIRECTORY_KEYS.map((key) => directoryCard(key, lists[key] || [], editable)).join(
    ""
  );

  return `
    <div class="settings-section directories-section">
      <div class="settings-section-header">
        <h2>Довідники</h2>
        ${
          editable
            ? `<button type="button" class="btn btn-primary btn-sm" id="saveAllDirectoriesBtn">Зберегти всі</button>`
            : ""
        }
      </div>
      <p class="settings-hint">
        ${
          editable
            ? "Значення з довідників використовуються у формах замовлень, позицій і календаря монтажу. Після змін натисніть «Зберегти» біля довідника або «Зберегти всі»."
            : "Перегляд довідників. Редагування доступне лише адміністратору."
        }
      </p>
      <div class="directory-grid">${cards}</div>
    </div>
  `;
}

export function appendDirectoryItemRow(key) {
  const card = document.querySelector(`[data-directory="${CSS.escape(key)}"]`);
  const ul = card?.querySelector(".directory-items");
  if (!ul) return;
  ul.insertAdjacentHTML("beforeend", directoryItemRow("", true));
  ul.querySelector(".directory-item:last-child [data-dir-input]")?.focus();
}

export function handleDirectoriesClick(e, onChange) {
  if (!e.target.closest(".directories-section")) return false;

  if (e.target.closest("[data-add-dir-item]")) {
    const key = e.target.closest("[data-add-dir-item]").dataset.directory;
    appendDirectoryItemRow(key);
    return true;
  }

  const delBtn = e.target.closest("[data-delete-dir-item]");
  if (delBtn) {
    const li = delBtn.closest(".directory-item");
    const card = delBtn.closest("[data-directory]");
    const inputs = card?.querySelectorAll("[data-dir-input]") ?? [];
    if (inputs.length <= 1) {
      import("./toast.js").then(({ toastError }) =>
        toastError("У довіднику має залишитись хоча б одне значення")
      );
      return true;
    }
    li?.remove();
    return true;
  }

  const saveOne = e.target.closest("[data-save-directory]");
  if (saveOne) {
    saveDirectoryKey(saveOne.dataset.saveDirectory, { onReload: onChange }).catch(() => {});
    return true;
  }

  if (e.target.closest("#saveAllDirectoriesBtn")) {
    saveAllDirectories({ onReload: onChange }).catch(() => {});
    return true;
  }

  return false;
}
