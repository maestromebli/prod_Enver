import { Router } from "express";
import { all, one, run } from "../db.js";
import { STAGE_STATUS_FIELD } from "../roles.js";
import { mapPosition } from "../mappers.js";
import { enrichPositionRow } from "../position-logic.js";
import { logStageChange } from "../audit.js";
import {
  auditActor,
  requireAuth,
  requireOperatorPanelView,
  requireOperatorSelf
} from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.use((req, res, next) => {
  if (req.method === "GET") {
    requireOperatorPanelView(req, res, next);
    return;
  }
  next();
});

async function getPosition(id) {
  return one("SELECT * FROM positions WHERE id = $1", [id]);
}

async function savePosition(id, row) {
  const enriched = enrichPositionRow(row);
  await run(
    `UPDATE positions SET
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      position_status = @position_status,
      progress = @progress
    WHERE id = @id`,
    {
      id,
      cutting_status: enriched.cutting_status,
      edging_status: enriched.edging_status,
      drilling_status: enriched.drilling_status,
      assembly_status: enriched.assembly_status,
      position_status: enriched.position_status,
      progress: enriched.progress
    }
  );
  return mapPosition(await getPosition(id));
}

router.get("/queue/:stageKey", async (req, res) => {
  const field = STAGE_STATUS_FIELD[req.params.stageKey];
  if (!field) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }

  const rows = await all(
    `SELECT p.*, o.priority AS order_priority, o.plan_date
     FROM positions p
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.${field} IN ('Передано', 'В роботі', 'На паузі')
     ORDER BY
       CASE p.${field} WHEN 'В роботі' THEN 0 WHEN 'На паузі' THEN 0 ELSE 1 END,
       CASE WHEN p.problem <> '' THEN 0 ELSE 1 END,
       CASE WHEN p.overdue_days > 0 THEN 0 ELSE 1 END,
       CASE o.priority WHEN 'Високий' THEN 0 WHEN 'Середній' THEN 1 ELSE 2 END,
       p.overdue_days DESC,
       p.id`
  );
  const queue = rows.map((r) => mapPosition(enrichPositionRow(r, { planDate: r.plan_date })));

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Увійдіть у систему" });
    return;
  }

  const activeSession = await one(
    `SELECT os.*, p.order_number, p.item, p.object
     FROM operator_sessions os
     JOIN positions p ON p.id = os.position_id
     WHERE os.user_id = $1 AND os.finished_at IS NULL
     ORDER BY
       CASE WHEN os.stage_key = $2 THEN 0 ELSE 1 END,
       os.started_at DESC
     LIMIT 1`,
    [userId, req.params.stageKey]
  );

  res.json({ queue, activeSession: activeSession || null });
});

async function getOpenSession(userId, positionId, stageKey) {
  return one(
    `SELECT * FROM operator_sessions
     WHERE user_id = $1 AND position_id = $2 AND stage_key = $3 AND finished_at IS NULL
     ORDER BY id DESC LIMIT 1`,
    [userId, positionId, stageKey]
  );
}

router.post("/start", requireOperatorSelf, async (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const row = await getPosition(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const current = row[field];
  if (!["Передано", "Не розпочато"].includes(current)) {
    res.status(400).json({ error: `Етап у статусі «${current || "—"}» — не можна почати` });
    return;
  }

  const open = await one(
    `SELECT id, position_id, stage_key FROM operator_sessions
     WHERE user_id = $1 AND finished_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [userId]
  );
  if (open) {
    if (open.position_id === positionId) {
      res.status(409).json({ error: "Це завдання вже в роботі — натисніть «Закінчив»" });
    } else {
      res.status(409).json({
        error: "Спочатку завершіть поточне завдання (натисніть «Закінчив»), потім беріть наступне"
      });
    }
    return;
  }

  const before = { ...row };
  row[field] = "В роботі";

  const session = await one(
    `INSERT INTO operator_sessions (user_id, position_id, stage_key, started_at)
     VALUES ($1, $2, $3, now())
     RETURNING id`,
    [userId, positionId, stageKey]
  );

  await savePosition(positionId, row);
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "В роботі" },
    auditActor(req)
  );

  res.json({
    sessionId: session.id,
    position: mapPosition(await getPosition(positionId))
  });
});

router.post("/finish", requireOperatorSelf, async (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const session = await getOpenSession(userId, positionId, stageKey);

  if (!session) {
    res.status(404).json({ error: "Активну сесію не знайдено" });
    return;
  }

  const row = await getPosition(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  if (!["В роботі", "На паузі"].includes(row[field])) {
    res.status(400).json({
      error: `Завершити можна лише з «В роботі» або «На паузі» (зараз «${row[field]}»)`
    });
    return;
  }

  const before = { ...row };
  row[field] = "Готово";

  await run(`UPDATE operator_sessions SET finished_at = now() WHERE id = $1`, [session.id]);

  await savePosition(positionId, row);
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "Готово" },
    auditActor(req)
  );

  res.json({ position: mapPosition(await getPosition(positionId)) });
});

router.post("/pause", requireOperatorSelf, async (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const session = await getOpenSession(userId, positionId, stageKey);
  if (!session) {
    res.status(404).json({ error: "Активну сесію не знайдено" });
    return;
  }

  const row = await getPosition(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  if (row[field] !== "В роботі") {
    res
      .status(400)
      .json({ error: `Пауза доступна лише у статусі «В роботі» (зараз «${row[field]}»)` });
    return;
  }

  const before = { ...row };
  row[field] = "На паузі";

  await savePosition(positionId, row);
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "На паузі" },
    auditActor(req)
  );

  res.json({ position: mapPosition(await getPosition(positionId)) });
});

router.post("/resume", requireOperatorSelf, async (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const session = await getOpenSession(userId, positionId, stageKey);
  if (!session) {
    res.status(404).json({ error: "Активну сесію не знайдено" });
    return;
  }

  const row = await getPosition(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  if (row[field] !== "На паузі") {
    res.status(400).json({ error: `Продовження доступне лише з паузи (зараз «${row[field]}»)` });
    return;
  }

  const before = { ...row };
  row[field] = "В роботі";

  await savePosition(positionId, row);
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "В роботі" },
    auditActor(req)
  );

  res.json({ position: mapPosition(await getPosition(positionId)) });
});

export default router;
