import { Router } from "express";
import { requireAdmin, requireAuth } from "../middleware/auth.js";
import { OPERATOR_STAGES } from "../roles.js";
import { getRecentLogEvents, ingestLogFile, ingestLogText } from "../machine-log-ingest.js";
import { getLatestMatch } from "../machine-ai-matcher.js";
import { getParserProfiles } from "../machine-log-parser.js";
import { db } from "../db.js";

const router = Router();
const validStages = new Set(OPERATOR_STAGES.map((s) => s.key));

router.use(requireAuth);

router.get("/profiles", (_req, res) => {
  res.json(getParserProfiles());
});

router.get("/events/:stageKey", (req, res) => {
  if (!validStages.has(req.params.stageKey)) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  const limit = Math.min(100, Number(req.query.limit) || 30);
  res.json({
    events: getRecentLogEvents(req.params.stageKey, limit),
    match: getLatestMatch(req.params.stageKey)
  });
});

router.get("/match/:stageKey", (req, res) => {
  if (!validStages.has(req.params.stageKey)) {
    res.status(400).json({ error: "Невідомий етап" });
    return;
  }
  res.json({ match: getLatestMatch(req.params.stageKey) });
});

router.post("/ingest/:stageKey", requireAdmin, async (req, res, next) => {
  try {
    if (!validStages.has(req.params.stageKey)) {
      res.status(400).json({ error: "Невідомий етап" });
      return;
    }
    const result = await ingestLogFile(req.params.stageKey, {
      fullScan: Boolean(req.body?.fullScan)
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post("/upload/:stageKey", requireAdmin, async (req, res, next) => {
  try {
    if (!validStages.has(req.params.stageKey)) {
      res.status(400).json({ error: "Невідомий етап" });
      return;
    }
    const text = req.body?.text ?? "";
    if (!String(text).trim()) {
      res.status(400).json({ error: "Передайте поле text з вмістом логу" });
      return;
    }
    if (text.length > 5_000_000) {
      res.status(413).json({ error: "Лог занадто великий (макс. 5 МБ)" });
      return;
    }
    const result = await ingestLogText(req.params.stageKey, text);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.put("/match/:matchId/confirm", requireAdmin, (req, res) => {
  const id = Number(req.params.matchId);
  const existing = db.prepare("SELECT * FROM machine_task_matches WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Зіставлення не знайдено" });
    return;
  }
  db.prepare(
    `UPDATE machine_task_matches SET status = 'confirmed', confirmed_at = datetime('now'), confirmed_by = ?
     WHERE id = ?`
  ).run(req.user.id, id);
  res.json({ ok: true });
});

export default router;
