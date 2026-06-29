import { constructiveFileDownloadUrl } from "./api.js";
import { STAGES, getStageStatus, stageStatusClass } from "./workflows.js";
import { PIPELINE_STAGES, STAGE_STATUS_DONE } from "@enver/shared/production/stages.js";
import { computeProgress } from "@enver/shared/production/position-logic.js";
import { badge, escapeHtml } from "./utils.js";
import { formatConstructiveSize } from "@enver/shared/production/constructive-files.js";

/** Статична розмітка drawer-оболонки (монтується один раз у DOM). */
export const POSITION_DRAWER_SHELL_HTML = `
    <div class="drawer" role="dialog" aria-labelledby="positionDrawerTitle">
      <div class="drawer-header">
        <div class="drawer-header-main">
          <h2 id="positionDrawerTitle">Редагування позиції</h2>
          <div class="drawer-meta" id="positionDrawerSubtitle"></div>
          <div class="drawer-progress">
            <div class="drawer-progress-label">
              <span>Прогрес виробництва</span>
              <span id="positionDrawerProgressLabel">0%</span>
            </div>
            <div id="positionDrawerProgress"></div>
          </div>
        </div>
        <button type="button" class="modal-close" id="closePositionDrawer" aria-label="Закрити">×</button>
      </div>
      <div class="drawer-body" id="positionDrawerBody"></div>
      <div class="drawer-footer">
        <button type="button" class="btn btn-danger" id="deletePositionBtn" style="margin-right: auto; display: none">Видалити</button>
        <button type="button" class="btn" id="cancelPositionBtn">Закрити</button>
        <button type="submit" form="positionForm" class="btn btn-primary">Зберегти</button>
      </div>
    </div>
  `;

/** Оцінка прогресу позиції за вагами етапів (0–100). */
export function estimatePositionProgress(position) {
  return computeProgress(position);
}

export function renderConstructiveFileList(files, positionId, { editable = false } = {}) {
  if (!files?.length) return "";
  const items = files
    .map(
      (f) => `
    <li class="constructive-file-item">
      <a class="constructive-file-link" href="${constructiveFileDownloadUrl(positionId, f.id)}" download>
        <span class="constructive-file-name">${escapeHtml(f.fileName)}</span>
        <span class="constructive-file-size enver-meta">${escapeHtml(formatConstructiveSize(f.sizeBytes))}</span>
      </a>
      ${
        editable
          ? `<button type="button" class="btn btn-sm btn-danger constructive-file-delete" data-delete-legacy-file="${f.id}" title="Видалити" aria-label="Видалити файл">×</button>`
          : ""
      }
    </li>`
    )
    .join("");
  return `<ul class="constructive-files-list" aria-label="Файли конструктива">${items}</ul>`;
}

/** HTML компактного pipeline у drawer позиції (лише перегляд). */
export function renderPositionPipeline(draft) {
  const currentKey = draft.currentStage || "constructor";
  const currentStage = STAGES.find((s) => s.key === currentKey) || STAGES[0];
  const currentStatus = getStageStatus(draft, currentStage);

  const track = PIPELINE_STAGES.map((stage) => {
    const status = getStageStatus(draft, stage);
    let dotCls = "step-dot";
    if (status === "Проблема") dotCls += " step-dot--problem";
    else if (STAGE_STATUS_DONE.has(status)) dotCls += " step-dot--done";
    else if (stage.key === currentKey) dotCls += " step-dot--current";
    else if (status !== "Не розпочато") dotCls += " step-dot--active";
    return `<span class="${dotCls}" title="${escapeHtml(stage.label)}: ${escapeHtml(status)}" aria-hidden="true"></span>`;
  }).join('<span class="step-line" aria-hidden="true"></span>');

  const statusRows = STAGES.filter((s) => s.field)
    .map((stage) => {
      const status = getStageStatus(draft, stage);
      const cls = stageStatusClass(status);
      return `
        <div class="pipeline-manual-row ${cls}">
          <span class="pipeline-manual-label">${escapeHtml(stage.label)}</span>
          <span>${badge(status)}</span>
        </div>`;
    })
    .join("");

  return `
    <div class="pipeline-compact pipeline-compact--readonly">
      <div class="pipeline-compact-now">
        <span class="pipeline-compact-icon">${currentStage.icon}</span>
        <div class="pipeline-compact-text">
          <strong>${escapeHtml(currentStage.label)}</strong>
          <span>${badge(currentStatus)}</span>
        </div>
      </div>
      <div class="step-track step-track--drawer">${track}</div>
      <div class="pipeline-manual-grid pipeline-manual-grid--readonly">${statusRows}</div>
      <p class="field-hint enver-meta">Зміну етапів робіть на вкладці «Цех зараз» або через наступну дію.</p>
    </div>`;
}
