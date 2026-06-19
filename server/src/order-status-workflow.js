/** Статуси замовлення, для яких потрібна хоча б одна основна позиція. */
export { ORDER_STATUSES_NEED_POSITION } from "../../shared/production/orders.js";

import { isStageIdle } from "../../shared/production/stages.js";

/** Пресети етапів позиції за статусом замовлення (лише підвищення, без відкату). */
export function orderStatusStagePreset(status) {
  switch (status) {
    case "Передано у виробництво":
      return { cutting_status: "Передано" };
    case "У виробництві":
      return { cutting_status: "Передано" };
    default:
      return {};
  }
}

export function applyOrderStatusPreset(row, preset) {
  if (!preset || !Object.keys(preset).length) return row;
  const copy = { ...row };
  for (const [field, value] of Object.entries(preset)) {
    if (isStageIdle(copy[field])) copy[field] = value;
  }
  return copy;
}

export function defaultPositionRow(orderRow, id) {
  return {
    id,
    parent_id: null,
    order_id: orderRow.id,
    order_number: orderRow.order_number,
    object: orderRow.object || "",
    item: orderRow.object?.trim() || orderRow.order_number,
    item_type: "Інше",
    manager: orderRow.manager || "",
    constructor_name: "",
    cutting_status: "Не розпочато",
    edging_status: "Не розпочато",
    drilling_status: "Не розпочато",
    assembly_status: "Не розпочато",
    assembly_responsible: "",
    ready_date: "",
    install_date: "",
    install_end_date: "",
    install_time_start: "",
    install_time_end: "",
    install_responsible: "",
    position_status: "Не розпочато",
    progress: 0,
    overdue_days: 0,
    problem: "",
    note: ""
  };
}

export function positionStagesChanged(before, after) {
  return (
    before.cutting_status !== after.cutting_status ||
    before.edging_status !== after.edging_status ||
    before.drilling_status !== after.drilling_status ||
    before.assembly_status !== after.assembly_status
  );
}
