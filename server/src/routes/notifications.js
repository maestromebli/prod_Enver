import { Router } from "express";
import { all } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import {
  AI_COUNT_SUBQUERY,
  ACTIVE_SESSION_SUBQUERY,
  buildNotificationsPayloadWithAi,
  LATEST_AI_SUMMARY_SUBQUERY
} from "../godmode-enrich.js";
import { filterNotificationsForRole } from "../ai/ai-notifications.js";

const router = Router();
router.use(requireAuth);

const POSITION_SELECT = `SELECT p.*,
  (SELECT pf.original_name FROM position_files pf
   WHERE pf.position_id = p.id AND pf.kind = 'constructive'
   ORDER BY pf.created_at DESC LIMIT 1) AS constructive_file_name,
  ${AI_COUNT_SUBQUERY},
  ${LATEST_AI_SUMMARY_SUBQUERY},
  ${ACTIVE_SESSION_SUBQUERY}
 FROM positions p`;

const STREAM_INTERVAL_MS = 30_000;

async function loadNotificationsPayload() {
  const orders = await all("SELECT * FROM orders ORDER BY id");
  const rows = await all(`${POSITION_SELECT} WHERE p.parent_id IS NULL ORDER BY p.id`);
  const planMap = new Map(orders.map((o) => [o.order_number, o.plan_date]));

  return buildNotificationsPayloadWithAi({
    orders,
    positions: rows.map((r) => ({ ...r, plan_date: planMap.get(r.order_number) })),
    users: [],
    now: new Date()
  });
}

router.get("/", async (req, res) => {
  const items = await loadNotificationsPayload();
  const role = req.user?.role || "manager";
  res.json(filterNotificationsForRole(items, role));
});

router.get("/stream", async (req, res) => {
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  let closed = false;
  req.on("close", () => {
    closed = true;
  });

  const push = async () => {
    if (closed) return;
    try {
      const items = filterNotificationsForRole(
        await loadNotificationsPayload(),
        req.user?.role || "manager"
      );
      res.write(
        `event: notifications\ndata: ${JSON.stringify({ items, at: new Date().toISOString() })}\n\n`
      );
    } catch (err) {
      console.error("[notifications/stream]", err);
      res.write(
        `event: error\ndata: ${JSON.stringify({ message: "Помилка оновлення сповіщень" })}\n\n`
      );
    }
  };

  await push();
  const timer = setInterval(() => void push(), STREAM_INTERVAL_MS);
  req.on("close", () => clearInterval(timer));
});

export default router;
