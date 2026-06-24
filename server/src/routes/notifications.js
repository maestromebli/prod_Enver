import { Router } from "express";
import { all } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  AI_COUNT_SUBQUERY,
  ACTIVE_SESSION_SUBQUERY,
  buildNotificationsPayload
} from "../godmode-enrich.js";

const router = Router();
router.use(requireAuth);

const POSITION_SELECT = `SELECT p.*,
  (SELECT pf.original_name FROM position_files pf
   WHERE pf.position_id = p.id AND pf.kind = 'constructive'
   ORDER BY pf.created_at DESC LIMIT 1) AS constructive_file_name,
  ${AI_COUNT_SUBQUERY},
  ${ACTIVE_SESSION_SUBQUERY}
 FROM positions p`;

router.get("/", async (_req, res) => {
  const orders = await all("SELECT * FROM orders ORDER BY id");
  const rows = await all(`${POSITION_SELECT} WHERE p.parent_id IS NULL ORDER BY p.id`);
  const planMap = new Map(orders.map((o) => [o.order_number, o.plan_date]));

  const notifications = await buildNotificationsPayload({
    orders,
    positions: rows.map((r) => ({ ...r, plan_date: planMap.get(r.order_number) })),
    users: [],
    now: new Date()
  });

  res.json(notifications);
});

export default router;
