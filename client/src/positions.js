import { api, constructiveFileDownloadUrl, getPartLabelsUrl } from "./api.js";
import { runSave } from "./save-flow.js";
import { loadPositionHistory, renderDrawerHistory } from "./history.js";
import { expandPosition, getParentPosition } from "./position-tree.js";
import { state } from "./state.js";
import {
  POSITION_STATUSES,
  PRODUCTION_PROGRESS_WEIGHTS,
  STAGE_STATUSES,
  STAGES,
  getNextStatus,
  getStageStatus,
  stageStatusClass
} from "./workflows.js";
import { PIPELINE_STAGES, STAGE_STATUS_DONE } from "@enver/shared/production/stages.js";
import {
  CONSTRUCTORS_DIRECTORY_KEY,
  getDirectoryList
} from "@enver/shared/production/directories.js";
import { renderNextActionBanner, resolvePositionGodmode } from "./godmode-ui.js";
import { $, badge, escapeHtml, fillSelect, progressBar, showFormError } from "./utils.js";
import { canManageProcurement, canReviewConstructive } from "./auth.js";
import {
  loadCncJobsSummary,
  loadProcurementSummary,
  renderConstructivePipelinePanel
} from "./constructive-pipeline-panel.js";
import { openModelMappingModal } from "./model-mapping-ui.js";
import { openConstructiveReviewModal } from "./constructive-review-ui.js";
import {
  bindConstructivePackageBlock,
  loadConstructivePackageDetail,
  renderConstructivePackageBlock
} from "./constructive-package-ui.js";
import { bindLegacyAiBlock, renderLegacyAiBlock } from "./position-legacy-ai.js";

import { formatConstructiveSize } from "@enver/shared/production/constructive-files.js";

let onSaved = () => {};
let draft = null;
let activePanel = "general";
let constructiveFiles = [];
let constructivePackageDetail = null;
let procurementSummary = null;
let cncJobsSummary = [];

export function setPositionSaveHandler(handler) {
  onSaved = handler;
}

async function refreshConstructiveFiles() {
  if (!draft?.id) {
    constructiveFiles = [];
    constructivePackageDetail = null;
    return;
  }
  try {
    constructiveFiles = (await api.getConstructiveFiles(draft.id)) || [];
    constructivePackageDetail = await loadConstructivePackageDetail(draft.id);
  } catch {
    constructiveFiles = [];
    constructivePackageDetail = null;
  }
}

function renderConstructiveFileList(positionId) {
  if (!constructiveFiles.length) return "";
  const items = constructiveFiles
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

function backdrop() {
  return $("#positionDrawer");
}

function showError(message) {
  showFormError("#positionFormError", message);
}

function listOptions(key) {
  const items = getDirectoryList(state.directories, key);
  if (items.length) return items;
  if (key === CONSTRUCTORS_DIRECTORY_KEY) {
    return (state.constructorDesk.constructors || []).map((c) => c.name).filter(Boolean);
  }
  return [];
}

async function ensureDirectoryLists() {
  const keys = [CONSTRUCTORS_DIRECTORY_KEY, "Збирачі", "Монтажники"];
  if (keys.some((k) => !getDirectoryList(state.directories, k).length)) {
    try {
      state.directories = await api.getDirectories();
    } catch {
      /* datalist лишиться порожнім */
    }
  }
}

function applyOrderDefaults(orderNumber) {
  const order = state.orders.find((o) => o.orderNumber === orderNumber);
  if (!order) return;
  draft.orderId = order.id;
  draft.orderNumber = order.orderNumber;
  draft.object = order.object;
  if (!draft.manager) draft.manager = order.manager;
}

function renderPipeline() {
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

function renderDrawerContent() {
  const p = draft;
  const godmodeBanner =
    p.id && !p.parentId
      ? renderNextActionBanner(resolvePositionGodmode(p), { positionId: p.id, showCta: true })
      : "";
  const orderOptions = state.orders
    .map(
      (o) =>
        `<option value="${escapeHtml(o.orderNumber)}">${escapeHtml(o.orderNumber)} — ${escapeHtml(o.object)}</option>`
    )
    .join("");

  $("#positionDrawerBody").innerHTML = `
    <p class="form-error" id="positionFormError"></p>
    ${godmodeBanner}

    <div class="drawer-section drawer-section--pipeline">
      <div class="pipeline" id="positionPipeline">${renderPipeline()}</div>
    </div>

    <div class="drawer-tabs">
      <button type="button" class="drawer-tab ${activePanel === "general" ? "active" : ""}" data-panel="general">Основне</button>
      <button type="button" class="drawer-tab ${activePanel === "constructive" ? "active" : ""}" data-panel="constructive">Конструктив / ЧПК</button>
      <button type="button" class="drawer-tab ${activePanel === "install" ? "active" : ""}" data-panel="install">Монтаж</button>
      <button type="button" class="drawer-tab ${activePanel === "more" ? "active" : ""}" data-panel="more">Ще</button>
    </div>

    <form id="positionForm">
      <input type="hidden" id="positionId" value="${p.id ?? ""}" />

      <div class="drawer-panel ${activePanel === "general" ? "active" : ""}" data-panel="general">
        ${
          p.parentId
            ? `<p class="drawer-parent-note">Підпозиція в межах: <strong>${escapeHtml(draft._parentItem || "—")}</strong> (замовлення ${escapeHtml(p.orderNumber)})</p>`
            : ""
        }
        <div class="form-grid">
          <div class="form-field span-2">
            <label for="posItem">${p.parentId ? "Назва зони *" : "Виріб / зона *"}</label>
            <input id="posItem" value="${escapeHtml(p.item)}" required />
          </div>
          ${
            p.parentId
              ? ""
              : `<div class="form-field span-2">
            <label for="posOrderNumber">Замовлення *</label>
            <select id="posOrderNumber" required>
              <option value="">— оберіть —</option>
              ${orderOptions}
              ${p.orderNumber && !state.orders.some((o) => o.orderNumber === p.orderNumber) ? `<option value="${escapeHtml(p.orderNumber)}" selected>${escapeHtml(p.orderNumber)}</option>` : ""}
            </select>
          </div>`
          }
          <div class="form-field">
            <label for="posConstructor">Конструктор</label>
            <input id="posConstructor" list="constructorsList" value="${escapeHtml(p.constructor)}" />
            <datalist id="constructorsList"></datalist>
          </div>
          <div class="form-field">
            <label for="posAssembler">Збирач</label>
            <input id="posAssembler" list="assemblersList" value="${escapeHtml(p.assemblyResponsible)}" />
            <datalist id="assemblersList"></datalist>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "constructive" ? "active" : ""}" data-panel="constructive">
        <div id="constructivePipelineMount">${renderConstructivePipelinePanel(constructivePackageDetail, procurementSummary, pipelinePanelOptions())}</div>
        <div id="constructivePackageMount">${renderConstructivePackageBlock(p, constructivePackageDetail, { editable: true, fileListHtml: renderConstructiveFileList(p.id) })}</div>
        ${renderLegacyAiBlock(p)}
      </div>

      <div class="drawer-panel ${activePanel === "install" ? "active" : ""}" data-panel="install">
        <p class="drawer-section-title">Період монтажу</p>
        <div class="form-grid install-period-grid">
          <div class="form-field">
            <label for="posInstallDate">з</label>
            <input id="posInstallDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.installDate)}" />
          </div>
          <div class="form-field">
            <label for="posInstallEndDate">по</label>
            <input id="posInstallEndDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.installEndDate || p.installDate || "")}" />
          </div>
          <div class="form-field span-2">
            <label for="posInstaller">Монтажник</label>
            <input id="posInstaller" list="installersList" value="${escapeHtml(p.installResponsible)}" />
            <datalist id="installersList"></datalist>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "more" ? "active" : ""}" data-panel="more">
        <div class="form-grid">
          <div class="form-field span-2">
            <label for="posProblem">Проблема</label>
            <textarea id="posProblem" rows="2">${escapeHtml(p.problem)}</textarea>
          </div>
          <div class="form-field span-2">
            <label for="posNote">Примітка</label>
            <textarea id="posNote" rows="2">${escapeHtml(p.note)}</textarea>
          </div>
          <div class="form-field">
            <label for="posReadyDate">Дата готовності</label>
            <input id="posReadyDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.readyDate)}" />
          </div>
          <div class="form-field">
            <label for="posPositionStatus">Статус</label>
            <select id="posPositionStatus"></select>
          </div>
        </div>
        <div id="positionHistoryPanel" class="position-history-panel" style="margin-top:14px">
          <p class="history-muted">Завантаження історії…</p>
        </div>
      </div>
    </form>
  `;

  fillSelect($("#posPositionStatus"), POSITION_STATUSES, p.positionStatus);
  if (p.orderNumber && $("#posOrderNumber")) $("#posOrderNumber").value = p.orderNumber;

  void ensureDirectoryLists().then(() => {
    $("#constructorsList").innerHTML = listOptions("Конструктори")
      .map((x) => `<option value="${escapeHtml(x)}"></option>`)
      .join("");
    $("#assemblersList").innerHTML = listOptions("Збирачі")
      .map((x) => `<option value="${escapeHtml(x)}"></option>`)
      .join("");
    $("#installersList").innerHTML = listOptions("Монтажники")
      .map((x) => `<option value="${escapeHtml(x)}"></option>`)
      .join("");
  });

  bindDrawerEvents();
  if (activePanel === "more") refreshDrawerHistory();
}

async function refreshDrawerHistory() {
  const el = $("#positionHistoryPanel");
  if (!el) return;
  if (!draft?.id) {
    el.innerHTML = '<p class="note">Збережіть позицію, щоб переглядати історію змін.</p>';
    return;
  }
  el.innerHTML = '<p class="history-muted">Завантаження…</p>';
  try {
    const entries = await loadPositionHistory(draft.id);
    el.innerHTML = renderDrawerHistory(entries);
  } catch (err) {
    el.innerHTML = `<p class="form-error visible">${escapeHtml(err.message)}</p>`;
  }
}

function updateHeader() {
  const kind = draft.parentId ? "Підпозиція" : "Позиція";
  $("#positionDrawerTitle").textContent =
    draft.item || (draft.parentId ? "Нова підпозиція" : "Нова позиція");
  $("#positionDrawerSubtitle").innerHTML = `
    <span class="meta-pill">${kind}</span>
    <span class="meta-pill">#${draft.id || "нова"}</span>
    <span class="meta-pill">${escapeHtml(draft.orderNumber || "—")}</span>
    ${badge(draft.positionStatus || "Не розпочато")}
  `;
  $("#positionDrawerProgress").innerHTML = progressBar(draft.progress ?? 0);
  $("#positionDrawerProgressLabel").textContent = `${draft.progress ?? 0}% готово`;
}

function pipelineStatus(key, field) {
  const sel = document.querySelector(`.pipeline-select[data-pipeline-status="${key}"]`);
  return sel?.value ?? draft[field] ?? "Не розпочато";
}

function readForm() {
  const orderNumber = draft.parentId
    ? draft.orderNumber
    : $("#posOrderNumber")?.value.trim() || draft.orderNumber;
  const order = state.orders.find((o) => o.orderNumber === orderNumber);
  return {
    parentId: draft.parentId ?? null,
    orderId: order?.id ?? draft.orderId ?? null,
    orderNumber,
    object: draft.object || order?.object || "",
    item: $("#posItem").value.trim(),
    itemType: draft.itemType || "Зона",
    manager: draft.manager || order?.manager || "",
    constructor: $("#posConstructor")?.value.trim() ?? "",
    cuttingStatus: pipelineStatus("cutting", "cuttingStatus"),
    edgingStatus: pipelineStatus("edging", "edgingStatus"),
    drillingStatus: pipelineStatus("drilling", "drillingStatus"),
    assemblyStatus: pipelineStatus("assembly", "assemblyStatus"),
    packagingStatus: pipelineStatus("packaging", "packagingStatus"),
    assemblyResponsible: $("#posAssembler")?.value.trim() ?? "",
    readyDate: $("#posReadyDate")?.value.trim() ?? "",
    installDate: $("#posInstallDate")?.value.trim() ?? "",
    installEndDate: $("#posInstallEndDate")?.value.trim() ?? "",
    installTimeStart: "",
    installTimeEnd: "",
    installResponsible: $("#posInstaller")?.value.trim() ?? "",
    positionStatus: $("#posPositionStatus")?.value ?? draft.positionStatus,
    overdueDays: Number(draft.overdueDays) || 0,
    problem: $("#posProblem")?.value.trim() ?? "",
    note: $("#posNote")?.value.trim() ?? ""
  };
}

function syncDraftFromForm() {
  Object.assign(draft, readForm());
  draft.progress = estimateProgress(draft);
}

function estimateProgress(p) {
  let weighted = 0;
  for (const stage of STAGES) {
    const w = PRODUCTION_PROGRESS_WEIGHTS[stage.key];
    if (!w) continue;
    const st = getStageStatus(p, stage);
    let score = 0;
    if (st === "Готово" || st === "Не потрібно") score = 100;
    else if (st === "В роботі") score = 65;
    else if (st === "Передано") score = 35;
    weighted += w * score;
  }
  return Math.round(weighted / 100);
}

async function patchStage(stageKey, payload) {
  if (!draft.id) {
    showError("Спочатку збережіть позицію");
    return;
  }
  const stage = STAGES.find((s) => s.key === stageKey);
  const stageName = stage?.label || stageKey;

  await runSave(`Етап «${stageName}»`, {
    saveFn: async () => {
      const updated = await api.patchPositionStage(draft.id, stageKey, payload);
      draft = { ...updated };
      return updated;
    },
    successMessage: `Етап «${stageName}» збережено`,
    onSuccess: async () => {
      updateHeader();
      renderDrawerContent();
      if (activePanel === "more") await refreshDrawerHistory();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

function rootPositionForOrderNumber(orderNumber, orderId) {
  return state.positions.find(
    (p) => !p.parentId && (p.orderId === orderId || (orderNumber && p.orderNumber === orderNumber))
  );
}

function withParentWhenRootExists(body) {
  if (body.parentId) return body;
  const root = rootPositionForOrderNumber(body.orderNumber, body.orderId);
  if (!root) return body;
  return { ...body, parentId: root.id };
}

async function savePosition() {
  showError("");
  syncDraftFromForm();

  if (!draft.item) {
    showError("Вкажіть назву виробу");
    activePanel = "general";
    renderDrawerContent();
    return;
  }
  if (!draft.orderNumber) {
    showError("Оберіть замовлення");
    activePanel = "general";
    renderDrawerContent();
    return;
  }

  const isEdit = Boolean(draft.id);
  const submitBtn = $("#positionForm")?.querySelector('[type="submit"]');

  await runSave(isEdit ? "Позиція" : "Нова позиція", {
    submitEl: submitBtn,
    saveFn: async () => {
      const body = withParentWhenRootExists(readForm());
      if (isEdit) {
        return api.updatePosition(draft.id, body);
      }
      const created = await api.createPosition(body);
      if (created.parentId) expandPosition(created.parentId);
      return created;
    },
    successMessage: isEdit ? "Позицію збережено" : "Позицію створено",
    onSuccess: async () => {
      closePositionDrawer();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

async function deletePosition() {
  if (!draft.id) return;
  const kind = draft.parentId ? "підпозицію" : "позицію";
  if (!window.confirm(`Видалити ${kind} #${draft.id} «${draft.item}»?`)) return;

  await runSave("Позиція", {
    saveFn: () => api.deletePosition(draft.id),
    successMessage: "Позицію видалено",
    onSuccess: async () => {
      closePositionDrawer();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
}

function scrollPositionDrawerToTabs() {
  requestAnimationFrame(() => {
    const body = $("#positionDrawerBody");
    const tabs = body?.querySelector(".drawer-tabs");
    if (!body || !tabs) return;
    body.scrollTo({ top: Math.max(0, tabs.offsetTop - 8), behavior: "smooth" });
  });
}

function onDrawerTabSelect(panel) {
  if (!panel) return;
  activePanel = panel;
  syncDraftFromForm();
  renderDrawerContent();
  scrollPositionDrawerToTabs();
  if (activePanel === "more") refreshDrawerHistory();
  if (activePanel === "constructive" && draft?.id) {
    void Promise.all([loadProcurementSummary(draft.id), loadCncJobsSummary(draft.id)]).then(
      ([proc, jobs]) => {
        procurementSummary = proc;
        cncJobsSummary = jobs || [];
        const pipe = $("#constructivePipelineMount");
        if (pipe) {
          pipe.innerHTML = renderConstructivePipelinePanel(
            constructivePackageDetail,
            procurementSummary,
            pipelinePanelOptions()
          );
        }
        bindConstructivePipelinePanel();
      }
    );
  }
  if (activePanel === "constructive") bindConstructivePipelinePanel();
}

function pipelinePanelOptions() {
  return {
    canManageProcurement: canManageProcurement(),
    cncJobs: cncJobsSummary
  };
}

function bindConstructivePipelinePanel() {
  $("#openConstructiveReviewBtn")?.addEventListener("click", () => {
    if (constructivePackageDetail?.package?.id && draft?.id) {
      openConstructiveReviewModal(draft.id, constructivePackageDetail, {
        canReview: canReviewConstructive()
      });
    }
  });

  $("#openModelMappingBtn")?.addEventListener("click", () => {
    if (constructivePackageDetail?.package?.id && draft?.id) {
      openModelMappingModal(draft.id, constructivePackageDetail);
    }
  });

  $("#analyzePackageAiBtn")?.addEventListener("click", async () => {
    const pkgId = constructivePackageDetail?.package?.id;
    if (!pkgId || !draft?.id) return;
    const box = $("#packageAiResult");
    if (box) {
      box.hidden = false;
      box.textContent = "ШІ аналізує пакет…";
    }
    try {
      const res = await api.analyzeConstructivePackageAi(draft.id, pkgId);
      if (box) {
        box.innerHTML = `<pre class="package-ai-json">${escapeHtml(JSON.stringify(res.analysis || res, null, 2))}</pre>`;
      }
    } catch (err) {
      if (box) box.textContent = err.message;
    }
  });

  $("#advanceProcurementBtn")?.addEventListener("click", async () => {
    const nextStatus = $("#advanceProcurementBtn")?.dataset?.nextStatus;
    if (!nextStatus || !draft?.id || !procurementSummary?.id) return;
    try {
      procurementSummary = await api.updatePositionProcurement(draft.id, procurementSummary.id, {
        status: nextStatus
      });
      const pipe = $("#constructivePipelineMount");
      if (pipe) {
        pipe.innerHTML = renderConstructivePipelinePanel(
          constructivePackageDetail,
          procurementSummary,
          pipelinePanelOptions()
        );
      }
      bindConstructivePipelinePanel();
    } catch (err) {
      showFormError(err.message);
    }
  });
}

async function refreshConstructiveWorkspace() {
  if (!draft?.id) return;
  await refreshConstructiveFiles();
  const mount = $("#constructivePackageMount");
  if (mount) {
    mount.innerHTML = renderConstructivePackageBlock(draft, constructivePackageDetail, {
      editable: true,
      fileListHtml: renderConstructiveFileList(draft.id)
    });
  }
  const pipe = $("#constructivePipelineMount");
  if (pipe) {
    [procurementSummary, cncJobsSummary] = await Promise.all([
      loadProcurementSummary(draft.id),
      loadCncJobsSummary(draft.id)
    ]);
    pipe.innerHTML = renderConstructivePipelinePanel(
      constructivePackageDetail,
      procurementSummary,
      pipelinePanelOptions()
    );
    bindConstructivePipelinePanel();
  }
  bindConstructiveWorkspace();
}

function bindConstructiveWorkspace() {
  const mount = $("#constructivePackageMount");
  if (!mount || !draft?.id) return;
  bindConstructivePackageBlock(draft, mount, {
    editable: true,
    onUpdated: async () => {
      await refreshConstructiveWorkspace();
      draft = { ...draft, hasConstructiveFile: true };
      updateHeader();
      await onSaved();
    }
  });
  bindLegacyAiBlock(mount, draft, {
    onUpdated: async () => {
      await refreshConstructiveWorkspace();
      await onSaved();
    },
    showError
  });
}

function bindDrawerEvents() {
  $("#positionForm")?.addEventListener("input", () => {
    document.dispatchEvent(new CustomEvent("enver-ui-changed"));
  });
  $("#positionForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    savePosition();
  });

  $("#posOrderNumber")?.addEventListener("change", (e) => {
    applyOrderDefaults(e.target.value);
    $("#posObject").value = draft.object || "";
    $("#posManager").value = draft.manager || "";
  });

  document.querySelectorAll("[data-pipeline-jump]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.pipelineJump;
      const stage = STAGES.find((s) => s.key === key);
      if (!stage || key === draft.currentStage) return;
      if (stage.type === "constructor") {
        if (!draft.hasConstructiveFile) {
          onDrawerTabSelect("constructive");
          showError("Завантажте файл конструктива");
          return;
        }
        await patchStage(key, { status: "Передано", constructor: draft.constructor });
        return;
      }
      await patchStage(key, {
        status: "В роботі",
        assemblyResponsible: draft.assemblyResponsible
      });
    });
  });

  document.querySelectorAll("[data-pipeline-advance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.pipelineAdvance;
      const next = btn.dataset.next;
      const stage = STAGES.find((s) => s.key === key);
      if (stage.type === "constructor") {
        if (!draft.hasConstructiveFile && next !== "Не розпочато") {
          onDrawerTabSelect("constructive");
          showError("Завантажте файл конструктива");
          return;
        }
        await patchStage(key, { status: next, constructor: draft.constructor });
      } else {
        await patchStage(key, {
          status: next,
          assemblyResponsible: draft.assemblyResponsible
        });
      }
    });
  });

  document.querySelectorAll(".pipeline-select").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const key = sel.dataset.pipelineStatus;
      const stage = STAGES.find((s) => s.key === key);
      const status = sel.value;
      if (stage.type === "constructor") {
        await patchStage(key, { status, constructor: draft.constructor });
      } else {
        await patchStage(key, { status, assemblyResponsible: draft.assemblyResponsible });
      }
    });
  });

  bindConstructiveWorkspace();
  bindConstructivePipelinePanel();

  document.addEventListener(
    "enver:constructive-package-updated",
    async () => {
      if (draft?.id) await refreshConstructiveWorkspace();
    },
    { once: false }
  );

  document.querySelectorAll("[data-run-next-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const positionId = Number(btn.dataset.runNextAction);
      const actionType = btn.dataset.actionType;
      const position = state.positions.find((p) => p.id === positionId);

      if (position && actionType === "assign_constructor") {
        const { openConstructorDeskForAssignment } = await import("./constructor-desk.js");
        await openConstructorDeskForAssignment({ positionId });
        return;
      }

      await runSave("Наступна дія", {
        saveFn: () => api.runPositionNextAction(positionId, actionType),
        successMessage: "Дію виконано",
        onSuccess: async (updated) => {
          draft = { ...draft, ...updated };
          updateHeader();
          renderDrawerContent();
        }
      }).catch(() => {});
    });
  });
}

export function openSubPositionDrawer(parentId) {
  const parent = getParentPosition(parentId);
  if (!parent) return;
  expandPosition(parentId);
  openPositionDrawer(null, {
    parentId,
    orderNumber: parent.orderNumber,
    orderId: parent.orderId,
    object: parent.object,
    manager: parent.manager,
    itemType: parent.itemType || "Кухня"
  });
}

export function capturePositionDrawerState() {
  if (!backdrop()?.classList.contains("open") || !draft) return null;
  syncDraftFromForm();
  const { _parentItem, ...draftData } = draft;
  return { activePanel, draft: draftData };
}

export async function restorePositionDrawerState(saved) {
  if (!saved?.draft) return;
  activePanel = saved.activePanel || "general";
  draft = { ...saved.draft };
  if (draft.parentId) {
    const parent = getParentPosition(draft.parentId);
    if (parent) draft._parentItem = parent.item;
  }
  if (draft.orderNumber) applyOrderDefaults(draft.orderNumber);
  $("#positionDrawerTitle").textContent = draft.item || "Нова позиція";
  $("#deletePositionBtn").style.display = draft.id ? "inline-flex" : "none";
  updateHeader();
  await refreshConstructiveFiles();
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export async function openPositionDrawer(position = null, options = {}) {
  if (options.restoredDraft) {
    await restorePositionDrawerState({ activePanel: options.panel, draft: options.restoredDraft });
    return;
  }

  activePanel = options.panel || "general";
  const parentId = position?.parentId ?? options.parentId ?? null;
  const parent = parentId ? getParentPosition(parentId) : null;

  draft = position
    ? {
        ...position,
        _parentItem: (position.parentId ? getParentPosition(position.parentId) : parent)?.item
      }
    : {
        parentId,
        orderNumber: options.orderNumber || "",
        orderId: options.orderId || null,
        object: options.object || "",
        manager: options.manager || "",
        _parentItem: parent?.item,
        item: "",
        itemType: options.itemType || "Кухня",
        constructor: "",
        cuttingStatus: "Не розпочато",
        edgingStatus: "Не розпочато",
        drillingStatus: "Не розпочато",
        assemblyStatus: "Не розпочато",
        positionStatus: "Не розпочато",
        progress: 0,
        overdueDays: 0,
        problem: "",
        note: ""
      };

  if (draft.orderNumber) applyOrderDefaults(draft.orderNumber);

  $("#positionDrawerTitle").textContent = draft.item || "Нова позиція";
  $("#deletePositionBtn").style.display = draft.id ? "inline-flex" : "none";
  updateHeader();
  await refreshConstructiveFiles();
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function closePositionDrawer() {
  backdrop().classList.remove("open");
  backdrop().setAttribute("aria-hidden", "true");
  draft = null;
  constructiveFiles = [];
}

export async function quickAdvancePosition(id, stageKey) {
  const position = state.positions.find((p) => p.id === id);
  if (!position) return;
  const stage = STAGES.find((s) => s.key === stageKey);
  if (!stage) return;
  const current = getStageStatus(position, stage);
  const next = getNextStatus(current);
  const payload =
    stage.type === "constructor"
      ? { status: next, constructor: position.constructor }
      : { status: next, assemblyResponsible: position.assemblyResponsible };

  await runSave(`Етап «${stage.label}»`, {
    saveFn: async () => {
      const updated = await api.patchPositionStage(id, stageKey, payload);
      const idx = state.positions.findIndex((p) => p.id === id);
      if (idx >= 0) state.positions[idx] = updated;
      return updated;
    },
    successMessage: `«${stage.label}»: ${next}`,
    onSuccess: () => onSaved()
  }).catch(() => {});
}

export function initPositionDrawer() {
  if (document.getElementById("positionDrawer")) return;

  const el = document.createElement("div");
  el.id = "positionDrawer";
  el.className = "drawer-backdrop";
  el.setAttribute("aria-hidden", "true");
  el.innerHTML = `
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
  document.body.appendChild(el);

  $("#positionDrawerBody")?.addEventListener("click", (e) => {
    const tab = e.target.closest(".drawer-tab");
    if (!tab?.dataset.panel) return;
    onDrawerTabSelect(tab.dataset.panel);
  });

  el.addEventListener("click", (e) => {
    if (e.target === el) closePositionDrawer();
  });
  $("#closePositionDrawer").addEventListener("click", closePositionDrawer);
  $("#cancelPositionBtn").addEventListener("click", closePositionDrawer);
  $("#deletePositionBtn").addEventListener("click", deletePosition);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && el.classList.contains("open")) closePositionDrawer();
  });
}

export function positionActionButtons(id, compact = false) {
  const label = compact ? "▸" : "Відкрити";
  return `
    <div class="actions-cell">
      <button type="button" class="btn btn-sm" data-edit-position="${id}">${label}</button>
    </div>
  `;
}

export function stageQuickActions(id, stageKey) {
  const position = state.positions.find((p) => p.id === id);
  if (!position) return "";
  const stage = STAGES.find((s) => s.key === stageKey);
  const status = getStageStatus(position, stage);
  const next = getNextStatus(status);
  if (status === "Готово" || status === "Не потрібно") {
    return `<span class="muted">✓</span>`;
  }
  return `
    <div class="stage-quick">
      <button type="button" class="btn btn-ghost btn-sm" data-quick-stage="${stageKey}" data-position-id="${id}" data-next="${escapeHtml(next)}">${escapeHtml(next)}</button>
      <button type="button" class="btn btn-sm" data-edit-position="${id}">⋯</button>
    </div>
  `;
}
