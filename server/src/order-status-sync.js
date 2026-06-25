import { all, one, run } from "./db.js";
import { logPositionCreate } from "./audit.js";
import { enrichPositionRow } from "./position-logic.js";
import { nextPositionId } from "./db/position-id.js";
import { insertPosition, updatePositionStagesFromOrderSync } from "./db/position-persistence.js";
import { enqueueOrderPositionsForConstructorDesk } from "./constructor-desk-queue.js";
import { ORDER_STATUSES_CONSTRUCTOR_QUEUE } from "../../shared/production/orders.js";
import {
  ORDER_STATUSES_NEED_POSITION,
  applyOrderStatusPreset,
  defaultPositionRow,
  defaultSubPositionRow,
  orderStatusStagePreset,
  positionStagesChanged
} from "./order-status-workflow.js";

async function insertPositionRow(row, planDate) {
  const enriched = enrichPositionRow(row, { planDate });
  await insertPosition(enriched);
  return one("SELECT * FROM positions WHERE id = $1", [row.id]);
}

async function updatePositionRow(row, planDate) {
  const enriched = enrichPositionRow(row, { planDate });
  await updatePositionStagesFromOrderSync(enriched);
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

  let queuedCount = 0;
  if (ORDER_STATUSES_CONSTRUCTOR_QUEUE.has(status)) {
    const queued = await enqueueOrderPositionsForConstructorDesk(orderRow, { planDate });
    queuedCount = queued.length;
  }

  return { created, updated, queuedCount };
}

/** Створює підпозиції (зони / вироби) під основною позицією замовлення. */
export async function createOrderSubPositions(orderRow, rootRow, itemNames, { actor = null } = {}) {
  if (!rootRow?.id || !itemNames?.length) return { created: 0 };

  const planDate = orderRow.plan_date || "";
  let created = 0;

  for (const itemName of itemNames) {
    const id = await nextPositionId();
    const inserted = await insertPositionRow(
      defaultSubPositionRow(orderRow, rootRow, id, itemName),
      planDate
    );
    await logPositionCreate(inserted, actor);
    created += 1;
  }

  return { created };
}

/** Після створення замовлення: root + підпозиції (за потреби) і черга конструктора. */
export async function bootstrapOrderPositions(
  orderRow,
  { subItems = [], createRootPosition = false, actor = null } = {}
) {
  const { root } = await ensureOrderRootPosition(orderRow, { actor });

  if (createRootPosition && !subItems.length && root?.id) {
    const item = String(orderRow.object || "").trim() || orderRow.order_number;
    await run(`UPDATE positions SET item = $2, item_type = $3 WHERE id = $1`, [
      root.id,
      item,
      "Замовлення"
    ]);
    if (orderRow.default_delivery_address || orderRow.client_address) {
      const addr = String(
        orderRow.default_delivery_address || orderRow.client_address || ""
      ).trim();
      if (addr) {
        await run(
          `UPDATE positions SET delivery_address = $2 WHERE id = $1 AND trim(delivery_address) = ''`,
          [root.id, addr]
        );
      }
    }
  }

  if (subItems.length) {
    await createOrderSubPositions(orderRow, root, subItems, { actor });
  }
  const queued = await enqueueOrderPositionsForConstructorDesk(orderRow, {
    planDate: orderRow.plan_date || ""
  });
  return { root, queuedCount: queued.length };
}
