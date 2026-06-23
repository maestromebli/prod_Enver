import {
  PRODUCTION_PROGRESS_WEIGHTS,
  STAGE_STATUSES,
  POSITION_STATUSES,
  STAGES,
  STAGE_STATUS_DONE,
  getNextStatus,
  stageStatusClass
} from "@enver/shared/production/stages.js";

export {
  STAGE_STATUSES,
  POSITION_STATUSES,
  PRODUCTION_PROGRESS_WEIGHTS,
  STAGES,
  getNextStatus,
  stageStatusClass
};

const STAGE_DONE = STAGE_STATUS_DONE;

export function getStageStatus(position, stage) {
  if (stage.type === "constructor") {
    return position.hasConstructiveFile ? "Передано" : "Не розпочато";
  }
  return position[stage.field] || "Не розпочато";
}

export function getStageResponsible(position, stage) {
  if (stage.type === "constructor") return position.constructor || "—";
  if (stage.defaultResponsible) return stage.defaultResponsible;
  if (stage.usesAssembler) return position.assemblyResponsible || "—";
  return position.assemblyResponsible || "—";
}

export function stageRequiresAssignment(stage) {
  return stage.type === "constructor" || stage.usesAssembler || stage.key === "drilling";
}

function hasStageAssignment(position, stage) {
  if (stage.type === "constructor") {
    return Boolean(position.hasConstructiveFile);
  }
  return Boolean(position.assemblyResponsible?.trim());
}

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
