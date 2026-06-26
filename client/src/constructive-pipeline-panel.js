import { escapeHtml } from "./utils.js";
import { api, getPartLabelsUrl } from "./api.js";
import {
  packageStatusLabel,
  procurementStatusLabel,
  procurementAdvanceButtonLabel,
  nextProcurementStatus,
  cncJobStatusLabel,
  formatPartDimensionsMm,
  packageParseDisplay,
  PACKAGE_HANDOFF_TO_CUTTING_STATUSES
} from "@enver/shared/production/constructive-package.js";
import { runPackageParseWithProgress } from "./constructive-package-parse-ui.js";
import {
  formatCncFileMaterialLabel,
  summarizeCncPackageFiles
} from "@enver/shared/production/cnc-file-meta.js";
import { buildConstructiveReviewSummary } from "@enver/shared/production/constructive-review.js";
import { getConstructivePackageNextAction } from "@enver/shared/production/constructive-godmode.js";

export async function loadProcurementSummary(positionId) {
  return api.getPositionProcurement(positionId);
}

export async function loadCncJobsSummary(positionId) {
  try {
    return await api.getPositionCncJobs(positionId);
  } catch {
    return [];
  }
}

export function renderCncQueuePanel(jobs = [], { packageFiles = [] } = {}) {
  const cncSummary = summarizeCncPackageFiles(packageFiles);
  const filesBlock =
    cncSummary.count > 0
      ? `
    <div class="cp-cnc-files-block">
      <h4 class="enver-meta">Файли на станок</h4>
      <p class="enver-meta">${cncSummary.count} програм · ${cncSummary.types.join(", ") || "—"} · декори: ${cncSummary.decors.join(", ") || "—"}</p>
      <ul class="cp-cnc-files-list">
        ${cncSummary.files
          .map((f) => {
            const label = formatCncFileMaterialLabel(f);
            return `<li><span class="cp-cnc-material-badge">${escapeHtml(label || "ЧПК")}</span> ${escapeHtml(f.originalName || "файл")}</li>`;
          })
          .join("")}
      </ul>
    </div>`
      : "";

  if (!jobs.length) {
    return `<section class="cnc-queue-panel">
      ${filesBlock}
      <p class="enver-meta">Черга ЧПК порожня — відправте пакет на ЧПК або передайте на верстат.</p>
    </section>`;
  }

  const active = jobs.filter((j) => !["done", "cancelled"].includes(j.status)).length;
  const rows = jobs
    .slice(0, 40)
    .map(
      (j) => `
    <tr class="cnc-status-${escapeHtml(j.status)}">
      <td>${escapeHtml(j.blockCode || "—")} · ${escapeHtml(j.partNo || "—")}</td>
      <td>${escapeHtml(j.partName || "—")}</td>
      <td>${escapeHtml(cncJobStatusLabel(j.status))}</td>
      <td><code>${escapeHtml(j.barcodeValue?.slice(-10) || "—")}</code></td>
    </tr>`
    )
    .join("");

  return `
    <section class="cnc-queue-panel">
      ${filesBlock}
      <h3 class="drawer-section-title">Черга ЧПК</h3>
      <p class="enver-meta">${active} активних · ${jobs.length} загалом</p>
      <div class="cp-parts-table-wrap">
        <table class="cp-parts-table">
          <thead><tr><th>Деталь</th><th>Назва</th><th>Статус</th><th>Код</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>`;
}

export function renderProcurementPanel(procurement = null, { canManage = false } = {}) {
  if (!procurement) {
    return `<section class="procurement-panel">
      <p class="enver-meta">Закупівлю ще не створено.</p>
      <p class="enver-meta">Позиції формуються з <strong>Excel-специфікації конструктора</strong> після розбору пакета. Файли ЧПК не використовуються.</p>
    </section>`;
  }

  const items = (procurement.items || [])
    .map(
      (item) => `
    <tr>
      <td>${escapeHtml(item.itemType || "—")}</td>
      <td>${escapeHtml(item.name || "—")}</td>
      <td>${escapeHtml(item.qty || "—")} ${escapeHtml(item.unit || "")}</td>
      <td>${escapeHtml(procurementStatusLabel(item.status))}</td>
    </tr>`
    )
    .join("");

  const nextStatus = nextProcurementStatus(procurement.status);
  const advanceLabel = procurementAdvanceButtonLabel(procurement.status);

  return `
    <section class="procurement-panel">
      <h3 class="drawer-section-title">Закупівля</h3>
      <p class="cp-status-lg">${escapeHtml(procurementStatusLabel(procurement.status))}</p>
      <p class="enver-meta">${procurement.items?.length || 0} позицій · план ${Number(procurement.totalEstimated || 0).toFixed(2)} UAH</p>
      ${
        items
          ? `<table class="cp-parts-table procurement-items-table"><thead><tr><th>Тип</th><th>Назва</th><th>Кількість</th><th>Статус</th></tr></thead><tbody>${items}</tbody></table>`
          : ""
      }
      ${
        canManage && nextStatus
          ? `<button type="button" class="btn btn-sm" id="advanceProcurementBtn" data-next-status="${escapeHtml(nextStatus)}">→ ${escapeHtml(advanceLabel)}</button>`
          : ""
      }
    </section>`;
}

export function renderConstructivePipelinePanel(detail, procurement = null, options = {}) {
  const pkg = detail?.package;
  if (!pkg) {
    return `<section class="constructive-pipeline-panel constructive-pipeline-panel--empty">
      <p class="enver-meta">Пакет конструктива ще не завантажено.</p>
      <p class="enver-meta">Завантажте файли на <strong>столі конструктора</strong> (вкладка «Пакет конструктива»).</p>
    </section>`;
  }

  const review = buildConstructiveReviewSummary(detail);
  const reviewBadge =
    review.needsReview && detail.parts?.length
      ? `<span class="cp-review-badge">Потрібна перевірка</span>`
      : "";

  const pkgAction = getConstructivePackageNextAction({
    packageStatus: pkg.status,
    unmappedPartsCount: detail.unmappedParts?.length || 0
  });
  const hideProcurement = options.hideProcurement === true;
  const canHandoffCutting = PACKAGE_HANDOFF_TO_CUTTING_STATUSES.includes(pkg.status);
  const pipelineGodmodeBtn =
    pkgAction &&
    pkgAction.allowed !== false &&
    !["wait_parse", "wait_procurement", ...(hideProcurement ? ["create_procurement"] : [])].includes(
      pkgAction.type
    )
      ? `<button type="button" class="btn btn-sm btn-primary" id="pipelineGodmodeBtn" data-pipeline-action="${escapeHtml(pkgAction.type)}">${escapeHtml(pkgAction.buttonLabel)}</button>`
      : "";

  const partsList = (detail.parts || [])
    .slice(0, 50)
    .map(
      (p) => `
    <tr class="${p.modelNodeId || p.modelMeshName ? "" : "is-unmapped"}">
      <td>${escapeHtml(p.blockCode || "—")}</td>
      <td>${escapeHtml(p.partNo)}</td>
      <td>${escapeHtml(p.partName)}</td>
      <td>${escapeHtml(p.material)}</td>
      <td>${escapeHtml(formatPartDimensionsMm(p))}</td>
      <td><code>${escapeHtml(p.barcodeValue?.slice(-12) || "")}</code></td>
      <td>${escapeHtml(p.cncStatus || "—")}</td>
    </tr>`
    )
    .join("");

  const parseDisplay = packageParseDisplay(pkg.status, detail.parts?.length || 0);
  const parseBadgeClass = parseDisplay.parsing
    ? "cp-parse-badge--parsing"
    : parseDisplay.parsed
      ? "cp-parse-badge--parsed"
      : "cp-parse-badge--pending";

  return `
    <section class="constructive-pipeline-panel">
      <div class="cp-parse-badge ${parseBadgeClass}" role="status">
        <strong>${escapeHtml(parseDisplay.title)}</strong>
        <span class="enver-meta"> · ${escapeHtml(parseDisplay.subtitle)}</span>
      </div>
      <p class="cp-status-lg">${escapeHtml(packageStatusLabel(pkg.status))} · v${pkg.version} ${reviewBadge}</p>
      <div class="cp-actions-inline">
        ${pipelineGodmodeBtn}
        ${
          canHandoffCutting
            ? `<button type="button" class="btn btn-sm btn-primary" id="pipelineHandoffCuttingBtn">На порізку</button>`
            : ""
        }
        <button type="button" class="btn btn-sm btn-primary" id="openConstructiveReviewBtn">Перевірка конструктива</button>
        <button type="button" class="btn btn-sm" id="openB3dPreviewBtn">Перегляд 3D</button>
        <button type="button" class="btn btn-sm" id="analyzePackageAiBtn">ШІ-аналіз пакета</button>
      </div>
      <div id="packageAiResult" class="package-ai-result" hidden></div>
      <div id="cncQueuePanelMount">${renderCncQueuePanel(options.cncJobs || [], { packageFiles: detail?.files || [] })}</div>
      <div class="cp-parts-section" data-cp-parts-section>
        <div class="cp-parts-section-head">
          <button type="button" class="btn-tree cp-parts-toggle" data-cp-toggle-parts aria-expanded="false" title="Показати деталіровку" aria-label="Показати деталіровку">+</button>
          <h3 class="drawer-section-title cp-parts-section-title">
            Деталіровка
            <span class="enver-meta">${detail.parts?.length || 0} деталей · ${detail.unmappedParts?.length || 0} без 3D</span>
          </h3>
        </div>
        <div class="cp-parts-table-wrap" data-cp-parts-body hidden>
          <table class="cp-parts-table">
            <thead><tr><th>Блок</th><th>№</th><th>Назва</th><th>Матеріал</th><th>Розмір, мм</th><th>Код</th><th>ЧПК</th></tr></thead>
            <tbody>${partsList || "<tr><td colspan='7'>Немає деталей — розберіть пакет</td></tr>"}</tbody>
          </table>
        </div>
      </div>
      ${
        hideProcurement
          ? ""
          : `<div id="procurementPanelMount">${renderProcurementPanel(procurement, { canManage: options.canManageProcurement })}</div>`
      }
    </section>`;
}

/** Підвʼязує кнопки pipeline-конструктива (перевірка, 3D, ШІ, закупівля). */
export function bindConstructivePipelinePanel(root, ctx = {}) {
  const {
    positionId,
    hideProcurement = false,
    getPackageDetail = () => null,
    getProcurement = () => null,
    onProcurementUpdated,
    onPackageUpdated,
    onOpenPosition
  } = ctx;
  if (!root || !positionId) return;

  root.querySelector("[data-cp-toggle-parts]")?.addEventListener("click", (e) => {
    const btn = e.currentTarget;
    const body = root.querySelector("[data-cp-parts-body]");
    if (!body) return;
    const expanded = btn.getAttribute("aria-expanded") === "true";
    const next = !expanded;
    btn.setAttribute("aria-expanded", String(next));
    btn.textContent = next ? "−" : "+";
    btn.title = next ? "Згорнути деталіровку" : "Показати деталіровку";
    btn.setAttribute("aria-label", btn.title);
    body.hidden = !next;
  });

  const afterPipelineAction = () => {
    onPackageUpdated?.();
    onProcurementUpdated?.();
  };

  root.querySelector("#pipelineHandoffCuttingBtn")?.addEventListener("click", async () => {
    const { toastError, toastSuccess } = await import("./toast.js");
    try {
      await api.runPositionNextAction(positionId, "handoff_to_cutting");
      toastSuccess("Позицію передано в чергу порізки");
      afterPipelineAction();
      onOpenPosition?.(positionId);
    } catch (err) {
      const hint = err.nextAction?.label ? ` (${err.nextAction.label})` : "";
      toastError(`${err.message}${hint}`);
    }
  });

  root.querySelector("#pipelineGodmodeBtn")?.addEventListener("click", async () => {
    const btn = root.querySelector("#pipelineGodmodeBtn");
    const action = btn?.dataset?.pipelineAction;
    const detail = getPackageDetail();
    const pkgId = detail?.package?.id;
    if (!action) return;

    const { toastError, toastSuccess } = await import("./toast.js");

    try {
      if (action === "parse_constructive_package" && pkgId) {
        const panel = root.closest(".constructive-pipeline-panel")?.parentElement || root;
        const liveCtx = { detail, onDetailPatched: (d) => { detail = d; } };
        await runPackageParseWithProgress(positionId, pkgId, {
          root: panel,
          position: { id: positionId },
          liveCtx,
          notify: afterPipelineAction
        });
        toastSuccess("Пакет розібрано");
        afterPipelineAction();
        return;
      } else if (action === "create_procurement" && pkgId) {
        if (hideProcurement) return;
        const proc = await api.createProcurementFromPackage(positionId, pkgId);
        const { invalidateProcurementListCache } = await import("./procurement-view.js");
        invalidateProcurementListCache();
        onProcurementUpdated?.(proc);
        toastSuccess("Закупівлю створено");
      } else if (action === "handoff_to_cutting") {
        await api.runPositionNextAction(positionId, "handoff_to_cutting");
        toastSuccess("Позицію передано в чергу порізки");
      } else if (action === "release_to_cnc" && pkgId) {
        await api.releaseConstructivePackageToCnc(positionId, pkgId);
        toastSuccess("Передано на верстат");
      } else if (action === "print_part_labels") {
        window.open(getPartLabelsUrl(positionId), "_blank", "noopener,noreferrer");
        return;
      } else if (action === "review_constructive" && pkgId) {
        const { openConstructiveReviewModal } = await import("./constructive-review-ui.js");
        const { canReviewConstructive } = await import("./auth.js");
        openConstructiveReviewModal(positionId, detail, { canReview: canReviewConstructive() });
        return;
      } else if (action === "upload_constructive_package") {
        onOpenPosition?.(positionId);
        return;
      } else {
        toastError("Дію потрібно виконати вручну");
        return;
      }
      afterPipelineAction();
    } catch (err) {
      toastError(err.message);
    }
  });

  root.querySelector("[data-open-position-full]")?.addEventListener("click", () => {
    onOpenPosition?.(positionId);
  });

  root.querySelector("#openConstructiveReviewBtn")?.addEventListener("click", async () => {
    const detail = getPackageDetail();
    if (!detail?.package?.id) return;
    const { openConstructiveReviewModal } = await import("./constructive-review-ui.js");
    const { canReviewConstructive } = await import("./auth.js");
    openConstructiveReviewModal(positionId, detail, { canReview: canReviewConstructive() });
  });

  root.querySelector("#openB3dPreviewBtn")?.addEventListener("click", async () => {
    const detail = getPackageDetail();
    if (!detail?.package?.id) return;
    const { openB3dPreviewModal } = await import("./b3d-preview-modal.js");
    openB3dPreviewModal(positionId, detail);
  });

  root.querySelector("#analyzePackageAiBtn")?.addEventListener("click", async () => {
    const detail = getPackageDetail();
    const pkgId = detail?.package?.id;
    if (!pkgId) return;
    const box = root.querySelector("#packageAiResult");
    if (box) {
      box.hidden = false;
      box.textContent = "ШІ аналізує пакет…";
    }
    try {
      const res = await api.analyzeConstructivePackageAi(positionId, pkgId);
      if (box) {
        box.innerHTML = `<pre class="package-ai-json">${escapeHtml(JSON.stringify(res.analysis || res, null, 2))}</pre>`;
      }
    } catch (err) {
      if (box) box.textContent = err.message;
    }
  });

  if (!hideProcurement) {
    root.querySelector("#advanceProcurementBtn")?.addEventListener("click", async () => {
      const btn = root.querySelector("#advanceProcurementBtn");
      const nextStatus = btn?.dataset?.nextStatus;
      const procurement = getProcurement();
      if (!nextStatus || !procurement?.id) return;
      try {
        const updated = await api.updatePositionProcurement(positionId, procurement.id, {
          status: nextStatus
        });
        onProcurementUpdated?.(updated);
      } catch (err) {
        const { toastError } = await import("./toast.js");
        toastError(err.message);
      }
    });
  }
}

export function bindProcurementPanel(root, ctx = {}) {
  bindConstructivePipelinePanel(root, ctx);
}
