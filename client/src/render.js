import { api } from "./api.js";
import {
  canEditOrders,
  canEditPositions,
  canViewProductionFloor,
  canViewSettings,
  hasOperatorAccess,
  isOperator
} from "./auth.js";
import { PRODUCTION_FLOOR_TAB, TABS } from "./constants.js";
import { historyTab } from "./history.js";
import { renderOperatorView } from "./operator-panel.js";
import { setOperatorUiActive, syncOperatorBuildChip } from "./operator-ui.js";
import { renderPositionTableBody } from "./render-positions.js";
import { bindOrdersGrid, renderOrdersGrid } from "./orders-view.js";
import { bindSettingsActions, renderSettingsView } from "./settings.js";
import { getTourStep, renderTourCoach } from "./tour.js";
import { filteredPositions } from "./filters.js";
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
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";

export { filteredPositions };

function emptyRow(colspan = 10) {
  return `<tr><td colspan="${colspan}" class="empty">Немає даних за обраними фільтрами</td></tr>`;
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
  const headerRow = allowActions
    ? `<div class="card-header-row">
        <div class="block-title">${escapeHtml(title)}</div>
        <button type="button" class="btn btn-primary btn-sm" id="newPositionBtn">+ Нова позиція</button>
       </div>`
    : `<div class="block-title">${escapeHtml(title)}</div>`;

  return `
    <div class="card">
      ${headerRow}
      <p class="positions-hint">У кожному замовленні є одна основна позиція; вироби та зони завжди додаються як <strong>підпозиції</strong> через <strong>+</strong> біля неї (окремий конструктор, збирач і монтажник).</p>
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

function visibleTabs() {
  return TABS.filter((tab) => tab !== PRODUCTION_FLOOR_TAB || canViewProductionFloor());
}

const TAB_META = {
  Замовлення: { icon: "◫", subtitle: "Картки з прогресом і етапами" },
  [PRODUCTION_FLOOR_TAB]: { icon: "⬡", subtitle: "Черги, сесії та проблеми" },
  Встановлення: { icon: "▦", subtitle: "Календар монтажу" },
  Позиції: { icon: "☰", subtitle: "Таблиця всіх позицій" },
  "Історія змін": { icon: "◷", subtitle: "Аудит дій у системі" }
};

function renderPageChrome() {
  const meta = TAB_META[state.activeTab] || { subtitle: "" };
  const title = document.querySelector("#pageTitle");
  const sub = document.querySelector("#pageSubtitle");
  if (title) title.textContent = state.activeTab;
  if (sub) sub.textContent = meta.subtitle || "";
}

export function renderTabs() {
  const tour = getTourStep();
  const newOrders = countNewOrdersForCurrentRole();
  const newTasks = countNewProductionTasksForCurrentRole();
  const tabBadge = (count) => (count > 0 ? `<span class="tab-reminder-badge">${count}</span>` : "");
  document.querySelector("#tabs").innerHTML = visibleTabs()
    .map((tab) => {
      const meta = TAB_META[tab] || { icon: "•" };
      return `
      <button
        type="button"
        class="tab-btn ${tab === state.activeTab ? "active" : ""} ${tour?.tab === tab ? "tour-target" : ""}"
        data-tab="${escapeHtml(tab)}"
      >
        <span class="app-shell-nav-icon" aria-hidden="true">${meta.icon}</span>
        <span class="app-shell-nav-label">${escapeHtml(tab)}</span>
        ${tab === "Замовлення" ? tabBadge(newOrders) : ""}
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
  if (state.activeTab === "Позиції" && canEditPositions()) {
    parts.push(
      `<button type="button" class="btn btn-primary" id="toolbarNewPositionBtn">+ Нова позиція</button>`
    );
  }
  if (state.activeTab === "Позиції") {
    parts.push(`<button type="button" class="btn btn-sm" id="exportCsvBtn">Експорт CSV</button>`);
  }
  parts.push(renderTourCoach());
  el.innerHTML = parts.join("");
}

export function renderStageFilter() {
  const select = document.querySelector("#stageFilter");
  if (!select) return;

  const field = select.closest(".filter-field");
  select.hidden = true;
  if (field) field.hidden = true;
}

function renderContent() {
  const data = filteredPositions();
  const tab = state.activeTab;

  if (tab === "Замовлення") return renderOrdersGrid(state.orders, state.positions);
  if (tab === PRODUCTION_FLOOR_TAB) return renderProductionFloorTab();
  if (tab === "Позиції") return positionsTable(data, "Позиції", true);
  if (tab === "Встановлення") return renderInstallTab();
  if (tab === "Історія змін") return historyTab();
  return renderOrdersGrid(state.orders, state.positions);
}

export function renderHeaderChrome() {
  const user = state.currentUser;
  const chip = document.querySelector("#userChip");
  const gear = document.querySelector("#settingsGearBtn");
  const logout = document.querySelector("#logoutBtn");
  const topbar = document.querySelector(".app-shell-main");
  const appRoot = document.querySelector("#appRoot");
  const toolbar = document.querySelector("#mainToolbar");
  const showMainChrome = state.view === "main";
  const immersiveOperator = state.view === "operator";
  const focusMode = state.view !== "main";

  if (appRoot) {
    appRoot.classList.toggle("app-shell--focus", focusMode);
  }

  if (chip) {
    chip.hidden = !user;
    if (user) chip.textContent = user.name;
  }
  const notifyBtn = document.querySelector("#notifySettingsBtn");
  if (gear) gear.hidden = !canViewSettings();
  if (notifyBtn) notifyBtn.hidden = !user || canViewSettings();
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

  setOperatorUiActive(state.view === "operator");
  document.body.classList.toggle("view-main", state.view === "main");
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
    syncOperatorBuildChip("operatorBuildChipInline");
    window.scrollTo(0, 0);
    return;
  }

  if (!contentOnly) {
    renderTabs();
    renderKpis();
    renderToolbarActions();
  } else {
    renderPageChrome();
  }
  renderStageFilter();
  document.querySelector("#content").innerHTML = renderContent();

  if (state.activeTab === "Замовлення") {
    bindOrdersGrid(document.querySelector("#content"), {
      orders: state.orders,
      positions: state.positions,
      onOpenPosition: async (pos) => {
        const { openPositionDrawer } = await import("./positions.js");
        openPositionDrawer(pos);
      }
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
