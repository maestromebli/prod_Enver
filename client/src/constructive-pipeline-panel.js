import { escapeHtml } from "./utils.js";
import { api, getPartLabelsUrl } from "./api.js";
import {
  packageStatusLabel,
  procurementStatusLabel,
  cncJobStatusLabel
} from "@enver/shared/production/constructive-package.js";
import { buildConstructiveReviewSummary } from "@enver/shared/production/constructive-review.js";
import { getConstructivePackageNextAction } from "@enver/shared/production/constructive-godmode.js";

export function renderFinancePanel(positionId, summary = null) {
  if (!summary) {
    return `<section class="finance-panel"><p class="enver-meta">Завантаження фінансів…</p></section>`;
  }

  const rows = Object.entries(summary.byType || {})
    .map(
      ([type, data]) => `
    <tr>
      <td>${escapeHtml(type)}</td>
      <td class="num">${Number(data.actual || 0).toFixed(2)}</td>
    </tr>`
    )
    .join("");

  return `
    <section class="finance-panel">
      <h3 class="drawer-section-title">Фінанси позиції</h3>
      <div class="finance-summary-grid">
        <div class="finance-card">
          <span class="finance-label">План</span>
          <strong>${Number(summary.estimated || 0).toFixed(2)} UAH</strong>
        </div>
        <div class="finance-card">
          <span class="finance-label">Факт</span>
          <strong>${Number(summary.actual || 0).toFixed(2)} UAH</strong>
        </div>
        <div class="finance-card ${summary.difference > 0 ? "is-over" : ""}">
          <span class="finance-label">Відхилення</span>
          <strong>${Number(summary.difference || 0).toFixed(2)} UAH</strong>
        </div>
      </div>
      ${
        rows
          ? `<table class="finance-table"><thead><tr><th>Тип</th><th>Сума</th></tr></thead><tbody>${rows}</tbody></table>`
          : "<p class='enver-meta'>Записів фінансів ще немає.</p>"
      }
    </section>`;
}

export async function loadFinanceSummary(positionId) {
  return api.getPositionFinance(positionId);
}

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

export function renderCncQueuePanel(jobs = []) {
  if (!jobs.length) {
    return `<section class="cnc-queue-panel"><p class="enver-meta">Черга ЧПК порожня — відправте пакет у GitLab або release CNC.</p></section>`;
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

const PROCUREMENT_ADVANCE = {
  draft: "waiting_approval",
  waiting_approval: "approved",
  approved: "ordered",
  ordered: "partially_received",
  partially_received: "received"
};

export function renderProcurementPanel(procurement = null, { canManage = false } = {}) {
  if (!procurement) {
    return `<section class="procurement-panel"><p class="enver-meta">Закупівлю ще не створено — кнопка у вкладці «Ще».</p></section>`;
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

  const nextStatus = PROCUREMENT_ADVANCE[procurement.status];
  const advanceLabel =
    procurement.status === "ordered"
      ? "Частково отримано"
      : procurement.status === "partially_received"
        ? "Отримано"
        : nextStatus
          ? procurementStatusLabel(nextStatus)
          : null;

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
      <p class="enver-meta">Завантажте файли у повній картці позиції або на стілі конструктора.</p>
      <button type="button" class="btn btn-sm btn-primary" data-open-position-full>Відкрити картку позиції</button>
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
  const pipelineGodmodeBtn =
    pkgAction &&
    pkgAction.allowed !== false &&
    !["wait_parse", "wait_procurement", "handoff_to_cutting"].includes(pkgAction.type)
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
      <td>${escapeHtml(`${p.length}×${p.width}`)}</td>
      <td><code>${escapeHtml(p.barcodeValue?.slice(-12) || "")}</code></td>
      <td>${escapeHtml(p.cncStatus || "—")}</td>
    </tr>`
    )
    .join("");

  return `
    <section class="constructive-pipeline-panel">
      <p class="cp-status-lg">${escapeHtml(packageStatusLabel(pkg.status))} · v${pkg.version} ${reviewBadge}</p>
      <p>${detail.parts?.length || 0} деталей · ${detail.unmappedParts?.length || 0} без 3D</p>
      <div class="cp-actions-inline">
        ${pipelineGodmodeBtn}
        <button type="button" class="btn btn-sm btn-primary" id="openConstructiveReviewBtn">Перевірка конструктива</button>
        <button type="button" class="btn btn-sm" id="openModelMappingBtn">Мапінг 3D деталей</button>
        <button type="button" class="btn btn-sm" id="analyzePackageAiBtn">ШІ-аналіз пакета</button>
      </div>
      <div id="packageAiResult" class="package-ai-result" hidden></div>
      <div id="cncQueuePanelMount">${renderCncQueuePanel(options.cncJobs || [])}</div>
      <div class="cp-parts-table-wrap">
        <table class="cp-parts-table">
          <thead><tr><th>Блок</th><th>№</th><th>Назва</th><th>Матеріал</th><th>Розмір</th><th>Код</th><th>ЧПК</th></tr></thead>
          <tbody>${partsList || "<tr><td colspan='7'>Немає деталей — розберіть пакет</td></tr>"}</tbody>
        </table>
      </div>
      <div id="procurementPanelMount">${renderProcurementPanel(procurement, { canManage: options.canManageProcurement })}</div>
    </section>`;
}

/** Підвʼязує кнопки pipeline-конструктива (перевірка, 3D, ШІ, закупівля). */
export function bindConstructivePipelinePanel(root, ctx = {}) {
  const {
    positionId,
    getPackageDetail = () => null,
    getProcurement = () => null,
    onProcurementUpdated,
    onPackageUpdated,
    onOpenPosition
  } = ctx;
  if (!root || !positionId) return;

  const afterPipelineAction = () => {
    onPackageUpdated?.();
    onProcurementUpdated?.();
  };

  root.querySelector("#pipelineGodmodeBtn")?.addEventListener("click", async () => {
    const btn = root.querySelector("#pipelineGodmodeBtn");
    const action = btn?.dataset?.pipelineAction;
    const detail = getPackageDetail();
    const pkgId = detail?.package?.id;
    if (!action) return;

    const { toastError, toastSuccess } = await import("./toast.js");

    try {
      if (action === "parse_constructive_package" && pkgId) {
        await api.parseConstructivePackage(positionId, pkgId);
        toastSuccess("Пакет розібрано");
      } else if (action === "create_procurement" && pkgId) {
        const proc = await api.createProcurementFromPackage(positionId, pkgId);
        onProcurementUpdated?.(proc);
        toastSuccess("Закупівлю створено");
      } else if (action === "send_to_gitlab") {
        await api.sendToGitlab(positionId);
        toastSuccess("Відправлено в GitLab");
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

  root.querySelector("#openModelMappingBtn")?.addEventListener("click", async () => {
    const detail = getPackageDetail();
    if (!detail?.package?.id) return;
    const { openModelMappingModal } = await import("./model-mapping-ui.js");
    openModelMappingModal(positionId, detail);
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

export function bindProcurementPanel(root, ctx = {}) {
  bindConstructivePipelinePanel(root, ctx);
}
