import {
  canEditOrders,
  canViewProductionFloor,
  canViewConstructorDesk,
  canViewProcurement,
  canViewSettings,
  hasOperatorAccess,
  isOperator
} from "./auth.js";
import {
  PRODUCTION_FLOOR_TAB,
  TABS,
  ATTENTION_TAB,
  OVERVIEW_TAB,
  CONSTRUCTOR_DESK_TAB,
  PROCUREMENT_TAB
} from "./constants.js";
import { getSettingsHeaderMeta } from "./settings.js";
import { getTourStep, renderTourCoach } from "./tour.js";
import { syncListFiltersToDom } from "./filters.js";
import { renderFilterPresetBar } from "./filter-presets.js";
import {
  countNewOrdersForCurrentRole,
  countNewProductionTasksForCurrentRole
} from "./role-notifications.js";
import { state } from "./state.js";
import { escapeHtml } from "./utils.js";
import { attentionTabBadgeCount } from "./attention-view.js";
import { formatObjectHeader } from "@enver/shared/production/object-display.js";
import {
  getWorkPositions,
  positionsForOrder
} from "@enver/shared/production/order-position-model.js";
import {
  mountGodmodeNotifyChrome,
  syncGodmodeNotifyForView,
  updateGodmodeNotifyBadge
} from "./godmode-notifications.js";
import { navIconSvg, iconSvg } from "./icons.js";
import { setOperatorUiActive } from "./operator-ui.js";
import { procurementTabBadgeCount } from "./procurement-view.js";
import { renderShortcutsHintButton, bindShortcutsHintButton } from "./keyboard-shortcuts.js";

function isOrdersRegistry() {
  return state.activeTab === "Замовлення" && !state.selectedOrderId && state.view === "main";
}

function isOrdersPositionsMode() {
  return isOrdersRegistry() && state.ordersView.displayMode === "positions";
}

function visibleTabs() {
  return TABS.filter((tab) => {
    if (tab === PRODUCTION_FLOOR_TAB) return canViewProductionFloor();
    if (tab === CONSTRUCTOR_DESK_TAB) return canViewConstructorDesk();
    if (tab === PROCUREMENT_TAB) return canViewProcurement();
    return true;
  });
}

const TAB_META = {
  [OVERVIEW_TAB]: { subtitle: "Ключові показники та швидкі переходи" },
  Замовлення: { subtitle: "Картки, список замовлень або реєстр позицій" },
  [ATTENTION_TAB]: { subtitle: "Блокери, попередження та наступні кроки" },
  [PRODUCTION_FLOOR_TAB]: { subtitle: "Черги, сесії та проблеми" },
  [CONSTRUCTOR_DESK_TAB]: { subtitle: "Картки або список замовлень у конструктиві" },
  [PROCUREMENT_TAB]: { subtitle: "Календар MTO, склад, рекламації" },
  Встановлення: { subtitle: "Календар монтажу" },
  "Історія змін": { subtitle: "Аудит дій у системі" }
};

function shouldShowMainToolbar() {
  if (state.view !== "main") return false;
  if (state.activeTab !== "Замовлення") return false;
  return true;
}

export function renderPageChrome() {
  const meta = TAB_META[state.activeTab] || { subtitle: "" };
  const title = document.querySelector("#pageTitle");
  const sub = document.querySelector("#pageSubtitle");
  if (state.activeTab === "Замовлення" && state.selectedOrderId) {
    const order = state.orders.find((o) => o.id === state.selectedOrderId);
    if (order) {
      const tab = state.ordersView?.detailTab || "overview";
      const { title: objectTitle } = formatObjectHeader(order);
      if (title) title.textContent = objectTitle;
      if (sub) {
        if (tab.startsWith("pos-")) {
          const related = positionsForOrder(order, state.positions);
          const position = getWorkPositions(order, related).find(
            (p) => p.id === Number(tab.slice(4))
          );
          sub.textContent =
            String(position?.item ?? "").trim() || order.client || "Позиція замовлення";
        } else {
          sub.textContent =
            [order.client, order.object].filter(Boolean).join(" · ") || "Позиції замовлення";
        }
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
  const procurementCount = procurementTabBadgeCount();
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
        ${tab === PROCUREMENT_TAB ? tabBadge(procurementCount) : ""}
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

  let presetMount = document.querySelector("#filterPresetBar");
  if (!presetMount && onOrdersRegistry) {
    const toolbar = document.querySelector("#mainToolbar");
    if (toolbar) {
      toolbar.insertAdjacentHTML(
        "afterend",
        '<div id="filterPresetBar" class="filter-preset-mount"></div>'
      );
      presetMount = document.querySelector("#filterPresetBar");
    }
  }
  if (presetMount) {
    if (onOrdersRegistry) {
      presetMount.innerHTML = renderFilterPresetBar();
      presetMount.hidden = false;
    } else {
      presetMount.innerHTML = "";
      presetMount.hidden = true;
    }
  }
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
  if (positionsMode) {
    parts.push(`<button type="button" class="btn btn-sm" id="exportCsvBtn">Експорт CSV</button>`);
  }
  parts.push(renderTourCoach());
  el.innerHTML = parts.join("");
}

export function renderStageFilter() {
  renderToolbarFilters();
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

  let shortcutsBtn = document.querySelector("#shortcutsHintBtn");
  if (user && showMainChrome) {
    if (!shortcutsBtn) {
      const actions = document.querySelector("#headerActions");
      const mount = document.createElement("span");
      mount.innerHTML = renderShortcutsHintButton();
      shortcutsBtn = mount.firstElementChild;
      actions?.insertBefore(shortcutsBtn, actions.querySelector("#themeToggleBtn"));
      bindShortcutsHintButton();
    }
    shortcutsBtn.hidden = false;
  } else if (shortcutsBtn) {
    shortcutsBtn.hidden = true;
  }

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
