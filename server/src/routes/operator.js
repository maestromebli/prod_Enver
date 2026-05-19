import { Router } from "express";
import { db } from "../db.js";
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

const getPosition = db.prepare("SELECT * FROM positions WHERE id = ?");

function savePosition(id, row) {
  const enriched = enrichPositionRow(row);
  db.prepare(`
    UPDATE positions SET
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      position_status = @position_status,
      progress = @progress
    WHERE id = @id
  `).run({
    id,
    cutting_status: enriched.cutting_status,
    edging_status: enriched.edging_status,
    drilling_status: enriched.drilling_status,
    assembly_status: enriched.assembly_status,
    position_status: enriched.position_status,
    progress: enriched.progress
  });
  return mapPosition(getPosition.get(id));
}

router.get("/queue/:stageKey", (req, res) => {
  const field = STAGE_STATUS_FIELD[req.params.stageKey];
  if (!field) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }

  const rows = db
    .prepare(
      `SELECT p.*, o.priority AS order_priority, o.plan_date
       FROM positions p
       LEFT JOIN orders o ON o.id = p.order_id
       WHERE p.${field} IN ('Передано', 'В роботі', 'На паузі')
       ORDER BY
         CASE p.${field} WHEN 'В роботі' THEN 0 WHEN 'На паузі' THEN 0 ELSE 1 END,
         CASE WHEN p.problem != '' THEN 0 ELSE 1 END,
         CASE WHEN p.overdue_days > 0 THEN 0 ELSE 1 END,
         CASE o.priority WHEN 'Високий' THEN 0 WHEN 'Середній' THEN 1 ELSE 2 END,
         p.overdue_days DESC,
         p.id`
    )
    .all()
    .map((r) => mapPosition(enrichPositionRow(r, { planDate: r.plan_date })));

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Увійдіть у систему" });
    return;
  }

  const activeSession = db
    .prepare(
      `SELECT os.*, p.order_number, p.item, p.object
       FROM operator_sessions os
       JOIN positions p ON p.id = os.position_id
       WHERE os.user_id = ? AND os.finished_at IS NULL
       ORDER BY
         CASE WHEN os.stage_key = ? THEN 0 ELSE 1 END,
         os.started_at DESC
       LIMIT 1`
    )
    .get(userId, req.params.stageKey);

  res.json({ queue: rows, activeSession: activeSession || null });
});

router.post("/start", requireOperatorSelf, (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const row = getPosition.get(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const current = row[field];
  if (!["Передано", "Не розпочато"].includes(current)) {
    res.status(400).json({ error: `Етап у статусі «${current || "—"}» — не можна почати` });
    return;
  }

  const open = db
    .prepare(
      `SELECT id, position_id, stage_key FROM operator_sessions
       WHERE user_id = ? AND finished_at IS NULL
       ORDER BY started_at DESC LIMIT 1`
    )
    .get(userId);
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

  const session = db
    .prepare(
      `INSERT INTO operator_sessions (user_id, position_id, stage_key, started_at)
       VALUES (?, ?, ?, datetime('now'))`
    )
    .run(userId, positionId, stageKey);

  savePosition(positionId, row);
  logStageChange(before, getPosition.get(positionId), stageKey, { status: "В роботі" }, auditActor(req));

  res.json({
    sessionId: session.lastInsertRowid,
    position: mapPosition(getPosition.get(positionId))
  });
});

router.post("/finish", requireOperatorSelf, (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const session = getOpenSession(userId, positionId, stageKey);

  if (!session) {
    res.status(404).json({ error: "Активну сесію не знайдено" });
    return;
  }

  const row = getPosition.get(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  if (!["В роботі", "На паузі"].includes(row[field])) {
    res.status(400).json({ error: `Завершити можна лише з «В роботі» або «На паузі» (зараз «${row[field]}»)` });
    return;
  }

  const before = { ...row };
  row[field] = "Готово";

  db.prepare(`UPDATE operator_sessions SET finished_at = datetime('now') WHERE id = ?`).run(session.id);

  savePosition(positionId, row);
  logStageChange(before, getPosition.get(positionId), stageKey, { status: "Готово" }, auditActor(req));

  res.json({ position: mapPosition(getPosition.get(positionId)) });
});

function getOpenSession(userId, positionId, stageKey) {
  return db
    .prepare(
      `SELECT * FROM operator_sessions
       WHERE user_id = ? AND position_id = ? AND stage_key = ? AND finished_at IS NULL
       ORDER BY id DESC LIMIT 1`
    )
    .get(userId, positionId, stageKey);
}

router.post("/pause", requireOperatorSelf, (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const session = getOpenSession(userId, positionId, stageKey);
  if (!session) {
    res.status(404).json({ error: "Активну сесію не знайдено" });
    return;
  }

  const row = getPosition.get(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  if (row[field] !== "В роботі") {
    res.status(400).json({ error: `Пауза доступна лише у статусі «В роботі» (зараз «${row[field]}»)` });
    return;
  }

  const before = { ...row };
  row[field] = "На паузі";

  savePosition(positionId, row);
  logStageChange(before, getPosition.get(positionId), stageKey, { status: "На паузі" }, auditActor(req));

  res.json({ position: mapPosition(getPosition.get(positionId)) });
});

router.post("/resume", requireOperatorSelf, (req, res) => {
  const { userId, positionId, stageKey } = req.body || {};
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!userId || !positionId || !field) {
    res.status(400).json({ error: "userId, positionId та stageKey обов'язкові" });
    return;
  }

  const session = getOpenSession(userId, positionId, stageKey);
  if (!session) {
    res.status(404).json({ error: "Активну сесію не знайдено" });
    return;
  }

  const row = getPosition.get(positionId);
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

  savePosition(positionId, row);
  logStageChange(before, getPosition.get(positionId), stageKey, { status: "В роботі" }, auditActor(req));

  res.json({ position: mapPosition(getPosition.get(positionId)) });
});

export default router;
