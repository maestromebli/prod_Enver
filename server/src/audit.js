import { run } from "./db.js";
import { mapOrder, mapPosition } from "./mappers.js";

const ORDER_FIELDS = {
  orderNumber: "Номер замовлення",
  object: "Об'єкт",
  client: "Клієнт",
  manager: "Менеджер",
  startDate: "Дата запуску",
  planDate: "Планова дата",
  status: "Статус",
  priority: "Пріоритет",
  comment: "Коментар"
};

const POSITION_FIELDS = {
  orderNumber: "Замовлення",
  object: "Об'єкт",
  item: "Виріб",
  itemType: "Тип виробу",
  manager: "Менеджер",
  constructor: "Конструктор",
  cuttingStatus: "Порізка",
  edgingStatus: "Крайкування",
  drillingStatus: "Присадка",
  assemblyStatus: "Збірка",
  assemblyResponsible: "Збирач",
  readyDate: "Дата готовності",
  installDate: "Початок монтажу",
  installEndDate: "Кінець монтажу",
  installTimeStart: "Час початку",
  installTimeEnd: "Час кінця",
  installResponsible: "Монтажник",
  positionStatus: "Статус позиції",
  progress: "Прогрес, %",
  overdueDays: "Прострочка",
  problem: "Проблема",
  note: "Примітка"
};

const STAGE_LABELS = {
  constructor: "Конструктив",
  cutting: "Порізка",
  edging: "Крайкування",
  drilling: "Присадка",
  assembly: "Збірка"
};

const STAGE_PATCH_TO_FIELD = {
  cutting: "cuttingStatus",
  edging: "edgingStatus",
  drilling: "drillingStatus",
  assembly: "assemblyStatus"
};

const ACTION_LABELS = {
  create: "Створено",
  update: "Оновлено",
  delete: "Видалено",
  stage_change: "Етап змінено",
  auto_handoff: "Автопередача"
};

export const SYSTEM_ACTOR = { id: null, name: "Система" };

export function diffFields(before, after, fieldMap) {
  const changes = [];
  for (const [key, label] of Object.entries(fieldMap)) {
    const oldValue = before?.[key] ?? "";
    const newValue = after?.[key] ?? "";
    if (String(oldValue).trim() === String(newValue).trim()) continue;
    changes.push({
      field: key,
      label,
      oldValue: String(oldValue),
      newValue: String(newValue)
    });
  }
  return changes;
}

function formatSummary(entityType, action, meta) {
  const actionLabel = ACTION_LABELS[action] || action;
  if (entityType === "order") {
    return `${actionLabel}: замовлення ${meta.orderNumber || `#${meta.entityId}`}`;
  }
  return `${actionLabel}: позиція #${meta.entityId} — ${meta.item || meta.orderNumber}`;
}

export async function recordHistory({
  entityType,
  entityId,
  action,
  changes = [],
  meta = {},
  actor = null
}) {
  const summary =
    meta.summary ||
    formatSummary(entityType, action, {
      entityId,
      orderNumber: meta.orderNumber,
      item: meta.item
    });

  await run(
    `INSERT INTO change_history (
      entity_type, entity_id, action, summary, changes_json, order_number, item_label, user_id, user_name
    ) VALUES (
      @entity_type, @entity_id, @action, @summary, @changes_json, @order_number, @item_label, @user_id, @user_name
    )`,
    {
      entity_type: entityType,
      entity_id: entityId,
      action,
      summary,
      changes_json: JSON.stringify(changes),
      order_number: meta.orderNumber ?? "",
      item_label: meta.item ?? "",
      user_id: actor?.id ?? null,
      user_name: actor?.name ?? ""
    }
  );
}

export async function logOrderCreate(orderRow, actor = null) {
  const o = mapOrder(orderRow);
  const changes = diffFields({}, o, ORDER_FIELDS);
  await recordHistory({
    entityType: "order",
    entityId: o.id,
    action: "create",
    changes,
    meta: { orderNumber: o.orderNumber },
    actor
  });
}

export async function logOrderUpdate(beforeRow, afterRow, actor = null) {
  const before = mapOrder(beforeRow);
  const after = mapOrder(afterRow);
  const changes = diffFields(before, after, ORDER_FIELDS);
  if (!changes.length) return;
  await recordHistory({
    entityType: "order",
    entityId: after.id,
    action: "update",
    changes,
    meta: { orderNumber: after.orderNumber },
    actor
  });
}

export async function logOrderDelete(orderRow, actor = null) {
  const o = mapOrder(orderRow);
  await recordHistory({
    entityType: "order",
    entityId: o.id,
    action: "delete",
    changes: [],
    meta: { orderNumber: o.orderNumber, summary: `Видалено замовлення ${o.orderNumber}` },
    actor
  });
}

export async function logPositionCreate(positionRow, actor = null) {
  const p = mapPosition(positionRow);
  const changes = diffFields({}, p, POSITION_FIELDS);
  await recordHistory({
    entityType: "position",
    entityId: p.id,
    action: "create",
    changes,
    meta: { orderNumber: p.orderNumber, item: p.item },
    actor
  });
}

export async function logPositionUpdate(beforeRow, afterRow, actor = null) {
  const before = mapPosition(beforeRow);
  const after = mapPosition(afterRow);
  const changes = diffFields(before, after, POSITION_FIELDS);
  if (!changes.length) return;
  await recordHistory({
    entityType: "position",
    entityId: after.id,
    action: "update",
    changes,
    meta: { orderNumber: after.orderNumber, item: after.item },
    actor
  });
}

export async function logPositionDelete(positionRow, actor = null) {
  const p = mapPosition(positionRow);
  await recordHistory({
    entityType: "position",
    entityId: p.id,
    action: "delete",
    changes: [],
    meta: {
      orderNumber: p.orderNumber,
      item: p.item,
      summary: `Видалено позицію #${p.id}: ${p.item}`
    },
    actor
  });
}

export async function logStageChange(beforeRow, afterRow, stageKey, patch = {}, actor = null) {
  const before = mapPosition(beforeRow);
  const after = mapPosition(afterRow);
  const stageLabel = STAGE_LABELS[stageKey] || stageKey;
  const changes = diffFields(before, after, POSITION_FIELDS);

  const oldStatus =
    stageKey === "constructor"
      ? before.constructor
        ? "Передано"
        : "Не розпочато"
      : before[STAGE_PATCH_TO_FIELD[stageKey]] || "Не розпочато";
  const newStatus =
    stageKey === "constructor"
      ? after.constructor
        ? patch.status || "Передано"
        : "Не розпочато"
      : patch.status || after[STAGE_PATCH_TO_FIELD[stageKey]];

  const stageChanges = [
    {
      field: stageKey,
      label: stageLabel,
      oldValue: oldStatus,
      newValue: newStatus
    }
  ];

  await recordHistory({
    entityType: "position",
    entityId: after.id,
    action: "stage_change",
    changes: stageChanges.length ? stageChanges : changes,
    meta: {
      orderNumber: after.orderNumber,
      item: after.item,
      summary: `Позиція #${after.id}: «${stageLabel}» ${oldStatus} → ${newStatus}`
    },
    actor
  });
}

export async function logAutoHandoff(
  beforeRow,
  afterRow,
  handoff,
  triggerStageKey,
  actor = SYSTEM_ACTOR
) {
  const after = mapPosition(afterRow);
  const stageLabelText = STAGE_LABELS[handoff.stageKey] || handoff.stageKey;
  const triggerLabel = STAGE_LABELS[triggerStageKey] || triggerStageKey;
  const isHuman = actor?.id != null;
  const summary = isHuman
    ? `Оператор завершив «${triggerLabel}» — позиція автоматично передана на «${stageLabelText}».`
    : `Автопередача: «${stageLabelText}» ${handoff.from} → ${handoff.to} (після «${triggerLabel}»)`;

  await recordHistory({
    entityType: "position",
    entityId: after.id,
    action: "auto_handoff",
    changes: [
      {
        field: handoff.stageKey,
        label: stageLabelText,
        oldValue: handoff.from,
        newValue: handoff.to
      }
    ],
    meta: {
      orderNumber: after.orderNumber,
      item: after.item,
      summary
    },
    actor
  });
}

export async function logStageChangeWithAutoHandoffs(
  beforeRow,
  afterRow,
  stageKey,
  patch = {},
  actor = null,
  handoffs = []
) {
  await logStageChange(beforeRow, afterRow, stageKey, patch, actor);
  for (const handoff of handoffs) {
    await logAutoHandoff(beforeRow, afterRow, handoff, stageKey, actor || SYSTEM_ACTOR);
  }
}

export function mapHistory(row) {
  let changes = [];
  try {
    changes = JSON.parse(row.changes_json || "[]");
  } catch {
    changes = [];
  }
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actionLabel: ACTION_LABELS[row.action] || row.action,
    summary: row.summary,
    changes,
    orderNumber: row.order_number,
    itemLabel: row.item_label,
    userId: row.user_id ?? null,
    userName: row.user_name || "",
    createdAt: row.created_at
  };
}
