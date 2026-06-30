import { Router } from "express";
import { all, one, run } from "../db.js";
import { STAGE_STATUS_FIELD } from "../roles.js";
import { enrichPositionRow, applyStageHandoff, detectAutoHandoffs } from "../position-logic.js";
import { logStageChange, logStageChangeWithAutoHandoffs } from "../audit.js";
import {
  reconcileOperatorSessionsForUser,
  reconcileStaleStageStatuses,
  isOperatorSessionActive,
  stageStatusFromRow
} from "../operator-sessions.js";
import { updatePositionStages } from "../db/position-persistence.js";
import { syncOrderStatusFromPositions } from "../order-status-from-positions.js";
import { OPERATOR_QUEUE_STATUSES, sqlLiteralsIn } from "../../../shared/production/stages.js";
import {
  AI_COUNT_SUBQUERY,
  ACTIVE_SESSION_SUBQUERY,
  enrichAndMapPosition
} from "../godmode-enrich.js";
import { loadStageTimestampsMap, stageTimestampsForPosition } from "../stage-timestamps.js";
import { getOperatorJobDetails } from "../folder-sync.js";
import {
  computeStageEstimateForPosition,
  mapSessionEstimate,
  recordStageCompletionFact,
  saveSessionStageEstimate
} from "../stage-duration-learning.js";
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
  return one(
    `SELECT p.*, ${AI_COUNT_SUBQUERY}, ${ACTIVE_SESSION_SUBQUERY}
     FROM positions p WHERE p.id = $1`,
    [id]
  );
}

async function mapOperatorPosition(row) {
  if (!row) return null;
  const order = row.order_id
    ? await one("SELECT plan_date FROM orders WHERE id = $1", [row.order_id])
    : null;
  const tsMap = await loadStageTimestampsMap([row.id]);
  return enrichAndMapPosition(row, order?.plan_date, {
    hasAiAnalysis: Number(row.ai_analysis_count) > 0,
    stageTimestamps: stageTimestampsForPosition(tsMap, row.id),
    now: new Date()
  });
}

async function savePosition(id, row, { actor = null } = {}) {
  const enriched = enrichPositionRow(row);
  await updatePositionStages({ ...enriched, id });
  const mapped = await mapOperatorPosition(await getPosition(id));
  if (mapped?.orderId) {
    await syncOrderStatusFromPositions(mapped.orderId, { actor });
  }
  return mapped;
}

router.get("/queue/:stageKey", async (req, res) => {
  const stageKey = req.params.stageKey;
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!field) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }

  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Увійдіть у систему" });
    return;
  }

  await reconcileOperatorSessionsForUser(userId);
  await reconcileStaleStageStatuses(stageKey);

  const queueIn = sqlLiteralsIn(OPERATOR_QUEUE_STATUSES);
  const rows = await all(
    `SELECT p.*, o.priority AS order_priority, o.plan_date
     FROM positions p
     LEFT JOIN orders o ON o.id = p.order_id
     WHERE p.${field} IN (${queueIn})
     ORDER BY
       CASE p.${field} WHEN 'В роботі' THEN 0 WHEN 'На паузі' THEN 0 ELSE 1 END,
       CASE WHEN p.problem <> '' THEN 0 ELSE 1 END,
       CASE WHEN p.overdue_days > 0 THEN 0 ELSE 1 END,
       CASE o.priority WHEN 'Високий' THEN 0 WHEN 'Середній' THEN 1 ELSE 2 END,
       p.overdue_days DESC,
       p.id`
  );
  const queue = await Promise.all(rows.map((r) => mapOperatorPosition(r)));

  let activeSession = await one(
    `SELECT os.*, p.order_number, p.item, p.object,
            p.cutting_status, p.edging_status, p.drilling_status, p.assembly_status, p.packaging_status
     FROM operator_sessions os
     JOIN positions p ON p.id = os.position_id
     WHERE os.user_id = $1 AND os.finished_at IS NULL
     ORDER BY
       CASE WHEN os.stage_key = $2 THEN 0 ELSE 1 END,
       os.started_at DESC
     LIMIT 1`,
    [userId, stageKey]
  );

  if (activeSession && !isOperatorSessionActive(activeSession, activeSession.stage_key)) {
    await run(`UPDATE operator_sessions SET finished_at = now() WHERE id = $1`, [activeSession.id]);
    activeSession = null;
  } else if (activeSession) {
    activeSession.stage_status = stageStatusFromRow(activeSession, activeSession.stage_key);
    const timing = mapSessionEstimate(activeSession);
    activeSession.estimated_finish_at = timing?.estimatedFinishAt || null;
    activeSession.stage_estimate = timing?.estimate || null;
  }

  res.json({ queue, activeSession: activeSession || null });
});

router.get("/job/:positionId", async (req, res) => {
  const positionId = Number(req.params.positionId);
  const job = await getOperatorJobDetails(positionId);
  if (!job) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  res.json(job);
});

router.get("/estimate/:positionId/:stageKey", async (req, res) => {
  const positionId = Number(req.params.positionId);
  const stageKey = req.params.stageKey;
  if (!STAGE_STATUS_FIELD[stageKey]) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  const row = await getPosition(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }
  try {
    const estimate = await computeStageEstimateForPosition(
      positionId,
      stageKey,
      req.user?.id || null
    );
    res.json(estimate);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
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

  await reconcileOperatorSessionsForUser(userId);
  await reconcileStaleStageStatuses(stageKey);

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
    `INSERT INTO operator_sessions (user_id, position_id, stage_key, status, started_at, updated_at)
     VALUES ($1, $2, $3, 'active', now(), now())
     RETURNING id, started_at`,
    [userId, positionId, stageKey]
  );

  let stageEstimate = null;
  try {
    stageEstimate = await computeStageEstimateForPosition(positionId, stageKey, userId);
    await saveSessionStageEstimate(session.id, stageEstimate);
  } catch (err) {
    console.error("[operator start estimate]", err.message);
  }

  await savePosition(positionId, row, { actor: auditActor(req) });
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "В роботі" },
    auditActor(req)
  );

  res.json({
    sessionId: session.id,
    stageEstimate,
    estimatedFinishAt: stageEstimate?.estimatedFinishAt || null,
    position: await mapOperatorPosition(await getPosition(positionId))
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
  const handedOff = applyStageHandoff(row, stageKey, { status: "Готово" });

  await run(
    `UPDATE operator_sessions SET status = 'finished', finished_at = now(), updated_at = now() WHERE id = $1`,
    [session.id]
  );

  const finishedSession = await one(`SELECT * FROM operator_sessions WHERE id = $1`, [session.id]);
  await recordStageCompletionFact({
    session: finishedSession,
    positionId,
    stageKey,
    userId
  }).catch((err) => console.error("[stage completion fact]", err.message));

  await savePosition(positionId, handedOff, { actor: auditActor(req) });
  const afterRow = await getPosition(positionId);
  const autoHandoffs = detectAutoHandoffs(before, afterRow, stageKey);
  await logStageChangeWithAutoHandoffs(
    before,
    afterRow,
    stageKey,
    { status: "Готово" },
    auditActor(req),
    autoHandoffs
  );

  res.json({ position: await mapOperatorPosition(afterRow) });
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

  await run(
    `UPDATE operator_sessions SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`,
    [session.id]
  );

  await savePosition(positionId, row, { actor: auditActor(req) });
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "На паузі" },
    auditActor(req)
  );

  res.json({ position: await mapOperatorPosition(await getPosition(positionId)) });
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

  await run(
    `UPDATE operator_sessions SET status = 'active', paused_at = NULL, updated_at = now() WHERE id = $1`,
    [session.id]
  );

  await savePosition(positionId, row, { actor: auditActor(req) });
  await logStageChange(
    before,
    await getPosition(positionId),
    stageKey,
    { status: "В роботі" },
    auditActor(req)
  );

  res.json({ position: await mapOperatorPosition(await getPosition(positionId)) });
});

router.post("/report-problem", requireOperatorSelf, async (req, res) => {
  const { userId, positionId, stageKey, comment } = req.body || {};
  const text = String(comment || "").trim();
  if (!userId || !positionId) {
    res.status(400).json({ error: "userId та positionId обов'язкові" });
    return;
  }
  if (!text) {
    res.status(400).json({ error: "Опишіть проблему коментарем" });
    return;
  }

  const row = await getPosition(positionId);
  if (!row) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const before = { ...row };
  row.problem = text;
  row.position_status = "Проблема";

  const field = stageKey && STAGE_STATUS_FIELD[stageKey];
  if (field && ["Передано", "В роботі", "На паузі"].includes(row[field])) {
    row[field] = "Проблема";
  }

  const session = stageKey ? await getOpenSession(userId, positionId, stageKey) : null;
  if (session) {
    await run(
      `UPDATE operator_sessions SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`,
      [session.id]
    );
  }

  await savePosition(positionId, row, { actor: auditActor(req) });
  const afterRow = await getPosition(positionId);
  if (stageKey && field) {
    await logStageChange(
      before,
      afterRow,
      stageKey,
      { status: "Проблема", problem: text },
      auditActor(req)
    );
  }

  const { recordOperatorProblemLearning } = await import("../ai/ai-task-learning.js");
  await recordOperatorProblemLearning({
    positionRow: afterRow,
    stageKey,
    comment: text,
    userId: auditActor(req)?.id
  }).catch((err) => console.error("[ai operator learning]", err.message));

  res.json({ position: await mapOperatorPosition(afterRow) });
});

export default router;
