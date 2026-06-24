import { Router } from "express";
import { one } from "../db.js";
import { requireAdmin, requireAuth, requirePositionWrite } from "../middleware/auth.js";
import {
  analyzeConstructiveFile,
  listAnalysesForPosition,
  listRecentAnalyses,
  saveAiFeedback
} from "../constructive-ai.js";
import { chatWithAssistant, fetchAssistantHints, getAiAvailability } from "../ai-assistant.js";
import { auditActor } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth);

router.post("/analyze-constructive/:positionId", requirePositionWrite, async (req, res) => {
  const positionId = Number(req.params.positionId);
  const position = await one("SELECT * FROM positions WHERE id = $1", [positionId]);
  if (!position) {
    res.status(404).json({ error: "Позицію не знайдено" });
    return;
  }

  const file = await one(
    `SELECT * FROM position_files
     WHERE position_id = $1 AND kind = 'constructive'
     ORDER BY created_at DESC LIMIT 1`,
    [positionId]
  );
  if (!file) {
    res.status(400).json({ error: "Спочатку завантажте файл конструктива" });
    return;
  }

  const result = await analyzeConstructiveFile({
    positionFileId: file.id,
    orderNumber: position.order_number,
    item: position.item,
    storagePath: file.storage_path,
    mime: file.mime,
    originalName: file.original_name
  });
  res.json(result);
});

router.get("/analyses/:positionId", async (req, res) => {
  const positionId = Number(req.params.positionId);
  const analyses = await listAnalysesForPosition(positionId);
  res.json(analyses);
});

router.get("/recent", requireAdmin, async (_req, res) => {
  const analyses = await listRecentAnalyses(25);
  res.json(analyses);
});

router.get("/status", async (_req, res) => {
  const status = await getAiAvailability();
  res.json({ ...status, available: status.enabled && status.hasApiKey });
});

router.post("/assist", async (req, res) => {
  const { mode = "hints", message, context, history } = req.body || {};

  if (mode === "chat") {
    const text = String(message || "").trim();
    if (!text) {
      res.status(400).json({ error: "message обов'язковий для режиму chat" });
      return;
    }
    const result = await chatWithAssistant({
      message: text,
      context: context || {},
      history: Array.isArray(history) ? history : []
    });
    res.json(result);
    return;
  }

  const result = await fetchAssistantHints(context || {});
  res.json(result);
});

router.post("/feedback", requireAdmin, async (req, res) => {
  const { analysisId, rating, correctionText } = req.body || {};
  if (!analysisId) {
    res.status(400).json({ error: "analysisId обов'язковий" });
    return;
  }
  await saveAiFeedback({
    analysisId,
    rating,
    correctionText,
    userId: auditActor(req)?.id
  });
  res.json({ ok: true });
});

export default router;
