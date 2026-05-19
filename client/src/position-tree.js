import { state } from "./state.js";

/** Рядки таблиці: основна позиція або підпозиція (depth 1). */
export function buildVisiblePositionRows(allPositions, filtered, expandedIds = state.expandedPositionIds) {
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

  for (const parent of byParent.get(null) || []) {
    const childCount = (byParent.get(parent.id) || []).length;
    rows.push({ position: parent, depth: 0, isSub: false, childCount });
    if (expandedIds.has(parent.id)) {
      appendChildren(parent.id, 1);
    }
  }

  return rows;
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
