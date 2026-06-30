import { state } from "./state.js";
import { api, constructivePackageFileUrl } from "./api.js";
import { createFileDropZone } from "./interactions/drag-drop.js";
import { pickLocalFile } from "./file-picker.js";
import { readFileAsBase64, renderFileUploadZone } from "./file-upload-zone.js";
import {
  CONSTRUCTIVE_ACCEPT_EXT,
  CONSTRUCTIVE_MAX_BYTES,
  formatConstructiveSize
} from "@enver/shared/production/constructive-files.js";
import {
  formatCncFileMaterialLabel,
  inferCncFileMaterialMeta,
  isMultiInstancePackageFileKind
} from "@enver/shared/production/cnc-file-meta.js";
import {
  PACKAGE_FILE_KIND_LABELS,
  PACKAGE_HANDOFF_TO_CUTTING_STATUSES,
  packageStatusLabel,
  packageParseDisplay,
  detectPackageFileKind,
  partitionModelMappingSources,
  canCreateProcurement,
  hasModelMappingResult,
  hasModelMappingSources,
  has3dPreviewFile,
  shouldShowModelMappingTab
} from "@enver/shared/production/constructive-package.js";
import { canWorkConstructorDesk } from "./auth.js";
import { escapeHtml } from "./utils.js";
import { renderConstructiveFileList } from "./position-drawer-render.js";
import { toastError, toastSuccess } from "./toast.js";
import { renderPackage3dStatusBlock, renderGiblabEnver3HookHelp } from "./preview-3d-ui.js";
import {
  preview3dLayout,
  preview3dLayoutLabel
} from "@enver/shared/production/constructive-package.js";
import { get3dUpgradeHintText } from "@enver/shared/production/resolve-3d-preview.js";
import {
  evaluatePackageReadiness,
  packageReadinessScore
} from "@enver/shared/production/package-readiness.js";
import {
  formatAssemblyMissingMessage,
  formatEnver3SyncMessage
} from "@enver/shared/production/preview-3d-meta.js";
import {
  renderConstructivePipeline,
  renderPackageParseBanner,
  runPackageParseWithProgress,
  applyPackageParseUi,
  refreshStalePackageParseUi
} from "./constructive-package-parse-ui.js";
import { mountPackageAiBlock, pollPackageAiAnalysis } from "./package-ai-ui.js";
import {
  renderPackageWizardStepper,
  resolvePackageWizardStep,
  wrapWizardPanel,
  applyPackageWizardUi,
  bindPackageWizard
} from "./constructive-package-wizard.js";
import { renderWizardHandoffExtras } from "./constructive-pipeline-panel.js";

const packageDropZones = new WeakMap();
const packageBindAbort = new WeakMap();
const packageUploadQueues = new WeakMap();

const PACKAGE_EXTRA_EXT = [".glb", ".gltf", ".wrl"];
const PACKAGE_CNC_EXT = [".nc", ".giblab", ".kdt", ".gcode", ".tap", ".cnc"];
const PACKAGE_ALL_ACCEPT = [...CONSTRUCTIVE_ACCEPT_EXT, ...PACKAGE_EXTRA_EXT, ...PACKAGE_CNC_EXT];

async function fileToPackagePayload(file) {
  const kind = detectPackageFileKind(file.name);
  const payload = {
    fileName: file.name,
    mime: file.type || "application/octet-stream",
    kind,
    dataBase64: await readFileAsBase64(file)
  };
  if (isMultiInstancePackageFileKind(kind)) {
    const meta = inferCncFileMaterialMeta(file.name);
    payload.materialType = meta.materialType || "";
    payload.materialDecor = meta.materialDecor || "";
  }
  return payload;
}

async function flushPackageUploadQueue(position, root, notify) {
  const state = packageUploadQueues.get(root);
  if (!state || state.busy || !state.pending.length) return;

  state.busy = true;
  const files = state.pending.splice(0, state.pending.length);
  const zone = root.querySelector("[data-cp-package-drop]");
  zone?.classList.add("is-uploading");
  zone?.setAttribute("aria-busy", "true");

  try {
    const payload = await Promise.all(files.map(fileToPackagePayload));
    const result = await api.uploadConstructivePackage(position.id, payload);
    const ctx = getPackagePanelContext(position.id);
    handlePackageUploadResult(root, result, {
      onDetailPatched: ctx?.onDetailPatched,
      hideProcurement: ctx?.hideProcurement === true
    });
    if (ctx) {
      ctx.detail = result;
      if (ctx.onUpdated) {
        await ctx.onUpdated({ packageDomOnly: true });
      } else {
        applyPackageDetailToDom(root, position, result, ctx.constructiveFiles || []);
      }
    } else {
      notify();
    }
  } catch (err) {
    toastError(err.message);
  } finally {
    state.busy = false;
    zone?.classList.remove("is-uploading");
    zone?.removeAttribute("aria-busy");
    if (state.pending.length) {
      void flushPackageUploadQueue(position, root, notify);
    }
  }
}

function enqueuePackageUpload(root, position, fileList, notify) {
  const accepted = fileList.filter(isPackageUploadFile);
  const skipped = fileList.length - accepted.length;
  if (!accepted.length) {
    if (fileList.length) toastError("Немає підтримуваних файлів пакета");
    return { added: 0, skipped };
  }

  if (!packageUploadQueues.has(root)) {
    packageUploadQueues.set(root, { pending: [], busy: false });
  }
  const state = packageUploadQueues.get(root);
  state.pending.push(...accepted);
  void flushPackageUploadQueue(position, root, notify);

  return { added: accepted.length, skipped };
}

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

function appendPreview3dUploadNotes(parts, result) {
  const enver3 = formatEnver3SyncMessage(result?.preview3d?.enver3Sync);
  if (enver3) parts.push(enver3);
  const partial = formatAssemblyMissingMessage({
    missingCodes: result?.preview3d?.missingCodes,
    totalPanels: result?.parts?.length,
    assembledCount: result?.preview3d?.assembledCount
  });
  if (partial) parts.push(partial);
}

function handlePackageUploadResult(
  root,
  result,
  { onDetailPatched, hideProcurement = false } = {}
) {
  onDetailPatched?.(result);

  if (result?.autoParseError) {
    toastError(`Файли збережено, але автоматичний розбір не вдався: ${result.autoParseError}`);
    return;
  }

  const mappingReady = hasModelMappingResult(result) || shouldShowModelMappingTab(result);

  if (result?.autoParsed) {
    const parts = ["Файли збережено"];
    if (has3dPreviewFile(result)) {
      const layout = result.preview3d?.layout || preview3dLayout(result);
      parts.push(
        result.preview3d?.isPartialAssembly
          ? "3D-збірка (частково)"
          : layout === "assembly"
            ? "3D-збірка готова"
            : `3D: ${preview3dLayoutLabel(layout)}`
      );
      appendPreview3dUploadNotes(parts, result);
      const hint = get3dUpgradeHintText({ layout, packageDetail: result });
      toastSuccess(hint ? `${parts.join(" — ")}. ${hint}` : `${parts.join(" — ")}.`);
      return;
    }
    if (mappingReady) parts.push("мапінг 3D створено");
    if (!hideProcurement && (result?.autoProcurement || result?.procurement?.id)) {
      parts.push("закупівлю з Excel");
    }
    toastSuccess(`${parts.join(" — ")}.`);
    return;
  }

  if (!mappingReady && !hasModelMappingSources(result)) {
    const files = result?.files || [];
    const missing = [];
    if (!files.some((f) => f.kind === "project")) missing.push(".project");
    if (!files.some((f) => f.kind === "b3d")) missing.push(".b3d");
    if (missing.length) {
      toastSuccess(
        `Файли збережено. Додайте ${missing.join(" та ")} у той самий пакет — розбір і мапінг 3D запустяться автоматично`
      );
      return;
    }
  }

  const msg = packageUploadSuccessMessage(result);
  const notes = [];
  appendPreview3dUploadNotes(notes, result);
  toastSuccess(notes.length ? `${msg} · ${notes.join(" · ")}` : msg);
}

function packageUploadSuccessMessage(result) {
  if (has3dPreviewFile(result)) {
    const layout = preview3dLayout(result);
    return layout === "assembly"
      ? "Файли збережено — 3D-збірка готова"
      : "Файли збережено — розкладка деталей (для збірки — ENVER3 або .wrl)";
  }
  return "Файли завантажено";
}

function renderUploadedConstructiveFiles(
  positionId,
  detail,
  legacyFiles = [],
  { editable = false } = {}
) {
  const pkg = detail?.package;
  const packageFiles = detail?.files || [];
  const hasLegacy = legacyFiles.length > 0;
  const hasPackage = Boolean(pkg);

  if (!hasLegacy && !hasPackage) {
    return `<div class="cp-uploaded-files cp-uploaded-files--empty" data-cp-uploaded-files><p class="field-hint">Завантажених файлів ще немає.</p></div>`;
  }

  const blocks = [];
  if (hasPackage) {
    blocks.push(`
      <div class="cp-uploaded-group">
        ${pkg?.version ? `<p class="enver-meta">Пакет v${pkg.version} · ${escapeHtml(packageStatusLabel(pkg.status))}</p>` : ""}
        ${packageFiles.length ? renderPackageFilesList(positionId, pkg.id, packageFiles, { editable }) : `<p class="enver-meta" data-package-id="${pkg.id}">Файлів у пакеті немає — додайте нові.</p>`}
      </div>`);
  }
  if (hasLegacy) {
    blocks.push(`
      <div class="cp-uploaded-group cp-uploaded-group--legacy">
        <h4 class="cp-uploaded-title enver-meta">Раніше завантажені</h4>
        ${renderConstructiveFileList(legacyFiles, positionId, { editable })}
      </div>`);
  }

  return `<div class="cp-uploaded-files" data-cp-uploaded-files>${blocks.join("")}</div>`;
}

/** Оновлює лише блок завантажених файлів (без повного re-render панелі). */
export function patchConstructiveUploadedFiles(root, position, detail, constructiveFiles = []) {
  if (!root) return;
  const mount = root.querySelector("[data-cp-uploaded-files]");
  const html = renderUploadedConstructiveFiles(position?.id, detail, constructiveFiles, {
    editable: true
  });
  if (mount) {
    mount.outerHTML = html;
  } else {
    const filesPanel = root.querySelector("[data-cp-package-files]");
    const uploadWrap = filesPanel?.querySelector(".file-upload-wrap");
    if (filesPanel && uploadWrap) {
      uploadWrap.insertAdjacentHTML("beforebegin", html);
    }
  }
}

function renderPipeline(status) {
  return renderConstructivePipeline(status);
}

function renderPackageFilesList(positionId, packageId, files = [], { editable = false } = {}) {
  if (!files.length) {
    return `<p class="enver-meta">Файлів у пакеті немає.</p>`;
  }
  const items = files
    .map((f) => {
      const href = constructivePackageFileUrl(positionId, packageId, f.id);
      const kindLabel = escapeHtml(f.kindLabel || PACKAGE_FILE_KIND_LABELS[f.kind] || f.kind);
      const materialLabel = formatCncFileMaterialLabel(f);
      const materialBadge = materialLabel
        ? `<span class="cp-cnc-material-badge">${escapeHtml(materialLabel)}</span>`
        : "";
      return `
    <li class="constructive-file-item">
      <a class="constructive-file-link" href="${href}" download="${escapeHtml(f.originalName || "file")}">
        <span class="constructive-file-name">
          <span class="cp-file-kind-badge">${kindLabel}</span>
          ${materialBadge}
          <span class="cp-file-link-text">${escapeHtml(f.originalName || "файл")}</span>
        </span>
        <span class="constructive-file-size enver-meta">${escapeHtml(formatConstructiveSize(f.sizeBytes))}</span>
      </a>
      ${
        editable
          ? `<button type="button" class="btn btn-sm btn-danger constructive-file-delete" data-cp-delete-file="${f.id}" data-package-id="${packageId}" title="Видалити" aria-label="Видалити файл">×</button>`
          : ""
      }
    </li>`;
    })
    .join("");
  return `<ul class="constructive-files-list" data-package-id="${packageId}" aria-label="Файли пакета">${items}</ul>`;
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
  const { project, b3d, specification, cncMachine } = partitionModelMappingSources(files);
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
      ${pkg ? renderPackageParseBanner(detail) : ""}
      ${pkg ? renderPipeline(status) : ""}
      ${
        pkg
          ? `<p class="cp-status">v${pkg.version} · ${escapeHtml(statusLabel)}</p>`
          : `<p class="enver-meta">Пакет ще не завантажено.</p>
             <button type="button" class="btn btn-sm btn-primary" data-open-constructor-ws="${positionId || ""}">Завантажити на столі конструктора</button>`
      }
      ${pkg && packageId && b3d.length ? `<div class="cp-legacy-files"><h4 class="enver-meta">3D-модель (.b3d)</h4>${renderPackageFilesList(positionId, packageId, b3d)}</div>` : ""}
      ${pkg && packageId && project.length ? `<div class="cp-legacy-files"><h4 class="enver-meta">Проект конструктора (.project)</h4>${renderPackageFilesList(positionId, packageId, project)}</div>` : ""}
      ${pkg && packageId && specification.length ? `<div class="cp-legacy-files"><h4 class="enver-meta">Специфікація</h4>${renderPackageFilesList(positionId, packageId, specification)}</div>` : ""}
      ${pkg && packageId && cncMachine.length ? `<div class="cp-legacy-files"><h4 class="enver-meta">Файли на верстат</h4>${renderPackageFilesList(positionId, packageId, cncMachine)}</div>` : ""}
      ${detail?.parts?.length ? `<p class="cp-parts-count">${detail.parts.length} деталей · ${detail.materials?.length || 0} матеріалів · ${detail.hardware?.length || 0} фурнітури</p>` : ""}
      ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку</p>` : ""}
      ${
        canWorkConstructorDesk() && positionId
          ? `<p class="cp-readonly-hint"><button type="button" class="btn btn-sm btn-primary" data-open-constructor-ws="${positionId}">Завантажити на столі конструктора</button></p>`
          : ""
      }
    </section>`;
}

function renderPackageReadinessChecklist(detail) {
  const readiness = evaluatePackageReadiness(detail);
  const score = packageReadinessScore(readiness);
  const items = readiness.checks
    .map(
      (c) => `
    <li class="cp-readiness-item ${c.ok ? "is-ok" : c.required ? "is-fail" : "is-warn"}">
      <span aria-hidden="true">${c.ok ? "✓" : "○"}</span>
      ${escapeHtml(c.label)}
      ${c.hint ? `<span class="enver-meta"> — ${escapeHtml(c.hint)}</span>` : ""}
    </li>`
    )
    .join("");
  return `
    <div class="cp-readiness" data-ready="${readiness.readyForAutoHandoff ? "1" : "0"}">
      <p class="cp-readiness-score">Готовність до автопередачі: <strong>${score}%</strong></p>
      <ul class="cp-readiness-list">${items}</ul>
      ${
        !readiness.readyForAutoHandoff && readiness.blockReason
          ? `<p class="cp-warning">Блокер: ${escapeHtml(readiness.blockReason)}</p>`
          : ""
      }
    </div>`;
}

function packageUploadFormatsLabel() {
  const mb = Math.round(CONSTRUCTIVE_MAX_BYTES / (1024 * 1024));
  return `.project · .b3d · XLS · PDF · ЧПК · GLB — до ${mb} МБ`;
}

function renderUnifiedPackageUpload(detail, { hideProcurement = false } = {}) {
  const hasFiles = Boolean(detail?.files?.length);
  const autoHint = hideProcurement
    ? "3D-збірка — після скрипта <strong>enver-b3d-assembly-export.js</strong> у Базісі на .b3d (ENVER3). Без скрипта — лише розкладка деталей."
    : "3D-збірка: .project + .b3d з ENVER3 (скрипт Базіс). Закупівля — після Excel.";
  return `
    <div class="cp-unified-upload file-upload-wrap">
      ${renderFileUploadZone({
        zoneAttr: "data-cp-package-drop",
        inputAttr: "data-cp-package-input",
        hasFiles,
        title: hasFiles ? "Додати файли" : "Завантажити файли пакета",
        hintHtml:
          'Перетягніть або <button type="button" class="btn-link" data-cp-pick-files>оберіть файли</button> · <button type="button" class="btn-link" data-cp-pick-folder>папку</button>',
        formats: packageUploadFormatsLabel(),
        accept: PACKAGE_ALL_ACCEPT.join(",")
      })}
      <p class="enver-meta cp-auto-hint">${autoHint}</p>
      ${renderGiblabEnver3HookHelp()}
    </div>`;
}

export function renderConstructivePackageBlock(
  position,
  detail = null,
  { editable = false, constructiveFiles = [], hideProcurement = false, downstream = null } = {}
) {
  if (!editable) {
    return renderConstructivePackageReadOnly(position, detail, { legacyFiles: constructiveFiles });
  }

  const pkg = detail?.package;
  const status = pkg?.status || "uploaded";
  const parseDisplay = packageParseDisplay(status, detail?.parts?.length || 0);
  const partsSuffix = detail?.parts?.length ? ` · ${detail.parts.length} деталей` : "";
  const showManualParseBtn =
    pkg && pkg.status !== "parsing" && (detail?.files?.length > 0 || pkg.status !== "uploaded");
  const parseBtnLabel = pkg?.status === "uploaded" ? "Розібрати" : "Розібрати знову";
  const canStartProcurement = !hideProcurement && canCreateProcurement(detail);

  const currentStep = resolvePackageWizardStep(detail);
  const stepCtx = { current: currentStep, selected: currentStep };

  const uploadPanel = wrapWizardPanel(
    0,
    "upload",
    `
      ${renderUploadedConstructiveFiles(position?.id, detail, constructiveFiles, { editable: true })}
      ${renderUnifiedPackageUpload(detail, { hideProcurement })}
    `,
    stepCtx
  );

  const parsePanel = wrapWizardPanel(
    1,
    "parse",
    `
      ${pkg ? renderPackageParseBanner(detail) : ""}
      ${pkg ? renderPackage3dStatusBlock(detail) : ""}
      ${pkg ? `<p class="cp-status enver-meta cp-status--${parseDisplay.parsed ? "parsed" : parseDisplay.parsing ? "parsing" : "pending"}">${escapeHtml(parseDisplay.title)}${partsSuffix}</p>` : ""}
      <div class="constructive-actions constructive-actions--cta cp-actions">
        ${showManualParseBtn ? `<button type="button" class="btn btn-sm btn-primary" data-cp-parse-btn">${parseBtnLabel}</button>` : ""}
      </div>
    `,
    stepCtx
  );

  const verifyPanel = wrapWizardPanel(
    2,
    "verify",
    `
      ${pkg ? `<p class="cp-status enver-meta cp-status--${parseDisplay.parsed ? "parsed" : parseDisplay.parsing ? "parsing" : "pending"}">${escapeHtml(parseDisplay.title)}${partsSuffix}</p>` : ""}
      ${detail ? renderPackageReadinessChecklist(detail) : ""}
      ${renderPackage3dStatusBlock(detail)}
      <div class="constructive-actions constructive-actions--cta cp-actions">
        <button type="button" class="btn btn-sm" data-cp-approve-btn ${detail?.parts?.length && ["parsed", "needs_review"].includes(status) ? "" : "disabled"}>Підтвердити пакет</button>
        <button type="button" class="btn btn-sm" id="openConstructiveReviewBtn">Перевірка конструктива</button>
        <button type="button" class="btn btn-sm" id="openB3dPreviewBtn">Перегляд 3D</button>
      </div>
      ${detail?.unmappedParts?.length ? `<p class="cp-warning">${detail.unmappedParts.length} деталей без 3D-звʼязку — перевірте перед передачею</p>` : ""}
      ${detail?.parts?.length ? `<p class="enver-meta cp-wizard-parts-hint">${detail.parts.length} деталей у специфікації · ${detail.materials?.length || 0} матеріалів</p>` : ""}
    `,
    stepCtx
  );

  const handoffPanel = wrapWizardPanel(
    3,
    "handoff",
    `
      <div class="constructive-actions constructive-actions--cta cp-actions">
        ${
          hideProcurement
            ? ""
            : `<button type="button" class="btn btn-sm" data-cp-procurement-btn ${canStartProcurement ? "" : "disabled"} title="З Excel-специфікації">В закупівлю</button>`
        }
        <button type="button" class="btn btn-sm btn-primary" data-cp-handoff-cutting-btn ${PACKAGE_HANDOFF_TO_CUTTING_STATUSES.includes(status) ? "" : "disabled"}>На порізку</button>
      </div>
      <div class="package-ai-mount" data-cp-package-ai></div>
      <div data-cp-pipeline-handoff>${renderWizardHandoffExtras(detail, downstream?.procurement, {
        hideProcurement,
        cncJobs: downstream?.cncJobs || [],
        canManageProcurement: downstream?.canManageProcurement
      })}</div>
    `,
    stepCtx
  );

  return `
    <section class="constructive-package-block cp-wizard" data-position-id="${position?.id || ""}" data-package-id="${pkg?.id || ""}" data-cp-wizard-step="${currentStep}">
      <h3 class="enver-section-title">Пакет конструктива</h3>
      ${renderPackageWizardStepper(detail)}
      <div class="cp-wizard-panels" data-cp-package-files data-cp-wizard-panels>
        ${uploadPanel}
        ${parsePanel}
        ${verifyPanel}
        ${handoffPanel}
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

const packagePanelContextsByPosition = new Map();

function storePackagePanelContext(positionId, ctx) {
  if (positionId && ctx) packagePanelContextsByPosition.set(Number(positionId), ctx);
}

function getPackagePanelContext(positionId) {
  return packagePanelContextsByPosition.get(Number(positionId)) || null;
}

function patchConstructiveActionButtons(block, detail, { hideProcurement = false } = {}) {
  const pkg = detail?.package;
  const status = pkg?.status || "uploaded";
  const showManualParseBtn =
    pkg && pkg.status !== "parsing" && (detail?.files?.length > 0 || status !== "uploaded");
  const parseBtnLabel = status === "uploaded" ? "Розібрати" : "Розібрати знову";
  const canStartProcurement = !hideProcurement && canCreateProcurement(detail);

  const parseBtn = block.querySelector("[data-cp-parse-btn]");
  if (parseBtn) {
    parseBtn.textContent = parseBtnLabel;
    parseBtn.hidden = !showManualParseBtn;
    parseBtn.disabled = false;
  } else if (showManualParseBtn) {
    const actions = block.querySelector(".cp-actions");
    if (actions && !actions.querySelector("[data-cp-parse-btn]")) {
      actions.insertAdjacentHTML(
        "afterbegin",
        `<button type="button" class="btn btn-sm btn-ghost" data-cp-parse-btn">${parseBtnLabel}</button>`
      );
    }
  }

  const procBtn = block.querySelector("[data-cp-procurement-btn]");
  if (hideProcurement) {
    procBtn?.remove();
  } else if (procBtn) {
    procBtn.disabled = !canStartProcurement;
  }

  const approveBtn = block.querySelector("[data-cp-approve-btn]");
  if (approveBtn) {
    approveBtn.disabled = !(detail?.parts?.length && ["parsed", "needs_review"].includes(status));
  }

  const handoffBtn = block.querySelector("[data-cp-handoff-cutting-btn]");
  if (handoffBtn) {
    handoffBtn.disabled = !PACKAGE_HANDOFF_TO_CUTTING_STATUSES.includes(status);
  }
}

function applyPackageDetailToDom(root, position, detail, constructiveFiles = []) {
  const block = root?.querySelector?.(".constructive-package-block");
  if (!block || !position?.id) return;

  block.dataset.packageId = String(detail?.package?.id || "");
  applyPackageParseUi(block, position, detail, constructiveFiles);
  void refreshStalePackageParseUi(block, position, detail, (packageId) => {
    void runPackageParseWithProgress(position.id, packageId, {
      root,
      position,
      liveCtx: getPackagePanelContext(position.id) || { detail },
      notify: () => getPackagePanelContext(position.id)?.onUpdated?.()
    }).catch((err) => toastError(err.message));
  });
  patchConstructiveActionButtons(block, detail, {
    hideProcurement: getPackagePanelContext(position.id)?.hideProcurement === true
  });
  patchConstructiveUploadedFiles(root, position, detail, constructiveFiles);
  applyPackageWizardUi(block, detail);
  const aiMount = block.querySelector("[data-cp-package-ai]");
  if (aiMount) {
    mountPackageAiBlock(aiMount, detail?.aiAnalysis, {
      showRerun: Boolean(detail?.package?.id && detail?.parts?.length),
      positionId: position.id,
      showError: toastError,
      onRerun: async () => {
        const packageId = detail?.package?.id;
        if (!packageId) return;
        mountPackageAiBlock(aiMount, { status: "pending" });
        try {
          const res = await api.analyzeConstructivePackageAi(position.id, packageId);
          const next = res.aiAnalysis
            ? { ...detail, aiAnalysis: res.aiAnalysis }
            : await api.getConstructivePackageLatest(position.id);
          mountPackageAiBlock(aiMount, next?.aiAnalysis || res.aiAnalysis, {
            showRerun: true,
            positionId: position.id,
            showError: toastError,
            onRerun: () => aiMount.querySelector("[data-package-ai-rerun]")?.click()
          });
          getPackagePanelContext(position.id)?.onDetailPatched?.(next);
        } catch (err) {
          toastError(err.message);
        }
      }
    });
    if (detail?.aiAnalysis?.status === "pending") {
      pollPackageAiAnalysis(position.id, {
        onUpdate: (nextDetail) => {
          mountPackageAiBlock(aiMount, nextDetail?.aiAnalysis, {
            showRerun: Boolean(nextDetail?.parts?.length),
            positionId: position.id,
            showError: toastError,
            onRerun: () => aiMount.querySelector("[data-package-ai-rerun]")?.click()
          });
          getPackagePanelContext(position.id)?.onDetailPatched?.(nextDetail);
        }
      });
    }
  }
}

async function refreshAfterPackageFileChange(root, position, liveCtx, detail, constructiveFiles) {
  liveCtx.detail = detail;
  if (constructiveFiles !== undefined) {
    liveCtx.constructiveFiles = constructiveFiles;
    if (position?.id && state.constructorDesk.selectedPositionId === position.id) {
      state.constructorDesk.packageConstructiveFiles = constructiveFiles;
    }
  }
  liveCtx.onDetailPatched?.(detail);
  if (liveCtx.onUpdated) {
    await liveCtx.onUpdated({ packageDomOnly: true });
    return;
  }
  applyPackageDetailToDom(root, position, detail, liveCtx.constructiveFiles || []);
}

function bindPackageFileDelete(root, position, liveCtx, { signal }) {
  root.addEventListener(
    "click",
    async (e) => {
      const pkgBtn = e.target.closest("[data-cp-delete-file]");
      const legacyBtn = e.target.closest("[data-delete-legacy-file]");
      if (!pkgBtn && !legacyBtn) return;

      e.preventDefault();
      e.stopPropagation();

      const btn = pkgBtn || legacyBtn;
      const block = btn.closest(".constructive-package-block");
      if (!block || block.dataset.cpDeleting === "1") return;

      const positionId = Number(block.dataset.positionId) || position?.id;
      if (!positionId) {
        toastError("Не вдалося визначити позицію");
        return;
      }

      if (pkgBtn) {
        const fileId = Number(btn.getAttribute("data-cp-delete-file"));
        const packageId = Number(btn.getAttribute("data-package-id") || block.dataset.packageId);
        if (!fileId || !packageId) {
          toastError("Не вдалося визначити файл для видалення");
          return;
        }
        if (
          !window.confirm(
            "Видалити цей файл з пакета? Після видалення потрібно розібрати пакет знову."
          )
        ) {
          return;
        }
        block.dataset.cpDeleting = "1";
        try {
          const detail = await api.deleteConstructivePackageFile(positionId, packageId, fileId);
          await refreshAfterPackageFileChange(root, position, liveCtx, detail);
          toastSuccess("Файл видалено");
        } catch (err) {
          toastError(err.message || "Не вдалося видалити файл");
        } finally {
          delete block.dataset.cpDeleting;
        }
        return;
      }

      const fileId = Number(btn.getAttribute("data-delete-legacy-file"));
      if (!fileId) {
        toastError("Не вдалося визначити файл для видалення");
        return;
      }
      if (!window.confirm("Видалити цей файл конструктива?")) return;

      block.dataset.cpDeleting = "1";
      try {
        const result = await api.deleteConstructiveFile(positionId, fileId);
        const legacyFiles = result.files || (await api.getConstructiveFiles(positionId)) || [];
        const detail = liveCtx.detail || (await api.getConstructivePackageLatest(positionId));
        await refreshAfterPackageFileChange(root, position, liveCtx, detail, legacyFiles);
        toastSuccess("Файл видалено");
      } catch (err) {
        toastError(err.message || "Не вдалося видалити файл");
      } finally {
        delete block.dataset.cpDeleting;
      }
    },
    { signal }
  );
}

function bindConstructivePackageActions(root, position, liveCtx, { signal, notify }) {
  const hideProcurement = liveCtx.hideProcurement === true;

  root.addEventListener(
    "click",
    async (e) => {
      const parseBtn = e.target.closest("[data-cp-parse-btn]");
      const parseRetryBtn = e.target.closest("[data-cp-parse-retry]");
      if (parseBtn || parseRetryBtn) {
        if (parseBtn?.disabled) return;
        const block = (parseBtn || parseRetryBtn).closest(".constructive-package-block");
        try {
          const latest = await api.getConstructivePackageLatest(position.id);
          const packageId = latest?.package?.id;
          if (!packageId) {
            toastError("Спочатку завантажте файли пакета");
            return;
          }
          liveCtx.detail = latest;
          const after = await runPackageParseWithProgress(position.id, packageId, {
            root,
            position,
            liveCtx,
            notify
          });
          if (!hideProcurement && (after?.autoProcurement || after?.procurement?.id)) {
            toastSuccess("Пакет розібрано — закупівлю створено з Excel");
          } else {
            toastSuccess("Пакет розібрано");
          }
        } catch (err) {
          toastError(err.message);
          if (block && position) {
            const fresh = await api.getConstructivePackageLatest(position.id).catch(() => null);
            if (fresh) applyPackageParseUi(block, position, fresh);
          }
        }
        return;
      }

      if (!hideProcurement && e.target.closest("[data-cp-procurement-btn]")) {
        try {
          const latest = await api.getConstructivePackageLatest(position.id);
          const proc = await api.createProcurementFromPackage(position.id, latest.package.id);
          const { invalidateProcurementListCache } = await import("./procurement-view.js");
          const { canViewProcurement } = await import("./auth.js");
          invalidateProcurementListCache();
          if (canViewProcurement() && proc?.id) {
            const { openProcurementRequest } = await import("./procurement-view.js");
            await openProcurementRequest(proc.id);
            const { notifyUiChanged } = await import("./ui-persistence.js");
            const { renderApp } = await import("./render.js");
            notifyUiChanged();
            renderApp();
            toastSuccess("Заявку додано до реєстру закупівель");
          } else {
            toastSuccess("Закупівлю створено");
          }
          notify();
        } catch (err) {
          toastError(err.message);
        }
        return;
      }

      if (e.target.closest("[data-cp-approve-btn]")) {
        try {
          const latest = await api.getConstructivePackageLatest(position.id);
          const approvedPkg = await api.approveConstructivePackage(position.id, latest.package.id);
          const nextDetail = {
            ...latest,
            package: { ...latest.package, ...approvedPkg, status: approvedPkg.status }
          };
          liveCtx.detail = nextDetail;
          liveCtx.onDetailPatched?.(nextDetail);
          const block = root.querySelector(".constructive-package-block");
          if (block) applyPackageDetailToDom(root, position, nextDetail, liveCtx.constructiveFiles);
          toastSuccess("Пакет підтверджено");
          notify();
        } catch (err) {
          toastError(err.message);
        }
        return;
      }

      if (e.target.closest("[data-cp-handoff-cutting-btn]")) {
        try {
          await api.runPositionNextAction(position.id, "handoff_to_cutting");
          toastSuccess("Позицію передано в чергу порізки");
          notify();
        } catch (err) {
          const hint = err.nextAction?.label ? ` (${err.nextAction.label})` : "";
          toastError(`${err.message}${hint}`);
        }
      }
    },
    { signal }
  );
}

export function bindConstructivePackageBlock(
  position,
  root = document.body,
  {
    onUpdated,
    editable = false,
    detail = null,
    constructiveFiles = [],
    onDetailPatched,
    hideProcurement = false
  } = {}
) {
  if (!editable || !position?.id || !root) return;

  packageDropZones.get(root)?.destroy();
  packageBindAbort.get(root)?.abort();
  const bindAbort = new AbortController();
  packageBindAbort.set(root, bindAbort);
  const { signal } = bindAbort;

  const notify = () => {
    onUpdated?.();
  };

  const patchDetail = (nextDetail) => {
    onDetailPatched?.(nextDetail);
  };

  const liveCtx = {
    position,
    detail,
    constructiveFiles,
    hideProcurement,
    onDetailPatched: patchDetail,
    onUpdated
  };
  storePackagePanelContext(position.id, liveCtx);

  bindPackageFileDelete(root, position, liveCtx, { signal });
  bindConstructivePackageActions(root, position, liveCtx, { signal, notify });

  const zone = root.querySelector("[data-cp-package-drop]");
  if (!zone) return;

  const uploadFiles = (fileList) => {
    if (!Array.isArray(fileList) || !fileList.length) return;
    enqueuePackageUpload(root, position, fileList, notify);
  };

  const pickPackageFiles = () => {
    void pickLocalFile({ multiple: true, accept: PACKAGE_ALL_ACCEPT.join(",") }).then(uploadFiles);
  };

  const pickPackageFolder = () => {
    void pickLocalFile({ directory: true }).then(uploadFiles);
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
    accept: PACKAGE_ALL_ACCEPT,
    maxBytes: CONSTRUCTIVE_MAX_BYTES,
    multiple: true,
    onFile: (file) => {
      uploadFiles([file]);
    }
  });
  packageDropZones.set(root, dz);

  bindPackageWizard(root, {
    getDetail: () => getPackagePanelContext(position.id)?.detail || detail
  });
}
