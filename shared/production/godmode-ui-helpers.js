/** Чисті хелпери GODMODE UI — без DOM, для клієнта та тестів. */

export const HANDOFF_ACTION_TYPES = new Set([
  "handoff_to_cutting",
  "handoff_to_edging",
  "handoff_to_drilling",
  "handoff_to_assembly",
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
  if (actionType === "schedule_install" || actionType === "wait_install") return "install";
  if (
    actionType === "parse_constructive_package" ||
    actionType === "review_constructive" ||
    actionType === "create_procurement" ||
    actionType === "release_to_cnc" ||
    actionType === "print_part_labels" ||
    actionType === "run_ai_analysis" ||
    actionType === "create_tasks_from_ai"
  ) {
    return "constructive";
  }
  if (actionType === "resolve_problem") return "more";
  if (actionType === "fill_manager_data") return "general";
  return "general";
}

/** Підвкладка картки замовлення для godmode-дії (null — відкривати drawer або стіл конструктора). */
export function orderDetailSubTabForGodmodeAction(actionType) {
  const map = {
    fill_manager_data: "manager",
    run_ai_analysis: "constructive",
    create_tasks_from_ai: "constructive",
    schedule_install: "install",
    parse_constructive_package: "constructive",
    review_constructive: "constructive",
    wait_parse: "constructive",
    create_procurement: "procurement",
    wait_procurement: "procurement",
    release_to_cnc: "cnc",
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

/** Швидке виконання з вкладки «Потребує уваги» (handoff + навігаційні дії). */
export const ATTENTION_QUICK_ACTION_TYPES = new Set([
  ...HANDOFF_ACTION_TYPES,
  ...ORDER_API_ACTION_TYPES,
  "create_procurement",
  "parse_constructive_package",
  "schedule_install"
]);

export function canAttentionQuickRun(actionType) {
  return ATTENTION_QUICK_ACTION_TYPES.has(actionType);
}

export function isRunnableGodmodeAction(actionType) {
  return (
    canQuickRunGodmodeAction(actionType) ||
    actionType === "close_order" ||
    actionType === "add_position"
  );
}

/** data-* атрибути для CTA-кнопки godmode (без DOM). */
export function buildGodmodeCtaAttrs(next, { positionId = null, orderId = null } = {}) {
  if (!next || next.allowed === false) return "";

  if (ORDER_API_ACTION_TYPES.has(next.type) && orderId != null) {
    return `data-run-order-action="${orderId}" data-action-type="${next.type}"`;
  }

  if (next.type === "assign_constructor") {
    if (positionId != null) {
      return `data-order-detail-tab="pos-${positionId}" data-focus-responsibles="1"`;
    }
    if (orderId != null) return `data-open-constructor-desk-order="${orderId}"`;
    return `data-open-constructor-desk="1"`;
  }

  if (
    (next.type === "upload_constructive" || next.type === "upload_constructive_package") &&
    positionId != null
  ) {
    return `data-open-constructor-desk-position="${positionId}" data-constructor-ws-tab="package"`;
  }

  if (next.type === "parse_constructive_package" && positionId != null) {
    return `data-run-next-action="${positionId}" data-action-type="parse_constructive_package"`;
  }

  if (next.type === "fill_manager_data" && positionId != null) {
    return `data-order-detail-tab="pos-${positionId}"`;
  }

  if (
    (next.type === "create_procurement" || next.type === "wait_procurement") &&
    positionId != null
  ) {
    return `data-godmode-nav="${next.type}" data-godmode-nav-position="${positionId}"`;
  }

  if (next.type === "add_position" && orderId != null) {
    return `data-order-detail-tab="overview" data-focus-inline-add="1"`;
  }

  if (positionId != null) {
    return `data-run-next-action="${positionId}" data-action-type="${next.type}"`;
  }

  return "";
}

export const PROCUREMENT_NAV_ACTION_TYPES = new Set(["create_procurement", "wait_procurement"]);
