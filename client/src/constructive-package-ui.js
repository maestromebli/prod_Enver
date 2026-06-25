import { api, getPartLabelsUrl } from "./api.js";
import { createFileDropZone } from "./interactions/drag-drop.js";
import {
  CONSTRUCTIVE_ACCEPT_EXT,
  CONSTRUCTIVE_MAX_BYTES
} from "@enver/shared/production/constructive-files.js";
import {
  CONSTRUCTIVE_PIPELINE_STEPS,
  PACKAGE_FILE_KIND_LABELS,
  packageStatusLabel,
  detectPackageFileKind
} from "@enver/shared/production/constructive-package.js";
import { canEditPositions } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { runSave } from "./save-flow.js";

const packageDropZones = new WeakMap();
const legacyDropZones = new WeakMap();
const pendingFilesByRoot = new WeakMap();

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

export function renderConstructivePackageBlock(position, detail = null) {
  const pkg = detail?.package;
  const status = pkg?.status || "uploaded";
  const statusLabel = packageStatusLabel(status);
  const canEdit = canEditPositions();

  return `
    <section class="constructive-package-block">
      <h3 class="enver-section-title">Пакет конструктива</h3>
      ${pkg ? renderPipeline(status) : ""}
      <p class="cp-status">${pkg ? `v${pkg.version} · ${escapeHtml(statusLabel)}` : "Файли не завантажені"}</p>
      ${
        canEdit
          ? `<div data-cp-package-drop class="constructive-upload-zone enver-drop-target" tabindex="0">
        <input type="file" data-cp-package-input multiple accept="${CONSTRUCTIVE_ACCEPT_EXT.join(",")},.glb,.gltf" hidden />
        <p class="constructive-upload-title">Перетягніть файли пакета</p>
        <p class="constructive-upload-hint">XLS · Project · B3D · PDF · GLB · ЧПК</p>
      </div>
      <div class="cp-file-slots">${renderFileSlots()}</div>
      <div class="constructive-actions constructive-actions--cta cp-actions">
        <button type="button" class="btn btn-primary" data-cp-upload-btn disabled>Завантажити пакет</button>
        <button type="button" class="btn" data-cp-parse-btn ${pkg ? "" : "disabled"}>Розібрати</button>
        <button type="button" class="btn" data-cp-procurement-btn ${pkg?.status === "parsed" || pkg?.status === "needs_review" ? "" : "disabled"}>Створити закупівлю</button>
        <button type="button" class="btn" data-cp-approve-btn ${detail?.parts?.length ? "" : "disabled"}>Підтвердити</button>
        <button type="button" class="btn" data-cp-gitlab-btn ${["approved_by_constructor", "approved_by_production", "cnc_ready"].includes(status) ? "" : "disabled"}>GitLab / ЧПК</button>
        <a class="btn" data-cp-labels-btn href="${position?.id ? getPartLabelsUrl(position.id) : "#"}" target="_blank" ${detail?.parts?.length ? "" : "hidden"}>Друк етикеток</a>
      </div>`
          : `<p class="enver-meta">Немає прав на завантаження пакета.</p>`
      }
      ${detail?.parts?.length ? `<p class="cp-parts-count">${detail.parts.length} деталей · ${detail.materials?.length || 0} матеріалів · ${detail.hardware?.length || 0} фурнітури</p>` : ""}
      ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку</p>` : ""}
    </section>`;
}

export function renderLegacyConstructiveUpload(position) {
  if (!canEditPositions()) return "";
  const has = position?.hasConstructiveFile;
  return `
    <section class="legacy-constructive-upload">
      <h4 class="enver-section-title">Файл конструктива (швидкий)</h4>
      <p class="enver-meta">${has ? "Файл уже є — можна додати ще." : "PDF, ZIP, XML, DWG, XLS, B3D — для запуску етапу виробництва."}</p>
      <div class="constructive-upload-wrap">
        <div data-legacy-constructive-drop class="constructive-upload-zone enver-drop-target" tabindex="0">
          <input type="file" data-legacy-constructive-input accept="${CONSTRUCTIVE_ACCEPT_EXT.join(",")}" hidden />
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

export function bindConstructivePackageBlock(position, root = document.body, { onUpdated } = {}) {
  if (!position?.id || !root) return;

  packageDropZones.get(root)?.destroy();
  const pendingFiles = getPendingFiles(root);
  pendingFiles.clear();

  const zone = root.querySelector("[data-cp-package-drop]");
  const input = root.querySelector("[data-cp-package-input]");
  if (!zone) return;

  const notify = () => {
    onUpdated?.();
    document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
  };

  const dz = createFileDropZone(zone, {
    inputEl: input,
    accept: [...CONSTRUCTIVE_ACCEPT_EXT, ".glb", ".gltf"],
    maxBytes: CONSTRUCTIVE_MAX_BYTES,
    onFile: async (file) => {
      const kind = detectPackageFileKind(file.name);
      pendingFiles.set(kind, file);
      updateSlotName(root, kind, file.name);
      const btn = root.querySelector("[data-cp-upload-btn]");
      if (btn) btn.disabled = pendingFiles.size === 0;
    }
  });
  packageDropZones.set(root, dz);

  root.querySelector("[data-cp-upload-btn]")?.addEventListener("click", async () => {
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
  });

  root.querySelector("[data-cp-parse-btn]")?.addEventListener("click", async () => {
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
  });

  root.querySelector("[data-cp-procurement-btn]")?.addEventListener("click", async () => {
    try {
      const latest = await api.getConstructivePackageLatest(position.id);
      await api.createProcurementFromPackage(position.id, latest.package.id);
      toastSuccess("Закупівлю створено");
      notify();
    } catch (err) {
      toastError(err.message);
    }
  });

  root.querySelector("[data-cp-approve-btn]")?.addEventListener("click", async () => {
    try {
      const latest = await api.getConstructivePackageLatest(position.id);
      await api.approveConstructivePackage(position.id, latest.package.id);
      toastSuccess("Пакет підтверджено");
      notify();
    } catch (err) {
      toastError(err.message);
    }
  });

  root.querySelector("[data-cp-gitlab-btn]")?.addEventListener("click", async () => {
    try {
      await api.sendToGitlab(position.id);
      toastSuccess("Відправлено в GitLab");
      notify();
    } catch (err) {
      toastError(err.message);
    }
  });
}

export function bindLegacyConstructiveUpload(root, position, { onUploaded } = {}) {
  if (!canEditPositions() || !position?.id || !root) return;

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
