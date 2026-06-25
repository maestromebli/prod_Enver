/** Чисті хелпери GODMODE UI — без DOM, для клієнта та тестів. */

export const HANDOFF_ACTION_TYPES = new Set([
  "handoff_to_cutting",
  "handoff_to_edging",
  "handoff_to_drilling",
  "handoff_to_assembly",
  "handoff_to_packaging",
  "ready_for_install"
]);

export const UI_ACTION_TYPES = new Set([
  "upload_constructive",
  "run_ai_analysis",
  "create_tasks_from_ai",
  "schedule_install",
  "resolve_problem",
  "fill_manager_data",
  "assign_constructor"
]);

export const ORDER_API_ACTION_TYPES = new Set(["close_order"]);

export function panelForGodmodeAction(actionType) {
  if (actionType === "fill_manager_data") return "manager";
  if (actionType === "assign_constructor") return "constructor-desk";
  if (actionType === "schedule_install" || actionType === "wait_install") return "install";
  if (
    actionType === "parse_constructive_package" ||
    actionType === "review_constructive" ||
    actionType === "create_procurement" ||
    actionType === "send_to_gitlab" ||
    actionType === "print_part_labels"
  ) {
    return "constructive";
  }
  if (UI_ACTION_TYPES.has(actionType) || actionType === "resolve_problem") return "more";
  return "general";
}

/** Підвкладка картки замовлення для godmode-дії (null — відкривати drawer). */
export function orderDetailSubTabForGodmodeAction(actionType) {
  const map = {
    fill_manager_data: "manager",
    upload_constructive: "constructive",
    run_ai_analysis: "constructive",
    create_tasks_from_ai: "constructive",
    schedule_install: "install",
    parse_constructive_package: "constructive",
    review_constructive: "constructive",
    upload_constructive_package: "constructive",
    wait_parse: "constructive",
    create_procurement: "procurement",
    wait_procurement: "procurement",
    send_to_gitlab: "cnc",
    print_part_labels: "cnc"
  };
  return map[actionType] || null;
}

export function shouldOpenOrderDetailForGodmodeAction(actionType) {
  return (
    actionType === "fill_manager_data" ||
    actionType === "assign_constructor" ||
    Boolean(orderDetailSubTabForGodmodeAction(actionType))
  );
}

export function canQuickRunGodmodeAction(actionType) {
  return HANDOFF_ACTION_TYPES.has(actionType) || ORDER_API_ACTION_TYPES.has(actionType);
}

export function isRunnableGodmodeAction(actionType) {
  return (
    canQuickRunGodmodeAction(actionType) ||
    actionType === "close_order" ||
    actionType === "add_position"
  );
}
