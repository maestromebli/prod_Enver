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
            <col class="col-w-type" />
            <col class="col-w-person" />
            <col class="col-w-person" />
            <col class="col-w-stage" span="4" />
            <col class="col-w-date" />
            <col class="col-w-date" />
            <col class="col-w-person" />
            <col class="col-w-status" />
            <col class="col-w-progress" />
            <col class="col-w-overdue" />
            <col class="col-w-text" />
            <col class="col-w-text" />
            ${allowActions ? '<col class="col-w-actions" />' : ""}
          </colgroup>
          <thead>
            <tr>
              <th>ID</th>
              <th>Номер замовлення</th>
              <th>Об'єкт / Адреса</th>
              <th class="left col-item">Виріб / Зона</th>
              <th>Тип виробу</th>
              <th>Менеджер</th>
              <th>Конструктор</th>
              <th>Порізка</th>
              <th>Крайкування</th>
              <th>Присадка</th>
              <th>Збірка</th>
              <th>Дата готовності</th>
              <th>Дата встановлення</th>
              <th>Монтажник</th>
              <th>Статус позиції</th>
              <th>Готово, %</th>
              <th>Прострочка, днів</th>
              <th class="left">Проблема</th>
              <th class="left">Примітка</th>
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

function ordersTable(showActions = false) {
  const allowEdit = showActions && canEditOrders();
  const actionHeader = allowEdit ? "<th>Дії</th>" : "";
  const rows = state.orders
    .map((o) => {
      const rowClass = orderRowHighlightClasses(o, state.positions);
      const actions = allowEdit
        ? `<td class="actions-cell">
            <button type="button" class="btn btn-sm" data-edit-order="${o.id}">Змінити</button>
           </td>`
        : "";

      return `
        <tr class="${rowClass}">
          <td>${o.id}</td>
          <td>${escapeHtml(o.orderNumber)}</td>
          <td>${escapeHtml(o.object)}</td>
          <td>${escapeHtml(o.client)}</td>
          <td>${escapeHtml(o.manager)}</td>
          <td>${escapeHtml(o.startDate)}</td>
          <td>${escapeHtml(o.planDate)}</td>
          <td>${badge(o.status)}</td>
          <td>${escapeHtml(o.priority)}</td>
          <td class="left">${escapeHtml(o.comment || "—")}</td>
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
              <th>ID замовлення</th>
              <th>Номер замовлення</th>
              <th>Об'єкт / Адреса</th>
              <th>Клієнт</th>
              <th>Менеджер</th>
              <th>Дата запуску</th>
              <th>Планова дата завершення</th>
              <th>Статус замовлення</th>
              <th>Пріоритет</th>
              <th class="left">Коментар</th>
              ${actionHeader}
            </tr>
          </thead>
          <tbody>${rows || emptyRow(showActions ? 11 : 10)}</tbody>
        </table>
      </div>
    </div>
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
          <td>${p.id}</td>
          <td>${escapeHtml(p.orderNumber)}</td>
          <td>${escapeHtml(p.object)}</td>
          <td class="left">${escapeHtml(itemLabel)}</td>
          <td>${escapeHtml(responsible || "—")}</td>
          <td>${badge(status)}</td>
          <td>${escapeHtml(p.readyDate || "—")}</td>
          <td>${status === "Готово" ? escapeHtml(p.readyDate || "—") : "—"}</td>
          <td>${overdue(p.overdueDays)}</td>
          <td>${stageQuickActions(p.id, stageKey)}</td>
          <td class="left">${escapeHtml(p.problem || p.note || "—")}</td>
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
              <th>ID позиції</th>
              <th>Замовлення</th>
              <th>Об'єкт</th>
              <th class="left">Виріб</th>
              <th>Відповідальний</th>
              <th>Статус</th>
              <th>Планова дата</th>
              <th>Фактична дата</th>
              <th>Прострочка</th>
              <th>Перехід</th>
              <th class="left">Коментар</th>
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
          <td>${p.id}</td>
          <td>${escapeHtml(p.orderNumber)}</td>
          <td>${escapeHtml(p.object)}</td>
          <td class="left">${escapeHtml(p.item)}</td>
          <td>${escapeHtml(stage)}</td>
          <td>${badge(status)}</td>
          <td>${escapeHtml(responsible)}</td>
          <td>${escapeHtml(p.readyDate || "—")}</td>
          <td>${status === "Готово" ? escapeHtml(p.readyDate || "—") : "—"}</td>
          <td>${overdue(p.overdueDays)}</td>
          <td class="left">${escapeHtml(p.problem || "—")}</td>
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
              <th>ID позиції</th>
              <th>Замовлення</th>
              <th>Об'єкт</th>
              <th class="left">Виріб</th>
              <th>Етап</th>
              <th>Статус етапу</th>
              <th>Відповідальний</th>
              <th>Планова дата</th>
              <th>Фактична дата</th>
              <th>Прострочка</th>
              <th class="left">Коментар</th>
            </tr>
          </thead>
          <tbody>${rows.length ? rows.join("") : emptyRow(11)}</tbody>
        </table>
      </div>
    </div>
  `;
}

function installTable() {
  const data = filteredPositions(
    state.positions.filter((p) => p.positionStatus === "Готово до встановлення" || p.installDate)
  );

  return `
    <div class="card">
      <div class="block-title">Встановлення</div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>ID позиції</th>
              <th>Номер замовлення</th>
              <th>Об'єкт</th>
              <th class="left">Виріб</th>
              <th>Дата готовності</th>
              <th>Планова дата встановлення</th>
              <th>Монтажник</th>
              <th>Статус встановлення</th>
              <th>Що не готово</th>
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
                          <td>${p.id}</td>
                          <td>${escapeHtml(p.orderNumber)}</td>
                          <td>${escapeHtml(p.object)}</td>
                          <td class="left">${escapeHtml(p.item)}</td>
                          <td>${escapeHtml(p.readyDate || "—")}</td>
                          <td>${escapeHtml(p.installDate || "—")}</td>
                          <td>${escapeHtml(p.installResponsible || "—")}</td>
                          <td>${badge(p.positionStatus === "Готово до встановлення" ? "Готово до встановлення" : "В роботі")}</td>
                          <td>${p.progress < 100 ? "Не всі етапи закриті" : "—"}</td>
                          <td>${positionActionButtons(p.id, true)}</td>
                        </tr>
                      `
                    )
                    .join("")
                : emptyRow(11)
            }
          </tbody>
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
              <th>ID позиції</th>
              <th>Замовлення</th>
              <th>Об'єкт</th>
              <th class="left">Виріб</th>
              <th>Етап</th>
              <th>Відповідальний</th>
              <th>Прострочка, днів</th>
              <th class="left">Причина</th>
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
                          <td>${p.id}</td>
                          <td>${escapeHtml(p.orderNumber)}</td>
                          <td>${escapeHtml(p.object)}</td>
                          <td class="left">${escapeHtml(p.item)}</td>
                          <td>${p.assemblyStatus !== "Готово" ? "Збірка / Виробництво" : "Встановлення"}</td>
                          <td>${escapeHtml(p.assemblyResponsible || p.constructor || "—")}</td>
                          <td>${overdue(p.overdueDays)}</td>
                          <td class="left">${escapeHtml(p.problem || "Не вказано")}</td>
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

function dashboardCommandCenter() {
  const data = state.positions;
  const problems = data.filter((p) => p.problem?.trim() || p.positionStatus === "Проблема");
  const overdue = data.filter((p) => (p.overdueDays ?? 0) > 0);
  const ready = data.filter((p) => p.positionStatus === "Готово до встановлення");
  const inWork = data.filter((p) => p.positionStatus === "У виробництві");

  const card = (title, count, cls, hint) => `
    <div class="dash-widget ${cls}">
      <div class="dash-widget-value">${count}</div>
      <div class="dash-widget-label">${escapeHtml(title)}</div>
      <div class="dash-widget-hint">${escapeHtml(hint)}</div>
    </div>`;

  return `
    <div class="dash-command">
      ${card("Проблеми", problems.length, "dash-red", "потребують уваги")}
      ${card("Прострочені", overdue.length, "dash-orange", "днів понад план")}
      ${card("У виробництві", inWork.length, "dash-blue", "активні позиції")}
      ${card("До монтажу", ready.length, "dash-green", "готові до встановлення")}
    </div>`;
}

function dashboard() {
  const data = filteredPositions();
  const readyData = data.filter((p) => p.positionStatus === "Готово до встановлення");

  return `
    <div class="card">
      <div class="block-title">Штаб виробництва ENVER</div>
      ${dashboardCommandCenter()}
    </div>
    ${positionsTable(data, "Позиції замовлення", canEditPositions())}
    <div class="grid-2">
      ${ordersTable(false)}
      ${installTable()}
    </div>
    <div class="grid-2">
      ${overdueTable()}
      ${positionsTable(readyData, "Готові до встановлення")}
    </div>
  `;
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
