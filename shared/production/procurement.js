/** Закупівля: MTO, склад, рекламації, блокери цеху. */

export const PROCUREMENT_REQUEST_KINDS = ["spec_auto", "mto_manual", "mixed"];

export const PROCUREMENT_CLASSES = ["spec", "mto"];

export const MTO_CATEGORIES = [
  "facade_agt",
  "facade_veneer",
  "facade_painted",
  "sliding_system",
  "mirror",
  "glass",
  "stone",
  "custom"
];

export const MTO_CATEGORY_LABELS = {
  facade_agt: "Фасади AGT",
  facade_veneer: "Фасади шпон",
  facade_painted: "Фасади фарбовані",
  sliding_system: "Розсувна система",
  mirror: "Дзеркало",
  glass: "Скло / лакобель",
  stone: "Камінь / стільниця",
  custom: "Під замовлення"
};

export function mtoCategoryLabel(category) {
  return MTO_CATEGORY_LABELS[category] || category || "—";
}

/** Категорії, що блокують збірку без отримання на склад. */
export const ASSEMBLY_BLOCKING_CATEGORIES = new Set([
  "facade_agt",
  "facade_veneer",
  "facade_painted",
  "sliding_system",
  "mirror",
  "glass",
  "stone",
  "custom"
]);

export const WAREHOUSE_MOVEMENT_TYPES = ["inbound", "reserve", "issue", "return", "write_off"];

export const WAREHOUSE_MOVEMENT_LABELS = {
  inbound: "Надходження",
  reserve: "Резерв",
  issue: "Видача в цех",
  return: "Повернення",
  write_off: "Списання"
};

export const RETURN_REASON_CODES = [
  "defect",
  "wrong_size",
  "wrong_decor",
  "transport_damage",
  "other"
];

export const RETURN_REASON_LABELS = {
  defect: "Дефект",
  wrong_size: "Невірний розмір",
  wrong_decor: "Невірний декор",
  transport_damage: "Пошкодження при транспорті",
  other: "Інше"
};

export function returnReasonLabel(code) {
  return RETURN_REASON_LABELS[code] || code || "—";
}

export const RETURN_STATUSES = [
  "draft",
  "submitted",
  "supplier_ack",
  "accepted",
  "rejected",
  "replacement_ordered",
  "credit_received",
  "closed"
];

export const RETURN_STATUS_LABELS = {
  draft: "Чернетка",
  submitted: "Надіслано постачальнику",
  supplier_ack: "Підтверджено постачальником",
  accepted: "Прийнято",
  rejected: "Відхилено",
  replacement_ordered: "Замовлено заміну",
  credit_received: "Зарахування",
  closed: "Закрито"
};

export function returnStatusLabel(status) {
  return RETURN_STATUS_LABELS[status] || status || "—";
}

export const RETURN_ADVANCE = {
  draft: "submitted",
  submitted: "supplier_ack",
  supplier_ack: "accepted",
  accepted: "replacement_ordered",
  replacement_ordered: "closed",
  credit_received: "closed"
};

export function nextReturnStatus(current) {
  return RETURN_ADVANCE[current] || null;
}

export const TERMINAL_RETURN_STATUSES = new Set(["rejected", "closed"]);

export const MTO_CATEGORY_COLORS = {
  facade_agt: "#2563eb",
  facade_veneer: "#7c3aed",
  facade_painted: "#db2777",
  sliding_system: "#0891b2",
  mirror: "#0d9488",
  glass: "#0284c7",
  stone: "#78716c",
  custom: "#64748b"
};

export function categoryColor(category) {
  return MTO_CATEGORY_COLORS[category] || "#64748b";
}

function parseQty(value) {
  const n = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (m) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export function isItemFullyReceived(item) {
  const qty = parseQty(item?.qty);
  const received = parseQty(item?.qtyReceived ?? item?.qty_received);
  if (qty <= 0) return item?.status === "received";
  return received >= qty;
}

export function isBlockingCategory(category) {
  return ASSEMBLY_BLOCKING_CATEGORIES.has(String(category || "").trim());
}

export function isMtoItem(item) {
  return String(item?.procurementClass ?? item?.procurement_class ?? "").trim() === "mto";
}

/** Чи прострочено очікувану поставку. */
export function isDeliveryOverdue(item, now = new Date()) {
  const expected = parseDate(item?.expectedDeliveryDate ?? item?.expected_delivery_date);
  if (!expected || isItemFullyReceived(item)) return false;
  const today = now.toISOString().slice(0, 10);
  return expected < today;
}

/** Чи ризик: поставка пізніше потреби цеху. */
export function isDeliveryAtRisk(item) {
  const expected = parseDate(item?.expectedDeliveryDate ?? item?.expected_delivery_date);
  const required = parseDate(item?.requiredByDate ?? item?.required_by_date);
  if (!expected || !required || isItemFullyReceived(item)) return false;
  return expected > required;
}

export function summarizeProcurementItems(items = []) {
  const list = Array.isArray(items) ? items : [];
  const mto = list.filter(isMtoItem);
  const blocking = list.filter((i) => isBlockingCategory(i.category) && !isItemFullyReceived(i));
  const overdue = mto.filter((i) => isDeliveryOverdue(i));
  const atRisk = mto.filter((i) => isDeliveryAtRisk(i));
  const received = list.filter(isItemFullyReceived).length;
  return {
    total: list.length,
    mtoCount: mto.length,
    blockingCount: blocking.length,
    overdueCount: overdue.length,
    atRiskCount: atRisk.length,
    receivedCount: received,
    allBlockingReceived: blocking.length === 0,
    label:
      blocking.length > 0
        ? `${received}/${list.length} отримано · ${blocking.length} блокує збірку`
        : `${received}/${list.length} отримано`
  };
}

export function getProcurementWarnings(items = [], context = {}) {
  const warnings = [];
  const summary = summarizeProcurementItems(items);
  if (!summary.mtoCount && !summary.blockingCount) return warnings;

  if (summary.overdueCount > 0) {
    warnings.push({
      type: "procurement_overdue",
      level: "warning",
      title: "Прострочена закупівля",
      message: `${summary.overdueCount} матеріал(ів) під замовлення прострочено.`
    });
  }

  if (summary.atRiskCount > 0) {
    warnings.push({
      type: "procurement_at_risk",
      level: "warning",
      title: "Ризик затримки в цех",
      message: `${summary.atRiskCount} позицій: поставка пізніше потрібної дати для цеху.`
    });
  }

  if (summary.blockingCount > 0) {
    const stage = context.currentStage || "assembly";
    if (stage === "assembly" || stage === "drilling") {
      warnings.push({
        type: "procurement_blocks_assembly",
        level: "warning",
        title: "Матеріали не на складі",
        message: `${summary.blockingCount} позицій закупівлі ще не отримано (фасади, розсувні, дзеркала тощо).`
      });
    }
  }

  if (context.openReturns > 0) {
    warnings.push({
      type: "procurement_return_open",
      level: "warning",
      title: "Відкрита рекламація",
      message: `${context.openReturns} рекламаційне повернення в роботі.`
    });
  }

  return warnings;
}

export function getProcurementBlockers(items = [], context = {}) {
  const blockers = [];
  const stage = String(context.currentStage || context.current_stage || "").trim();
  if (stage !== "assembly" && stage !== "drilling") return blockers;

  const blocking = (Array.isArray(items) ? items : []).filter(
    (i) => isBlockingCategory(i.category) && !isItemFullyReceived(i)
  );
  if (!blocking.length) return blockers;

  const names = blocking
    .slice(0, 3)
    .map((i) => i.name || mtoCategoryLabel(i.category))
    .join(", ");

  blockers.push({
    type: "procurement_blocks_assembly",
    level: "blocker",
    title: "Немає матеріалів для збірки",
    message: `Очікується: ${names}${blocking.length > 3 ? "…" : ""}.`
  });

  return blockers;
}

/** Подія для календаря з рядка закупівлі. */
export function calendarEventFromItem(item, position = {}) {
  const iso = parseDate(item?.expectedDeliveryDate ?? item?.expected_delivery_date);
  if (!iso) return null;
  return {
    item,
    positionId: item.positionId ?? position.id ?? null,
    orderNumber: item.orderNumber ?? position.orderNumber ?? "",
    itemName: item.name || mtoCategoryLabel(item.category),
    positionItem: position.item ?? item.positionItem ?? "",
    object: position.object ?? item.object ?? "",
    category: item.category,
    status: item.status,
    isoDate: iso,
    overdue: isDeliveryOverdue(item),
    atRisk: isDeliveryAtRisk(item)
  };
}
