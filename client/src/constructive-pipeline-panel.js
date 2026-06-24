import { escapeHtml } from "./utils.js";
import { api } from "./api.js";
import {
  packageStatusLabel,
  procurementStatusLabel
} from "@enver/shared/production/constructive-package.js";

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

export function renderConstructivePipelinePanel(detail, procurement = undefined) {
  const pkg = detail?.package;
  if (!pkg) {
    return `<p class="enver-meta">Завантажте пакет конструктива у вкладці «Ще».</p>`;
  }

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
      <p class="cp-status-lg">${escapeHtml(packageStatusLabel(pkg.status))} · v${pkg.version}</p>
      <p>${detail.parts?.length || 0} деталей · ${detail.unmappedParts?.length || 0} без 3D</p>
      <div class="cp-actions-inline">
        <button type="button" class="btn btn-sm" id="openModelMappingBtn">Мапінг 3D деталей</button>
        <button type="button" class="btn btn-sm" id="analyzePackageAiBtn">ШІ-аналіз пакета</button>
      </div>
      <div id="packageAiResult" class="package-ai-result" hidden></div>
      <div class="cp-parts-table-wrap">
        <table class="cp-parts-table">
          <thead><tr><th>Блок</th><th>№</th><th>Назва</th><th>Матеріал</th><th>Розмір</th><th>Код</th><th>ЧПК</th></tr></thead>
          <tbody>${partsList || "<tr><td colspan='7'>Немає деталей — розберіть пакет</td></tr>"}</tbody>
        </table>
      </div>
      <div id="procurementPanelMount">${renderProcurementPanel(procurement)}</div>
    </section>`;
}
