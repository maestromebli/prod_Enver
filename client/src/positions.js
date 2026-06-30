import { api } from "./api.js";
import { runSave } from "./save-flow.js";
import { loadPositionHistory, renderDrawerHistory } from "./history.js";
import { expandPosition, getParentPosition } from "./position-tree.js";
import { state } from "./state.js";
import { POSITION_STATUSES } from "./workflows.js";
import {
  CONSTRUCTORS_DIRECTORY_KEY,
  getDirectoryList
} from "@enver/shared/production/directories.js";
import {
  renderNextActionBanner,
  renderAutomationHints,
  resolvePositionGodmode,
  bindGodmodeNavCta
} from "./godmode-ui.js";
import { $, badge, escapeHtml, fillSelect, progressBar, showFormError } from "./utils.js";
import {
  bindPositionManagerPanel,
  loadPositionManagerBundle,
  renderPositionManagerPanel
} from "./position-manager-panel.js";
import { openInlineAddPosition } from "./position-workspace.js";
import {
  POSITION_DRAWER_SHELL_HTML,
  estimatePositionProgress,
  renderPositionPipeline
} from "./position-drawer-render.js";

let onSaved = () => {};
let draft = null;
let activePanel = "general";
let managerBundle = null;

export function setPositionSaveHandler(handler) {
  onSaved = handler;
}

function backdrop() {
  return $("#positionDrawer");
}

function renderPipeline() {
  return renderPositionPipeline(draft);
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
  const keys = [CONSTRUCTORS_DIRECTORY_KEY, "Збирачі"];
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
  if (!draft.deliveryAddress?.trim()) {
    draft.deliveryAddress = order.defaultDeliveryAddress || "";
  }
  if (!draft.deliveryContactName?.trim()) {
    draft.deliveryContactName = order.client || "";
  }
  if (!draft.positionDeadline?.trim()) {
    draft.positionDeadline = order.planDate || "";
  }
  if (!draft.note?.trim()) {
    draft.note = order.comment || "";
  }
}

function renderDrawerContent() {
  const p = draft;
  const gm = p.id && !p.parentId ? resolvePositionGodmode(p) : null;
  const godmodeBanner = gm
    ? `${renderNextActionBanner(gm, { positionId: p.id, showCta: true })}${renderAutomationHints(gm)}`
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
      <button type="button" class="drawer-tab ${activePanel === "manager" ? "active" : ""}" data-panel="manager">Дані менеджера</button>
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

      <div class="drawer-panel ${activePanel === "manager" ? "active" : ""}" data-panel="manager">
        <div id="positionManagerWorkspaceMount">${
          p.id
            ? renderPositionManagerPanel(p, managerBundle, { editable: true })
            : `<p class="enver-meta">Збережіть позицію, щоб редагувати дані менеджера.</p>`
        }</div>
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
  });

  bindDrawerEvents();
  if (activePanel === "manager" && p.id) {
    bindManagerWorkspace();
  }
  if (activePanel === "more") refreshDrawerHistory();
}

function bindManagerWorkspace() {
  const mount = $("#positionManagerWorkspaceMount");
  if (!mount || !draft?.id) return;
  bindPositionManagerPanel(mount, {
    positionId: draft.id,
    editable: true,
    onSaved: async (bundle) => {
      if (bundle) managerBundle = bundle;
      await onSaved();
    }
  });
}

async function ensureManagerBundle() {
  if (!draft?.id) {
    managerBundle = null;
    return;
  }
  try {
    managerBundle = await loadPositionManagerBundle(draft.id);
  } catch {
    managerBundle = null;
  }
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
    cuttingStatus: draft.cuttingStatus || "Не розпочато",
    edgingStatus: draft.edgingStatus || "Не розпочато",
    drillingStatus: draft.drillingStatus || "Не розпочато",
    assemblyStatus: draft.assemblyStatus || "Не розпочато",
    assemblyResponsible: $("#posAssembler")?.value.trim() ?? "",
    readyDate: $("#posReadyDate")?.value.trim() ?? "",
    installDate: draft.installDate || "",
    installEndDate: draft.installEndDate || "",
    installTimeStart: "",
    installTimeEnd: "",
    installResponsible: draft.installResponsible || "",
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

async function onDrawerTabSelect(panel) {
  if (!panel) return;
  activePanel = panel;
  syncDraftFromForm();
  if (activePanel === "manager" && draft?.id) {
    await ensureManagerBundle();
  }
  renderDrawerContent();
  scrollPositionDrawerToTabs();
  if (activePanel === "more") refreshDrawerHistory();
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

  bindGodmodeNavCta(document.getElementById("positionDrawer"), {
    onRefresh: () => renderDrawerContent()
  });
}

export function openSubPositionDrawer(parentId) {
  if (!openInlineAddPosition(parentId)) return;
  window.__enverRender?.();
}

export async function openPositionEditDrawer(position, options = {}) {
  return openPositionDrawer(position, options);
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
  if (activePanel === "manager" && draft.id) {
    await ensureManagerBundle();
  }
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

  if (!position?.id) {
    if (options.parentId) {
      openSubPositionDrawer(options.parentId);
      return;
    }
    const orderId =
      options.orderId ||
      state.orders.find((o) => o.orderNumber === options.orderNumber)?.id ||
      null;
    if (orderId) {
      const { focusOrderInlineAddInput } = await import("./order-detail-state.js");
      state.selectedOrderId = orderId;
      state.activeTab = "Замовлення";
      state.ordersView.detailTab = "positions";
      focusOrderInlineAddInput();
      window.__enverRender?.();
      return;
    }
    return;
  }

  activePanel = options.panel || "general";

  draft = {
    ...position,
    _parentItem: position.parentId ? getParentPosition(position.parentId)?.item : undefined
  };

  if (draft.orderNumber) applyOrderDefaults(draft.orderNumber);

  $("#positionDrawerTitle").textContent = draft.item || "Редагування позиції";
  $("#deletePositionBtn").style.display = draft.id ? "inline-flex" : "none";
  updateHeader();
  if (activePanel === "manager" && draft.id) {
    await ensureManagerBundle();
  }
  renderDrawerContent();
  showError("");
  backdrop().classList.add("open");
  backdrop().setAttribute("aria-hidden", "false");
}

export function closePositionDrawer() {
  backdrop().classList.remove("open");
  backdrop().setAttribute("aria-hidden", "true");
  draft = null;
  managerBundle = null;
}

export function stageQuickActions() {
  return "";
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
