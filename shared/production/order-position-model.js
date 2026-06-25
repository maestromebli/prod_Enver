/**
 * Канонічна модель root / sub / work positions для замовлення ENVER.
 */

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
 * Робочі позиції — одиниці workflow (конструктив, закупка, ЧПК, оператор).
 * Якщо є sub-позиції — робочими є вони; інакше — root.
 */
export function getWorkPositions(order, positions = []) {
  let related = order ? positionsForOrder(order, positions) : [...positions];
  if (!related.length && positions.length) related = [...positions];
  const subs = related.filter((p) => isSubPosition(p));
  if (subs.length) return subs;
  return related.filter((p) => isRootPosition(p));
}

export function isSinglePositionOrder(order, positions = []) {
  return getWorkPositions(order, positions).length === 1;
}

export function shouldUseRootAsWorkPosition(order, positions = []) {
  return getSubPositions(order, positions).length === 0;
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
