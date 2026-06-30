import { state } from "./state.js";
import { setListFilters } from "./filters.js";
import { escapeHtml } from "./utils.js";
import { notifyUiChanged } from "./ui-persistence.js";

/** Збережені види фільтрів для реєстру замовлень / позицій. */
export const LIST_FILTER_PRESETS = [
  { id: "", label: "Усі" },
  { id: "mine", label: "Мої" },
  { id: "overdue", label: "Прострочені" },
  { id: "problems", label: "Проблеми" },
  { id: "no_constructive", label: "Без конструктива" }
];

export function getActiveFilterPreset() {
  return state.ordersView.filterPreset ?? "";
}

export function applyFilterPreset(presetId) {
  const id = presetId ?? "";
  state.ordersView.filterPreset = id;
  state.showArchived = false;

  if (!id) {
    setListFilters({ search: "", status: "", responsible: "" });
    state.productionStageFilter = "";
    state.ordersView.priorityFilter = "";
    return;
  }

  const userName = String(state.currentUser?.name || "").trim();

  if (id === "mine") {
    setListFilters({ search: "", status: "", responsible: userName });
    state.productionStageFilter = "";
    state.ordersView.priorityFilter = "";
    return;
  }

  if (id === "overdue") {
    setListFilters({ search: "", status: "", responsible: "" });
    state.productionStageFilter = "";
    state.ordersView.priorityFilter = "";
    return;
  }

  if (id === "problems") {
    setListFilters({ search: "", status: "Проблема", responsible: "" });
    state.productionStageFilter = "";
    state.ordersView.priorityFilter = "";
    return;
  }

  if (id === "no_constructive") {
    setListFilters({ search: "", status: "", responsible: "" });
    state.productionStageFilter = "";
    state.ordersView.priorityFilter = "";
  }
}

export function positionMatchesFilterPreset(position) {
  const preset = getActiveFilterPreset();
  if (!preset || preset === "mine" || preset === "problems") return true;

  if (preset === "overdue") {
    return (position.overdueDays ?? 0) > 0;
  }

  if (preset === "no_constructive") {
    return !position.hasConstructivePackage && !position.hasConstructiveFile;
  }

  return true;
}

export function orderMatchesFilterPreset(order, relatedPositions) {
  const preset = getActiveFilterPreset();
  if (!preset || preset === "mine" || preset === "problems") return true;
  if (!relatedPositions?.length) return preset !== "overdue" && preset !== "no_constructive";
  return relatedPositions.some((p) => positionMatchesFilterPreset(p));
}

export function renderFilterPresetBar() {
  const active = getActiveFilterPreset();
  const chips = LIST_FILTER_PRESETS.map((p) => {
    const isActive = active === p.id;
    return `<button type="button" class="filter-preset-chip ${isActive ? "active" : ""}" data-filter-preset="${escapeHtml(p.id)}" aria-pressed="${isActive}">${escapeHtml(p.label)}</button>`;
  }).join("");
  return `<div class="filter-preset-bar" role="group" aria-label="Збережені види">${chips}</div>`;
}

export function bindFilterPresetBar(root = document) {
  root.querySelectorAll("[data-filter-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const next = btn.dataset.filterPreset ?? "";
      if (next === getActiveFilterPreset()) return;
      applyFilterPreset(next);
      notifyUiChanged();
      window.__enverRender?.({ contentOnly: true });
    });
  });
}
