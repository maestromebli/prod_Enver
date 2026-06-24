/** Whitelist дій AI Assistant — лише безпечна навігація та godmode-дії. */

export const ALLOWED_ACTION_TYPES = new Set([
  "open_tab",
  "open_order",
  "open_position",
  "open_attention",
  "open_production_floor",
  "open_install_calendar",
  "open_settings_ai",
  "run_position_action",
  "run_order_action"
]);

const DANGEROUS_ACTION_TYPES = new Set(["delete", "sql", "url", "script", "eval"]);

const POSITION_ACTIONS = new Set([
  "handoff_to_cutting",
  "handoff_to_edging",
  "handoff_to_drilling",
  "handoff_to_assembly",
  "handoff_to_packaging",
  "ready_for_install",
  "upload_constructive",
  "run_ai_analysis",
  "create_tasks_from_ai"
]);

const ORDER_ACTIONS = new Set(["close_order"]);

const CONFIRMATION_REQUIRED = new Set([
  "run_position_action",
  "run_order_action",
  "handoff_to_cutting",
  "handoff_to_edging",
  "handoff_to_drilling",
  "handoff_to_assembly",
  "handoff_to_packaging",
  "ready_for_install",
  "close_order",
  "create_tasks_from_ai"
]);

function sanitizeLabel(label) {
  return String(label || "")
    .trim()
    .slice(0, 120);
}

function sanitizePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof k !== "string") continue;
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "string") out[k] = v.slice(0, 200);
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export function validateAssistantAction(raw) {
  if (!raw || typeof raw !== "object") return null;

  const type = String(raw.type || "").trim();
  if (!type || DANGEROUS_ACTION_TYPES.has(type) || !ALLOWED_ACTION_TYPES.has(type)) {
    return null;
  }

  const payload = sanitizePayload(raw.payload);
  const label = sanitizeLabel(raw.label) || "Дія";

  if (type === "open_tab" && !payload.tab) return null;
  if (type === "open_order" && !payload.orderId) return null;
  if (type === "open_position" && !payload.positionId) return null;

  if (type === "run_position_action") {
    const actionType = String(payload.actionType || "").trim();
    if (!payload.positionId || !POSITION_ACTIONS.has(actionType)) return null;
    payload.actionType = actionType;
  }

  if (type === "run_order_action") {
    const actionType = String(payload.actionType || "").trim();
    if (!payload.orderId || !ORDER_ACTIONS.has(actionType)) return null;
    payload.actionType = actionType;
  }

  const requiresConfirmation =
    raw.requiresConfirmation === true ||
    CONFIRMATION_REQUIRED.has(type) ||
    CONFIRMATION_REQUIRED.has(payload.actionType);

  return { label, type, payload, requiresConfirmation };
}

export function validateAssistantActions(actions) {
  if (!Array.isArray(actions)) return [];
  return actions.map(validateAssistantAction).filter(Boolean).slice(0, 6);
}

export function buildActionsPromptBlock() {
  return `
Можеш запропонувати дії (actions) — лише з цього списку type:
- open_tab { tab: "Замовлення"|"Позиції"|"Потребує уваги"|"Цех зараз"|"Встановлення" }
- open_order { orderId: number }
- open_position { positionId: number }
- open_attention {}
- open_production_floor {}
- open_install_calendar {}
- open_settings_ai {}
- run_position_action { positionId, actionType: handoff_to_cutting|handoff_to_edging|... }
- run_order_action { orderId, actionType: close_order }

Поверни JSON:
{
  "reply": "коротка відповідь",
  "actions": [{ "label": "...", "type": "...", "payload": {}, "requiresConfirmation": true }],
  "warnings": []
}

Правила:
- Не вигадуй id замовлень/позицій — лише з контексту.
- Дії зміни даних — requiresConfirmation: true.
- Якщо даних немає — не пропонуй action.
- Не обіцяй виконати дію без action у JSON.`;
}
