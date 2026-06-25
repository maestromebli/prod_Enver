import {
  MANAGER_FILE_KINDS,
  MANAGER_FILE_KIND_LABELS
} from "@enver/shared/production/position-manager-data.js";
import { api, getStoredToken } from "./api.js";
import { canEditPositionManagerData } from "./auth.js";
import { runSave } from "./save-flow.js";
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";

const panelCache = new Map();

export function managerFileDownloadUrl(positionId, fileId) {
  const token = getStoredToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return `/api/positions/${positionId}/files/${fileId}/download${q}`;
}

function kindOptions() {
  return MANAGER_FILE_KINDS.map(
    (k) => `<option value="${k}">${escapeHtml(MANAGER_FILE_KIND_LABELS[k] || k)}</option>`
  ).join("");
}

function renderAppliances(appliances = []) {
  if (!appliances.length) {
    return `<p class="field-hint">Посилання на техніку ще не додано.</p>`;
  }
  return `<ul class="pm-appliance-list">${appliances
    .map(
      (a, i) => `
      <li class="pm-appliance-item" data-appliance-idx="${i}">
        <strong>${escapeHtml(a.title || "Техніка")}</strong>
        ${a.url ? `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener">${escapeHtml(a.url)}</a>` : ""}
        ${a.note ? `<span class="enver-meta">${escapeHtml(a.note)}</span>` : ""}
      </li>`
    )
    .join("")}</ul>`;
}

function renderFiles(positionId, files = []) {
  if (!files.length) {
    return `<p class="field-hint">Файлів ще немає.</p>`;
  }
  return `<div class="pm-files-grid">${files
    .map((f) => {
      const href = managerFileDownloadUrl(positionId, f.id);
      const isImg = String(f.mime || "").startsWith("image/");
      const preview = isImg
        ? `<img class="pm-file-thumb" src="${href}" alt="" loading="lazy" />`
        : `<span class="pm-file-icon">📄</span>`;
      return `
        <article class="pm-file-card">
          ${preview}
          <div class="pm-file-meta">
            <span class="enver-badge">${escapeHtml(f.kindLabel || f.kind)}</span>
            <strong>${escapeHtml(f.fileName || "файл")}</strong>
          </div>
          <a class="btn btn-sm" href="${href}" target="_blank" rel="noopener">Відкрити</a>
          ${
            canEditPositionManagerData() && !f.readOnly
              ? `<button type="button" class="btn btn-sm btn-danger" data-delete-manager-file="${f.id}">Видалити</button>`
              : f.source === "workspace"
                ? `<span class="enver-meta">Стіл конструктора</span>`
                : ""
          }
        </article>`;
    })
    .join("")}</div>`;
}

export function renderPositionManagerPanel(position, bundle = null) {
  const canEdit = canEditPositionManagerData();
  const data = bundle?.managerData ||
    position?.managerData || {
      delivery: {},
      deadlines: {},
      comments: {},
      appliances: [],
      requirements: { needsTech: false, needsLed: false },
      sourceLinks: []
    };
  const files = bundle?.files || position?.managerFiles || [];
  const pct = bundle?.managerDataPercent ?? position?.managerDataPercent ?? 0;
  const complete = bundle?.managerDataComplete ?? position?.managerDataComplete ?? false;
  const needsTech = Boolean(data.requirements?.needsTech);
  const needsLed = Boolean(data.requirements?.needsLed);

  return `
    <section class="position-manager-panel card" data-position-manager="${position.id}">
      <header class="pm-header">
        <h3 class="enver-section-title">Дані менеджера</h3>
        <span class="enver-badge ${complete ? "enver-badge-success" : "enver-badge-warning"}">${pct}% · ${complete ? "Заповнено" : "Потрібно доповнити"}</span>
      </header>

      <form class="pm-form" data-pm-form="${position.id}">
        <div class="pm-requirements form-grid span-2">
          <label class="checkbox-label">
            <input type="checkbox" id="pmNeedsTech-${position.id}" data-pm-needs-tech ${needsTech ? "checked" : ""} ${canEdit ? "" : "disabled"} />
            Потрібна техніка
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="pmNeedsLed-${position.id}" data-pm-needs-led ${needsLed ? "checked" : ""} ${canEdit ? "" : "disabled"} />
            Потрібен LED
          </label>
        </div>
        <div class="form-grid">
          <div class="form-field span-2">
            <label for="pmDelivery-${position.id}">Адреса доставки *</label>
            <input id="pmDelivery-${position.id}" name="deliveryAddress" value="${escapeHtml(data.delivery?.address || position.deliveryAddress || "")}" ${canEdit ? "" : "readonly"} />
          </div>
          <div class="form-field">
            <label for="pmContactName-${position.id}">Контакт</label>
            <input id="pmContactName-${position.id}" value="${escapeHtml(data.delivery?.contactName || position.deliveryContactName || "")}" ${canEdit ? "" : "readonly"} />
          </div>
          <div class="form-field">
            <label for="pmContactPhone-${position.id}">Телефон</label>
            <input id="pmContactPhone-${position.id}" value="${escapeHtml(data.delivery?.contactPhone || position.deliveryContactPhone || "")}" ${canEdit ? "" : "readonly"} />
          </div>
          <div class="form-field">
            <label for="pmDeadline-${position.id}">Строк позиції *</label>
            <input id="pmDeadline-${position.id}" placeholder="дд.мм.рррр" value="${escapeHtml(data.deadlines?.positionDeadline || position.positionDeadline || "")}" ${canEdit ? "" : "readonly"} />
          </div>
          <div class="form-field">
            <label for="pmMeasure-${position.id}">Дата заміру</label>
            <input id="pmMeasure-${position.id}" placeholder="дд.мм.рррр" value="${escapeHtml(data.deadlines?.measurementDate || position.measurementDate || "")}" ${canEdit ? "" : "readonly"} />
          </div>
          <div class="form-field">
            <label for="pmInstallPref-${position.id}">Бажана дата монтажу</label>
            <input id="pmInstallPref-${position.id}" placeholder="дд.мм.рррр" value="${escapeHtml(data.deadlines?.installPreferredDate || position.installationPreferredDate || "")}" ${canEdit ? "" : "readonly"} />
          </div>
          <div class="form-field span-2">
            <label for="pmClientNotes-${position.id}">Побажання клієнта</label>
            <textarea id="pmClientNotes-${position.id}" rows="2" ${canEdit ? "" : "readonly"}>${escapeHtml(data.comments?.client || "")}</textarea>
          </div>
          <div class="form-field span-2">
            <label for="pmManagerNotes-${position.id}">Нотатки менеджера</label>
            <textarea id="pmManagerNotes-${position.id}" rows="2" ${canEdit ? "" : "readonly"}>${escapeHtml(data.comments?.manager || position.note || "")}</textarea>
          </div>
          <div class="form-field span-2">
            <label for="pmTechNotes-${position.id}">Технічні примітки</label>
            <textarea id="pmTechNotes-${position.id}" rows="2" ${canEdit ? "" : "readonly"}>${escapeHtml(data.comments?.technical || "")}</textarea>
          </div>
        </div>
        ${
          canEdit
            ? `<div class="pm-form-actions">
            <button type="submit" class="btn btn-primary">Зберегти дані</button>
          </div>`
            : ""
        }
      </form>

      <div class="pm-block pm-tech-block" data-pm-tech-block="${position.id}" ${needsTech ? "" : "hidden"}>
        <h4>Техніка / посилання</h4>
        ${renderAppliances(data.appliances)}
        ${
          canEdit
            ? `<div class="pm-inline-add form-grid">
            <div class="form-field"><input id="pmApplianceTitle-${position.id}" placeholder="Назва (духовка)" /></div>
            <div class="form-field"><input id="pmApplianceUrl-${position.id}" placeholder="URL" /></div>
            <div class="form-field"><button type="button" class="btn btn-sm" data-pm-add-appliance="${position.id}">Додати</button></div>
          </div>`
            : ""
        }
      </div>

      <div class="pm-block">
        <h4>Файли менеджера</h4>
        <div class="pm-files" data-pm-files="${position.id}">${renderFiles(position.id, files)}</div>
        ${
          canEdit
            ? `<div class="pm-upload">
            <div class="pm-drop" data-pm-drop="${position.id}">
              <p>Перетягніть файли сюди або оберіть</p>
              <input type="file" multiple data-pm-file-input="${position.id}" />
            </div>
            <div class="form-field">
              <label>Тип файлу</label>
              <select data-pm-file-kind="${position.id}">${kindOptions()}</select>
            </div>
          </div>`
            : ""
        }
      </div>
    </section>`;
}

function readForm(positionId) {
  return {
    delivery: {
      address: document.getElementById(`pmDelivery-${positionId}`)?.value?.trim() || "",
      contactName: document.getElementById(`pmContactName-${positionId}`)?.value?.trim() || "",
      contactPhone: document.getElementById(`pmContactPhone-${positionId}`)?.value?.trim() || ""
    },
    deadlines: {
      positionDeadline: document.getElementById(`pmDeadline-${positionId}`)?.value?.trim() || "",
      measurementDate: document.getElementById(`pmMeasure-${positionId}`)?.value?.trim() || "",
      installPreferredDate:
        document.getElementById(`pmInstallPref-${positionId}`)?.value?.trim() || ""
    },
    comments: {
      client: document.getElementById(`pmClientNotes-${positionId}`)?.value?.trim() || "",
      manager: document.getElementById(`pmManagerNotes-${positionId}`)?.value?.trim() || "",
      technical: document.getElementById(`pmTechNotes-${positionId}`)?.value?.trim() || ""
    },
    requirements: {
      needsTech: Boolean(document.getElementById(`pmNeedsTech-${positionId}`)?.checked),
      needsLed: Boolean(document.getElementById(`pmNeedsLed-${positionId}`)?.checked)
    },
    appliances: panelCache.get(positionId)?.managerData?.appliances || [],
    markComplete: true
  };
}

async function uploadFiles(positionId, fileList, kind) {
  for (const file of fileList) {
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1] || "");
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    await api.uploadPositionManagerFile(positionId, {
      fileName: file.name,
      mime: file.type,
      dataBase64,
      kind
    });
  }
}

export function bindPositionManagerPanel(root, { positionId, onSaved } = {}) {
  const panel = root.querySelector(`[data-position-manager="${positionId}"]`);
  if (!panel) return;

  const syncTechBlockVisibility = () => {
    const needsTech = Boolean(document.getElementById(`pmNeedsTech-${positionId}`)?.checked);
    const block = panel.querySelector(`[data-pm-tech-block="${positionId}"]`);
    if (block) block.hidden = !needsTech;
  };

  panel.querySelector(`[data-pm-needs-tech]`)?.addEventListener("change", syncTechBlockVisibility);

  panel.querySelector(`[data-pm-form="${positionId}"]`)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = readForm(positionId);
    await runSave("Дані позиції", {
      saveFn: () => api.savePositionManagerData(positionId, body),
      successMessage: "Дані збережено",
      onSuccess: async (result) => {
        panelCache.set(positionId, result);
        await onSaved?.(result);
      },
      onError: (err) => toastError(err.message)
    }).catch(() => {});
  });

  panel.querySelector(`[data-pm-add-appliance="${positionId}"]`)?.addEventListener("click", () => {
    const title = document.getElementById(`pmApplianceTitle-${positionId}`)?.value?.trim();
    const url = document.getElementById(`pmApplianceUrl-${positionId}`)?.value?.trim();
    if (!title && !url) return;
    const cached = panelCache.get(positionId) || { managerData: { appliances: [] } };
    const appliances = [...(cached.managerData?.appliances || []), { title, url, note: "" }];
    panelCache.set(positionId, {
      ...cached,
      managerData: { ...(cached.managerData || {}), appliances }
    });
    const list = panel.querySelector(".pm-appliance-list")?.parentElement;
    if (list) {
      const h4 = list.querySelector("h4");
      list.innerHTML = `${h4 ? h4.outerHTML : "<h4>Техніка / посилання</h4>"}${renderAppliances(appliances)}`;
    }
  });

  panel.querySelectorAll(`[data-delete-manager-file]`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const fileId = btn.dataset.deleteManagerFile;
      if (String(fileId).startsWith("ws-")) return;
      if (!window.confirm("Видалити файл?")) return;
      await api.deletePositionManagerFile(positionId, fileId);
      toastSuccess("Файл видалено");
      await onSaved?.();
    });
  });

  const drop = panel.querySelector(`[data-pm-drop="${positionId}"]`);
  const input = panel.querySelector(`[data-pm-file-input="${positionId}"]`);
  const kindSelect = panel.querySelector(`[data-pm-file-kind="${positionId}"]`);

  async function handleFiles(files) {
    if (!files?.length) return;
    const kind = kindSelect?.value || "manager_other";
    await runSave("Файли", {
      saveFn: () => uploadFiles(positionId, files, kind),
      successMessage: "Файли завантажено",
      onSuccess: () => onSaved?.()
    }).catch(() => {});
  }

  input?.addEventListener("change", () => handleFiles(input.files));
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("pm-drop--active");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("pm-drop--active"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("pm-drop--active");
    handleFiles(e.dataTransfer?.files);
  });
}

export async function loadPositionManagerBundle(positionId) {
  const bundle = await api.getPositionManagerData(positionId);
  panelCache.set(positionId, bundle);
  return bundle;
}

export function setPositionManagerCache(positionId, bundle) {
  panelCache.set(positionId, bundle);
}
