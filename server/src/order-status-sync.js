import { all, one, run } from "./db.js";
import { logPositionCreate } from "./audit.js";
import { enrichPositionRow } from "./position-logic.js";
import { nextPositionId } from "./db/position-id.js";
import {
  ORDER_STATUSES_NEED_POSITION,
  applyOrderStatusPreset,
  defaultPositionRow,
  orderStatusStagePreset,
  positionStagesChanged
} from "./order-status-workflow.js";

async function insertPositionRow(row, planDate) {
  const enriched = enrichPositionRow(row, { planDate });
  await run(
    `INSERT INTO positions (
      id, parent_id, order_id, order_number, object, item, item_type, manager, constructor_name,
      cutting_status, edging_status, drilling_status, assembly_status, assembly_responsible,
      ready_date, install_date, install_end_date, install_time_start, install_time_end, install_responsible,
      position_status, progress, overdue_days, problem, note
    ) VALUES (
      @id, @parent_id, @order_id, @order_number, @object, @item, @item_type, @manager, @constructor_name,
      @cutting_status, @edging_status, @drilling_status, @assembly_status, @assembly_responsible,
      @ready_date, @install_date, @install_end_date, @install_time_start, @install_time_end, @install_responsible,
      @position_status, @progress, @overdue_days, @problem, @note
    )`,
    enriched
  );
  return one("SELECT * FROM positions WHERE id = $1", [row.id]);
}

async function updatePositionRow(row, planDate) {
  const enriched = enrichPositionRow(row, { planDate });
  await run(
    `UPDATE positions SET
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      position_status = @position_status,
      progress = @progress,
      overdue_days = @overdue_days
    WHERE id = @id`,
    {
      id: enriched.id,
      cutting_status: enriched.cutting_status,
      edging_status: enriched.edging_status,
      drilling_status: enriched.drilling_status,
      assembly_status: enriched.assembly_status,
      position_status: enriched.position_status,
      progress: enriched.progress,
      overdue_days: enriched.overdue_days
    }
  );
}

/** Гарантує одну основну позицію на замовлення (контейнер для підпозицій). */
export async function ensureOrderRootPosition(orderRow, { actor = null } = {}) {
  const planDate = orderRow.plan_date || "";
  const positions = await all(
    `SELECT * FROM positions
     WHERE order_id = $1 OR order_number = $2
     ORDER BY COALESCE(parent_id, id), id`,
    [orderRow.id, orderRow.order_number]
  );

  const roots = positions.filter((p) => !p.parent_id);
  if (roots.length) {
    return { created: 0, root: roots[0] };
  }

  const id = await nextPositionId();
  const inserted = await insertPositionRow(defaultPositionRow(orderRow, id), planDate);
  await logPositionCreate(inserted, actor);
  return { created: 1, root: inserted };
}

/** Після зміни статусу замовлення: створити позицію (якщо немає) і передати на відповідні етапи. */
export async function syncOrderStatusWorkflow(orderRow, { actor = null } = {}) {
  const status = String(orderRow.status || "").trim();
  if (!ORDER_STATUSES_NEED_POSITION.has(status)) {
    return { created: 0, updated: 0 };
  }

  const planDate = orderRow.plan_date || "";
  const { created, root } = await ensureOrderRootPosition(orderRow, { actor });
  let roots = root ? [root] : [];

  const preset = orderStatusStagePreset(status);
  let updated = 0;

  for (const pos of roots) {
    const next = applyOrderStatusPreset(pos, preset);
    if (!positionStagesChanged(pos, next)) continue;
    await updatePositionRow(next, planDate);
    updated += 1;
  }

  return { created, updated };
}
