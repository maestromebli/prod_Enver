export const STAGE_STATUSES = [
  "Не розпочато",
  "Передано",
  "В роботі",
  "Готово",
  "На паузі",
  "Проблема",
  "Не потрібно"
];

export const POSITION_STATUSES = [
  "Не розпочато",
  "Передано",
  "У виробництві",
  "Готово до встановлення",
  "На паузі",
  "Проблема"
];

export const STAGES = [
  {
    key: "constructor",
    label: "Конструктив",
    icon: "📐",
    type: "constructor"
  },
  {
    key: "cutting",
    label: "Порізка",
    icon: "🪚",
    field: "cuttingStatus",
    defaultResponsible: "Віяр"
  },
  {
    key: "edging",
    label: "Крайкування",
    icon: "📏",
    field: "edgingStatus",
    defaultResponsible: "Віяр"
  },
  {
    key: "drilling",
    label: "Присадка",
    icon: "🕳",
    field: "drillingStatus"
  },
  {
    key: "assembly",
    label: "Збірка",
    icon: "🔧",
    field: "assemblyStatus",
    usesAssembler: true
  }
];

const NEXT_STATUS = {
  "Не розпочато": "Передано",
  Передано: "В роботі",
  "В роботі": "Готово",
  Готово: "Готово",
  "На паузі": "В роботі",
  Проблема: "В роботі",
  "Не потрібно": "Не потрібно"
};

export function getStageStatus(position, stage) {
  if (stage.type === "constructor") {
    return position.constructor ? "Передано" : "Не розпочато";
  }
  return position[stage.field] || "Не розпочато";
}

export function getNextStatus(current) {
  return NEXT_STATUS[current] || "Передано";
}

export function getStageResponsible(position, stage) {
  if (stage.type === "constructor") return position.constructor || "—";
  if (stage.defaultResponsible) return stage.defaultResponsible;
  if (stage.usesAssembler) return position.assemblyResponsible || "—";
  return position.assemblyResponsible || "—";
}

export function stageStatusClass(status) {
  const map = {
    "Не розпочато": "stage-idle",
    Передано: "stage-handoff",
    "В роботі": "stage-active",
    Готово: "stage-done",
    "На паузі": "stage-pause",
    Проблема: "stage-problem",
    "Не потрібно": "stage-skip"
  };
  return map[status] || "stage-idle";
}

const STAGE_DONE = new Set(["Готово", "Не потрібно"]);

export function stageRequiresAssignment(stage) {
  return stage.type === "constructor" || stage.usesAssembler || stage.key === "drilling";
}

function hasStageAssignment(position, stage) {
  if (stage.type === "constructor") return Boolean(position.constructor?.trim());
  return Boolean(position.assemblyResponsible?.trim());
}

/** Позиція без відповідального на поточному (наступному) етапі, де він обов'язковий. */
export function positionMissingNextAssignment(position) {
  for (const stage of STAGES) {
    const status = getStageStatus(position, stage);
    if (STAGE_DONE.has(status)) continue;
    if (stageRequiresAssignment(stage) && !hasStageAssignment(position, stage)) {
      return true;
    }
    if (status !== "Не розпочато") return false;
  }
  return false;
}

export function positionsForOrder(order, positions) {
  return positions.filter((p) => p.orderId === order.id || p.orderNumber === order.orderNumber);
}

export function isNewOrder(order) {
  return order.status === "Новий";
}

/** Позиції, для яких перевіряємо призначення: підпозиції або основні без дітей. */
export function assignablePositions(order, positions) {
  const related = positionsForOrder(order, positions);
  return related.filter((p) => {
    if (p.parentId) return true;
    return !related.some((c) => c.parentId === p.id);
  });
}

export function orderMissingNextAssignment(order, positions) {
  if (order.status === "Завершено") return false;
  const related = positionsForOrder(order, positions);
  if (!related.length) return order.status !== "Новий";
  const check = assignablePositions(order, positions);
  return check.some(positionMissingNextAssignment);
}

export function orderRowHighlightClasses(order, positions) {
  const classes = [];
  if (isNewOrder(order)) classes.push("row-order-new");
  if (orderMissingNextAssignment(order, positions)) classes.push("row-order-no-assignment");
  return classes.join(" ");
}
