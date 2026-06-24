import { api, getPartLabelsUrl } from "./api.js";
import { createFileDropZone } from "./interactions/drag-drop.js";
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
import { escapeHtml } from "./utils.js";
import { toastError, toastSuccess } from "./toast.js";
import { $ } from "./utils.js";

let packageDropZone = null;
let pendingFiles = new Map();

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

  return `
    <section class="constructive-package-block" id="constructivePackageBlock">
      <h3 class="drawer-section-title">Пакет конструктива</h3>
      ${pkg ? renderPipeline(status) : ""}
      <p class="cp-status">${pkg ? `v${pkg.version} · ${escapeHtml(statusLabel)}` : "Файли не завантажені"}</p>
      <div id="constructivePackageDrop" class="constructive-upload-zone enver-drop-target" tabindex="0">
        <input type="file" id="constructivePackageInput" multiple accept="${CONSTRUCTIVE_ACCEPT_EXT.join(",")},.glb,.gltf" hidden />
        <p class="constructive-upload-title">Перетягніть файли пакета</p>
        <p class="constructive-upload-hint">XLS · Project · B3D · PDF · GLB · ЧПК</p>
      </div>
      <div class="cp-file-slots">${renderFileSlots()}</div>
      <div class="constructive-actions constructive-actions--cta cp-actions">
        <button type="button" class="btn btn-primary" id="uploadPackageBtn" disabled>Завантажити пакет</button>
        <button type="button" class="btn" id="parsePackageBtn" ${pkg ? "" : "disabled"}>Розібрати</button>
        <button type="button" class="btn" id="procurementPackageBtn" ${pkg?.status === "parsed" || pkg?.status === "needs_review" ? "" : "disabled"}>Створити закупівлю</button>
        <button type="button" class="btn" id="approvePackageBtn" ${detail?.parts?.length ? "" : "disabled"}>Підтвердити</button>
        <button type="button" class="btn" id="gitlabPackageBtn" ${["approved_by_constructor", "approved_by_production", "cnc_ready"].includes(status) ? "" : "disabled"}>GitLab / ЧПК</button>
        <a class="btn" id="labelsPackageBtn" href="${position?.id ? getPartLabelsUrl(position.id) : "#"}" target="_blank" ${detail?.parts?.length ? "" : "hidden"}>Друк етикеток</a>
      </div>
      ${detail?.parts?.length ? `<p class="cp-parts-count">${detail.parts.length} деталей · ${detail.materials?.length || 0} матеріалів · ${detail.hardware?.length || 0} фурнітури</p>` : ""}
      ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку</p>` : ""}
    </section>`;
}

export async function loadConstructivePackageDetail(positionId) {
  try {
    return await api.getConstructivePackageLatest(positionId);
  } catch {
    return null;
  }
}

function updateSlotName(kind, name) {
  const el = document.querySelector(`[data-slot-name="${kind}"]`);
  if (el) el.textContent = name || "—";
}

export function bindConstructivePackageBlock(position) {
  packageDropZone?.destroy();
  pendingFiles.clear();

  const zone = $("#constructivePackageDrop");
  const input = $("#constructivePackageInput");
  if (!zone || !position?.id) return;

  packageDropZone = createFileDropZone(zone, {
    inputEl: input,
    accept: [...CONSTRUCTIVE_ACCEPT_EXT, ".glb", ".gltf"],
    maxBytes: CONSTRUCTIVE_MAX_BYTES,
    onFile: async (file) => {
      const kind = detectPackageFileKind(file.name);
      pendingFiles.set(kind, file);
      updateSlotName(kind, file.name);
      $("#uploadPackageBtn").disabled = pendingFiles.size === 0;
    }
  });

  $("#uploadPackageBtn")?.addEventListener("click", async () => {
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
      document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
    } catch (err) {
      toastError(err.message);
    }
  });

  $("#parsePackageBtn")?.addEventListener("click", async () => {
    try {
      const latest = await api.getConstructivePackageLatest(position.id);
      const packageId = latest?.package?.id;
      if (!packageId) return;
      await api.parseConstructivePackage(position.id, packageId);
      toastSuccess("Пакет розібрано");
      document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
    } catch (err) {
      toastError(err.message);
    }
  });

  $("#procurementPackageBtn")?.addEventListener("click", async () => {
    try {
      const latest = await api.getConstructivePackageLatest(position.id);
      await api.createProcurementFromPackage(position.id, latest.package.id);
      toastSuccess("Закупівлю створено");
      document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
    } catch (err) {
      toastError(err.message);
    }
  });

  $("#approvePackageBtn")?.addEventListener("click", async () => {
    try {
      const latest = await api.getConstructivePackageLatest(position.id);
      await api.approveConstructivePackage(position.id, latest.package.id);
      toastSuccess("Пакет підтверджено");
      document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
    } catch (err) {
      toastError(err.message);
    }
  });

  $("#gitlabPackageBtn")?.addEventListener("click", async () => {
    try {
      await api.sendToGitlab(position.id);
      toastSuccess("Відправлено в GitLab");
      document.dispatchEvent(new CustomEvent("enver:constructive-package-updated"));
    } catch (err) {
      toastError(err.message);
    }
  });
}
