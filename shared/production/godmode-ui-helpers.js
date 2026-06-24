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
  "resolve_problem"
]);

export const ORDER_API_ACTION_TYPES = new Set(["close_order"]);

export function panelForGodmodeAction(actionType) {
  if (actionType === "schedule_install" || actionType === "wait_install") return "install";
  if (UI_ACTION_TYPES.has(actionType) || actionType === "resolve_problem") return "more";
  return "general";
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
