/**
 * Канонічна модель root / sub / work positions для замовлення ENVER.
 */

import { computeProgress } from "./position-logic.js";

function pid(position) {
  return position?.id ?? position?.positionId ?? null;
}

function parentId(position) {
  const v = position?.parentId ?? position?.parent_id;
  return v == null ? null : Number(v);
}

export function isRootPosition(position) {
  return parentId(position) == null;
}

export function isSubPosition(position) {
  return parentId(position) != null;
}

/** Усі позиції одного замовлення (масив positions або related). */
export function positionsForOrder(order, positions = []) {
  if (!order) return positions;
  const orderId = order.id ?? order.orderId;
  const orderNumber = order.orderNumber ?? order.order_number;
  return positions.filter(
    (p) =>
      (orderId != null && (p.orderId === orderId || p.order_id === orderId)) ||
      (orderNumber && (p.orderNumber === orderNumber || p.order_number === orderNumber))
  );
}

/** Підпозиції (sub-positions) у межах набору позицій. */
export function getSubPositions(order, positions = []) {
  return positionsForOrder(order, positions).filter((p) => isSubPosition(p));
}

/** Root-позиції замовлення. */
export function getRootPositions(order, positions = []) {
  return positionsForOrder(order, positions).filter((p) => isRootPosition(p));
}

/**
 * Службовий контейнер замовлення (авто root «Інше» або root з підпозиціями).
 * Такі рядки не показують у списках і не вважають робочими.
 */
export function isOrderContainerPosition(position, related = []) {
  if (!isRootPosition(position)) return false;
  const id = pid(position);
  if (related.some((p) => parentId(p) === id)) return true;
  const type = String(position?.itemType ?? position?.item_type ?? "").trim();
  return type === "Інше";
}

/**
 * Робочі позиції — одиниці workflow (конструктив, закупка, ЧПК, оператор).
 * Якщо є sub-позиції — робочими є вони; інакше — root (крім службового контейнера).
 */
export function getWorkPositions(order, positions = []) {
  let related = order ? positionsForOrder(order, positions) : [...positions];
  if (!related.length && positions.length) related = [...positions];
  const subs = related.filter((p) => isSubPosition(p));
  if (subs.length) return subs;
  return related.filter((p) => isRootPosition(p) && !isOrderContainerPosition(p, related));
}

/** Середній прогрес робочих позицій замовлення (0–100). Єдине джерело для UI і godmode. */
export function orderProgress(order, positions = []) {
  const work = getWorkPositions(order, positions);
  if (!work.length) return 0;
  const sum = work.reduce((acc, p) => {
    const stored = Number(p.progress);
    const value = Number.isFinite(stored) ? stored : computeProgress(p);
    return acc + value;
  }, 0);
  return Math.round(sum / work.length);
}

export function isSinglePositionOrder(order, positions = []) {
  return getWorkPositions(order, positions).length === 1;
}

export function shouldUseRootAsWorkPosition(order, positions = []) {
  return (
    getSubPositions(order, positions).length === 0 &&
    getWorkPositions(order, positions).some((p) => isRootPosition(p))
  );
}

export function getPositionDisplayName(position) {
  const item = String(position?.item ?? "").trim();
  const orderNumber = String(position?.orderNumber ?? position?.order_number ?? "").trim();
  if (item) return item;
  if (orderNumber) return orderNumber;
  const id = pid(position);
  return id != null ? `Позиція #${id}` : "Позиція";
}

export function getPositionTabLabel(position, index = 0) {
  const name = getPositionDisplayName(position);
  const type = String(position?.itemType ?? position?.item_type ?? "").trim();
  if (type && type !== "Зона" && type !== "Інше") {
    return `${name}`;
  }
  if (index > 0) return name;
  return name || "Позиція";
}

/** Чи позиція є робочою для замовлення. */
export function isWorkPosition(position, order, allPositions = []) {
  const work = getWorkPositions(order, allPositions);
  const id = pid(position);
  return work.some((p) => pid(p) === id);
}

/**
 * Позиції, по яких будується workflow (godmode, увага, сповіщення).
 * Якщо є sub — лише вони; інакше root.
 */
export function workflowPositions(order, positions = []) {
  if (order) return getWorkPositions(order, positions);
  const related = [...positions];
  const subs = related.filter((p) => isSubPosition(p));
  if (subs.length) return subs;
  return related.filter((p) => isRootPosition(p) && !isOrderContainerPosition(p, related));
}

/** Унікальні робочі позиції для набору замовлень. */
export function workflowPositionsForOrders(orders = [], positions = []) {
  const seen = new Set();
  const result = [];
  for (const order of orders) {
    for (const p of getWorkPositions(order, positions)) {
      const id = pid(p);
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      result.push(p);
    }
  }
  if (result.length) return result;

  const byKey = new Map();
  for (const p of positions) {
    const key = p.orderId ?? p.order_id ?? p.orderNumber ?? p.order_number ?? `solo-${pid(p)}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(p);
  }
  for (const group of byKey.values()) {
    for (const p of workflowPositions(null, group)) {
      const id = pid(p);
      if (id == null || seen.has(id)) continue;
      seen.add(id);
      result.push(p);
    }
  }
  return result;
}
