/**
 * UI блоку ШІ-аналізу пакета конструктива.
 */
import { escapeHtml } from "./utils.js";
import {
  FURNITURE_TYPE_LABELS,
  LABOR_STAGE_LABELS,
  formatLaborHours
} from "@enver/shared/production/package-ai.js";
import { api } from "./api.js";

function resolveAnalysis(aiRecord) {
  if (!aiRecord) return null;
  if (aiRecord.status === "pending") return { pending: true };
  if (aiRecord.status === "error") {
    return { error: aiRecord.errorMessage || "Помилка ШІ-аналізу" };
  }
  if (aiRecord.status === "skipped") {
    return { skipped: true, message: aiRecord.analysis?.message || "ШІ вимкнено" };
  }
  return aiRecord.analysis?.analysis || aiRecord.analysis || null;
}

function renderLaborBlock(labor) {
  if (!labor) return "";
  const stageRows = ["constructor", "cutting", "edging", "drilling", "assembly"]
    .map((stage) => {
      const label = LABOR_STAGE_LABELS[stage] || stage;
      const value =
        stage === "constructor"
          ? formatLaborHours(labor.constructorHours)
          : formatLaborHours((labor.stages?.[stage]?.minutes || 0) / 60);
      return `<li><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></li>`;
    })
    .join("");

  const conf = Math.round((labor.confidence ?? 0.6) * 100);
  return `
    <div class="package-ai-labor">
      <h4>Орієнтовний час</h4>
      <p class="package-ai-total">Разом: <strong>${escapeHtml(formatLaborHours(labor.totalHours))}</strong>
        <span class="enver-meta"> · впевненість ${conf}%</span></p>
      <ul class="package-ai-labor-grid">${stageRows}</ul>
      ${labor.basis ? `<p class="enver-meta package-ai-basis">${escapeHtml(labor.basis)}</p>` : ""}
    </div>`;
}

function renderHardwareBlock(analysis) {
  const summary = analysis.hardwareSummary;
  const items = analysis.detectedHardware || [];
  if (!summary && !items.length) return "";

  const list = items
    .slice(0, 12)
    .map(
      (h) =>
        `<li>${escapeHtml(h.name)}${h.qty ? ` · ${escapeHtml(h.qty)}` : ""}${h.notes ? ` <span class="enver-meta">${escapeHtml(h.notes)}</span>` : ""}</li>`
    )
    .join("");

  return `
    <div class="package-ai-hardware">
      <h4>Фурнітура</h4>
      ${summary ? `<p>${escapeHtml(summary)}</p>` : ""}
      ${list ? `<ul class="package-ai-list">${list}</ul>` : ""}
    </div>`;
}

export function renderPackageAiResult(aiRecord) {
  const resolved = resolveAnalysis(aiRecord);
  if (!resolved) {
    return `<p class="enver-meta">ШІ-аналіз ще не запускався. Він стартує автоматично після розбору пакета.</p>`;
  }
  if (resolved.pending) {
    return `<div class="package-ai-pending" aria-busy="true">
      <div class="enver-skeleton" style="height:14px;width:60%;margin-bottom:8px"></div>
      <div class="enver-skeleton enver-skeleton-card" style="height:72px"></div>
      <p class="enver-meta">ШІ аналізує пакет…</p>
    </div>`;
  }
  if (resolved.error) {
    return `<p class="form-error visible">${escapeHtml(resolved.error)}</p>`;
  }
  if (resolved.skipped) {
    return `<p class="enver-meta">${escapeHtml(resolved.message)}</p>`;
  }

  const furnitureLabel =
    resolved.furnitureTypeLabel ||
    FURNITURE_TYPE_LABELS[resolved.furnitureType] ||
    FURNITURE_TYPE_LABELS.other;
  const warnings = (resolved.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");
  const checklist = (resolved.reviewChecklist || [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");
  const actions = (resolved.suggestedActions || [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");

  return `
    <article class="package-ai-card">
      <header class="package-ai-header">
        <span class="enver-badge">${escapeHtml(furnitureLabel)}</span>
        ${
          resolved.estimatedComplexity
            ? `<span class="enver-badge enver-badge-info">Складність: ${escapeHtml(resolved.estimatedComplexity)}</span>`
            : ""
        }
      </header>
      ${resolved.summary ? `<p class="package-ai-summary">${escapeHtml(resolved.summary)}</p>` : ""}
      ${renderHardwareBlock(resolved)}
      ${renderLaborBlock(resolved.estimatedLabor)}
      ${checklist ? `<div><h4>Чекліст</h4><ul class="package-ai-list">${checklist}</ul></div>` : ""}
      ${warnings ? `<div><h4>Попередження</h4><ul class="package-ai-warnings">${warnings}</ul></div>` : ""}
      ${actions ? `<div><h4>Рекомендації</h4><ul class="package-ai-list">${actions}</ul></div>` : ""}
    </article>`;
}

const pollTimers = new Map();

/** Опитування поки ШІ-аналіз у статусі pending. */
export function pollPackageAiAnalysis(
  positionId,
  { onUpdate, intervalMs = 3000, maxAttempts = 40 } = {}
) {
  const key = Number(positionId);
  if (pollTimers.has(key)) {
    clearInterval(pollTimers.get(key).timer);
    pollTimers.delete(key);
  }

  let attempts = 0;
  const timer = setInterval(async () => {
    attempts += 1;
    try {
      const detail = await api.getConstructivePackageLatest(positionId);
      const ai = detail?.aiAnalysis;
      onUpdate?.(detail, ai);
      if (!ai || ai.status !== "pending" || attempts >= maxAttempts) {
        clearInterval(timer);
        pollTimers.delete(key);
      }
    } catch {
      if (attempts >= maxAttempts) {
        clearInterval(timer);
        pollTimers.delete(key);
      }
    }
  }, intervalMs);

  pollTimers.set(key, { timer });
  return () => {
    clearInterval(timer);
    pollTimers.delete(key);
  };
}

export function mountPackageAiBlock(container, aiRecord, { showRerun = false, onRerun } = {}) {
  if (!container) return;
  container.hidden = false;
  container.innerHTML = `
    <section class="package-ai-block">
      <div class="package-ai-block-head">
        <h4 class="enver-section-title">ШІ-аналіз пакета</h4>
        ${
          showRerun
            ? `<button type="button" class="btn btn-sm" data-package-ai-rerun>Перезапустити</button>`
            : ""
        }
      </div>
      <div data-package-ai-body>${renderPackageAiResult(aiRecord)}</div>
    </section>`;

  container.querySelector("[data-package-ai-rerun]")?.addEventListener("click", () => onRerun?.());
}
