import { api } from "./api.js";
import {
  canEditOrders,
  canEditPositions,
  canViewProductionFloor,
  canViewConstructorDesk,
  canViewSettings,
  hasOperatorAccess,
  isOperator
} from "./auth.js";
import {
  PRODUCTION_FLOOR_TAB,
  TABS,
  ATTENTION_TAB,
  OVERVIEW_TAB,
  CONSTRUCTOR_DESK_TAB
} from "./constants.js";
import { historyTab } from "./history.js";
import { renderOperatorView, bindOperatorQueueSwipe } from "./operator-panel.js";
import { bindOperatorScanPanel } from "./part-scan.js";
import { isOperatorStylesLoaded } from "./operator-styles.js";
import { setOperatorUiActive, syncOperatorBuildChip } from "./operator-ui.js";
import { renderPositionTableBody, renderPositionCards } from "./render-positions.js";
import {
  bindOrderDetail,
  clearOrderDetailViewState,
  renderOrderDetailView
} from "./order-detail.js";
import { bindOrdersGrid, renderOrdersGrid, renderOrdersModeBar } from "./orders-view.js";
import { bindSettingsActions, getSettingsHeaderMeta, renderSettingsView } from "./settings.js";
import { getTourStep, renderTourCoach } from "./tour.js";
import {
  filteredPositions,
  filteredOrders,
  hasActiveFilters,
  syncListFiltersToDom
} from "./filters.js";
import {
  countNewOrdersForCurrentRole,
  countNewProductionTasksForCurrentRole,
  newProductionTaskIdsForCurrentRole
} from "./role-notifications.js";
import { renderInstallTab } from "./install-calendar.js";
import {
  bindProductionFloorActions,
  loadProductionFloor,
  renderProductionFloorTab
} from "./production-floor.js";
import { renderConstructorDeskTab, bindConstructorDeskWorkspace } from "./constructor-desk.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { activePositions } from "./archive.js";
import { positionsForOrder } from "./workflows.js";
import { notifyUiChanged } from "./ui-persistence.js";
import { notifyAiContextChanged } from "./ai-assistant.js";
import { attentionTabBadgeCount, bindAttentionTab, renderAttentionTab } from "./attention-view.js";
import { renderDashboard } from "./dashboard.js";
import {
  mountGodmodeNotifyChrome,
  syncGodmodeNotifyForView,
  updateGodmodeNotifyBadge
} from "./godmode-notifications.js";
import { emptyStateIcon, navIconSvg, iconSvg } from "./icons.js";

export { filteredPositions };

function isOrdersRegistry() {
  return state.activeTab === "Замовлення" && !state.selectedOrderId && state.view === "main";
}

function isOrdersPositionsMode() {
  return isOrdersRegistry() && state.ordersView.displayMode === "positions";
}

function emptyRow(colspan = 10) {
  return `<tr><td colspan="${colspan}">
    <div class="enver-empty-state positions-table-empty">
      <span class="enver-empty-state-icon" aria-hidden="true">${emptyStateIcon("search")}</span>
      <h3 class="enver-empty-state-title">Нічого не знайдено</h3>
      <p class="enver-empty-state-text">Немає позицій за обраними фільтрами. Скиньте фільтри або змініть пошук.</p>
    </div>
  </td></tr>`;
}

function positionsTable(data, title = "Позиції замовлення", showActions = false) {
  const allowActions = showActions && canEditPositions();
  const actionHeader = allowActions ? "<th>Дії</th>" : "";
  const colspan = allowActions ? 21 : 20;
  const newTaskIds = newProductionTaskIdsForCurrentRole();
  const body =
    renderPositionTableBody(
      data,
      state.positions,
      state.expandedPositionIds,
      allowActions,
      newTaskIds
    ) || emptyRow(colspan);
  const cards = renderPositionCards(
    data,
    state.positions,
    state.expandedPositionIds,
    allowActions,
    newTaskIds
  );
  const headerRow = allowActions
    ? `<div class="card-header-row">
        <div class="block-title">${escapeHtml(title)}</div>
        <button type="button" class="btn btn-primary btn-sm" id="newPositionBtn">+ Нова позиція</button>
       </div>`
    : `<div class="block-title">${escapeHtml(title)}</div>`;

  return `
    <div class="card positions-view">
      ${headerRow}
      <p class="positions-hint">У кожному замовленні є одна основна позиція; вироби та зони завжди додаються як <strong>підпозиції</strong> через <strong>+</strong> біля неї (окремий конструктор, збирач і монтажник).</p>
      <div class="positions-cards" aria-label="Позиції (картки)">${cards}</div>
      <div class="table-wrap positions-table-wrap" aria-label="Позиції (таблиця)">
        <table class="positions-table">
          <colgroup>
            <col class="col-w-id" />
            <col class="col-w-order" />
            <col class="col-w-object" />
            <col class="col-w-item" />
            <col class="col-w-type col-opt-type" />
            <col class="col-w-person col-opt-manager" />
            <col class="col-w-person col-opt-constructor" />
            <col class="col-w-stage" />
            <col class="col-w-stage col-opt-edging" />
            <col class="col-w-stage col-opt-drilling" />
            <col class="col-w-stage" />
            <col class="col-w-stage" />
            <col class="col-w-date col-opt-ready" />
            <col class="col-w-date col-opt-install-date" />
            <col class="col-w-person" />
            <col class="col-w-status" />
            <col class="col-w-progress" />
            <col class="col-w-overdue col-opt-overdue" />
            <col class="col-w-text col-opt-problem" />
            <col class="col-w-text col-opt-note" />
            ${allowActions ? '<col class="col-w-actions" />' : ""}
          </colgroup>
          <thead>
            <tr>
              <th class="col-opt-id">ID</th>
              <th>Номер замовлення</th>
              <th class="col-opt-object">Об'єкт / Адреса</th>
              <th class="left col-item">Виріб / Зона</th>
              <th class="col-opt-type">Тип виробу</th>
              <th class="col-opt-manager">Менеджер</th>
              <th class="col-opt-constructor">Конструктор</th>
              <th>Порізка</th>
              <th class="col-opt-edging">Крайкування</th>
              <th class="col-opt-drilling">Присадка</th>
              <th>Збірка</th>
              <th>Пакування</th>
              <th class="col-opt-ready">Дата готовності</th>
              <th class="col-opt-install-date">Період монтажу</th>
              <th>Монтажник</th>
              <th>Статус позиції</th>
              <th>Готово, %</th>
              <th class="col-opt-overdue">Прострочка, днів</th>
              <th class="left col-opt-problem">Проблема</th>
              <th class="left col-opt-note">Примітка</th>
              ${actionHeader}
            </tr>
          </thead>
          <tbody>${body}</tbody>
        </table>
      </div>
    </div>
  `;
}

function visibleTabs() {
  return TABS.filter((tab) => {
    if (tab === PRODUCTION_FLOOR_TAB) return canViewProductionFloor();
    if (tab === CONSTRUCTOR_DESK_TAB) return canViewConstructorDesk();
    return true;
  });
}

const TAB_META = {
  [OVERVIEW_TAB]: { subtitle: "Ключові показники та швидкі переходи" },
  Замовлення: { subtitle: "Картки, список замовлень або реєстр позицій" },
  [ATTENTION_TAB]: { subtitle: "Блокери, попередження та наступні кроки" },
  [PRODUCTION_FLOOR_TAB]: { subtitle: "Черги, сесії та проблеми" },
  [CONSTRUCTOR_DESK_TAB]: { subtitle: "Картки або список замовлень у конструктиві" },
  Встановлення: { subtitle: "Календар монтажу" },
  "Історія змін": { subtitle: "Аудит дій у системі" }
};

function shouldShowMainToolbar() {
  if (state.view !== "main") return false;
  if (state.activeTab !== "Замовлення") return false;
  return true;
}

function renderPageChrome() {
  const meta = TAB_META[state.activeTab] || { subtitle: "" };
  const title = document.querySelector("#pageTitle");
  const sub = document.querySelector("#pageSubtitle");
  if (state.activeTab === "Замовлення" && state.selectedOrderId) {
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    if (order) {
      if (title) title.textContent = order.orderNumber;
      if (sub) {
        sub.textContent =
          [order.client, order.object].filter(Boolean).join(" · ") || "Позиції замовлення";
      }
      return;
    }
  }
  if (state.activeTab === CONSTRUCTOR_DESK_TAB) {
    if (state.constructorDesk.selectedPositionId && state.constructorDesk.detail?.position) {
      const p = state.constructorDesk.detail.position;
      if (title) title.textContent = `Стіл конструктора · ${p.orderNumber}`;
      if (sub) sub.textContent = [p.item, p.object].filter(Boolean).join(" · ");
      return;
    }
    if (state.constructorDesk.selectedOrderId != null) {
      const order = state.constructorDesk.orders?.find(
        (o) =>
          o.orderId === state.constructorDesk.selectedOrderId ||
          String(o.orderNumber) === String(state.constructorDesk.selectedOrderId)
      );
      if (order) {
        if (title) title.textContent = order.orderNumber;
        if (sub) {
          sub.textContent =
            [order.orderClient, order.object].filter(Boolean).join(" · ") ||
            "Позиції у конструкторах";
        }
        return;
      }
    }
  }
  if (title) title.textContent = state.activeTab;
  if (sub) sub.textContent = meta.subtitle || "";
}

/** Легке оновлення підсвітки вкладки без повного перемальовування меню (для contentOnly). */
export function syncNavActiveTab() {
  document.querySelectorAll("#tabs .tab-btn[data-tab]").forEach((btn) => {
    const active = btn.dataset.tab === state.activeTab;
    btn.classList.toggle("active", active);
    if (active) btn.setAttribute("aria-current", "page");
    else btn.removeAttribute("aria-current");
  });
}

export function renderTabs() {
  const tour = getTourStep();
  const newOrders = countNewOrdersForCurrentRole();
  const newTasks = countNewProductionTasksForCurrentRole();
  const attentionCount = attentionTabBadgeCount();
  const tabBadge = (count) => (count > 0 ? `<span class="tab-reminder-badge">${count}</span>` : "");
  document.querySelector("#tabs").innerHTML = visibleTabs()
    .map((tab) => {
      return `
      <button
        type="button"
        class="tab-btn ${tab === state.activeTab ? "active" : ""} ${tour?.tab === tab ? "tour-target" : ""}"
        data-tab="${escapeHtml(tab)}"
      >
        <span class="app-shell-nav-icon" aria-hidden="true">${navIconSvg(tab)}</span>
        <span class="app-shell-nav-label">${escapeHtml(tab)}</span>
        ${tab === "Замовлення" ? tabBadge(newOrders) : ""}
        ${tab === ATTENTION_TAB ? tabBadge(attentionCount) : ""}
        ${tab === PRODUCTION_FLOOR_TAB ? tabBadge(newTasks) : ""}
      </button>
    `;
    })
    .join("");
  renderPageChrome();
}

export function renderKpis() {
  const k = state.kpis;
  if (!k) return;

  const kpis = [
    ["Активні", k.activeOrders, ""],
    ["У виробництві", k.inProduction, ""],
    ["В роботі", k.inWork, ""],
    ["Прострочені", k.overdueCount, "alert"],
    ["До монтажу", k.readyInstall, "ok"],
    ["Монтажі", k.installs, ""]
  ];

  document.querySelector("#kpiGrid").innerHTML = kpis
    .map(
      ([label, value, tone]) => `
        <div class="shell-kpi ${tone ? `shell-kpi--${tone}` : ""}" title="${escapeHtml(label)}">
          <strong>${value}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      `
    )
    .join("");
}

export function renderResponsibleOptions() {
  const select = document.querySelector("#responsibleFilter");
  if (!select) return;
  const current = state.listFilters.responsible ?? select.value;
  const people = new Set();

  state.orders.forEach((o) => {
    if (o.manager) people.add(o.manager);
  });
  state.positions.forEach((p) => {
    [p.manager, p.constructor, p.assemblyResponsible, p.installResponsible]
      .filter(Boolean)
      .forEach((person) => people.add(person));
  });
  if (current && !people.has(current)) people.add(current);

  select.innerHTML = `
    <option value="">Усі відповідальні</option>
    ${Array.from(people)
      .sort()
      .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
      .join("")}
  `;
  select.value = current;
}

const POSITION_STATUS_OPTIONS = [
  "",
  "Передано",
  "В роботі",
  "Готово",
  "Готово до встановлення",
  "На паузі",
  "Проблема",
  "Не розпочато",
  "Завершено"
];

function fillStatusFilterOptions(options, labels) {
  const select = document.querySelector("#statusFilter");
  if (!select) return;
  const current = state.listFilters.status || select.value;
  const labelEl = select.closest(".filter-field")?.querySelector(".filter-label");

  select.innerHTML = options
    .map((value, i) => {
      const label = labels?.[i] ?? (value || "Усі статуси");
      return `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`;
    })
    .join("");
  if (options.includes(current)) select.value = current;
  else select.value = "";

  if (labelEl) {
    const positionsMode =
      state.activeTab === "Замовлення" &&
      !state.selectedOrderId &&
      state.ordersView.displayMode === "positions";
    labelEl.textContent =
      state.activeTab === "Замовлення" && !positionsMode ? "Статус замовлення" : "Статус";
  }
}

export function renderToolbarFilters() {
  const stageSelect = document.querySelector("#stageFilter");
  const stageField = stageSelect?.closest(".filter-field");
  const stageLabel = stageField?.querySelector(".filter-label");
  const statusField = document.querySelector("#statusFilter")?.closest(".filter-field");
  const responsibleField = document.querySelector("#responsibleFilter")?.closest(".filter-field");
  const searchField = document.querySelector("#searchInput")?.closest(".filter-field");
  const onOrdersRegistry = isOrdersRegistry();
  const positionsMode = isOrdersPositionsMode();

  if (searchField) {
    const input = searchField.querySelector("#searchInput");
    if (input) {
      input.placeholder = onOrdersRegistry
        ? "Номер, клієнт, об'єкт, виріб…"
        : "Замовлення, об'єкт, виріб…";
    }
  }

  if (onOrdersRegistry && !positionsMode) {
    const orderStatuses = state.directories["Статуси замовлення"] || [
      "Новий",
      "У конструктиві",
      "Передано у виробництво",
      "У виробництві",
      "Частково готово",
      "Готово до встановлення",
      "На встановленні",
      "Пауза за клієнтом",
      "Проблема"
    ];
    fillStatusFilterOptions(["", ...orderStatuses], ["Усі статуси", ...orderStatuses]);

    if (stageSelect && stageField) {
      const priorities = state.directories["Пріоритети"] || ["Високий", "Звичайний", "Низький"];
      stageSelect.hidden = false;
      stageField.hidden = false;
      if (stageLabel) stageLabel.textContent = "Пріоритет";
      const current = state.ordersView.priorityFilter ?? "";
      stageSelect.innerHTML = `
        <option value="">Усі пріоритети</option>
        ${priorities.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("")}
      `;
      stageSelect.value = priorities.includes(current) ? current : "";
    }
  } else if (positionsMode) {
    fillStatusFilterOptions(
      POSITION_STATUS_OPTIONS,
      POSITION_STATUS_OPTIONS.map((v) => v || "Усі статуси")
    );

    if (stageSelect && stageField) {
      stageSelect.hidden = true;
      stageField.hidden = true;
      if (stageLabel) stageLabel.textContent = "Етап";
    }
  } else {
    fillStatusFilterOptions(
      POSITION_STATUS_OPTIONS,
      POSITION_STATUS_OPTIONS.map((v) => v || "Усі статуси")
    );

    if (stageSelect && stageField) {
      stageSelect.hidden = true;
      stageField.hidden = true;
      if (stageLabel) stageLabel.textContent = "Етап";
    }
  }

  const hideSecondary =
    state.activeTab === "Історія змін" || state.activeTab === OVERVIEW_TAB || state.view !== "main";
  if (statusField) statusField.hidden = hideSecondary;
  if (responsibleField) responsibleField.hidden = hideSecondary;
  syncListFiltersToDom();
}

export function renderToolbarActions() {
  const el = document.querySelector("#toolbarActions");
  if (!el) return;
  const onOrdersRegistry = isOrdersRegistry();
  const positionsMode = isOrdersPositionsMode();
  const parts = [];
  if (onOrdersRegistry && !positionsMode && canEditOrders()) {
    parts.push(
      `<button type="button" class="btn btn-primary" id="toolbarNewOrderBtn">+ Нове замовлення</button>`
    );
  }
  if (positionsMode && canEditPositions()) {
    parts.push(
      `<button type="button" class="btn btn-primary" id="toolbarNewPositionBtn">+ Нова позиція</button>`
    );
  }
  if (positionsMode) {
    parts.push(`<button type="button" class="btn btn-sm" id="exportCsvBtn">Експорт CSV</button>`);
  }
  parts.push(renderTourCoach());
  el.innerHTML = parts.join("");
}

export function renderStageFilter() {
  renderToolbarFilters();
}

function renderOrderDetail() {
  const order = state.orders.find((o) => o.id === state.selectedOrderId);
  if (!order) {
    state.selectedOrderId = null;
    return renderOrdersGrid(state.orders, state.positions);
  }
  const related = positionsForOrder(order, activePositions(state.positions, state.orders));
  for (const p of related) {
    if (!p.parentId && related.some((c) => c.parentId === p.id)) {
      state.expandedPositionIds.add(p.id);
    }
  }
  const bundles = state.ordersView.positionBundles || {};
  return renderOrderDetailView(order, state.positions, related, bundles);
}

function renderContent() {
  const tab = state.activeTab;
  const ordersData = filteredOrders();

  if (tab === OVERVIEW_TAB) return renderDashboard();
  if (tab === "Замовлення") {
    if (state.selectedOrderId) return renderOrderDetail();
    if (state.ordersView.displayMode === "positions") {
      const positionsData = filteredPositions();
      return `<div class="orders-view">${renderOrdersModeBar()}${positionsTable(positionsData, "Позиції", true)}</div>`;
    }
    return renderOrdersGrid(ordersData, state.positions, {
      filtersActive: hasActiveFilters()
    });
  }
  if (tab === ATTENTION_TAB) return renderAttentionTab();
  if (tab === PRODUCTION_FLOOR_TAB) return renderProductionFloorTab();
  if (tab === CONSTRUCTOR_DESK_TAB) return renderConstructorDeskTab();
  if (tab === "Встановлення") return renderInstallTab();
  if (tab === "Історія змін") return historyTab();
  return renderOrdersGrid(ordersData, state.positions, {
    filtersActive: hasActiveFilters()
  });
}

export function renderHeaderChrome() {
  const user = state.currentUser;
  const chip = document.querySelector("#userChip");
  const gear = document.querySelector("#settingsGearBtn");
  const logout = document.querySelector("#logoutBtn");
  const appHeader = document.querySelector(".app-shell-header");
  const appRoot = document.querySelector("#appRoot");
  const toolbar = document.querySelector("#mainToolbar");
  const showMainChrome = state.view === "main";
  const immersiveOperator = state.view === "operator";
  const focusMode = state.view !== "main";

  if (appRoot) {
    appRoot.classList.toggle("app-shell--focus", focusMode);
    appRoot.classList.toggle("app-shell--operator", immersiveOperator);
  }

  if (chip) {
    chip.hidden = !user;
    if (user) chip.textContent = user.name;
  }
  if (gear) {
    gear.hidden = !user || !canViewSettings();
    if (!gear.querySelector(".enver-icon")) gear.innerHTML = iconSvg("settings");
  }
  if (logout) logout.hidden = !user;

  if (user && state.view === "main") {
    mountGodmodeNotifyChrome();
    updateGodmodeNotifyBadge();
  }
  syncGodmodeNotifyForView(state.view);

  if (state.view === "settings") {
    const meta = getSettingsHeaderMeta();
    const title = document.querySelector("#pageTitle");
    const sub = document.querySelector("#pageSubtitle");
    if (title) title.textContent = meta.title;
    if (sub) sub.textContent = meta.subtitle;
  }

  let opBtn = document.querySelector("#productionOperatorBtn");
  if (hasOperatorAccess() && !isOperator()) {
    if (!opBtn) {
      const actions = document.querySelector("#headerActions");
      opBtn = document.createElement("button");
      opBtn.type = "button";
      opBtn.className = "btn btn-sm";
      opBtn.id = "productionOperatorBtn";
      opBtn.textContent = "Панель цеху";
      actions?.insertBefore(opBtn, actions.querySelector("#logoutBtn"));
      opBtn.addEventListener("click", async () => {
        const { enterOperatorView } = await import("./operator-panel.js");
        const { operatorStages } = await import("./auth.js");
        const stages = operatorStages();
        await enterOperatorView(stages[0] || "cutting");
      });
    }
    opBtn.hidden = !showMainChrome;
  } else if (opBtn) {
    opBtn.hidden = true;
  }

  if (appHeader) {
    appHeader.style.display = immersiveOperator ? "none" : "";
  }
  const showToolbar = showMainChrome && shouldShowMainToolbar();
  if (toolbar) {
    toolbar.style.display = showToolbar ? "" : "none";
    toolbar.classList.toggle(
      "toolbar--calendar",
      showMainChrome &&
        state.activeTab === "Встановлення" &&
        state.installCalendar.displayMode !== "list"
    );
  }

  setOperatorUiActive(state.view === "operator");
  document.body.classList.toggle("view-main", state.view === "main");
  document.body.classList.toggle(
    "view-dashboard",
    state.view === "main" && state.activeTab === OVERVIEW_TAB
  );
  document.body.classList.toggle("view-tab-no-toolbar", showMainChrome && !shouldShowMainToolbar());
}

export function renderApp(options = {}) {
  const contentOnly = options.contentOnly === true;
  renderHeaderChrome();

  if (state.view === "settings") {
    const content = document.querySelector("#content");
    try {
      content.innerHTML = renderSettingsView();
      bindSettingsActions(() => window.__enverRender?.());
    } catch (err) {
      content.innerHTML = `
        <div class="note" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">
          Помилка відображення налаштувань: ${escapeHtml(err.message)}
        </div>
      `;
    }
    return;
  }
  if (state.view === "operator") {
    if (!isOperatorStylesLoaded()) {
      void import("./operator-styles.js")
        .then(({ ensureOperatorStyles }) => ensureOperatorStyles())
        .then(() => renderApp(options));
      return;
    }
    document.querySelector("#content").innerHTML = renderOperatorView();
    bindOperatorQueueSwipe();
    bindOperatorScanPanel(state.operatorStage);
    syncOperatorBuildChip("operatorBuildChipInline");
    if (!options.preserveScroll) {
      window.scrollTo(0, 0);
    }
    notifyUiChanged();
    return;
  }

  if (!contentOnly) {
    renderTabs();
    renderKpis();
    renderToolbarActions();
  } else {
    syncNavActiveTab();
    renderPageChrome();
  }
  renderStageFilter();
  const content = document.querySelector("#content");
  try {
    content.innerHTML = renderContent();
  } catch (err) {
    console.error("renderContent failed", err);
    content.innerHTML = `
      <div class="note" style="border-color:#fecaca;background:#fef2f2;color:#991b1b">
        Не вдалося відобразити вкладку «${escapeHtml(state.activeTab)}»: ${escapeHtml(err.message)}
      </div>
    `;
  }

  if (state.activeTab === "Замовлення") {
    const ordersData = filteredOrders();
    if (!state.selectedOrderId) {
      bindOrdersGrid(document.querySelector("#content"), {
        orders: ordersData,
        positions: state.positions,
        onOpenPosition: async (id) => {
          const { openPositionInOrderDetail } = await import("./order-detail.js");
          if (openPositionInOrderDetail(id)) {
            notifyUiChanged();
            renderApp();
            window.scrollTo({ top: 0, behavior: "instant" });
            return;
          }
          const { openPositionDrawer } = await import("./positions.js");
          const position = state.positions.find((p) => p.id === id);
          if (position) openPositionDrawer(position);
        },
        onOrderClick: (order) => {
          clearOrderDetailViewState();
          state.selectedOrderId = order.id;
          state.ordersView.detailTab = "overview";
          notifyUiChanged();
          renderApp();
          window.scrollTo({ top: 0, behavior: "instant" });
        },
        onOrderCta: async (order, triggerEl) => {
          const { executePrimaryOrderAction } = await import("./godmode-ui.js");
          const { upsertPosition, upsertOrder, refreshAppData } = await import("./data-sync.js");
          const { openPositionDrawer } = await import("./positions.js");
          const { toastSuccess, toastError } = await import("./toast.js");
          const { humanizeUserMessage } = await import("./utils.js");
          const { runSave } = await import("./save-flow.js");

          try {
            const result = await runSave("Дія", {
              submitEl: triggerEl,
              silent: true,
              saveFn: () =>
                executePrimaryOrderAction(order, state.positions, {
                  api,
                  upsertPosition,
                  upsertOrder
                })
            });

            if (result.action === "handoff" || result.action === "close_order") {
              toastSuccess(result.message || "Дію виконано");
              await refreshAppData({ includeDirectories: false });
              renderApp({ contentOnly: true });
              return;
            }

            if (result.action === "open_position") {
              const position = state.positions.find((p) => p.id === result.positionId);
              if (position) openPositionDrawer(position, { panel: result.panel });
              return;
            }

            state.selectedOrderId = order.id;
            state.ordersView.detailTab = result.tab || "overview";
            if (result.subTab && String(result.tab || "").startsWith("pos-")) {
              const pid = Number(String(result.tab).slice(4));
              if (Number.isFinite(pid)) {
                state.ordersView.positionSubTab = {
                  ...(state.ordersView.positionSubTab || {}),
                  [pid]: result.subTab
                };
              }
            }
            notifyUiChanged();
            renderApp();
            window.scrollTo({ top: 0, behavior: "instant" });
            if (result.hint === "add_position" || result.tab === "positions") {
              const { focusOrderInlineAddInput } = await import("./order-detail.js");
              focusOrderInlineAddInput();
            }
          } catch (err) {
            toastError(humanizeUserMessage(err?.message || "Не вдалося виконати дію"));
          }
        }
      });
    } else {
      const content = document.querySelector("#content");
      bindOrderDetail(content, {
        onBack: () => {
          clearOrderDetailViewState();
          state.selectedOrderId = null;
          notifyUiChanged();
          renderApp();
          window.scrollTo({ top: 0, behavior: "instant" });
        },
        onRefresh: async (opts) => {
          try {
            const { refreshAppData } = await import("./data-sync.js");
            await refreshAppData({ includeDirectories: false });
          } catch {
            /* локальний стан уже оновлено */
          }
          renderApp(opts);
        },
        onOpenPosition: async (id) => {
          const { openPositionDrawer } = await import("./positions.js");
          const position = state.positions.find((p) => p.id === id);
          if (position) openPositionDrawer(position);
        },
        onEditOrder: async (id) => {
          const { openOrderModal } = await import("./orders.js");
          const order = state.orders.find((o) => o.id === id);
          if (order) openOrderModal(order);
        }
      });
    }
  }

  if (state.activeTab === ATTENTION_TAB) {
    bindAttentionTab(document.querySelector("#content"), {
      onOpenPosition: async (id) => {
        const { openPositionFromContext } = await import("./godmode-navigation.js");
        if (await openPositionFromContext(id)) {
          notifyUiChanged();
          renderApp();
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      },
      onOpenOrder: (orderId) => {
        state.selectedOrderId = orderId;
        state.ordersView.detailTab = "overview";
        state.activeTab = "Замовлення";
        notifyUiChanged();
        renderApp();
        window.scrollTo({ top: 0, behavior: "instant" });
      },
      onAfterAction: () => renderApp({ contentOnly: true })
    });
  }

  if (state.activeTab === PRODUCTION_FLOOR_TAB && canViewProductionFloor()) {
    bindProductionFloorActions({
      onRefresh: async () => {
        try {
          await loadProductionFloor();
          renderApp({ contentOnly: true });
        } catch (err) {
          import("./toast.js").then(({ toastError }) => toastError(err.message));
        }
      },
      onOpenPosition: async (id) => {
        const { openPositionFromContext } = await import("./godmode-navigation.js");
        if (await openPositionFromContext(id)) {
          notifyUiChanged();
          renderApp();
          window.scrollTo({ top: 0, behavior: "instant" });
        }
      }
    });
  }

  if (state.activeTab === CONSTRUCTOR_DESK_TAB && state.constructorDesk.selectedPositionId) {
    bindConstructorDeskWorkspace(() => renderApp({ contentOnly: true }));
  }

  notifyAiContextChanged();
}
