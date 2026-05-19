import { Router } from "express";
import { db } from "../db.js";
import { logOrderCreate, logOrderDelete, logOrderUpdate } from "../audit.js";
import { auditActor, requireAuth, requireOrderWrite } from "../middleware/auth.js";
import { mapOrder, orderToDb } from "../mappers.js";

const router = Router();
router.use(requireAuth);

const listStmt = db.prepare("SELECT * FROM orders ORDER BY id");
const getStmt = db.prepare("SELECT * FROM orders WHERE id = ?");

const insertStmt = db.prepare(`
  INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
  VALUES (@order_number, @object, @client, @manager, @start_date, @plan_date, @status, @priority, @comment)
`);

const updateStmt = db.prepare(`
  UPDATE orders SET
    order_number = @order_number,
    object = @object,
    client = @client,
    manager = @manager,
    start_date = @start_date,
    plan_date = @plan_date,
    status = @status,
    priority = @priority,
    comment = @comment,
    updated_at = datetime('now')
  WHERE id = @id
`);

const deleteStmt = db.prepare("DELETE FROM orders WHERE id = ?");

const syncPositionsByOrderId = db.prepare(`
  UPDATE positions SET order_number = @order_number, object = @object
  WHERE order_id = @order_id
`);

router.get("/", (_req, res) => {
  const rows = listStmt.all();
  res.json(rows.map(mapOrder));
});

router.get("/:id", (req, res) => {
  const row = getStmt.get(req.params.id);
  if (!row) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }
  res.json(mapOrder(row));
});

router.post("/", requireOrderWrite, (req, res) => {
  const data = orderToDb(req.body);
  if (!data.order_number) {
    res.status(400).json({ error: "Вкажіть номер замовлення" });
    return;
  }

  try {
    const result = insertStmt.run(data);
    const id = result.lastInsertRowid;
    db.prepare(`
      UPDATE positions SET order_id = ?, object = @object
      WHERE order_number = @order_number AND order_id IS NULL
    `).run({ order_id: id, order_number: data.order_number, object: data.object });
    const row = getStmt.get(id);
    logOrderCreate(row, auditActor(req));
    res.status(201).json(mapOrder(row));
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(409).json({ error: "Замовлення з таким номером уже існує" });
      return;
    }
    throw err;
  }
});

router.put("/:id", requireOrderWrite, (req, res) => {
  const id = Number(req.params.id);
  const existing = getStmt.get(id);
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
    updateStmt.run({ ...data, id });
    syncPositionsByOrderId.run({
      order_id: id,
      order_number: data.order_number,
      object: data.object
    });
    db.prepare(`
      UPDATE positions SET order_number = @order_number, object = @object
      WHERE order_number = @old_order_number
    `).run({
      order_number: data.order_number,
      object: data.object,
      old_order_number: existing.order_number
    });
    const row = getStmt.get(id);
    logOrderUpdate(existing, row, auditActor(req));
    res.json(mapOrder(row));
  } catch (err) {
    if (err.code === "SQLITE_CONSTRAINT_UNIQUE") {
      res.status(409).json({ error: "Замовлення з таким номером уже існує" });
      return;
    }
    throw err;
  }
});

router.delete("/:id", requireOrderWrite, (req, res) => {
  const id = Number(req.params.id);
  const existing = getStmt.get(id);
  if (!existing) {
    res.status(404).json({ error: "Замовлення не знайдено" });
    return;
  }

  const unlink = db.prepare(`
    UPDATE positions SET order_id = NULL WHERE order_id = ?
  `);

  const remove = db.transaction(() => {
    logOrderDelete(existing, auditActor(req));
    unlink.run(id);
    deleteStmt.run(id);
  });

  remove();
  res.status(204).send();
});

export default router;
