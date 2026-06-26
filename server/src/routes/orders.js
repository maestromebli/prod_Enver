import { Router } from "express";
import { all, one, run, withTransaction } from "../db.js";
import { logOrderCreate, logOrderDelete, logOrderUpdate } from "../audit.js";
import { auditActor, requireAuth, requireOrderWrite } from "../middleware/auth.js";
import { mapOrder, orderToDb } from "../mappers.js";
import { bootstrapOrderPositions, syncOrderStatusWorkflow } from "../order-status-sync.js";
import { normalizeOrderSubItems } from "../order-status-workflow.js";
import { attachGodmodeToOrder, enrichAndMapPosition } from "../godmode-enrich.js";
import { getWorkPositions } from "../../../shared/production/order-position-model.js";
import { loadStageTimestampsMap, stageTimestampsForPosition } from "../stage-timestamps.js";
import { canRunNextAction } from "../../../shared/production/godmode.js";
import {
  CONSTRUCTIVE_FILE_COUNT_SUBQUERY,
  CONSTRUCTIVE_FILE_NAME_SUBQUERY
} from "../constructive-files-service.js";
import {
  HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY,
  PACKAGE_ID_SUBQUERY,
  PACKAGE_PARTS_COUNT_SUBQUERY,
  PACKAGE_STATUS_SUBQUERY,
  PACKAGE_VERSION_SUBQUERY,
  UNMAPPED_PARTS_SUBQUERY
} from "../constructive-package-enrich.js";
import { MANAGER_FILE_COUNT_SUBQUERY } from "../position-manager-service.js";
const router = Router();
router.use(requireAuth);

const PG_UNIQUE_VIOLATION = "23505";
const ORDER_DONE_STATUS = "Завершено";

const ORDER_POSITIONS_SELECT = `SELECT p.*,
  ${CONSTRUCTIVE_FILE_NAME_SUBQUERY},
  ${CONSTRUCTIVE_FILE_COUNT_SUBQUERY},
  ${PACKAGE_STATUS_SUBQUERY},
  ${PACKAGE_ID_SUBQUERY},
  ${PACKAGE_VERSION_SUBQUERY},
  ${HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY},
  ${UNMAPPED_PARTS_SUBQUERY},
  ${PACKAGE_PARTS_COUNT_SUBQUERY},
  ${MANAGER_FILE_COUNT_SUBQUERY},
  (SELECT COUNT(*)::int FROM constructive_analyses ca
   JOIN position_files pf ON pf.id = ca.position_file_id
   WHERE pf.position_id = p.id) AS ai_analysis_count,
  (SELECT COUNT(*)::int FROM operator_sessions os
   WHERE os.position_id = p.id AND os.finished_at IS NULL) AS active_operator_sessions`;

async function mapOrderPositions(order, positionRows) {
  const tsMap = await loadStageTimestampsMap(positionRows.map((r) => r.id));
  const now = new Date();
  return positionRows.map((r) =>
    enrichAndMapPosition(r, order.planDate, {
      hasAiAnalysis: Number(r.ai_analysis_count) > 0,
      hasActiveOperatorSession: Number(r.active_operator_sessions) > 0,
      stageTimestamps: stageTimestampsForPosition(tsMap, r.id),
      now
    })
  );
}

async function archiveOrderPositions(orderId) {
  await run(
    `UPDATE positions SET
      cutting_status = 'Готово',
      edging_status = 'Готово',
      drilling_status = 'Готово',
      assembly_status = 'Готово',
      packaging_status = 'Готово',
      position_status = 'Завершено',
      progress = 100,
      overdue_days = 0
     WHERE order_id = $1`,
    [orderId]
  );
}

router.get("/", async (_req, res) => {
  const rows = await all("SELECT * FROM orders ORDER BY id");
  const positionRows = await all(`${ORDER_POSITIONS_SELECT} FROM positions p`);
  const planMap = new Map(rows.map((o) => [o.order_number, o.plan_date]));
  const tsMap = await loadStageTimestampsMap(positionRows.map((r) => r.id));
  const now = new Date();
  const mappedPositions = positionRows.map((row) =>
    enrichAndMapPosition(row, planMap.get(row.order_number), {
      hasAiAnalysis: Number(row.ai_analysis_count) > 0,
      hasActiveOperatorSession: Number(row.active_operator_sessions) > 0,
      stageTimestamps: stageTimestampsForPosition(tsMap, row.id),
      now
    })
  );

  res.json(
    rows.map((row) => {
      const order = mapOrder(row);
      const related = mappedPositions.filter(
        (p) => p.orderId === order.id || p.orderNumber === order.orderNumber
      );
      return attachGodmodeToOrder(order, related, { planDate: order.planDate });
    })
  );
});

router.get("/:id", async (req, res) => {
  const row = await one("SELECT * FROM orders WHERE id = $1", [req.params.id]);
  if (!row) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }
  const order = mapOrder(row);
  const positionRows = await all(
    `${ORDER_POSITIONS_SELECT}
     FROM positions p
     WHERE p.order_id = $1 OR p.order_number = $2
     ORDER BY COALESCE(p.parent_id, p.id), CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END, p.id`,
    [order.id, order.orderNumber]
  );
  const mappedPositions = await mapOrderPositions(order, positionRows);
  const workPositions = getWorkPositions(order, mappedPositions);
  res.json({
    ...attachGodmodeToOrder(order, mappedPositions, { planDate: order.planDate }),
    positions: mappedPositions,
    workPositions,
    summary: { workPositionCount: workPositions.length }
  });
});

router.post("/:id/run-next-action", requireOrderWrite, async (req, res) => {
  const id = Number(req.params.id);
  const row = await one("SELECT * FROM orders WHERE id = $1", [id]);
  if (!row) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }

  const order = mapOrder(row);
  const positionRows = await all(
    `${ORDER_POSITIONS_SELECT}
     FROM positions p
     WHERE p.order_id = $1 OR p.order_number = $2
     ORDER BY COALESCE(p.parent_id, p.id), CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END, p.id`,
    [order.id, order.orderNumber]
  );
  const mappedPositions = await mapOrderPositions(order, positionRows);
  const enrichedOrder = attachGodmodeToOrder(order, mappedPositions, { planDate: order.planDate });
  const nextAction = enrichedOrder.godmode.nextAction;
  const requestedType = req.body?.actionType || nextAction.type;

  if (requestedType !== nextAction.type) {
    res.status(400).json({
      error: "Зараз доступна інша дія.",
      nextAction
    });
    return;
  }

  const permission = canRunNextAction(order, nextAction, req.user, { planDate: order.planDate });
  if (!permission.allowed) {
    res.status(permission.code === "ACTION_REQUIRES_INPUT" ? 422 : 403).json({
      code: permission.code || "NOT_ALLOWED",
      error: permission.reason || "Цю дію зараз неможливо виконати."
    });
    return;
  }

  if (requestedType === "close_order") {
    const workPositions = getWorkPositions(order, mappedPositions);
    const closeTargets = workPositions.length
      ? workPositions
      : mappedPositions.filter((p) => !p.parentId);
    const allDone =
      closeTargets.length > 0 &&
      closeTargets.every((p) => (p.positionStatus || p.position_status) === "Завершено");
    if (!allDone) {
      res.status(400).json({ error: "Не всі позиції завершені — замовлення не можна закрити." });
      return;
    }

    const updated = await one(
      `UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, ORDER_DONE_STATUS]
    );
    await archiveOrderPositions(id);
    await logOrderUpdate(row, updated, auditActor(req));
    await syncOrderStatusWorkflow(updated, { actor: auditActor(req) });

    const afterRows = await all(
      `${ORDER_POSITIONS_SELECT}
       FROM positions p
       WHERE p.order_id = $1 OR p.order_number = $2
       ORDER BY COALESCE(p.parent_id, p.id), CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END, p.id`,
      [order.id, order.orderNumber]
    );
    const afterPositions = await mapOrderPositions(mapOrder(updated), afterRows);
    res.json(attachGodmodeToOrder(mapOrder(updated), afterPositions, { planDate: order.planDate }));
    return;
  }

  res.status(422).json({
    code: "ACTION_REQUIRES_INPUT",
    error: "Для цього потрібно виконати дію в інтерфейсі."
  });
});

router.post("/", requireOrderWrite, async (req, res) => {
  const data = orderToDb(req.body);
  if (!data.order_number) {
    res.status(400).json({ error: "Вкажіть номер замовлення" });
    return;
  }

  try {
    const inserted = await one(
      `INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment, default_delivery_address)
       VALUES (@order_number, @object, @client, @manager, @start_date, @plan_date, @status, @priority, @comment, @default_delivery_address)
       RETURNING *`,
      data
    );
    await run(
      `UPDATE positions SET order_id = @order_id, object = @object
       WHERE order_number = @order_number AND order_id IS NULL`,
      { order_id: inserted.id, order_number: data.order_number, object: data.object }
    );
    await logOrderCreate(inserted, auditActor(req));
    const actor = auditActor(req);
    const subItems = normalizeOrderSubItems(req.body);
    const createRootPosition = Boolean(req.body?.createRootPosition);
    await bootstrapOrderPositions(inserted, { subItems, createRootPosition, actor });
    await syncOrderStatusWorkflow(inserted, { actor });

    const positionRows = await all(
      `${ORDER_POSITIONS_SELECT}
       FROM positions p
       WHERE p.order_id = $1 OR p.order_number = $2
       ORDER BY COALESCE(p.parent_id, p.id), CASE WHEN p.parent_id IS NULL THEN 0 ELSE 1 END, p.id`,
      [inserted.id, data.order_number]
    );
    const order = mapOrder(inserted);
    const mappedPositions = await mapOrderPositions(order, positionRows);
    res.status(201).json({
      ...attachGodmodeToOrder(order, mappedPositions, { planDate: order.planDate }),
      positions: mappedPositions,
      workPositions: getWorkPositions(order, mappedPositions)
    });
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      res.status(409).json({ error: "Замовлення з таким номером уже існує" });
      return;
    }
    throw err;
  }
});

router.put("/:id", requireOrderWrite, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await one("SELECT * FROM orders WHERE id = $1", [id]);
  if (!existing) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }

  const data = orderToDb(req.body);
  if (!data.order_number) {
    res.status(400).json({ error: "Вкажіть номер замовлення" });
    return;
  }

  try {
    const updated = await one(
      `UPDATE orders SET
        order_number = @order_number,
        object = @object,
        client = @client,
        manager = @manager,
        start_date = @start_date,
        plan_date = @plan_date,
        status = @status,
        priority = @priority,
        comment = @comment,
        default_delivery_address = @default_delivery_address,
        updated_at = now()
      WHERE id = @id
      RETURNING *`,
      { ...data, id }
    );
    await run(
      `UPDATE positions SET order_number = @order_number, object = @object
       WHERE order_id = @order_id`,
      { order_id: id, order_number: data.order_number, object: data.object }
    );
    await run(
      `UPDATE positions SET order_number = @order_number, object = @object
       WHERE order_number = @old_order_number`,
      {
        order_number: data.order_number,
        object: data.object,
        old_order_number: existing.order_number
      }
    );
    if (updated.status === ORDER_DONE_STATUS) {
      await archiveOrderPositions(id);
    }
    await logOrderUpdate(existing, updated, auditActor(req));
    await syncOrderStatusWorkflow(updated, { actor: auditActor(req) });
    res.json(mapOrder(updated));
  } catch (err) {
    if (err.code === PG_UNIQUE_VIOLATION) {
      res.status(409).json({ error: "Замовлення з таким номером уже існує" });
      return;
    }
    throw err;
  }
});

router.delete("/:id", requireOrderWrite, async (req, res) => {
  const id = Number(req.params.id);
  const existing = await one("SELECT * FROM orders WHERE id = $1", [id]);
  if (!existing) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }

  await withTransaction(async (tx) => {
    await logOrderDelete(existing, auditActor(req));
    await tx.run("UPDATE positions SET order_id = NULL WHERE order_id = $1", [id]);
    await tx.run("DELETE FROM orders WHERE id = $1", [id]);
  });

  res.status(204).send();
});

export default router;
