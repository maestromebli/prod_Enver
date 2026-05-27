import { api } from "./api.js";
import {
  canEditOrders,
  canEditPositions,
  canViewProductionFloor,
  canViewSettings,
  hasOperatorAccess,
  isOperator
} from "./auth.js";
import { PRODUCTION_FLOOR_TAB, STAGE_TABS, TABS } from "./constants.js";
import { STAGE_TAB_KEYS } from "./terminology.js";
import { historyTab } from "./history.js";
import { renderOperatorView } from "./operator-panel.js";
import { renderPositionTableBody } from "./render-positions.js";
import { positionActionButtons, stageQuickActions } from "./positions.js";
import { bindSettingsActions, renderSettingsView } from "./settings.js";
import { renderDashboard } from "./dashboard.js";
import { activeOrders, archivedOrders, archivedPositions } from "./archive.js";
import { filteredPositions } from "./filters.js";
import { renderInstallTab } from "./install-calendar.js";
import {
  bindProductionFloorActions,
  loadProductionFloor,
  renderProductionFloorTab
} from "./production-floor.js";
import { state } from "./state.js";
import { badge, escapeHtml, overdue } from "./utils.js";
import { orderRowHighlightClasses } from "./workflows.js";

export { filteredPositions };

function emptyRow(colspan = 10) {
  return `<tr><td colspan="${colspan}" class="empty">Немає даних за обраними фільтрами</td></tr>`;
}

function positionsTable(data, title = "Позиції замовлення", showActions = false) {
  const allowActions = showActions && canEditPositions();
  const actionHeader = allowActions ? "<th>Дії</th>" : "";
  const colspan = allowActions ? 20 : 19;
  const body =
    renderPositionTableBody(data, state.positions, state.expandedPositionIds, allowActions) ||
    emptyRow(colspan);
  const headerRow = allowActions
    ? `<div class="card-header-row">
        <div class="block-title">${escapeHtml(title)}</div>
        <button type="button" class="btn btn-primary btn-sm" id="newPositionBtn">+ Нова позиція</button>
       </div>`
    : `<div class="block-title">${escapeHtml(title)}</div>`;

  return `
    <div class="card">
      ${headerRow}
      <p class="positions-hint">Основна позиція може мати підпозиції (окремі вироби/зони). Натисніть <strong>+</strong> біля позиції, щоб додати підпозицію з власним конструктором, збирачем і монтажником.</p>
      <div class="table-wrap">
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
              <th class="col-opt-ready">Дата готовності</th>
              <th class="col-opt-install-date">Дата встановлення</th>
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

function ordersLegendHtml() {
  return `
    <div class="orders-legend">
      <span class="legend-item legend-new">Нове замовлення</span>
      <span class="legend-item legend-no-assignment">Без наступного призначення</span>
    </div>
  `;
}

function ordersTable(showActions = false, ordersData = activeOrders(state.orders)) {
  const allowEdit = showActions && canEditOrders();
  const actionHeader = allowEdit ? "<th>Дії</th>" : "";
  const rows = ordersData
    .map((o) => {
      const rowClass = orderRowHighlightClasses(o, state.positions);
      const actions = allowEdit
        ? `<td class="actions-cell">
            <button type="button" class="btn btn-sm" data-edit-order="${o.id}">Змінити</button>
           </td>`
        : "";

      return `
        <tr class="${rowClass}">
          <td class="col-opt-id">${o.id}</td>
          <td>${escapeHtml(o.orderNumber)}</td>
          <td class="col-opt-object">${escapeHtml(o.object)}</td>
          <td class="col-opt-client">${escapeHtml(o.client)}</td>
          <td class="col-opt-manager">${escapeHtml(o.manager)}</td>
          <td class="col-opt-start-date">${escapeHtml(o.startDate)}</td>
          <td class="col-opt-plan-date">${escapeHtml(o.planDate)}</td>
          <td>${badge(o.status)}</td>
          <td class="col-opt-priority">${escapeHtml(o.priority)}</td>
          <td class="left col-opt-comment">${escapeHtml(o.comment || "—")}</td>
          ${actions}
        </tr>
      `;
    })
    .join("");

  const headerActions = allowEdit
    ? `<div class="card-header-row">
        <div class="block-title">Замовлення</div>
        <button type="button" class="btn btn-primary btn-sm" id="newOrderBtn">+ Нове замовлення</button>
       </div>`
    : `<div class="block-title">Замовлення</div>`;

  return `
    <div class="card">
      ${headerActions}
      ${ordersLegendHtml()}
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-opt-id">ID замовлення</th>
              <th>Номер замовлення</th>
              <th class="col-opt-object">Об'єкт / Адреса</th>
              <th class="col-opt-client">Клієнт</th>
              <th class="col-opt-manager">Менеджер</th>
              <th class="col-opt-start-date">Дата запуску</th>
              <th class="col-opt-plan-date">Планова дата завершення</th>
              <th>Статус замовлення</th>
              <th class="col-opt-priority">Пріоритет</th>
              <th class="left col-opt-comment">Коментар</th>
              ${actionHeader}
            </tr>
          </thead>
          <tbody>${rows || emptyRow(showActions ? 11 : 10)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function archiveTab() {
  const ordersData = archivedOrders(state.orders);
  const orderNumberSet = new Set(ordersData.map((o) => o.orderNumber));
  const positionsData = archivedPositions(state.positions, state.orders).filter((p) =>
    orderNumberSet.has(p.orderNumber)
  );

  return `
    <div class="note">
      У архів автоматично потрапляють завершені проєкти. Вони зникають з активних вкладок і лишаються лише тут.
    </div>
    ${ordersTable(false, ordersData)}
    ${positionsTable(positionsData, "Архівні позиції")}
  `;
}

function stageRows(stageName) {
  const statusMap = {
    Порізка: "cuttingStatus",
    Крайкування: "edgingStatus",
    Присадка: "drillingStatus",
    Збірка: "assemblyStatus"
  };

  const statusKey = statusMap[stageName];
  const stageKey = STAGE_TAB_KEYS[stageName] || "cutting";

  return filteredPositions()
    .map((p) => {
      const responsible =
        stageName === "Конструктив"
          ? p.constructor
          : stageName === "Збірка"
            ? p.assemblyResponsible
            : stageName === "Порізка" || stageName === "Крайкування"
              ? "Віяр"
              : p.assemblyResponsible || "—";

      const status =
        stageName === "Конструктив" ? (p.constructor ? "Передано" : "Не розпочато") : p[statusKey];
      const itemLabel = p.parentId ? `↳ ${p.item}` : p.item;

      return `
        <tr class="${p.parentId ? "row-sub-position" : ""}">
          <td class="col-opt-id">${p.id}</td>
          <td>${escapeHtml(p.orderNumber)}</td>
          <td class="col-opt-object">${escapeHtml(p.object)}</td>
          <td class="left">${escapeHtml(itemLabel)}</td>
          <td class="col-opt-manager">${escapeHtml(responsible || "—")}</td>
          <td>${badge(status)}</td>
          <td class="col-opt-plan-date">${escapeHtml(p.readyDate || "—")}</td>
          <td class="col-opt-fact-date">${status === "Готово" ? escapeHtml(p.readyDate || "—") : "—"}</td>
          <td class="col-opt-overdue">${overdue(p.overdueDays)}</td>
          <td>${stageQuickActions(p.id, stageKey)}</td>
          <td class="left col-opt-comment">${escapeHtml(p.problem || p.note || "—")}</td>
        </tr>
      `;
    })
    .join("");
}

function stageTable(stageName) {
  const rows = stageRows(stageName);

  return `
    <div class="note">
      Вкладка «${escapeHtml(stageName)}» показує завдання лише за одним процесом. Так виробництво бачить не всю простиню замовлень, а конкретний етап, статус, відповідального й прострочку.
    </div>
    <div class="card">
      <div class="block-title">${escapeHtml(stageName)}</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-opt-id">ID позиції</th>
              <th>Замовлення</th>
              <th class="col-opt-object">Об'єкт</th>
              <th class="left">Виріб</th>
              <th class="col-opt-manager">Відповідальний</th>
              <th>Статус</th>
              <th class="col-opt-plan-date">Планова дата</th>
              <th class="col-opt-fact-date">Фактична дата</th>
              <th class="col-opt-overdue">Прострочка</th>
              <th>Перехід</th>
              <th class="left col-opt-comment">Коментар</th>
            </tr>
          </thead>
          <tbody>${rows || emptyRow(11)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function productionTable() {
  const stageFilter = state.productionStageFilter || "";
  const stages = stageFilter ? [stageFilter] : STAGE_TABS;
  const rows = [];

  filteredPositions().forEach((p) => {
    stages.forEach((stage) => {
      let status = "Не розпочато";
      let responsible = "—";

      if (stage === "Конструктив") {
        status = p.constructor ? "Передано" : "Не розпочато";
        responsible = p.constructor || "—";
      }
      if (stage === "Порізка") {
        status = p.cuttingStatus;
        responsible = "Віяр";
      }
      if (stage === "Крайкування") {
        status = p.edgingStatus;
        responsible = "Віяр";
      }
      if (stage === "Присадка") {
        status = p.drillingStatus;
        responsible = p.assemblyResponsible || "—";
      }
      if (stage === "Збірка") {
        status = p.assemblyStatus;
        responsible = p.assemblyResponsible || "—";
      }

      rows.push(`
        <tr>
          <td class="col-opt-id">${p.id}</td>
          <td>${escapeHtml(p.orderNumber)}</td>
          <td class="col-opt-object">${escapeHtml(p.object)}</td>
          <td class="left">${escapeHtml(p.item)}</td>
          <td>${escapeHtml(stage)}</td>
          <td>${badge(status)}</td>
          <td class="col-opt-manager">${escapeHtml(responsible)}</td>
          <td class="col-opt-plan-date">${escapeHtml(p.readyDate || "—")}</td>
          <td class="col-opt-fact-date">${status === "Готово" ? escapeHtml(p.readyDate || "—") : "—"}</td>
          <td class="col-opt-overdue">${overdue(p.overdueDays)}</td>
          <td class="left col-opt-comment">${escapeHtml(p.problem || "—")}</td>
        </tr>
      `);
    });
  });

  return `
    <div class="card">
      <div class="block-title">Виробництво за етапами</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-opt-id">ID позиції</th>
              <th>Замовлення</th>
              <th class="col-opt-object">Об'єкт</th>
              <th class="left">Виріб</th>
              <th>Етап</th>
              <th>Статус етапу</th>
              <th class="col-opt-manager">Відповідальний</th>
              <th class="col-opt-plan-date">Планова дата</th>
              <th class="col-opt-fact-date">Фактична дата</th>
              <th class="col-opt-overdue">Прострочка</th>
              <th class="left col-opt-comment">Коментар</th>
            </tr>
          </thead>
          <tbody>${rows.length ? rows.join("") : emptyRow(11)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function overdueTable() {
  const data = filteredPositions(state.positions.filter((p) => p.overdueDays > 0));

  return `
    <div class="card">
      <div class="block-title">Прострочені позиції</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th class="col-opt-id">ID позиції</th>
              <th>Замовлення</th>
              <th class="col-opt-object">Об'єкт</th>
              <th class="left">Виріб</th>
              <th>Етап</th>
              <th class="col-opt-manager">Відповідальний</th>
              <th>Прострочка, днів</th>
              <th class="left col-opt-comment">Причина</th>
              <th>Дії</th>
            </tr>
          </thead>
          <tbody>
            ${
              data.length
                ? data
                    .map(
                      (p) => `
                        <tr class="row-clickable" data-edit-position="${p.id}">
                          <td class="col-opt-id">${p.id}</td>
                          <td>${escapeHtml(p.orderNumber)}</td>
                          <td class="col-opt-object">${escapeHtml(p.object)}</td>
                          <td class="left">${escapeHtml(p.item)}</td>
                          <td>${p.assemblyStatus !== "Готово" ? "Збірка / Виробництво" : "Встановлення"}</td>
                          <td class="col-opt-manager">${escapeHtml(p.assemblyResponsible || p.constructor || "—")}</td>
                          <td>${overdue(p.overdueDays)}</td>
                          <td class="left col-opt-comment">${escapeHtml(p.problem || "Не вказано")}</td>
                          <td>${positionActionButtons(p.id, true)}</td>
                        </tr>
                      `
                    )
                    .join("")
                : emptyRow(9)
            }
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function dashboard() {
  return renderDashboard();
}

function visibleTabs() {
  return TABS.filter((tab) => tab !== PRODUCTION_FLOOR_TAB || canViewProductionFloor());
}

export function renderTabs() {
  document.querySelector("#tabs").innerHTML = visibleTabs()
    .map(
      (tab) => `
      <button type="button" class="tab-btn ${tab === state.activeTab ? "active" : ""}" data-tab="${escapeHtml(tab)}">
        ${escapeHtml(tab)}
      </button>
    `
    )
    .join("");
}

export function renderKpis() {
  const k = state.kpis;
  if (!k) return;

  const kpis = [
    ["Активні замовлення", k.activeOrders, "blue"],
    ["У виробництві", k.inProduction, "blue"],
    ["Вироби в роботі", k.inWork, "blue"],
    ["Прострочені", k.overdueCount, "red"],
    ["До монтажу", k.readyInstall, "green"],
    ["Монтажі", k.installs, "blue"],
    ["Конструктори", k.constructors, "blue"],
    ["Збирачі", k.assemblers, "blue"]
  ];

  document.querySelector("#kpiGrid").innerHTML = kpis
    .map(
      ([label, value, tone]) => `
        <div class="kpi kpi-tone-${tone}" title="${escapeHtml(label)}">
          <div class="kpi-label">${escapeHtml(label)}</div>
          <div class="kpi-value ${tone}">${value}</div>
        </div>
      `
    )
    .join("");
}

export function renderResponsibleOptions() {
  const select = document.querySelector("#responsibleFilter");
  const current = select.value;
  const people = new Set();

  state.positions.forEach((p) => {
    [p.manager, p.constructor, p.assemblyResponsible, p.installResponsible]
      .filter(Boolean)
      .forEach((person) => people.add(person));
  });

  select.innerHTML = `
    <option value="">Усі відповідальні</option>
    ${Array.from(people)
      .sort()
      .map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`)
      .join("")}
  `;
  select.value = current;
}

export function renderToolbarActions() {
  const el = document.querySelector("#toolbarActions");
  if (!el) return;
  const parts = [];
  if (state.activeTab === "Замовлення" && canEditOrders()) {
    parts.push(
      `<button type="button" class="btn btn-primary" id="toolbarNewOrderBtn">+ Нове замовлення</button>`
    );
  }
  if (state.activeTab === "Позиції замовлення" && canEditPositions()) {
    parts.push(
      `<button type="button" class="btn btn-primary" id="toolbarNewPositionBtn">+ Нова позиція</button>`
    );
  }
  if (["Дашборд", "Позиції замовлення", "Прострочки"].includes(state.activeTab)) {
    parts.push(`<button type="button" class="btn btn-sm" id="exportCsvBtn">Експорт CSV</button>`);
  }
  el.innerHTML = parts.join("");
}

export function renderStageFilter() {
  const select = document.querySelector("#stageFilter");
  if (!select) return;

  const show = state.activeTab === "Виробництво за етапами";
  const field = select.closest(".filter-field");
  select.hidden = !show;
  if (field) field.hidden = !show;
  if (show) {
    select.value = state.productionStageFilter || "";
  }
}

function renderContent() {
  const data = filteredPositions();
  const tab = state.activeTab;

  if (tab === "Дашборд") return dashboard();
  if (tab === PRODUCTION_FLOOR_TAB) return renderProductionFloorTab();
  if (tab === "Замовлення") return ordersTable(true);
  if (tab === "Позиції замовлення") return positionsTable(data, "Позиції замовлення", true);
  if (tab === "Виробництво за етапами") return productionTable();
  if (STAGE_TABS.includes(tab)) return stageTable(tab);
  if (tab === "Встановлення") return renderInstallTab();
  if (tab === "Прострочки") return overdueTable();
  if (tab === "Архів") return archiveTab();
  if (tab === "Історія змін") return historyTab();
  return dashboard();
}

export function renderHeaderChrome() {
  const user = state.currentUser;
  const chip = document.querySelector("#userChip");
  const gear = document.querySelector("#settingsGearBtn");
  const logout = document.querySelector("#logoutBtn");
  const topbar = document.querySelector(".topbar");
  const toolbar = document.querySelector("#mainToolbar");
  const showMainChrome = state.view === "main";
  const immersiveOperator = state.view === "operator" && isOperator();

  if (chip) {
    chip.hidden = !user;
    if (user) chip.textContent = user.name;
  }
  if (gear) gear.hidden = !canViewSettings();
  if (logout) logout.hidden = !user;

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

  if (topbar) {
    topbar.style.display = immersiveOperator ? "none" : "";
    topbar.classList.toggle("topbar-slim", !showMainChrome && !immersiveOperator);
  }
  if (toolbar) {
    toolbar.style.display = showMainChrome ? "" : "none";
    toolbar.classList.toggle(
      "toolbar--calendar",
      showMainChrome &&
        state.activeTab === "Встановлення" &&
        state.installCalendar.displayMode !== "list"
    );
  }

  document.body.classList.toggle("view-operator", state.view === "operator");
  document.body.classList.toggle(
    "view-dashboard",
    state.view === "main" && state.activeTab === "Дашборд"
  );
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
    document.querySelector("#content").innerHTML = renderOperatorView();
    return;
  }

  if (!contentOnly) {
    renderTabs();
    renderKpis();
    renderToolbarActions();
  }
  renderStageFilter();
  document.querySelector("#content").innerHTML = renderContent();

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
        let position = state.positions.find((p) => p.id === id);
        if (!position) {
          try {
            position = await api.getPosition(id);
          } catch (err) {
            const { toastError } = await import("./toast.js");
            toastError(err.message || "Не вдалося відкрити позицію");
            return;
          }
        }
        const { openPositionDrawer } = await import("./positions.js");
        openPositionDrawer(position);
      }
    });
  }
}
