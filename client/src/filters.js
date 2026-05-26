import { state } from "./state.js";

export function currentFilters() {
  const searchEl = document.querySelector("#searchInput");
  const statusEl = document.querySelector("#statusFilter");
  const responsibleEl = document.querySelector("#responsibleFilter");
  return {
    search: (searchEl?.value ?? "").toLowerCase().trim(),
    status: statusEl?.value ?? "",
    responsible: responsibleEl?.value ?? ""
  };
}

export function filteredPositions(source = state.positions) {
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
