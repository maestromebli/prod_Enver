import { inferManagerFileKind } from "@enver/shared/production/position-manager-data.js";
import { api, getStoredToken } from "./api.js";
import { runSave } from "./save-flow.js";
import { bindFileUploadZone, readFileAsBase64, renderFileUploadZone } from "./file-upload-zone.js";
import { canEditPositionManagerData } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { state } from "./state.js";
import { renderManagerFilePreview } from "./manager-file-preview.js";

const panelCache = new Map();

export function managerFileDownloadUrl(positionId, fileId) {
  const token = getStoredToken();
  const q = token ? `?access_token=${encodeURIComponent(token)}` : "";
  return `/api/positions/${positionId}/files/${fileId}/download${q}`;
}

function fileOpenHref(positionId, file) {
  if (file.externalUrl) return file.externalUrl;
  return managerFileDownloadUrl(positionId, file.id);
}

function renderFilePreview(positionId, file) {
  return renderManagerFilePreview(positionId, file, {
    classPrefix: "pm",
    downloadUrl: managerFileDownloadUrl
  });
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

export function renderFiles(positionId, files = [], { editable } = {}) {
  const canDelete = editable ?? canEditPositionManagerData();
  if (!files.length) {
    return `<p class="field-hint">Файлів ще немає.</p>`;
  }
  return `<div class="pm-file-previews">${files
    .map((f) => {
      const href = fileOpenHref(positionId, f);
      const isLink = Boolean(f.externalUrl);
      return `
        <article class="pm-file-card">
          <div class="pm-file-card-head">
            <span class="enver-badge">${escapeHtml(f.kindLabel || f.kind)}</span>
            ${isLink ? `<span class="enver-badge enver-badge-info">Посилання</span>` : ""}
            <strong>${escapeHtml(f.fileName || "файл")}</strong>
          </div>
          <div class="pm-file-preview">${renderFilePreview(positionId, f)}</div>
          <div class="pm-file-actions">
            <a class="btn btn-sm" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${isLink ? "Відкрити" : "Переглянути"}</a>
            ${
              canDelete && !f.readOnly
                ? `<button type="button" class="btn btn-sm btn-danger" data-delete-manager-file="${f.id}">Видалити</button>`
                : f.source === "workspace"
                  ? `<span class="enver-meta">Стіл конструктора</span>`
                  : ""
            }
          </div>
        </article>`;
    })
    .join("")}</div>`;
}

function renderHeaderBadge(bundle) {
  const pct = bundle?.managerDataPercent ?? 0;
  const complete = bundle?.managerDataComplete ?? false;
  return `<span class="enver-badge ${complete ? "enver-badge-success" : "enver-badge-warning"}">${pct}% · ${complete ? "Заповнено" : "Потрібно доповнити"}</span>`;
}

export function renderPositionManagerPanel(
  position,
  bundle = null,
  { editable: editableOverride } = {}
) {
  const canEdit = editableOverride ?? canEditPositionManagerData();
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

  return `
    <section class="position-manager-panel card" data-position-manager="${position.id}">
      <header class="pm-header">
        <h3 class="enver-section-title">Дані менеджера</h3>
        <span data-pm-header-badge="${position.id}">${renderHeaderBadge(bundle || position)}</span>
      </header>

      <form class="pm-form" data-pm-form="${position.id}">
        <div class="pm-requirements form-grid span-2">
          <label class="checkbox-label">
            <input type="checkbox" id="pmNeedsTech-${position.id}" data-pm-needs-tech ${data.requirements?.needsTech ? "checked" : ""} ${canEdit ? "" : "disabled"} />
            Потрібна техніка
          </label>
          <label class="checkbox-label">
            <input type="checkbox" id="pmNeedsLed-${position.id}" data-pm-needs-led ${data.requirements?.needsLed ? "checked" : ""} ${canEdit ? "" : "disabled"} />
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

      <div class="pm-block pm-tech-block" data-pm-tech-block="${position.id}" ${data.requirements?.needsTech ? "" : "hidden"}>
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
        <div class="pm-files" data-pm-files="${position.id}">${renderFiles(position.id, files, { editable: canEdit })}</div>
        ${
          canEdit
            ? `<div class="pm-upload-tools">
            <div class="pm-link-add form-grid">
              <div class="form-field"><input id="pmLinkTitle-${position.id}" placeholder="Назва посилання" /></div>
              <div class="form-field"><input id="pmLinkUrl-${position.id}" type="url" placeholder="https://…" /></div>
              <div class="form-field pm-link-add-btn"><button type="button" class="btn btn-sm" data-pm-add-link="${position.id}">Додати посилання</button></div>
            </div>
            <div class="pm-upload">
            ${renderFileUploadZone({
              zoneAttr: `data-pm-drop="${position.id}"`,
              inputAttr: `data-pm-file-input="${position.id}"`,
              compact: true,
              multiple: true,
              title: "Додати файли",
              hint: "Перетягніть або натисніть — тип визначиться автоматично"
            })}
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

async function uploadLink(positionId, { title, url }) {
  return api.uploadPositionManagerFile(positionId, {
    fileName: title || url,
    externalUrl: url,
    kind: inferManagerFileKind(title || url, "")
  });
}

async function uploadFiles(positionId, fileList) {
  const uploaded = [];
  for (const file of fileList) {
    const dataBase64 = await readFileAsBase64(file);
    const row = await api.uploadPositionManagerFile(positionId, {
      fileName: file.name,
      mime: file.type,
      dataBase64,
      kind: inferManagerFileKind(file.name, file.type)
    });
    uploaded.push(row);
  }
  return uploaded;
}

function mergeBundle(positionId, partial = {}) {
  const prev = panelCache.get(positionId) || state.ordersView.positionBundles?.[positionId] || {};
  const files = partial.files ?? prev.files ?? [];
  const bundle = { ...prev, ...partial, files };
  panelCache.set(positionId, bundle);
  state.ordersView.positionBundles = {
    ...(state.ordersView.positionBundles || {}),
    [positionId]: bundle
  };
  return bundle;
}

function patchFilesList(panel, positionId, files) {
  const filesEl = panel.querySelector(`[data-pm-files="${positionId}"]`);
  if (filesEl) filesEl.innerHTML = renderFiles(positionId, files);
}

function patchHeaderBadge(panel, positionId, bundle) {
  const badgeEl = panel.querySelector(`[data-pm-header-badge="${positionId}"]`);
  if (badgeEl) badgeEl.innerHTML = renderHeaderBadge(bundle);
}

function bindDeleteFileButtons(panel, positionId, onSaved) {
  panel.querySelectorAll(`[data-delete-manager-file]`).forEach((btn) => {
    if (btn.dataset.pmDeleteBound === "1") return;
    btn.dataset.pmDeleteBound = "1";
    btn.addEventListener("click", async () => {
      const fileId = btn.dataset.deleteManagerFile;
      if (String(fileId).startsWith("ws-")) return;
      if (!window.confirm("Видалити файл?")) return;
      await api.deletePositionManagerFile(positionId, fileId);
      toastSuccess("Файл видалено");
      await onSaved?.();
    });
  });
}

export function bindPositionManagerPanel(root, { positionId, onSaved, editable = true } = {}) {
  const panel = root.querySelector(`[data-position-manager="${positionId}"]`);
  if (!panel || !editable) return;

  const syncTechBlockVisibility = () => {
    const needsTech = Boolean(document.getElementById(`pmNeedsTech-${positionId}`)?.checked);
    const block = panel.querySelector(`[data-pm-tech-block="${positionId}"]`);
    if (block) block.hidden = !needsTech;
  };

  panel.querySelector(`[data-pm-needs-tech]`)?.addEventListener("change", syncTechBlockVisibility);

  panel.querySelector(`[data-pm-form="${positionId}"]`)?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = readForm(positionId);
    const submitBtn =
      e.submitter || panel.querySelector(`[data-pm-form="${positionId}"] button[type="submit"]`);
    await runSave("Дані позиції", {
      submitEl: submitBtn,
      saveFn: () => api.savePositionManagerData(positionId, body),
      successMessage: "Дані збережено",
      onSuccess: async (result) => {
        const bundle = mergeBundle(positionId, result);
        patchHeaderBadge(panel, positionId, bundle);
        await onSaved?.(bundle);
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
    mergeBundle(positionId, {
      managerData: { ...(cached.managerData || {}), appliances }
    });
    const list = panel.querySelector(".pm-appliance-list")?.parentElement;
    if (list) {
      const h4 = list.querySelector("h4");
      list.innerHTML = `${h4 ? h4.outerHTML : "<h4>Техніка / посилання</h4>"}${renderAppliances(appliances)}`;
    }
  });

  panel.querySelector(`[data-pm-add-link="${positionId}"]`)?.addEventListener("click", async () => {
    const title = document.getElementById(`pmLinkTitle-${positionId}`)?.value?.trim() || "";
    const url = document.getElementById(`pmLinkUrl-${positionId}`)?.value?.trim() || "";
    if (!url) {
      toastError("Вкажіть посилання (https://…)");
      return;
    }
    if (!/^https?:\/\//i.test(url)) {
      toastError("Посилання має починатися з http:// або https://");
      return;
    }
    await runSave("Посилання", {
      saveFn: () => uploadLink(positionId, { title, url }),
      successMessage: "Посилання додано",
      onSuccess: async (uploaded) => {
        const prev =
          panelCache.get(positionId) || state.ordersView.positionBundles?.[positionId] || {};
        const files = [...(prev.files || []), uploaded];
        const bundle = mergeBundle(positionId, { files });
        patchFilesList(panel, positionId, files);
        patchHeaderBadge(panel, positionId, bundle);
        bindDeleteFileButtons(panel, positionId, onSaved);
        document.getElementById(`pmLinkTitle-${positionId}`).value = "";
        document.getElementById(`pmLinkUrl-${positionId}`).value = "";
        await onSaved?.(bundle);
      },
      onError: (err) => toastError(err.message)
    }).catch(() => {});
  });

  bindDeleteFileButtons(panel, positionId, onSaved);

  const dropSelector = `[data-pm-drop="${positionId}"]`;

  bindFileUploadZone(panel, {
    zoneSelector: dropSelector,
    inputSelector: `[data-pm-file-input="${positionId}"]`,
    multiple: true,
    onFile: async (file) => {
      await runSave("Файли", {
        saveFn: () => uploadFiles(positionId, [file]),
        successMessage: "Файл завантажено",
        onSuccess: async (uploaded) => {
          const prev =
            panelCache.get(positionId) || state.ordersView.positionBundles?.[positionId] || {};
          const files = [...(prev.files || []), ...uploaded];
          const bundle = mergeBundle(positionId, { files });
          patchFilesList(panel, positionId, files);
          patchHeaderBadge(panel, positionId, bundle);
          bindDeleteFileButtons(panel, positionId, onSaved);
          await onSaved?.(bundle);
        }
      }).catch(() => {});
    }
  });
}

export async function loadPositionManagerBundle(positionId) {
  const bundle = await api.getPositionManagerData(positionId);
  mergeBundle(positionId, bundle);
  return bundle;
}

export function setPositionManagerCache(positionId, bundle) {
  mergeBundle(positionId, bundle);
}
