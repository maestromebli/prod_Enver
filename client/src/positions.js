import { api } from "./api.js";
import { runSave } from "./save-flow.js";
import { loadPositionHistory, renderDrawerHistory } from "./history.js";
import { expandPosition, getParentPosition } from "./position-tree.js";
import { state } from "./state.js";
import { POSITION_STATUSES, STAGES, getNextStatus, getStageStatus } from "./workflows.js";
import {
  CONSTRUCTORS_DIRECTORY_KEY,
  getDirectoryList
} from "@enver/shared/production/directories.js";
import { renderNextActionBanner, resolvePositionGodmode } from "./godmode-ui.js";
import { $, badge, escapeHtml, fillSelect, progressBar, showFormError } from "./utils.js";
import { loadCncJobsSummary, loadProcurementSummary } from "./constructive-pipeline-panel.js";
import { loadConstructivePackageDetail } from "./constructive-package-ui.js";
import {
  bindPositionConstructivePanel,
  remountPositionConstructivePanel,
  renderPositionConstructivePanel
} from "./position-constructive-panel.js";
import {
  POSITION_DRAWER_SHELL_HTML,
  estimatePositionProgress,
  renderPositionPipeline
} from "./position-drawer-render.js";

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

function renderPipeline() {
  return renderPositionPipeline(draft);
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
        <div id="constructiveWorkspaceMount">${renderPositionConstructivePanel(p, buildConstructiveDownstream(), { editable: true })}</div>
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
  draft.progress = estimatePositionProgress(draft);
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
      const { invalidateProcurementListCache } = await import("./procurement-view.js");
      invalidateProcurementListCache();
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
    void refreshConstructiveWorkspace();
  }
}

function buildConstructiveDownstream() {
  return {
    packageDetail: constructivePackageDetail,
    procurement: procurementSummary,
    cncJobs: cncJobsSummary,
    constructiveFiles
  };
}

async function handleConstructivePanelRefresh(opts = {}) {
  if (!draft?.id) return;
  if (opts.packageDomOnly) {
    await refreshConstructiveFiles();
    remountPositionConstructivePanel($("#constructiveWorkspaceMount"), draft, {
      getDownstream: buildConstructiveDownstream,
      onRefresh: handleConstructivePanelRefresh,
      onPackageDetailPatched: (detail) => {
        constructivePackageDetail = detail;
      },
      editable: true
    });
    return;
  }
  await refreshConstructiveWorkspace();
}

async function refreshConstructiveWorkspace() {
  if (!draft?.id) return;
  await refreshConstructiveFiles();
  [procurementSummary, cncJobsSummary] = await Promise.all([
    loadProcurementSummary(draft.id),
    loadCncJobsSummary(draft.id)
  ]);
  const mount = $("#constructiveWorkspaceMount");
  if (mount) {
    mount.innerHTML = renderPositionConstructivePanel(draft, buildConstructiveDownstream(), {
      editable: true
    });
  }
  bindConstructivePanel();
}

function bindConstructivePanel() {
  const mount = $("#constructiveWorkspaceMount");
  if (!mount || !draft?.id) return;
  bindPositionConstructivePanel(mount, draft, {
    getDownstream: buildConstructiveDownstream,
    onRefresh: async (opts = {}) => {
      if (opts.packageDomOnly) {
        await handleConstructivePanelRefresh(opts);
        return;
      }
      await refreshConstructiveWorkspace();
      draft = { ...draft, hasConstructiveFile: true };
      updateHeader();
      await onSaved();
    },
    onPackageDetailPatched: (detail) => {
      constructivePackageDetail = detail;
    },
    editable: true
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

  bindConstructivePanel();

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
  el.innerHTML = POSITION_DRAWER_SHELL_HTML;
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
