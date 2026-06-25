import { state } from "./state.js";
import {
  activeOrders,
  activePositions,
  archivedPositions,
  isArchivedOrder,
  ORDER_DONE_STATUS
} from "./archive.js";
import { positionsForOrder } from "./workflows.js";

export function currentFilters() {
  return {
    search: (state.listFilters.search ?? "").toLowerCase().trim(),
    status: state.listFilters.status ?? "",
    responsible: state.listFilters.responsible ?? "",
    priority: state.ordersView.priorityFilter ?? ""
  };
}

/** Оновлює фільтри в state і синхронізує з DOM (якщо елементи вже є). */
export function setListFilters({ search, status, responsible } = {}) {
  if (search != null) state.listFilters.search = String(search);
  if (status != null) state.listFilters.status = String(status);
  if (responsible != null) state.listFilters.responsible = String(responsible);
  syncListFiltersToDom();
}

/** Після перемальовування тулбару — відновити значення фільтрів зі state. */
export function syncListFiltersToDom() {
  if (typeof document === "undefined") return;
  const searchEl = document.querySelector("#searchInput");
  const statusEl = document.querySelector("#statusFilter");
  const responsibleEl = document.querySelector("#responsibleFilter");
  const stageEl = document.querySelector("#stageFilter");

  if (searchEl) searchEl.value = state.listFilters.search ?? "";
  if (statusEl && state.listFilters.status != null) statusEl.value = state.listFilters.status;
  if (responsibleEl && state.listFilters.responsible != null) {
    responsibleEl.value = state.listFilters.responsible;
  }
  if (stageEl) {
    if (state.activeTab === "Замовлення" && !state.selectedOrderId) {
      stageEl.value = state.ordersView.priorityFilter ?? "";
    } else {
      stageEl.value = state.productionStageFilter ?? "";
    }
  }
}

export function hasActiveFilters(filters = currentFilters()) {
  return Boolean(filters.search || filters.status || filters.responsible || filters.priority);
}

function positionMatchesStatus(position, status) {
  return [
    position.positionStatus,
    position.cuttingStatus,
    position.edgingStatus,
    position.drillingStatus,
    position.assemblyStatus
  ].includes(status);
}

export function filteredOrders(source, positions) {
  const filters = currentFilters();
  const showArchived = state.showArchived || filters.status === ORDER_DONE_STATUS;
  const orderSource =
    source ?? (showArchived ? state.orders.filter(isArchivedOrder) : activeOrders(state.orders));
  const positionSource =
    positions ??
    (showArchived
      ? archivedPositions(state.positions, state.orders)
      : activePositions(state.positions, state.orders));

  const { search, status, responsible, priority } = filters;

  return orderSource.filter((order) => {
    const related = positionsForOrder(order, positionSource);

    const orderText = [
      order.id,
      order.orderNumber,
      order.object,
      order.client,
      order.manager,
      order.status,
      order.priority,
      order.comment,
      ...related.flatMap((p) => [
        p.item,
        p.object,
        p.itemType,
        p.positionStatus,
        p.problem,
        p.note,
        p.constructor,
        p.assemblyResponsible,
        p.installResponsible
      ])
    ]
      .join(" ")
      .toLowerCase();

    if (search && !orderText.includes(search)) return false;

    if (status) {
      const orderStatusMatch = order.status === status;
      const positionStatusMatch = related.some((p) => positionMatchesStatus(p, status));
      if (!orderStatusMatch && !positionStatusMatch) return false;
    }

    if (priority && order.priority !== priority) return false;

    if (responsible) {
      const people = [
        order.manager,
        ...related.flatMap((p) => [
          p.manager,
          p.constructor,
          p.assemblyResponsible,
          p.installResponsible
        ])
      ];
      if (!people.includes(responsible)) return false;
    }

    return true;
  });
}

export function filteredPositions(source) {
  const filters = currentFilters();
  const showArchived = state.showArchived || filters.status === ORDER_DONE_STATUS;
  const positionSource =
    source ??
    (showArchived
      ? archivedPositions(state.positions, state.orders)
      : activePositions(state.positions, state.orders));
  const { search, status, responsible } = filters;
  const parentItems = new Map(positionSource.filter((p) => !p.parentId).map((p) => [p.id, p.item]));

  return positionSource.filter((p) => {
    const parentItem = p.parentId ? parentItems.get(p.parentId) || "" : "";
    const text = [
      p.id,
      p.orderNumber,
      p.object,
      p.item,
      parentItem,
      p.itemType,
      p.manager,
      p.constructor,
      p.assemblyResponsible,
      p.installResponsible,
      p.positionStatus,
      p.problem,
      p.note
    ]
      .join(" ")
      .toLowerCase();

    const matchSearch = !search || text.includes(search);
    const matchStatus =
      !status ||
      [
        p.positionStatus,
        p.cuttingStatus,
        p.edgingStatus,
        p.drillingStatus,
        p.assemblyStatus
      ].includes(status);

    const people = [p.manager, p.constructor, p.assemblyResponsible, p.installResponsible];
    const matchResponsible = !responsible || people.includes(responsible);

    return matchSearch && matchStatus && matchResponsible;
  });
}
