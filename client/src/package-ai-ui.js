/**
 * UI блоку ШІ-аналізу пакета конструктива.
 */
import { escapeHtml } from "./utils.js";
import {
  FURNITURE_TYPE_LABELS,
  LABOR_STAGE_LABELS,
  formatLaborHours
} from "@enver/shared/production/package-ai.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { api } from "./api.js";

function resolveAiRecord(aiRecord) {
  if (!aiRecord) return null;
  if (aiRecord.status === "pending") return { pending: true };
  if (aiRecord.status === "error") {
    return { error: aiRecord.errorMessage || "Помилка ШІ-аналізу" };
  }
  if (aiRecord.status === "skipped") {
    return { skipped: true, message: aiRecord.analysis?.message || "ШІ вимкнено" };
  }

  const payload = aiRecord.analysis?.analysis ? aiRecord.analysis : { analysis: aiRecord.analysis };
  const analysis = payload.analysis || aiRecord.analysis || null;
  if (!analysis || typeof analysis !== "object") return null;

  return {
    analysis,
    analysisId: aiRecord.id,
    learningContext: payload.learningContext || aiRecord.learningContext || null,
    sourceMeta: payload.sourceMeta || aiRecord.sourceMeta || null
  };
}

function normalizeSuggestedTasks(analysis) {
  const raw = analysis?.suggestedTasks || [];
  return raw.map((t) => {
    if (typeof t === "string") {
      const map = {
        порізка: "cutting",
        крайкування: "edging",
        кромкування: "edging",
        присадка: "drilling",
        збірка: "assembly"
      };
      return { stage: map[t.toLowerCase()] || t, needed: true, reason: "", confidence: 0.7 };
    }
    return t;
  });
}

function qualityBadge(quality) {
  if (!quality) return "";
  const score = Math.round((quality.score ?? 0) * 100);
  const cls = quality.safeToCreateTasks
    ? "ai-quality--good"
    : quality.needsHumanReview
      ? "ai-quality--review"
      : "ai-quality--mid";
  return `<span class="ai-quality-badge ${cls}">Якість ${score}%</span>`;
}

function taskStatusLabel(t, quality) {
  const conf = t.confidence ?? 0.6;
  if (conf < 0.65) return "низька впевненість";
  if (quality?.needsHumanReview) return "перевірити вручну";
  if (conf >= 0.8) return "можна створити";
  return "перевірити вручну";
}

function renderLearningBlock(learningContext) {
  if (!learningContext) return "";
  const parts = [];
  const examplesCount = learningContext.examplesCount ?? learningContext.examples?.length ?? 0;
  if (examplesCount > 0) {
    parts.push(
      `<p class="ai-learning-note">✦ Враховано схожі замовлення ENVER (${examplesCount})</p>`
    );
  }
  if (learningContext.rules?.length) {
    for (const r of learningContext.rules.slice(0, 3)) {
      parts.push(
        `<p class="ai-learning-note">📋 Застосовано правило ENVER: ${escapeHtml(r.title || r.rule_text || "")}</p>`
      );
    }
  }
  if (learningContext.frequentMistakeCount >= 2) {
    parts.push(
      `<p class="ai-learning-note ai-learning-note--warn">⚠ У схожих випадках AI часто помилявся — потрібна перевірка</p>`
    );
  }
  return parts.length ? `<div class="ai-learning-block">${parts.join("")}</div>` : "";
}

function renderReadinessBlock(analysis) {
  const model = analysis.modelReadiness;
  const cnc = analysis.cncReadiness;
  if (!model && !cnc) return "";
  const lines = [];
  if (model) {
    lines.push(
      `3D: ${model.has3dSource ? "є джерело" : "немає"} · мапінг ${model.mappedPartsCount ?? 0} дет.`
    );
    if (model.needsGlbExport) lines.push("потрібен GLB для перегляду");
    if (model.unmappedParts?.length) {
      lines.push(`без 3D: ${model.unmappedParts.slice(0, 4).join(", ")}`);
    }
  }
  if (cnc) {
    lines.push(`ЧПК: ${cnc.ready ? "готово" : "не готово"}`);
    for (const w of (cnc.warnings || []).slice(0, 2)) lines.push(w);
  }
  return `<p class="enver-meta package-ai-readiness">${escapeHtml(lines.join(" · "))}</p>`;
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

function renderTasksBlock(analysis, quality) {
  const tasks = normalizeSuggestedTasks(analysis).filter((t) => t.needed !== false);
  if (!tasks.length) return "";
  const safe = quality?.safeToCreateTasks === true;
  const ctaLabel = safe ? "Створити рекомендовані задачі" : "Перевірити та створити обрані";
  const rows = tasks
    .map((t) => {
      const conf = Math.round((t.confidence ?? 0.6) * 100);
      const checked = (t.confidence ?? 0.6) >= 0.8 && !quality?.needsHumanReview ? "checked" : "";
      const status = taskStatusLabel(t, quality);
      return `
      <label class="ai-task-row">
        <input type="checkbox" data-task-stage value="${escapeHtml(t.stage)}" ${checked} />
        <div class="ai-task-body">
          <span class="ai-task-title"><strong>${escapeHtml(stageLabel(t.stage))}</strong> — ${escapeHtml(t.reason || "рекомендовано")}</span>
          <span class="ai-task-meta">Впевненість ${conf}% · ${escapeHtml(status)}</span>
        </div>
      </label>`;
    })
    .join("");

  return `
    <section class="ai-analysis-section">
      <h4>Рекомендовані задачі</h4>
      <div class="ai-task-list">${rows}</div>
      <div class="constructive-actions ai-task-actions">
        <button type="button" class="btn btn-sm btn-primary" data-package-create-tasks>${escapeHtml(ctaLabel)}</button>
        <button type="button" class="btn btn-sm" data-package-create-selected>Створити тільки обрані</button>
      </div>
    </section>`;
}

export function renderPackageAiResult(aiRecord) {
  const resolved = resolveAiRecord(aiRecord);
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

  const analysis = resolved.analysis;
  const quality = analysis.quality;
  const sourceMeta = resolved.sourceMeta;
  const furnitureLabel =
    analysis.furnitureTypeLabel ||
    FURNITURE_TYPE_LABELS[analysis.furnitureType] ||
    FURNITURE_TYPE_LABELS.other;
  const warnings = (analysis.warnings || []).map((w) => `<li>${escapeHtml(w)}</li>`).join("");
  const checklist = (analysis.reviewChecklist || [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");
  const actions = (analysis.suggestedActions || [])
    .map((w) => `<li>${escapeHtml(w)}</li>`)
    .join("");
  const qualityReasons = (quality?.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");

  return `
    <article class="package-ai-card" data-package-analysis-id="${resolved.analysisId || ""}">
      <header class="package-ai-header">
        <span class="enver-badge">${escapeHtml(furnitureLabel)}</span>
        ${
          analysis.estimatedComplexity
            ? `<span class="enver-badge enver-badge-info">Складність: ${escapeHtml(analysis.estimatedComplexity)}</span>`
            : ""
        }
        ${qualityBadge(quality)}
      </header>
      ${analysis.summary ? `<p class="package-ai-summary">${escapeHtml(analysis.summary)}</p>` : ""}

      ${
        sourceMeta
          ? `<p class="enver-meta">Джерела: ${escapeHtml(sourceMeta.sourceType || "package")} · ${escapeHtml(sourceMeta.extractionQuality || "—")} · ${sourceMeta.partsCount ?? "—"} дет.${sourceMeta.visionPageCount ? ` · Vision ${sourceMeta.visionPageCount} стор.` : ""}</p>`
          : ""
      }

      ${renderReadinessBlock(analysis)}
      ${renderLearningBlock(resolved.learningContext)}
      ${renderHardwareBlock(analysis)}
      ${renderLaborBlock(analysis.estimatedLabor)}

      ${
        qualityReasons
          ? `<details class="ai-quality-details" open>
        <summary>Якість / перевірка</summary>
        <ul class="ai-quality-reasons">${qualityReasons}</ul>
      </details>`
          : ""
      }

      ${checklist ? `<div><h4>Чекліст</h4><ul class="package-ai-list">${checklist}</ul></div>` : ""}
      ${warnings ? `<div><h4>Попередження</h4><ul class="package-ai-warnings">${warnings}</ul></div>` : ""}
      ${actions ? `<div><h4>Рекомендації</h4><ul class="package-ai-list">${actions}</ul></div>` : ""}

      ${renderTasksBlock(analysis, quality)}

      <div class="ai-feedback-rating" data-package-analysis-id="${resolved.analysisId || ""}">
        <span class="ai-feedback-label">Оцінити аналіз:</span>
        <button type="button" class="btn btn-sm ai-rate-btn" data-rating="good">👍 Правильно</button>
        <button type="button" class="btn btn-sm ai-rate-btn" data-rating="partial">~ Частково</button>
        <button type="button" class="btn btn-sm ai-rate-btn" data-rating="bad">👎 Неправильно</button>
      </div>
      <div class="ai-correction-form" hidden>
        <textarea class="ai-correction-text" rows="2" placeholder="Коментар / корекція для AI…"></textarea>
        <button type="button" class="btn btn-sm btn-primary" data-package-save-feedback>Зберегти корекцію</button>
      </div>
    </article>`;
}

const pollTimers = new Map();

export function bindPackageAiEvents(root, { positionId, onTasksCreated, showError } = {}) {
  if (!root || !positionId) return;

  let selectedRating = "";

  root.querySelectorAll(".ai-rate-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      selectedRating = btn.dataset.rating || "";
      root.querySelectorAll(".ai-rate-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const form = root.querySelector(".ai-correction-form");
      if (form) form.hidden = false;
    });
  });

  root.querySelector("[data-package-save-feedback]")?.addEventListener("click", async () => {
    const analysisId = Number(
      root.querySelector("[data-package-analysis-id]")?.dataset?.packageAnalysisId
    );
    if (!analysisId) return;
    const correctionText = root.querySelector(".ai-correction-text")?.value?.trim() || "";
    const stages = [];
    root.querySelectorAll("[data-task-stage]:checked").forEach((cb) => stages.push(cb.value));
    try {
      await api.submitPackageAiFeedback({
        analysisId,
        rating: selectedRating || "partial",
        correctionText,
        correctedTasks: stages,
        positionId
      });
    } catch (err) {
      showError?.(err.message);
    }
  });

  const createTasks = async () => {
    const stages = [];
    root.querySelectorAll("[data-task-stage]:checked").forEach((cb) => stages.push(cb.value));
    if (!stages.length) {
      showError?.("Оберіть хоча б один етап");
      return;
    }
    try {
      await api.createTasksFromAi(positionId, { stages, mode: "assisted" });
      await onTasksCreated?.(stages);
    } catch (err) {
      showError?.(err.message);
    }
  };

  root.querySelector("[data-package-create-tasks]")?.addEventListener("click", () => {
    root.querySelectorAll("[data-task-stage]").forEach((cb) => {
      cb.checked = true;
    });
    createTasks();
  });
  root.querySelector("[data-package-create-selected]")?.addEventListener("click", createTasks);
}

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

export function mountPackageAiBlock(
  container,
  aiRecord,
  { showRerun = false, onRerun, positionId, onTasksCreated, showError } = {}
) {
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
  const body = container.querySelector("[data-package-ai-body]");
  bindPackageAiEvents(body, { positionId, onTasksCreated, showError });
}
