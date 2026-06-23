import { Router } from "express";
import { all, one, run, withTransaction } from "../db.js";
import { logOrderCreate, logOrderDelete, logOrderUpdate } from "../audit.js";
import { auditActor, requireAuth, requireOrderWrite } from "../middleware/auth.js";
import { mapOrder, orderToDb } from "../mappers.js";
import { ensureOrderRootPosition, syncOrderStatusWorkflow } from "../order-status-sync.js";
const router = Router();
router.use(requireAuth);

const PG_UNIQUE_VIOLATION = "23505";
const ORDER_DONE_STATUS = "Завершено";

async function archiveOrderPositions(orderId) {
  await run(
    `UPDATE positions SET
      cutting_status = 'Готово',
      edging_status = 'Готово',
      drilling_status = 'Готово',
      assembly_status = 'Готово',
      position_status = 'Завершено',
      progress = 100,
      overdue_days = 0
     WHERE order_id = $1`,
    [orderId]
  );
}

router.get("/", async (_req, res) => {
  const rows = await all("SELECT * FROM orders ORDER BY id");
  res.json(rows.map(mapOrder));
});

router.get("/:id", async (req, res) => {
  const row = await one("SELECT * FROM orders WHERE id = $1", [req.params.id]);
  if (!row) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }
  res.json(mapOrder(row));
});

router.post("/", requireOrderWrite, async (req, res) => {
  const data = orderToDb(req.body);
  if (!data.order_number) {
    res.status(400).json({ error: "Вкажіть номер замовлення" });
    return;
  }

  try {
    const inserted = await one(
      `INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
       VALUES (@order_number, @object, @client, @manager, @start_date, @plan_date, @status, @priority, @comment)
       RETURNING *`,
      data
    );
    await run(
      `UPDATE positions SET order_id = @order_id, object = @object
       WHERE order_number = @order_number AND order_id IS NULL`,
      { order_id: inserted.id, order_number: data.order_number, object: data.object }
    );
    await logOrderCreate(inserted, auditActor(req));
    await ensureOrderRootPosition(inserted, { actor: auditActor(req) });
    await syncOrderStatusWorkflow(inserted, { actor: auditActor(req) });
    res.status(201).json(mapOrder(inserted));
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
