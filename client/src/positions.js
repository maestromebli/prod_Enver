import { api } from "./api.js";
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
import { $, badge, escapeHtml, progressBar } from "./utils.js";

let onSaved = () => {};
let draft = null;
let activePanel = "general";

export function setPositionSaveHandler(handler) {
  onSaved = handler;
}

function backdrop() {
  return $("#positionDrawer");
}

function showError(message) {
  const el = $("#positionFormError");
  if (!el) return;
  el.textContent = message;
  el.classList.toggle("visible", Boolean(message));
}

function fillSelect(el, options, value) {
  el.innerHTML = options
    .map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`)
    .join("");
  if (value !== undefined && value !== "") el.value = value;
}

function listOptions(key) {
  return state.directories[key] || [];
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
  return STAGES.map((stage) => {
    const status = getStageStatus(draft, stage);
    const next = getNextStatus(status);
    const cls = stageStatusClass(status);

    const advanceBtn =
      status !== "Готово" && status !== "Не потрібно"
        ? `<button type="button" class="btn btn-success btn-sm" data-pipeline-advance="${stage.key}" data-next="${escapeHtml(next)}">
            → ${escapeHtml(next)}
          </button>`
        : "";

    const statusSelect = `
      <select class="pipeline-select" data-pipeline-status="${stage.key}" aria-label="Статус ${escapeHtml(stage.label)}">
        ${STAGE_STATUSES.map(
          (s) =>
            `<option value="${escapeHtml(s)}" ${s === status ? "selected" : ""}>${escapeHtml(s)}</option>`
        ).join("")}
      </select>
    `;

    return `
      <div class="pipeline-step ${cls}" data-stage="${stage.key}">
        <div class="pipeline-icon">${stage.icon}</div>
        <div class="pipeline-label">${escapeHtml(stage.label)}</div>
        <div class="pipeline-status">${badge(status)}</div>
        <div class="pipeline-actions">
          ${statusSelect}
          ${advanceBtn}
        </div>
      </div>
    `;
  }).join("");
}

function renderDrawerContent() {
  const p = draft;
  const orderOptions = state.orders
    .map(
      (o) =>
        `<option value="${escapeHtml(o.orderNumber)}">${escapeHtml(o.orderNumber)} — ${escapeHtml(o.object)}</option>`
    )
    .join("");

  $("#positionDrawerBody").innerHTML = `
    <p class="form-error" id="positionFormError"></p>

    <div class="drawer-section">
      <h3>Етапи виробництва</h3>
      <div class="pipeline" id="positionPipeline">${renderPipeline()}</div>
    </div>

    <div class="drawer-tabs">
      <button type="button" class="drawer-tab ${activePanel === "general" ? "active" : ""}" data-panel="general">Загальне</button>
      <button type="button" class="drawer-tab ${activePanel === "stages" ? "active" : ""}" data-panel="stages">Деталі етапів</button>
      <button type="button" class="drawer-tab ${activePanel === "install" ? "active" : ""}" data-panel="install">Монтаж</button>
      <button type="button" class="drawer-tab ${activePanel === "issues" ? "active" : ""}" data-panel="issues">Проблеми</button>
      <button type="button" class="drawer-tab ${activePanel === "history" ? "active" : ""}" data-panel="history">Історія</button>
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
            <label for="posItem">${p.parentId ? "Назва підпозиції / зони *" : "Виріб / зона *"}</label>
            <input id="posItem" value="${escapeHtml(p.item)}" required />
          </div>
          <div class="form-field">
            <label for="posOrderNumber">Замовлення *</label>
            <select id="posOrderNumber" required ${p.parentId ? "disabled" : ""}>
              <option value="">— оберіть —</option>
              ${orderOptions}
              ${p.orderNumber && !state.orders.some((o) => o.orderNumber === p.orderNumber) ? `<option value="${escapeHtml(p.orderNumber)}" selected>${escapeHtml(p.orderNumber)}</option>` : ""}
            </select>
          </div>
          <div class="form-field">
            <label for="posItemType">Тип виробу</label>
            <input id="posItemType" list="itemTypesList" value="${escapeHtml(p.itemType)}" />
            <datalist id="itemTypesList"></datalist>
          </div>
          <div class="form-field span-2">
            <label for="posObject">Об'єкт / адреса</label>
            <input id="posObject" value="${escapeHtml(p.object)}" />
          </div>
          <div class="form-field">
            <label for="posManager">Менеджер</label>
            <input id="posManager" list="posManagersList" value="${escapeHtml(p.manager)}" />
            <datalist id="posManagersList"></datalist>
          </div>
          <div class="form-field">
            <label for="posPositionStatus">Статус позиції</label>
            <select id="posPositionStatus"></select>
          </div>
          <div class="form-field">
            <label for="posReadyDate">Дата готовності</label>
            <input id="posReadyDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.readyDate)}" />
          </div>
          <div class="form-field">
            <label for="posOverdue">Прострочка, днів</label>
            <input id="posOverdue" type="number" value="${p.overdueDays ?? 0}" />
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "stages" ? "active" : ""}" data-panel="stages">
        <div class="form-grid">
          <div class="form-field">
            <label for="posConstructor">Конструктор</label>
            <input id="posConstructor" list="constructorsList" value="${escapeHtml(p.constructor)}" />
            <datalist id="constructorsList"></datalist>
          </div>
          <div class="form-field">
            <label for="posCutting">Порізка</label>
            <select id="posCutting"></select>
          </div>
          <div class="form-field">
            <label for="posEdging">Крайкування</label>
            <select id="posEdging"></select>
          </div>
          <div class="form-field">
            <label for="posDrilling">Присадка</label>
            <select id="posDrilling"></select>
          </div>
          <div class="form-field">
            <label for="posAssembly">Збірка</label>
            <select id="posAssembly"></select>
          </div>
          <div class="form-field">
            <label for="posAssembler">Збирач</label>
            <input id="posAssembler" list="assemblersList" value="${escapeHtml(p.assemblyResponsible)}" />
            <datalist id="assemblersList"></datalist>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "install" ? "active" : ""}" data-panel="install">
        <div class="form-grid">
          <div class="form-field">
            <label for="posInstallDate">Початок монтажу</label>
            <input id="posInstallDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.installDate)}" />
          </div>
          <div class="form-field">
            <label for="posInstallEndDate">Кінець монтажу</label>
            <input id="posInstallEndDate" placeholder="дд.мм.рррр" value="${escapeHtml(p.installEndDate || p.installDate || "")}" />
          </div>
          <div class="form-field">
            <label for="posInstaller">Монтажник</label>
            <input id="posInstaller" list="installersList" value="${escapeHtml(p.installResponsible)}" />
            <datalist id="installersList"></datalist>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "issues" ? "active" : ""}" data-panel="issues">
        <div class="form-grid">
          <div class="form-field span-2">
            <label for="posProblem">Проблема / стоп-фактор</label>
            <textarea id="posProblem">${escapeHtml(p.problem)}</textarea>
          </div>
          <div class="form-field span-2">
            <label for="posNote">Примітка</label>
            <textarea id="posNote">${escapeHtml(p.note)}</textarea>
          </div>
        </div>
      </div>

      <div class="drawer-panel ${activePanel === "history" ? "active" : ""}" data-panel="history">
        <div id="positionHistoryPanel" class="position-history-panel">
          <p class="history-muted">Завантаження…</p>
        </div>
      </div>
    </form>
  `;

  fillSelect($("#posPositionStatus"), POSITION_STATUSES, p.positionStatus);
  fillSelect($("#posCutting"), STAGE_STATUSES, p.cuttingStatus);
  fillSelect($("#posEdging"), STAGE_STATUSES, p.edgingStatus);
  fillSelect($("#posDrilling"), STAGE_STATUSES, p.drillingStatus);
  fillSelect($("#posAssembly"), STAGE_STATUSES, p.assemblyStatus);

  if (p.orderNumber) $("#posOrderNumber").value = p.orderNumber;

  $("#itemTypesList").innerHTML = listOptions("Типи виробів")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");
  $("#posManagersList").innerHTML = listOptions("Менеджери")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");
  $("#constructorsList").innerHTML = listOptions("Конструктори")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");
  $("#assemblersList").innerHTML = listOptions("Збирачі")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");
  $("#installersList").innerHTML = listOptions("Монтажники")
    .map((x) => `<option value="${escapeHtml(x)}"></option>`)
    .join("");

  bindDrawerEvents();
  if (activePanel === "history") refreshDrawerHistory();
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

function readForm() {
  const orderNumber = draft.parentId ? draft.orderNumber : $("#posOrderNumber").value.trim();
  const order = state.orders.find((o) => o.orderNumber === orderNumber);
  return {
    parentId: draft.parentId ?? null,
    orderId: order?.id ?? draft.orderId ?? null,
    orderNumber,
    object: $("#posObject").value.trim(),
    item: $("#posItem").value.trim(),
    itemType: $("#posItemType").value.trim(),
    manager: $("#posManager").value.trim(),
    constructor: $("#posConstructor").value.trim(),
    cuttingStatus: $("#posCutting").value,
    edgingStatus: $("#posEdging").value,
    drillingStatus: $("#posDrilling").value,
    assemblyStatus: $("#posAssembly").value,
    assemblyResponsible: $("#posAssembler").value.trim(),
    readyDate: $("#posReadyDate").value.trim(),
    installDate: $("#posInstallDate").value.trim(),
    installEndDate: $("#posInstallEndDate").value.trim(),
    installTimeStart: "",
    installTimeEnd: "",
    installResponsible: $("#posInstaller").value.trim(),
    positionStatus: $("#posPositionStatus").value,
    overdueDays: Number($("#posOverdue").value) || 0,
    problem: $("#posProblem").value.trim(),
    note: $("#posNote").value.trim()
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
      if (activePanel === "history") await refreshDrawerHistory();
      await onSaved();
    },
    onError: (err) => showError(err.message)
  }).catch(() => {});
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
      const body = readForm();
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

function bindDrawerEvents() {
  $("#positionForm")?.addEventListener("input", () => {
    document.dispatchEvent(new CustomEvent("enver-ui-changed"));
  });
  $("#positionForm")?.addEventListener("submit", (e) => {
    e.preventDefault();
    savePosition();
  });

  document.querySelectorAll(".drawer-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      activePanel = btn.dataset.panel;
      syncDraftFromForm();
      renderDrawerContent();
      if (activePanel === "history") refreshDrawerHistory();
    });
  });

  $("#posOrderNumber")?.addEventListener("change", (e) => {
    applyOrderDefaults(e.target.value);
    $("#posObject").value = draft.object || "";
    $("#posManager").value = draft.manager || "";
  });

  document.querySelectorAll("[data-pipeline-advance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.pipelineAdvance;
      const next = btn.dataset.next;
      const stage = STAGES.find((s) => s.key === key);
      if (stage.type === "constructor") {
        if (!draft.constructor && next !== "Не розпочато") {
          activePanel = "stages";
          renderDrawerContent();
          showError("Вкажіть конструктора в деталях етапів");
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

export function restorePositionDrawerState(saved) {
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
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function openPositionDrawer(position = null, options = {}) {
  if (options.restoredDraft) {
    restorePositionDrawerState({ activePanel: options.panel, draft: options.restoredDraft });
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
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function closePositionDrawer() {
  backdrop().classList.remove("open");
  backdrop().setAttribute("aria-hidden", "true");
  draft = null;
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
