import { api } from "./api.js";
import { canEditPositions, canViewProductionFloor } from "./auth.js";
import {
  PRODUCTION_FLOOR_TAB,
  ATTENTION_TAB,
  OVERVIEW_TAB,
  CONSTRUCTOR_DESK_TAB,
  PROCUREMENT_TAB
} from "./constants.js";
import { historyTab } from "./history.js";
import { renderOperatorView, bindOperatorQueueSwipe } from "./operator-panel.js";
import { bindOperatorScanPanel } from "./part-scan.js";
import { isOperatorStylesLoaded } from "./operator-styles.js";
import { syncOperatorBuildChip } from "./operator-ui.js";
import { renderPositionTableBody, renderPositionCards } from "./render-positions.js";
import {
  bindOrderDetail,
  clearOrderDetailViewState,
  renderOrderDetailView
} from "./order-detail.js";
import { bindOrdersGrid, renderOrdersGrid, renderOrdersModeBar } from "./orders-view.js";
import { bindSettingsActions, renderSettingsView } from "./settings.js";
import { filteredPositions, filteredOrders, hasActiveFilters } from "./filters.js";
import { newProductionTaskIdsForCurrentRole } from "./role-notifications.js";
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
import { bindAttentionTab, renderAttentionTab } from "./attention-view.js";
import { renderDashboard } from "./dashboard.js";
import { bindProcurementTab, renderProcurementTab } from "./procurement-view.js";
import { emptyStateIcon } from "./icons.js";
import {
  renderHeaderChrome,
  renderKpis,
  renderPageChrome,
  renderStageFilter,
  renderTabs,
  renderToolbarActions,
  syncNavActiveTab
} from "./render-chrome.js";

export { filteredPositions };
export { renderResponsibleOptions } from "./render-chrome.js";

function positionsEmptyState() {
  return `<div class="enver-empty-state positions-table-empty" role="status">
    <span class="enver-empty-state-icon" aria-hidden="true">${emptyStateIcon("search")}</span>
    <h3 class="enver-empty-state-title">Нічого не знайдено</h3>
    <p class="enver-empty-state-text">Немає позицій за обраними фільтрами. Скиньте фільтри або змініть пошук.</p>
  </div>`;
}

function positionsTable(data, title = "Позиції замовлення", showActions = false) {
  const allowActions = showActions && canEditPositions();
  const actionHeader = allowActions ? '<th scope="col" title="Дії">Дії</th>' : "";
  const newTaskIds = newProductionTaskIdsForCurrentRole();
  const body = renderPositionTableBody(
    data,
    state.positions,
    state.expandedPositionIds,
    allowActions,
    newTaskIds
  );
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

  const tableHead = `
          <thead>
            <tr>
              <th scope="col" class="col-opt-id">ID</th>
              <th scope="col">Номер замовлення</th>
              <th scope="col" class="col-opt-object">Об'єкт</th>
              <th scope="col" class="left col-item">Виріб / Зона</th>
              <th scope="col" class="col-opt-type">Тип виробу</th>
              <th scope="col" class="col-opt-manager">Менеджер</th>
              <th scope="col" class="col-opt-constructor">Конструктор</th>
              <th scope="col">Порізка</th>
              <th scope="col" class="col-opt-edging">Крайкування</th>
              <th scope="col" class="col-opt-drilling">Присадка</th>
              <th scope="col">Збірка</th>
              <th scope="col" class="col-opt-ready">Дата готовності</th>
              <th scope="col" class="col-opt-install-date">Період монтажу</th>
              <th scope="col">Монтажник</th>
              <th scope="col">Статус позиції</th>
              <th scope="col">Готово, %</th>
              <th scope="col" class="col-opt-overdue">Прострочка, днів</th>
              <th scope="col" class="left col-opt-problem">Проблема</th>
              <th scope="col" class="left col-opt-note">Примітка</th>
              ${actionHeader}
            </tr>
          </thead>`;

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
            <col class="col-w-stage-wide col-opt-edging" />
            <col class="col-w-stage-wide col-opt-drilling" />
            <col class="col-w-stage" />
            <col class="col-w-date col-opt-ready" />
            <col class="col-w-date-wide col-opt-install-date" />
            <col class="col-w-person" />
            <col class="col-w-status" />
            <col class="col-w-progress" />
            <col class="col-w-overdue col-opt-overdue" />
            <col class="col-w-text col-opt-problem" />
            <col class="col-w-text col-opt-note" />
            ${allowActions ? '<col class="col-w-actions" />' : ""}
          </colgroup>
          ${tableHead}
          <tbody>${body || ""}</tbody>
        </table>
        ${body ? "" : `<div class="positions-table-empty-wrap">${positionsEmptyState()}</div>`}
      </div>
    </div>
  `;
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
  if (tab === PROCUREMENT_TAB) return renderProcurementTab();
  if (tab === "Встановлення") return renderInstallTab();
  if (tab === "Історія змін") return historyTab();
  return renderOrdersGrid(ordersData, state.positions, {
    filtersActive: hasActiveFilters()
  });
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

  if (state.activeTab === PROCUREMENT_TAB) {
    bindProcurementTab(document.querySelector("#content"), {
      onRefresh: () => renderApp({ contentOnly: true }),
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

  notifyAiContextChanged();
}
