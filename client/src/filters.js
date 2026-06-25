import { state } from "./state.js";
import { activeOrders, activePositions } from "./archive.js";
import { positionsForOrder } from "./workflows.js";

export function currentFilters() {
  const searchEl = document.querySelector("#searchInput");
  const statusEl = document.querySelector("#statusFilter");
  const responsibleEl = document.querySelector("#responsibleFilter");
  return {
    search: (searchEl?.value ?? "").toLowerCase().trim(),
    status: statusEl?.value ?? "",
    responsible: responsibleEl?.value ?? "",
    priority: state.ordersView.priorityFilter ?? ""
  };
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

export function filteredOrders(
  source = activeOrders(state.orders),
  positions = activePositions(state.positions, state.orders)
) {
  const { search, status, responsible, priority } = currentFilters();

  return source.filter((order) => {
    const related = positionsForOrder(order, positions);

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

export function filteredPositions(source = activePositions(state.positions, state.orders)) {
  const { search, status, responsible } = currentFilters();
  const parentItems = new Map(source.filter((p) => !p.parentId).map((p) => [p.id, p.item]));

  return source.filter((p) => {
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
