import { isOrderContainerPosition } from "@enver/shared/production/order-position-model.js";
import { state } from "./state.js";

/** Рядки таблиці: основна позиція або підпозиція (depth 1). */
export function buildVisiblePositionRows(
  allPositions,
  filtered,
  expandedIds = state.expandedPositionIds
) {
  const filteredIds = new Set(filtered.map((p) => p.id));
  const includeIds = new Set(filteredIds);

  for (const p of filtered) {
    if (p.parentId && !includeIds.has(p.parentId)) {
      const parent = allPositions.find((x) => x.id === p.parentId);
      if (parent) includeIds.add(parent.id);
    }
  }

  const pool = allPositions.filter((p) => includeIds.has(p.id));
  const byParent = new Map();

  for (const p of pool) {
    const key = p.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(p);
  }

  for (const list of byParent.values()) {
    list.sort((a, b) => a.id - b.id);
  }

  const rows = [];

  function appendChildren(parentId, depth) {
    for (const child of byParent.get(parentId) || []) {
      rows.push({ position: child, depth, isSub: true });
    }
  }

  const roots = [...(byParent.get(null) || [])].sort((a, b) => {
    const byOrder = String(a.orderNumber || "").localeCompare(String(b.orderNumber || ""), "uk");
    if (byOrder !== 0) return byOrder;
    return Number(a.id) - Number(b.id);
  });

  for (const parent of roots) {
    const childCount = (byParent.get(parent.id) || []).length;
    const isContainer = isOrderContainerPosition(parent, pool);

    if (isContainer && childCount > 0) {
      for (const child of byParent.get(parent.id) || []) {
        rows.push({ position: child, depth: 0, isSub: false, childCount: 0 });
      }
      continue;
    }
    if (isContainer) continue;

    rows.push({ position: parent, depth: 0, isSub: false, childCount });
    if (childCount === 0 || expandedIds.has(parent.id)) {
      appendChildren(parent.id, 1);
    }
  }

  return rows;
}

/** Розгорнути основні позиції, у яких є підпозиції (за замовчуванням видно дерево). */
export function expandParentsWithChildren(positions = state.positions) {
  for (const p of positions) {
    if (!p.parentId && getChildCount(p.id, positions) > 0) {
      state.expandedPositionIds.add(p.id);
    }
  }
}

export function getChildCount(parentId, positions = state.positions) {
  return positions.filter((p) => p.parentId === parentId).length;
}

export function togglePositionExpanded(id) {
  if (state.expandedPositionIds.has(id)) {
    state.expandedPositionIds.delete(id);
  } else {
    state.expandedPositionIds.add(id);
  }
}

export function expandPosition(id) {
  state.expandedPositionIds.add(id);
}

export function getParentPosition(parentId, positions = state.positions) {
  return positions.find((p) => p.id === parentId) ?? null;
}
