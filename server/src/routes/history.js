import { Router } from "express";
import { db } from "../db.js";
import { mapHistory } from "../audit.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.get("/", (req, res) => {
  const { entityType, entityId, orderNumber, limit = "100" } = req.query;
  const max = Math.min(Number(limit) || 100, 500);

  let sql = "SELECT * FROM change_history WHERE 1=1";
  const params = {};

  if (entityType) {
    sql += " AND entity_type = @entity_type";
    params.entity_type = entityType;
  }
  if (entityId) {
    sql += " AND entity_id = @entity_id";
    params.entity_id = Number(entityId);
  }
  if (orderNumber) {
    sql += " AND order_number = @order_number";
    params.order_number = String(orderNumber);
  }

  sql += " ORDER BY datetime(created_at) DESC, id DESC LIMIT @limit";
  params.limit = max;

  const rows = db.prepare(sql).all(params);
  res.json(rows.map(mapHistory));
});

export default router;
