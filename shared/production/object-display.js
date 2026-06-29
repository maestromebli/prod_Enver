/**
 * Назва об'єкта для карток і таблиць — не плутати з адресою доставки.
 */

function norm(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** Чи рядок схожий на адресу (місто, вулиця), а не на назву проєкту. */
export function looksLikeAddressFragment(text) {
  const t = norm(text);
  if (!t) return false;
  if (/^(м\.?\s*)?(київ|львів|одеса|харків|дніпро|запоріжжя|вінниця)$/i.test(t)) return true;
  if (/^м\.?\s+/i.test(t) && !/(вул|просп|бульв|пров|наб|пл\.)/i.test(t)) return true;
  return /(вул\.|просп\.|бульв\.|пров\.|наб\.|пл\.)/i.test(t) || /^\d+/.test(t);
}

/**
 * Назва об'єкта для UI: пріоритет — order.object (назва проєкту),
 * не deliveryAddress і не короткий фрагмент адреси в position.object.
 */
export function resolveObjectName(position = {}, order = null) {
  const orderName = String(order?.object ?? "").trim();
  const posName = String(position?.object ?? "").trim();
  const delivery = String(position?.deliveryAddress ?? position?.delivery_address ?? "").trim();

  if (posName && delivery && norm(posName) === norm(delivery)) {
    return orderName || posName;
  }
  if (
    posName &&
    looksLikeAddressFragment(posName) &&
    orderName &&
    !looksLikeAddressFragment(orderName)
  ) {
    return orderName;
  }
  return orderName || posName;
}

export function resolveObjectNameFromOrders(position, orders = []) {
  if (!position) return "";
  const orderId = position.orderId ?? position.order_id;
  const orderNumber = position.orderNumber ?? position.order_number;
  const order = orders.find(
    (o) =>
      (orderId != null && o.id === orderId) ||
      (orderNumber && (o.orderNumber === orderNumber || o.order_number === orderNumber))
  );
  return resolveObjectName(position, order);
}

/** Заголовок шапки об'єкта: номер замовлення · назва об'єкта (+ назва позиції окремо). */
export function formatObjectHeader(order = null, position = null) {
  const orderNumber = String(
    order?.orderNumber ?? position?.orderNumber ?? position?.order_number ?? ""
  ).trim();
  const objectName = resolveObjectName(position || {}, order);
  const titleParts = [orderNumber, objectName].filter(Boolean);
  const positionName = String(position?.item ?? "").trim();
  return {
    title: titleParts.join(" · ") || "—",
    positionName
  };
}
