import { api, constructivePackageFileUrl, getPartLabelsUrl } from "./api.js";
import { createFileDropZone } from "./interactions/drag-drop.js";
import { pickLocalFile } from "./file-picker.js";
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
import { toastError, toastSuccess } from "./toast.js";
import { runSave } from "./save-flow.js";

const packageDropZones = new WeakMap();
const legacyDropZones = new WeakMap();
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

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const raw = String(reader.result || "");
      resolve(raw.includes(",") ? raw.split(",")[1] : raw);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

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
export function renderConstructivePackageReadOnly(position, detail = null) {
  const pkg = detail?.package;
  const status = pkg?.status || null;
  const statusLabel = pkg ? packageStatusLabel(status) : null;
  const files = detail?.files || [];
  const positionId = position?.id;
  const packageId = pkg?.id;

  return `
    <section class="constructive-package-block constructive-package-block--readonly">
      <h3 class="enver-section-title">Пакет конструктива</h3>
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

export function renderConstructivePackageBlock(position, detail = null, { editable = false } = {}) {
  if (!editable) {
    return renderConstructivePackageReadOnly(position, detail);
  }

  const pkg = detail?.package;
  const status = pkg?.status || "uploaded";
  const statusLabel = packageStatusLabel(status);

  return `
    <section class="constructive-package-block">
      <h3 class="enver-section-title">Пакет конструктива</h3>
      ${pkg ? renderPipeline(status) : ""}
      <p class="cp-status">${pkg ? `v${pkg.version} · ${escapeHtml(statusLabel)}` : "Файли не завантажені"}</p>
      <div data-cp-package-drop class="constructive-upload-zone enver-drop-target" tabindex="0">
        <p class="constructive-upload-title">Перетягніть файли або папку</p>
        <p class="constructive-upload-hint">XLS · Project · B3D · PDF · GLB · ЧПК</p>
      </div>
      <div class="cp-pick-actions">
        <button type="button" class="btn btn-sm" data-cp-pick-files>Обрати файли</button>
        <button type="button" class="btn btn-sm" data-cp-pick-folder>Обрати папку</button>
      </div>
      <div class="cp-file-slots">${renderFileSlots()}</div>
      <div class="constructive-actions constructive-actions--cta cp-actions">
        <button type="button" class="btn btn-primary" data-cp-upload-btn disabled>Завантажити пакет</button>
        <button type="button" class="btn" data-cp-parse-btn ${pkg ? "" : "disabled"}>Розібрати</button>
        <button type="button" class="btn" data-cp-procurement-btn ${pkg?.status === "parsed" || pkg?.status === "needs_review" ? "" : "disabled"}>Створити закупівлю</button>
        <button type="button" class="btn" data-cp-approve-btn ${detail?.parts?.length ? "" : "disabled"}>Підтвердити</button>
        <button type="button" class="btn" data-cp-release-cnc-btn ${["approved_by_constructor", "approved_by_production", "cnc_ready", "sent_to_cnc"].includes(status) ? "" : "disabled"}>На верстат</button>
        <a class="btn" data-cp-labels-btn href="${position?.id ? getPartLabelsUrl(position.id) : "#"}" target="_blank" ${detail?.parts?.length ? "" : "hidden"}>Друк етикеток</a>
      </div>
      ${detail?.parts?.length ? `<p class="cp-parts-count">${detail.parts.length} деталей · ${detail.materials?.length || 0} матеріалів · ${detail.hardware?.length || 0} фурнітури</p>` : ""}
      ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку</p>` : ""}
    </section>`;
}

export function renderLegacyConstructiveUpload(position, { editable = false } = {}) {
  if (!editable) return "";
  const has = position?.hasConstructiveFile;
  return `
    <section class="legacy-constructive-upload">
      <h4 class="enver-section-title">Файл конструктива (швидкий)</h4>
      <p class="enver-meta">${has ? "Файл уже є — можна додати ще." : "PDF, ZIP, XML, DWG, XLS, B3D — для запуску етапу виробництва."}</p>
      <div class="constructive-upload-wrap">
        <div data-legacy-constructive-drop class="constructive-upload-zone enver-drop-target" tabindex="0">
          <input type="file" class="enver-file-input-offscreen" data-legacy-constructive-input accept="${CONSTRUCTIVE_ACCEPT_EXT.join(",")}" tabindex="-1" aria-hidden="true" />
          <div class="constructive-upload-inner">
            <span class="constructive-upload-icon" aria-hidden="true">${has ? "✓" : "📎"}</span>
            <p class="constructive-upload-title">${has ? "Додати файл" : "Перетягніть конструктив"}</p>
            <p class="constructive-upload-hint">або натисніть для вибору</p>
            <p class="constructive-upload-status" aria-live="polite"></p>
          </div>
        </div>
      </div>
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

export function bindLegacyConstructiveUpload(
  root,
  position,
  { onUploaded, editable = false } = {}
) {
  if (!editable || !position?.id || !root) return;

  legacyDropZones.get(root)?.destroy();
  const zone = root.querySelector("[data-legacy-constructive-drop]");
  const input = root.querySelector("[data-legacy-constructive-input]");
  if (!zone) return;

  const dz = createFileDropZone(zone, {
    inputEl: input,
    accept: CONSTRUCTIVE_ACCEPT_EXT,
    maxBytes: CONSTRUCTIVE_MAX_BYTES,
    onFile: async (file) => {
      await runSave("Конструктив", {
        saveFn: async () => {
          const dataBase64 = await readFileAsBase64(file);
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
  legacyDropZones.set(root, dz);
}
