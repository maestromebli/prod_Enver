/**
 * UI блоку AI-аналізу конструктива в drawer позиції.
 */
import { api } from "./api.js";
import { stageLabel } from "@enver/shared/production/stages.js";
import { escapeHtml } from "./utils.js";

function normalizeSuggestedTasks(result) {
  const raw = result?.suggestedTasks || result?.analysis?.suggestedTasks || [];
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
  if (learningContext.examples?.length) {
    parts.push(
      `<p class="ai-learning-note">✦ Враховано схожі замовлення ENVER (${learningContext.examples.length})</p>`
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

export function renderAiAnalysisResult(result) {
  const quality = result.quality || result.analysis?.quality;
  const meta = result.extractedTextMeta || {};
  const operatorNotes = result.operatorNotes || result.analysis?.operatorNotes || {};
  const tasks = normalizeSuggestedTasks(result).filter((t) => t.needed !== false);
  const missing = result.missingInfo || result.analysis?.missingInfo || [];
  const warnings = result.warnings || result.analysis?.warnings || [];
  const panels = result.panels || result.analysis?.panels || [];
  const materials = result.materials || result.analysis?.materials || [];
  const safe = quality?.safeToCreateTasks === true;
  const ctaLabel = safe ? "Створити рекомендовані задачі" : "Перевірити та створити обрані";

  const panelCards = panels
    .map(
      (p) => `
    <article class="ai-panel-card">
      <strong>${escapeHtml(p.name || "Панель")}</strong>
      <span>${p.qty ? `${p.qty} шт` : ""}</span>
      ${p.size ? `<div>${escapeHtml(p.size)}</div>` : ""}
      ${p.material ? `<div>${escapeHtml(p.material)}</div>` : ""}
      ${p.edge ? `<div>Крайка: ${escapeHtml(p.edge)}</div>` : ""}
      ${p.notes ? `<div class="ai-panel-notes">${escapeHtml(p.notes)}</div>` : ""}
    </article>`
    )
    .join("");

  const taskRows = tasks
    .map((t) => {
      const conf = Math.round((t.confidence ?? 0.6) * 100);
      const checked = (t.confidence ?? 0.6) >= 0.8 && !quality?.needsHumanReview ? "checked" : "";
      const note = operatorNotes[t.stage] || "";
      const status = taskStatusLabel(t, quality);
      return `
      <label class="ai-task-row">
        <input type="checkbox" data-task-stage value="${escapeHtml(t.stage)}" ${checked} />
        <div class="ai-task-body">
          <span class="ai-task-title"><strong>${escapeHtml(stageLabel(t.stage))}</strong> — ${escapeHtml(t.reason || "рекомендовано")}</span>
          <span class="ai-task-meta">Впевненість ${conf}% · ${escapeHtml(status)}</span>
          ${note ? `<span class="ai-task-operator-note">${escapeHtml(note)}</span>` : ""}
        </div>
      </label>`;
    })
    .join("");

  const qualityReasons = (quality?.reasons || []).map((r) => `<li>${escapeHtml(r)}</li>`).join("");

  return `
    <div class="analysis-card" data-analysis-id="${result.id || ""}">
      <header class="ai-analysis-header">
        <p class="ai-analysis-summary"><strong>${escapeHtml(result.summary || result.analysis?.summary || "—")}</strong></p>
        ${qualityBadge(quality)}
      </header>

      <div class="ai-analysis-meta-grid">
        ${result.estimatedComplexity ? `<span>Складність: ${escapeHtml(result.estimatedComplexity)}</span>` : ""}
        ${meta.extractionQuality ? `<span>Файл: ${escapeHtml(meta.sourceType || "—")} · ${escapeHtml(meta.extractionQuality)}</span>` : ""}
        ${result.model ? `<span>Модель: ${escapeHtml(result.model)}</span>` : ""}
        ${result.tokens ? `<span>Токени: ${result.tokens}</span>` : ""}
        ${result.durationMs ? `<span>${result.durationMs} мс</span>` : ""}
      </div>

      ${meta.readPreview ? `<p class="ai-read-preview"><small>Що AI зміг прочитати: ${escapeHtml(meta.readPreview)}</small></p>` : ""}

      ${renderLearningBlock(result.learningContext)}

      ${
        qualityReasons
          ? `<details class="ai-quality-details" open>
        <summary>Потрібна перевірка / якість</summary>
        <ul class="ai-quality-reasons">${qualityReasons}</ul>
      </details>`
          : ""
      }

      ${materials.length ? `<section class="ai-analysis-section"><h4>Матеріали</h4><ul class="ai-materials-list">${materials.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul></section>` : ""}

      ${panels.length ? `<section class="ai-analysis-section"><h4>Панелі</h4><div class="ai-panels-grid">${panelCards}</div></section>` : ""}

      ${warnings.length ? `<section class="ai-analysis-section ai-block-warn"><h4>Попередження</h4><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></section>` : ""}

      ${missing.length ? `<section class="ai-analysis-section ai-block-missing"><h4>Бракує даних</h4><ul>${missing.map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul></section>` : ""}

      ${tasks.length ? `<section class="ai-analysis-section"><h4>Рекомендовані задачі</h4><div class="ai-task-list">${taskRows}</div></section>` : ""}

      <div class="ai-feedback-rating" data-analysis-id="${result.id || ""}">
        <span class="ai-feedback-label">Оцінити аналіз:</span>
        <button type="button" class="btn btn-sm ai-rate-btn" data-rating="good">👍 Правильно</button>
        <button type="button" class="btn btn-sm ai-rate-btn" data-rating="partial">~ Частково</button>
        <button type="button" class="btn btn-sm ai-rate-btn" data-rating="bad">👎 Неправильно</button>
      </div>

      <div class="ai-correction-form" hidden>
        <textarea class="ai-correction-text" rows="2" placeholder="Коментар / корекція для AI…"></textarea>
        <div class="constructive-actions ai-correction-actions">
          <button type="button" class="btn btn-sm btn-primary" id="saveAiCorrectionBtn">Зберегти корекцію</button>
          <button type="button" class="btn btn-sm" id="rememberAiCorrectionBtn">Запамʼятати це виправлення</button>
        </div>
      </div>

      ${
        tasks.length
          ? `<div class="constructive-actions ai-task-actions">
        <button type="button" class="btn btn-sm btn-primary" id="createTasksBtn">${escapeHtml(ctaLabel)}</button>
        <button type="button" class="btn btn-sm" id="createSelectedTasksBtn">Створити тільки обрані</button>
        <button type="button" class="btn btn-sm" id="rejectAiTasksBtn">Відхилити</button>
        <button type="button" class="btn btn-sm" id="repeatAiAnalysisBtn">Повторити аналіз</button>
      </div>`
          : `<div class="constructive-actions">
        <button type="button" class="btn btn-sm" id="repeatAiAnalysisBtn">Повторити аналіз</button>
        <button type="button" class="btn btn-sm" id="rejectAiTasksBtn">Відхилити</button>
      </div>`
      }
    </div>`;
}

/**
 * Прив'язує обробники до блоку аналізу в drawer.
 */
export function bindAiAnalysisEvents(root, { positionId, onTasksCreated, onRepeat, showError }) {
  if (!root) return;

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

  const saveCorrection = async (remember = true) => {
    const analysisId = Number(
      root.dataset.analysisId || root.querySelector("[data-analysis-id]")?.dataset?.analysisId
    );
    if (!analysisId) return;
    const correctionText = root.querySelector(".ai-correction-text")?.value?.trim() || "";
    const stages = [];
    root.querySelectorAll("[data-task-stage]:checked").forEach((cb) => stages.push(cb.value));
    try {
      await api.submitAiFeedback({
        analysisId,
        rating: selectedRating || "partial",
        correctionText,
        correctedTasks: stages,
        rememberCorrection: remember,
        positionId
      });
    } catch (err) {
      showError?.(err.message);
    }
  };

  root.querySelector("#saveAiCorrectionBtn")?.addEventListener("click", () => saveCorrection(true));
  root
    .querySelector("#rememberAiCorrectionBtn")
    ?.addEventListener("click", () => saveCorrection(true));

  const createTasks = async (submitEl) => {
    const stages = [];
    root.querySelectorAll("[data-task-stage]:checked").forEach((cb) => stages.push(cb.value));
    if (!stages.length) {
      showError?.("Оберіть хоча б один етап");
      return;
    }
    await onTasksCreated?.(stages, submitEl);
  };

  root.querySelector("#createTasksBtn")?.addEventListener("click", () => {
    const unchecked = root.querySelectorAll("[data-task-stage]:not(:checked)");
    unchecked.forEach((cb) => {
      cb.checked = true;
    });
    createTasks(root.querySelector("#createTasksBtn"));
  });

  root.querySelector("#createSelectedTasksBtn")?.addEventListener("click", () => {
    createTasks(root.querySelector("#createSelectedTasksBtn"));
  });

  root.querySelector("#rejectAiTasksBtn")?.addEventListener("click", () => {
    root.innerHTML = `<p class="field-hint">Рекомендації AI відхилено.</p>`;
  });

  root.querySelector("#repeatAiAnalysisBtn")?.addEventListener("click", () => {
    onRepeat?.();
  });
}
