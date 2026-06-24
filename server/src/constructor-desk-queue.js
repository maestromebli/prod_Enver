import { all, one, run } from "./db.js";
import { logOrderUpdate } from "./audit.js";
import { enrichPositionRow } from "./position-logic.js";
import { defaultWorkspacePayload } from "./constructor-desk-service.js";

/** Робочі позиції замовлення для столу конструктора: підпозиції або одна root, якщо підпозицій немає. */
export async function listWorkPositionsForOrder(orderId, orderNumber) {
  const positions = await all(
    `SELECT * FROM positions
     WHERE order_id = $1 OR order_number = $2
     ORDER BY COALESCE(parent_id, id), id`,
    [orderId, orderNumber]
  );
  const subs = positions.filter((p) => p.parent_id);
  if (subs.length) return subs;
  return positions.filter((p) => !p.parent_id);
}

/** Поставити позицію в чергу столу конструктора (без призначення конструктора). */
export async function enqueuePositionForConstructorDesk(positionRow, { planDate = "" } = {}) {
  if (!positionRow?.id) return null;

  const enriched = enrichPositionRow(
    {
      ...positionRow,
      has_constructive_file: Boolean(positionRow.has_constructive_file),
      current_stage: "constructor"
    },
    { planDate }
  );

  const workspaceRaw = String(positionRow.constructor_workspace_json || "").trim();
  const workspaceJson =
    workspaceRaw && workspaceRaw !== "{}"
      ? workspaceRaw
      : JSON.stringify(
          defaultWorkspacePayload({
            item: positionRow.item,
            item_type: positionRow.item_type
          })
        );

  await run(
    `UPDATE positions SET
      current_stage = $2,
      position_status = $3,
      progress = $4,
      constructor_desk_queued_at = COALESCE(constructor_desk_queued_at, now()),
      constructor_workspace_json = CASE
        WHEN trim(coalesce(constructor_workspace_json, '')) IN ('', '{}') THEN $5
        ELSE constructor_workspace_json
      END
     WHERE id = $1`,
    [
      enriched.id,
      enriched.current_stage,
      enriched.position_status,
      enriched.progress,
      workspaceJson
    ]
  );

  return one(`SELECT * FROM positions WHERE id = $1`, [enriched.id]);
}

/** Усі робочі позиції замовлення — у чергу конструктора. */
export async function enqueueOrderPositionsForConstructorDesk(orderRow, { planDate = "" } = {}) {
  const plan = planDate || orderRow.plan_date || "";
  const work = await listWorkPositionsForOrder(orderRow.id, orderRow.order_number);
  const queued = [];
  for (const row of work) {
    const updated = await enqueuePositionForConstructorDesk(row, { planDate: plan });
    if (updated) queued.push(updated);
  }
  return queued;
}

const ORDER_STATUSES_BEFORE_CONSTRUCTOR = new Set(["Новий", ""]);

/** Після призначення всіх конструкторів — перевести замовлення в «У конструктиві». */
export async function syncOrderStatusAfterConstructorAssignment(orderRow, { actor = null } = {}) {
  if (!orderRow?.id) return { updated: false };

  const status = String(orderRow.status || "").trim();
  if (!ORDER_STATUSES_BEFORE_CONSTRUCTOR.has(status)) {
    return { updated: false, reason: "order_not_new" };
  }

  const work = await listWorkPositionsForOrder(orderRow.id, orderRow.order_number);
  if (!work.length) return { updated: false, reason: "no_positions" };

  const allAssigned = work.every((p) => p.constructor_user_id != null);
  if (!allAssigned) return { updated: false, reason: "not_all_assigned" };

  const before = await one(`SELECT * FROM orders WHERE id = $1`, [orderRow.id]);
  const updated = await one(
    `UPDATE orders SET status = 'У конструктиві', updated_at = now() WHERE id = $1 RETURNING *`,
    [orderRow.id]
  );
  if (before && updated) {
    await logOrderUpdate(before, updated, actor);
  }
  return { updated: true, status: "У конструктиві", order: updated };
}
