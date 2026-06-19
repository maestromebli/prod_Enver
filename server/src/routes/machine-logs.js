import { Router } from "express";
import { requireAdmin, requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import { OPERATOR_STAGE_KEY_SET } from "../roles.js";
import { getRecentLogEvents, ingestLogFile, ingestLogPayload } from "../machine-log-ingest.js";
import { getLatestMatch } from "../machine-ai-matcher.js";
import { getParserProfiles } from "../machine-log-parser.js";
import { one, run } from "../db.js";

const router = Router();

router.use(requireAuth);

const requireMachineLogsView = requirePermissionOrAdmin("canViewMachineLogs");

router.get("/profiles", requireMachineLogsView, (_req, res) => {
  res.json(getParserProfiles());
});

router.get("/events/:stageKey", requireMachineLogsView, async (req, res) => {
  if (!OPERATOR_STAGE_KEY_SET.has(req.params.stageKey)) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  const limit = Math.min(100, Number(req.query.limit) || 30);
  res.json({
    events: await getRecentLogEvents(req.params.stageKey, limit),
    match: await getLatestMatch(req.params.stageKey)
  });
});

router.get("/match/:stageKey", requireMachineLogsView, async (req, res) => {
  if (!OPERATOR_STAGE_KEY_SET.has(req.params.stageKey)) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  res.json({ match: await getLatestMatch(req.params.stageKey) });
});

router.post("/ingest/:stageKey", requireAdmin, async (req, res) => {
  if (!OPERATOR_STAGE_KEY_SET.has(req.params.stageKey)) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  const result = await ingestLogFile(req.params.stageKey, {
    fullScan: Boolean(req.body?.fullScan)
  });
  res.json(result);
});

router.post("/upload/:stageKey", requireAdmin, async (req, res) => {
  if (!OPERATOR_STAGE_KEY_SET.has(req.params.stageKey)) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  const outcome = await ingestLogPayload(req.params.stageKey, req.body || {});
  if (outcome.error) {
    res.status(outcome.status || 400).json({ error: outcome.error });
    return;
  }
  res.json(outcome.result);
});

router.put("/match/:matchId/confirm", requireAdmin, async (req, res) => {
  const id = Number(req.params.matchId);
  const existing = await one("SELECT * FROM machine_task_matches WHERE id = $1", [id]);
  if (!existing) {
    res.status(404).json({ error: "Зіставлення не знайдено" });
    return;
  }
  await run(
    `UPDATE machine_task_matches SET status = 'confirmed', confirmed_at = now(), confirmed_by = $1
     WHERE id = $2`,
    [req.user.id, id]
  );
  res.json({ ok: true });
});

export default router;
