import { constructiveFileDownloadUrl } from "./api.js";
import {
  PRODUCTION_PROGRESS_WEIGHTS,
  STAGE_STATUSES,
  STAGES,
  getNextStatus,
  getStageStatus,
  stageStatusClass
} from "./workflows.js";
import { PIPELINE_STAGES, STAGE_STATUS_DONE } from "@enver/shared/production/stages.js";
import { badge, escapeHtml } from "./utils.js";
import { formatConstructiveSize } from "@enver/shared/production/constructive-files.js";

/** Статична розмітка drawer-оболонки (монтується один раз у DOM). */
export const POSITION_DRAWER_SHELL_HTML = `
    <div class="drawer" role="dialog" aria-labelledby="positionDrawerTitle">
      <div class="drawer-header">
        <div class="drawer-header-main">
          <h2 id="positionDrawerTitle">Позиція</h2>
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
  let weighted = 0;
  for (const stage of STAGES) {
    if (!Object.hasOwn(PRODUCTION_PROGRESS_WEIGHTS, stage.key)) continue;
    const w = PRODUCTION_PROGRESS_WEIGHTS[stage.key];
    const st = getStageStatus(position, stage);
    let score = 0;
    if (st === "Готово" || st === "Не потрібно") score = 100;
    else if (st === "В роботі") score = 65;
    else if (st === "Передано") score = 35;
    weighted += w * score;
  }
  return Math.round(weighted / 100);
}

export function renderConstructiveFileList(files, positionId) {
  if (!files?.length) return "";
  const items = files
    .map(
      (f) => `
    <li class="constructive-file-item">
      <a class="constructive-file-link" href="${constructiveFileDownloadUrl(positionId, f.id)}" download>
        <span class="constructive-file-name">${escapeHtml(f.fileName)}</span>
        <span class="constructive-file-size enver-meta">${escapeHtml(formatConstructiveSize(f.sizeBytes))}</span>
      </a>
    </li>`
    )
    .join("");
  return `<ul class="constructive-files-list" aria-label="Файли конструктива">${items}</ul>`;
}

/** HTML компактного pipeline у drawer позиції. */
export function renderPositionPipeline(draft) {
  const currentKey = draft.currentStage || "constructor";
  const currentStage = STAGES.find((s) => s.key === currentKey) || STAGES[0];
  const currentStatus = getStageStatus(draft, currentStage);
  const next = getNextStatus(currentStatus);
  const canAdvance = currentStatus !== "Готово" && currentStatus !== "Не потрібно";

  const track = PIPELINE_STAGES.map((stage) => {
    const status = getStageStatus(draft, stage);
    let dotCls = "step-dot";
    if (status === "Проблема") dotCls += " step-dot--problem";
    else if (STAGE_STATUS_DONE.has(status)) dotCls += " step-dot--done";
    else if (stage.key === currentKey) dotCls += " step-dot--current";
    else if (status !== "Не розпочато") dotCls += " step-dot--active";
    return `<button type="button" class="${dotCls}" data-pipeline-jump="${stage.key}" title="${escapeHtml(stage.label)}: ${escapeHtml(status)}"></button>`;
  }).join('<span class="step-line" aria-hidden="true"></span>');

  const manualSteps = STAGES.filter((s) => s.field)
    .map((stage) => {
      const status = getStageStatus(draft, stage);
      const cls = stageStatusClass(status);
      return `
        <div class="pipeline-manual-row ${cls}">
          <span class="pipeline-manual-label">${escapeHtml(stage.label)}</span>
          <select class="pipeline-select" data-pipeline-status="${stage.key}" aria-label="${escapeHtml(stage.label)}">
            ${STAGE_STATUSES.map(
              (s) =>
                `<option value="${escapeHtml(s)}" ${s === status ? "selected" : ""}>${escapeHtml(s)}</option>`
            ).join("")}
          </select>
        </div>`;
    })
    .join("");

  return `
    <div class="pipeline-compact">
      <div class="pipeline-compact-now">
        <span class="pipeline-compact-icon">${currentStage.icon}</span>
        <div class="pipeline-compact-text">
          <strong>${escapeHtml(currentStage.label)}</strong>
          <span>${badge(currentStatus)}</span>
        </div>
        ${
          canAdvance
            ? `<button type="button" class="btn btn-primary btn-sm" data-pipeline-advance="${currentStage.key}" data-next="${escapeHtml(next)}">Далі → ${escapeHtml(next)}</button>`
            : ""
        }
      </div>
      <div class="step-track step-track--drawer">${track}</div>
      <details class="pipeline-manual">
        <summary>Змінити етап вручну</summary>
        <div class="pipeline-manual-grid">${manualSteps}</div>
      </details>
    </div>`;
}
