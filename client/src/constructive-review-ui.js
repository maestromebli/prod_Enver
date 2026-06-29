import { escapeHtml, $ } from "./utils.js";
import { api, constructivePackageFileUrl } from "./api.js";
import { buildConstructiveReviewSummary } from "@enver/shared/production/constructive-review.js";
import {
  packageStatusLabel,
  formatPartDimensionsMm
} from "@enver/shared/production/constructive-package.js";
import { toastError, toastSuccess } from "./toast.js";
import { renderPackageAiResult } from "./package-ai-ui.js";

function renderChecklist(checks = []) {
  return checks
    .map(
      (c) => `
    <li class="cr-check ${c.ok ? "is-ok" : "is-warn"}">
      <span class="cr-check-icon">${c.ok ? "✓" : "!"}</span>
      <span class="cr-check-label">${escapeHtml(c.label)}</span>
      <span class="cr-check-detail">${escapeHtml(c.detail)}</span>
    </li>`
    )
    .join("");
}

function renderPartsDiff(parts = [], limit = 30) {
  return parts
    .slice(0, limit)
    .map(
      (p) => `
    <tr class="${p.modelNodeId || p.modelMeshName ? "" : "is-unmapped"}">
      <td>${escapeHtml(p.blockCode || "—")}</td>
      <td>${escapeHtml(p.partNo)}</td>
      <td>${escapeHtml(p.partName)}</td>
      <td>${escapeHtml(p.material || "—")}</td>
      <td>${escapeHtml(formatPartDimensionsMm(p))}</td>
    </tr>`
    )
    .join("");
}

function renderMaterialsTable(materials = []) {
  return materials
    .slice(0, 25)
    .map(
      (m) => `
    <tr>
      <td>${escapeHtml(m.materialName || "—")}</td>
      <td>${escapeHtml(m.thickness || "—")}</td>
      <td>${escapeHtml(m.qtyEstimated || "—")} ${escapeHtml(m.unit || "")}</td>
    </tr>`
    )
    .join("");
}

function renderPdfPreview(positionId, packageId, pdfFile) {
  if (!pdfFile) {
    return `<p class="enver-meta">PDF не завантажено</p>`;
  }
  const href = constructivePackageFileUrl(positionId, packageId, pdfFile.id);
  return `<iframe class="cr-preview-pdf" src="${escapeHtml(href)}" title="${escapeHtml(pdfFile.originalName)}"></iframe>`;
}

function renderAiSection(analysis) {
  if (!analysis) return "";
  if (analysis.status) {
    return `<section class="cr-ai-block">${renderPackageAiResult(analysis)}</section>`;
  }
  return `<section class="cr-ai-block">${renderPackageAiResult({ status: "done", analysis })}</section>`;
}

export function renderConstructiveReviewModal(positionId, detail, { canReview = false } = {}) {
  const summary = buildConstructiveReviewSummary(detail);
  const pkg = detail?.package;
  const status = packageStatusLabel(pkg?.status);

  return `
    <div class="modal-backdrop open" id="constructiveReviewModal">
      <div class="modal constructive-review-modal" role="dialog">
        <header class="constructive-review-head">
          <div>
            <h2>Перевірка конструктива</h2>
            <p class="enver-meta">${escapeHtml(status)} · ${summary.counts.parts} деталей · ${summary.counts.blocks} блоків</p>
          </div>
          <button type="button" class="btn btn-sm" id="closeConstructiveReviewBtn">Закрити</button>
        </header>
        <div class="constructive-review-body">
          <aside class="cr-sidebar">
            <ul class="cr-checklist">${renderChecklist(summary.checks)}</ul>
            ${
              summary.warnings.length
                ? `<div class="cr-warnings-box"><strong>Попередження</strong><ul>${summary.warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></div>`
                : `<p class="cr-ok-note">Критичних розбіжностей не виявлено</p>`
            }
            ${
              canReview
                ? `<div class="cr-review-actions">
              <button type="button" class="btn btn-primary" id="reviewApproveBtn">Підтвердити</button>
              <button type="button" class="btn btn-danger" id="reviewRejectBtn">Відхилити</button>
              <button type="button" class="btn btn-sm" id="reviewRunAiBtn">ШІ-перевірка</button>
            </div>`
                : `<button type="button" class="btn btn-sm" id="reviewRunAiBtn">ШІ-перевірка</button>`
            }
            <div id="reviewAiMount"></div>
          </aside>
          <div class="cr-main">
            <div class="cr-split">
              <section class="cr-panel">
                <h3>PDF креслення</h3>
                ${renderPdfPreview(positionId, pkg?.id, summary.files.pdf)}
              </section>
              <section class="cr-panel">
                <h3>XLS — матеріали (${summary.counts.materials})</h3>
                ${
                  summary.files.xls
                    ? `<p class="enver-meta">${escapeHtml(summary.files.xls.originalName)}</p>`
                    : ""
                }
                <div class="cr-table-wrap">
                  <table class="cp-parts-table">
                    <thead><tr><th>Матеріал</th><th>Товщина</th><th>Кількість</th></tr></thead>
                    <tbody>${renderMaterialsTable(detail?.materials || []) || "<tr><td colspan='3'>—</td></tr>"}</tbody>
                  </table>
                </div>
              </section>
            </div>
            <section class="cr-panel cr-parts-panel">
              <h3>Деталі з розбору (${summary.counts.parts})</h3>
              <div class="cr-table-wrap">
                <table class="cp-parts-table">
                  <thead><tr><th>Блок</th><th>№</th><th>Назва</th><th>Матеріал</th><th>Розмір, мм</th></tr></thead>
                  <tbody>${renderPartsDiff(detail?.parts || []) || "<tr><td colspan='5'>Немає деталей</td></tr>"}</tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>`;
}

export function openConstructiveReviewModal(positionId, detail, options = {}) {
  if (!detail?.package?.id) return;
  closeConstructiveReviewModal();
  document.body.insertAdjacentHTML(
    "beforeend",
    renderConstructiveReviewModal(positionId, detail, options)
  );

  $("#closeConstructiveReviewBtn")?.addEventListener("click", closeConstructiveReviewModal);
  $("#constructiveReviewModal")?.addEventListener("click", (e) => {
    if (e.target.id === "constructiveReviewModal") closeConstructiveReviewModal();
  });

  $("#reviewRunAiBtn")?.addEventListener("click", () => runReviewAi(positionId, detail.package.id));
  if (detail?.aiAnalysis) {
    const mount = $("#reviewAiMount");
    if (mount) mount.innerHTML = renderAiSection(detail.aiAnalysis);
  }
  $("#reviewApproveBtn")?.addEventListener("click", () =>
    reviewAction(positionId, detail.package.id, "approve")
  );
  $("#reviewRejectBtn")?.addEventListener("click", () =>
    reviewAction(positionId, detail.package.id, "reject")
  );
}

async function runReviewAi(positionId, packageId) {
  const mount = $("#reviewAiMount");
  if (mount) mount.innerHTML = `<p class="enver-meta">ШІ аналізує…</p>`;
  try {
    const res = await api.analyzeConstructivePackageAi(positionId, packageId);
    if (mount)
      mount.innerHTML = renderAiSection(
        res.aiAnalysis || { status: "done", analysis: res.analysis }
      );
  } catch (err) {
    if (mount) mount.innerHTML = `<p class="cr-error">${escapeHtml(err.message)}</p>`;
  }
}

async function reviewAction(positionId, packageId, action) {
  try {
    if (action === "approve") {
      await api.approveConstructivePackage(positionId, packageId);
      toastSuccess("Пакет підтверджено");
    } else {
      const reason = window.prompt("Причина відхилення:", "") || "";
      if (!reason.trim()) return;
      await api.rejectConstructivePackage(positionId, packageId, reason.trim());
      toastSuccess("Пакет відхилено");
    }
    closeConstructiveReviewModal();
    const packageDetail = await api.getConstructivePackageLatest(positionId).catch(() => null);
    document.dispatchEvent(
      new CustomEvent("enver:constructive-package-updated", {
        detail: { positionId, packageDetail }
      })
    );
    try {
      const { refreshAppData } = await import("./data-sync.js");
      const { notifyUiChanged } = await import("./ui-persistence.js");
      const { renderApp } = await import("./render.js");
      await refreshAppData({ includeDirectories: false, syncViews: true });
      notifyUiChanged();
      renderApp();
    } catch {
      /* UI оновиться при наступному завантаженні */
    }
  } catch (err) {
    toastError(err.message);
  }
}

function closeConstructiveReviewModal() {
  $("#constructiveReviewModal")?.remove();
}
