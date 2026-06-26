import { api, constructivePackageFileUrl, getPartLabelsUrl } from "./api.js";
import { createFileDropZone } from "./interactions/drag-drop.js";
import { pickLocalFile } from "./file-picker.js";
import { bindFileUploadZone, readFileAsBase64, renderFileUploadZone } from "./file-upload-zone.js";
import {
  CONSTRUCTIVE_ACCEPT_EXT,
  CONSTRUCTIVE_MAX_BYTES,
  formatConstructiveSize
} from "@enver/shared/production/constructive-files.js";
import {
  CONSTRUCTIVE_PIPELINE_STEPS,
  PACKAGE_FILE_KIND_LABELS,
  packageStatusLabel,
  detectPackageFileKind
} from "@enver/shared/production/constructive-package.js";
import { canWorkConstructorDesk } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { renderConstructiveFileList } from "./position-drawer-render.js";
import { toastError, toastSuccess } from "./toast.js";
import { runSave } from "./save-flow.js";

const packageDropZones = new WeakMap();
const quickUploadZones = new WeakMap();
const pendingFilesByRoot = new WeakMap();
const packageBindAbort = new WeakMap();

const PACKAGE_EXTRA_EXT = [".glb", ".gltf"];

function fileExtension(name) {
  const n = String(name || "");
  const i = n.lastIndexOf(".");
  return i >= 0 ? n.slice(i).toLowerCase() : "";
}

/** Чи файл підходить для пакета конструктива (файли або вміст папки). */
export function isPackageUploadFile(file) {
  if (!file?.name || file.name.startsWith(".")) return false;
  if (Number(file.size) > CONSTRUCTIVE_MAX_BYTES) return false;
  const ext = fileExtension(file.name);
  if (CONSTRUCTIVE_ACCEPT_EXT.includes(ext) || PACKAGE_EXTRA_EXT.includes(ext)) return true;
  return detectPackageFileKind(file.name) !== "other";
}

function syncPackageUploadBtn(root, pendingFiles) {
  const btn = root.querySelector("[data-cp-upload-btn]");
  if (btn) btn.disabled = pendingFiles.size === 0;
}

function addPendingPackageFiles(root, pendingFiles, fileList, { toastSummary = false } = {}) {
  let added = 0;
  let skipped = 0;
  for (const file of fileList) {
    if (!isPackageUploadFile(file)) {
      skipped += 1;
      continue;
    }
    const kind = detectPackageFileKind(file.name);
    pendingFiles.set(kind, file);
    updateSlotName(root, kind, file.name);
    added += 1;
  }
  syncPackageUploadBtn(root, pendingFiles);
  if (toastSummary && added > 0) {
    const extra = skipped > 0 ? ` · пропущено ${skipped}` : "";
    toastSuccess(`Додано ${added} файл(ів)${extra}`);
  } else if (toastSummary && !added) {
    toastError("У папці немає підтримуваних файлів пакета");
  }
  return { added, skipped };
}

function readFileAsBase64FromFile(file) {
  return readFileAsBase64(file);
}

export function bindQuickConstructiveUpload(root, position, { onUploaded, editable = false } = {}) {
  if (!editable || !position?.id || !root) return;

  quickUploadZones.get(root)?.destroy();

  const ctl = bindFileUploadZone(root, {
    zoneSelector: "[data-quick-constructive]",
    inputSelector: "[data-quick-constructive-input]",
    accept: CONSTRUCTIVE_ACCEPT_EXT,
    maxBytes: CONSTRUCTIVE_MAX_BYTES,
    onFile: async (file) => {
      await runSave("Конструктив", {
        saveFn: async () => {
          const dataBase64 = await readFileAsBase64FromFile(file);
          return api.uploadConstructiveFile(position.id, {
            fileName: file.name,
            mime: file.type,
            dataBase64
          });
        },
        successMessage: "Файл завантажено",
        onSuccess: () => onUploaded?.()
      }).catch(() => {});
    }
  });
  quickUploadZones.set(root, ctl);
}

/** @deprecated Використовуйте bindQuickConstructiveUpload */
export const bindLegacyConstructiveUpload = bindQuickConstructiveUpload;

function renderPipeline(status) {
  const steps = CONSTRUCTIVE_PIPELINE_STEPS.map((s) => {
    const active = s.statuses.includes(status);
    return `<span class="cp-pipe-step ${active ? "is-active" : ""}">${escapeHtml(s.label)}</span>`;
  });
  return `<div class="cp-pipeline">${steps.join('<span class="cp-pipe-arrow">→</span>')}</div>`;
}

function renderFileSlots() {
  const kinds = Object.entries(PACKAGE_FILE_KIND_LABELS);
  return kinds
    .map(
      ([kind, label]) => `
    <div class="cp-file-slot" data-kind="${kind}">
      <span class="cp-file-label">${escapeHtml(label)}</span>
      <span class="cp-file-name" data-slot-name="${kind}">—</span>
    </div>`
    )
    .join("");
}

function renderPackageFilesDownloadList(positionId, packageId, files = []) {
  if (!files.length) {
    return `<p class="enver-meta">Файлів у пакеті немає.</p>`;
  }
  const rows = files
    .map((f) => {
      const href = constructivePackageFileUrl(positionId, packageId, f.id);
      const kindLabel = escapeHtml(f.kindLabel || PACKAGE_FILE_KIND_LABELS[f.kind] || f.kind);
      return `<li class="cp-file-download-row">
        <span class="cp-file-kind">${kindLabel}</span>
        <a class="cp-file-link" href="${href}" download="${escapeHtml(f.originalName || "file")}">${escapeHtml(f.originalName || "файл")}</a>
        <span class="enver-meta">${escapeHtml(formatConstructiveSize(f.sizeBytes))}</span>
      </li>`;
    })
    .join("");
  return `<ul class="cp-files-download-list" aria-label="Файли пакета">${rows}</ul>`;
}

/** Перегляд пакета в замовленні — без завантаження та дій. */
export function renderConstructivePackageReadOnly(
  position,
  detail = null,
  { legacyFiles = [] } = {}
) {
  const pkg = detail?.package;
  const status = pkg?.status || null;
  const statusLabel = pkg ? packageStatusLabel(status) : null;
  const files = detail?.files || [];
  const positionId = position?.id;
  const packageId = pkg?.id;
  const legacyList = renderConstructiveFileList(legacyFiles, positionId);
  const hasLegacy = legacyFiles.length > 0 || position?.hasConstructiveFile;

  return `
    <section class="constructive-package-block constructive-package-block--readonly">
      <h3 class="enver-section-title">Пакет конструктива</h3>
      ${
        hasLegacy
          ? `<div class="cp-legacy-files">
              <h4 class="enver-meta">Файли конструктива</h4>
              ${legacyList || `<p class="enver-meta">Завантаження списку файлів…</p>`}
            </div>`
          : ""
      }
      ${pkg ? renderPipeline(status) : ""}
      ${
        pkg
          ? `<p class="cp-status">v${pkg.version} · ${escapeHtml(statusLabel)}</p>`
          : `<p class="enver-meta">Пакет ще не завантажено. Завантаження доступне на <strong>столі конструктора</strong>.</p>`
      }
      ${pkg && packageId ? renderPackageFilesDownloadList(positionId, packageId, files) : ""}
      ${detail?.parts?.length ? `<p class="cp-parts-count">${detail.parts.length} деталей · ${detail.materials?.length || 0} матеріалів · ${detail.hardware?.length || 0} фурнітури</p>` : ""}
      ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку</p>` : ""}
      ${
        canWorkConstructorDesk() && positionId
          ? `<p class="cp-readonly-hint"><button type="button" class="btn btn-sm btn-primary" data-open-constructor-ws="${positionId}">Завантажити на столі конструктора</button></p>`
          : ""
      }
    </section>`;
}

function constructiveFormatsLabel() {
  const mb = Math.round(CONSTRUCTIVE_MAX_BYTES / (1024 * 1024));
  return `PDF, ZIP, XML, DWG, XLS, B3D · до ${mb} МБ`;
}

/** Швидке завантаження одного файлу конструктива — спільний UI. */
export function renderQuickConstructiveUpload(position, { fileListHtml = "" } = {}) {
  if (!position?.id) {
    return `<p class="field-hint">Збережіть позицію, щоб завантажити файл.</p>`;
  }
  const has = position.hasConstructiveFile;
  return renderFileUploadZone({
    zoneAttr: "data-quick-constructive",
    inputAttr: "data-quick-constructive-input",
    hasFiles: has,
    title: has ? "Додати ще файл" : "Завантажити конструктив",
    hint: "Перетягніть або натисніть",
    formats: constructiveFormatsLabel(),
    accept: CONSTRUCTIVE_ACCEPT_EXT.join(","),
    fileListHtml
  });
}

/** @deprecated Використовуйте renderQuickConstructiveUpload */
export const renderLegacyConstructiveUpload = renderQuickConstructiveUpload;

export function renderConstructivePackageBlock(
  position,
  detail = null,
  { editable = false, fileListHtml = "" } = {}
) {
  if (!editable) {
    return renderConstructivePackageReadOnly(position, detail);
  }

  const pkg = detail?.package;
  const status = pkg?.status || "uploaded";
  const statusLabel = packageStatusLabel(status);

  return `
    <section class="constructive-package-block">
      <h3 class="enver-section-title">Конструктив</h3>
      ${renderQuickConstructiveUpload(position, { fileListHtml })}
      <details class="cp-package-advanced"${pkg ? " open" : ""}>
        <summary class="cp-package-advanced-summary">Пакет ЧПК${pkg ? ` · v${pkg.version} · ${escapeHtml(statusLabel)}` : ""}</summary>
        ${pkg ? renderPipeline(status) : ""}
        <div data-cp-package-drop class="constructive-upload-zone file-upload-zone file-upload-zone--compact enver-drop-target" tabindex="0">
          <p class="constructive-upload-title">Файли пакета</p>
          <p class="constructive-upload-hint">Перетягніть сюди або <button type="button" class="btn-link" data-cp-pick-files>оберіть файли</button> · <button type="button" class="btn-link" data-cp-pick-folder>папку</button></p>
          <p class="constructive-upload-formats">XLS · Project · B3D · PDF · GLB · ЧПК</p>
        </div>
        <details class="cp-slots-details">
          <summary>Слоти файлів</summary>
          <div class="cp-file-slots">${renderFileSlots()}</div>
        </details>
        <div class="constructive-actions constructive-actions--cta cp-actions">
          <button type="button" class="btn btn-primary" data-cp-upload-btn disabled>Завантажити пакет</button>
          <button type="button" class="btn btn-sm" data-cp-parse-btn ${pkg ? "" : "disabled"}>Розібрати</button>
          <button type="button" class="btn btn-sm" data-cp-procurement-btn ${pkg?.status === "parsed" || pkg?.status === "needs_review" ? "" : "disabled"}>Закупівля</button>
          <button type="button" class="btn btn-sm" data-cp-approve-btn ${detail?.parts?.length ? "" : "disabled"}>Підтвердити</button>
          <button type="button" class="btn btn-sm" data-cp-release-cnc-btn ${["approved_by_constructor", "approved_by_production", "cnc_ready", "sent_to_cnc"].includes(status) ? "" : "disabled"}>На верстат</button>
          <a class="btn btn-sm" data-cp-labels-btn href="${position?.id ? getPartLabelsUrl(position.id) : "#"}" target="_blank" ${detail?.parts?.length ? "" : "hidden"}>Етикетки</a>
        </div>
        ${detail?.parts?.length ? `<p class="cp-parts-count">${detail.parts.length} деталей · ${detail.materials?.length || 0} матеріалів · ${detail.hardware?.length || 0} фурнітури</p>` : ""}
        ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку</p>` : ""}
      </details>
    </section>`;
}

export async function loadConstructivePackageDetail(positionId) {
  try {
    return await api.getConstructivePackageLatest(positionId);
  } catch {
    return null;
  }
}

function getPendingFiles(root) {
  if (!pendingFilesByRoot.has(root)) pendingFilesByRoot.set(root, new Map());
  return pendingFilesByRoot.get(root);
}

function updateSlotName(root, kind, name) {
  const el = root.querySelector(`[data-slot-name="${kind}"]`);
  if (el) el.textContent = name || "—";
}

export function bindConstructivePackageBlock(
  position,
  root = document.body,
  { onUpdated, editable = false } = {}
) {
  if (!editable || !position?.id || !root) return;

  bindQuickConstructiveUpload(root, position, { editable: true, onUploaded: onUpdated });

  const zone = root.querySelector("[data-cp-package-drop]");
  if (!zone) return;

  const packageAccept = [...CONSTRUCTIVE_ACCEPT_EXT, ...PACKAGE_EXTRA_EXT].join(",");

  packageDropZones.get(root)?.destroy();
  packageBindAbort.get(root)?.abort();
  const bindAbort = new AbortController();
  packageBindAbort.set(root, bindAbort);
  const { signal } = bindAbort;

  const pendingFiles = getPendingFiles(root);
  pendingFiles.clear();

  const queueFile = (file) => {
    if (!isPackageUploadFile(file)) return;
    const kind = detectPackageFileKind(file.name);
    pendingFiles.set(kind, file);
    updateSlotName(root, kind, file.name);
    syncPackageUploadBtn(root, pendingFiles);
  };

  const notify = () => {
    onUpdated?.();
    document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
  };

  const pickPackageFiles = () => {
    void pickLocalFile({ multiple: true, accept: packageAccept }).then((files) => {
      if (!Array.isArray(files) || !files.length) return;
      addPendingPackageFiles(root, pendingFiles, files, { toastSummary: true });
    });
  };

  const pickPackageFolder = () => {
    void pickLocalFile({ directory: true }).then((files) => {
      if (!Array.isArray(files) || !files.length) return;
      addPendingPackageFiles(root, pendingFiles, files, { toastSummary: true });
    });
  };

  root.addEventListener(
    "click",
    (e) => {
      if (e.target.closest("[data-cp-pick-files]")) {
        pickPackageFiles();
        return;
      }
      if (e.target.closest("[data-cp-pick-folder]")) {
        pickPackageFolder();
      }
    },
    { signal }
  );

  const dz = createFileDropZone(zone, {
    openPicker: pickPackageFiles,
    accept: [...CONSTRUCTIVE_ACCEPT_EXT, ...PACKAGE_EXTRA_EXT],
    maxBytes: CONSTRUCTIVE_MAX_BYTES,
    multiple: true,
    onFile: async (file) => {
      queueFile(file);
    }
  });
  packageDropZones.set(root, dz);

  root.querySelector("[data-cp-upload-btn]")?.addEventListener(
    "click",
    async () => {
      if (!pendingFiles.size) return;
      try {
        const files = await Promise.all(
          [...pendingFiles.entries()].map(async ([kind, file]) => ({
            fileName: file.name,
            mime: file.type,
            kind,
            dataBase64: await readFileAsBase64(file)
          }))
        );
        await api.uploadConstructivePackage(position.id, files);
        pendingFiles.clear();
        toastSuccess("Пакет завантажено");
        notify();
      } catch (err) {
        toastError(err.message);
      }
    },
    { signal }
  );

  root.querySelector("[data-cp-parse-btn]")?.addEventListener(
    "click",
    async () => {
      try {
        const latest = await api.getConstructivePackageLatest(position.id);
        const packageId = latest?.package?.id;
        if (!packageId) return;
        await api.parseConstructivePackage(position.id, packageId);
        toastSuccess("Пакет розібрано");
        notify();
      } catch (err) {
        toastError(err.message);
      }
    },
    { signal }
  );

  root.querySelector("[data-cp-procurement-btn]")?.addEventListener(
    "click",
    async () => {
      try {
        const latest = await api.getConstructivePackageLatest(position.id);
        await api.createProcurementFromPackage(position.id, latest.package.id);
        toastSuccess("Закупівлю створено");
        notify();
      } catch (err) {
        toastError(err.message);
      }
    },
    { signal }
  );

  root.querySelector("[data-cp-approve-btn]")?.addEventListener(
    "click",
    async () => {
      try {
        const latest = await api.getConstructivePackageLatest(position.id);
        await api.approveConstructivePackage(position.id, latest.package.id);
        toastSuccess("Пакет підтверджено");
        notify();
      } catch (err) {
        toastError(err.message);
      }
    },
    { signal }
  );

  root.querySelector("[data-cp-release-cnc-btn]")?.addEventListener(
    "click",
    async () => {
      try {
        const latest = await api.getConstructivePackageLatest(position.id);
        const packageId = latest?.package?.id;
        if (!packageId) return;
        await api.releaseConstructivePackageToCnc(position.id, packageId);
        toastSuccess("Передано на верстат");
        notify();
      } catch (err) {
        toastError(err.message);
      }
    },
    { signal }
  );
}
