import { api } from "./api.js";
import { renderAiAnalysisResult, bindAiAnalysisEvents } from "./ai-analysis-ui.js";
import { escapeHtml } from "./utils.js";
import { runSave } from "./save-flow.js";

/** Блок ШІ-аналізу legacy-файлу конструктива (картка замовлення). */
export function renderLegacyAiBlock(position) {
  const hasFiles = position?.hasConstructiveFile;
  return `
    <section class="legacy-ai-block" data-legacy-ai="${position.id}">
      <button type="button" class="btn btn-sm btn-primary" data-legacy-analyze-btn ${hasFiles ? "" : "disabled"}>
        Запустити ШІ-аналіз
      </button>
      <div class="constructive-analysis" data-legacy-analysis></div>
    </section>`;
}

export function bindLegacyAiBlock(root, position, { onUpdated, showError } = {}) {
  if (!root || !position?.id) return;

  const block = root.querySelector(`[data-legacy-ai="${position.id}"]`) || root;
  const analyzeBtn = block.querySelector("[data-legacy-analyze-btn]");
  const box = block.querySelector("[data-legacy-analysis]");
  if (!analyzeBtn || !box) return;

  const runAnalysis = async () => {
    box.innerHTML = `
      <div class="ai-skeleton" aria-busy="true">
        <div class="enver-skeleton" style="height:16px;width:70%;margin-bottom:10px"></div>
        <div class="enver-skeleton enver-skeleton-card" style="height:88px"></div>
      </div>`;
    try {
      const result = await runSave("ШІ-аналіз", {
        submitEl: analyzeBtn,
        saveFn: () => api.analyzeConstructive(position.id),
        successMessage: "Аналіз завершено"
      });
      box.innerHTML = renderAiAnalysisResult(result);
      bindAiAnalysisEvents(box, {
        positionId: position.id,
        showError,
        onRepeat: runAnalysis,
        onTasksCreated: async (stages, submitEl) => {
          await runSave("Задачі", {
            submitEl,
            saveFn: () => api.createProductionTasks(position.id, stages),
            successMessage: "Виробничі задачі створено",
            onSuccess: () => onUpdated?.(),
            onError: (err) => showError?.(err.message)
          }).catch(() => {});
        }
      });
    } catch (err) {
      box.innerHTML = `<p class="form-error visible">${escapeHtml(err.message)}</p>`;
    }
  };

  analyzeBtn.addEventListener("click", runAnalysis);
}
