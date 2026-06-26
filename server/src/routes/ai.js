import { Router } from "express";
import { one } from "../db.js";
import { PACKAGE_ID_SUBQUERY } from "../constructive-package-enrich.js";
import {
  requireAdmin,
  requireAuth,
  requirePermissionOrAdmin,
  requirePositionAccess,
  requirePositionWrite,
  auditActor
} from "../middleware/auth.js";
import {
  analyzeConstructiveFile,
  listAnalysesForPosition,
  listRecentAnalyses,
  saveAiFeedback
} from "../constructive-ai.js";
import { analyzeConstructivePackage } from "../constructive/constructive-package-ai.js";
import { chatWithAssistant, fetchAssistantHints, getAiAvailability } from "../ai-assistant.js";
import {
  createAiRule,
  deleteAiRule,
  listAllRules,
  listLearningEvents,
  saveLearningEvent,
  updateAiRule,
  containsSecret
} from "../ai/ai-memory.js";
import { getLearningSummaryForAdmin } from "../ai/ai-learning.js";

const router = Router();
router.use(requireAuth);

router.post("/analyze-constructive/:positionId", requirePositionWrite, async (req, res) => {
  const positionId = Number(req.params.positionId);
  const position = await one(
    `SELECT p.*, ${PACKAGE_ID_SUBQUERY} FROM positions p WHERE p.id = $1`,
    [positionId]
  );
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
  if (file) {
    const result = await analyzeConstructiveFile({
      positionFileId: file.id,
      orderNumber: position.order_number,
      item: position.item,
      itemType: position.item_type,
      material: position.material,
      storagePath: file.storage_path,
      mime: file.mime,
      originalName: file.original_name
    });
    res.json(result);
    return;
  }

  const packageId = Number(position.constructive_package_id);
  if (packageId) {
    const result = await analyzeConstructivePackage(packageId, {
      orderNumber: position.order_number,
      item: position.item
    });
    res.json(result);
    return;
  }

  res.status(400).json({ error: "Спочатку завантажте файл конструктива" });
});

router.get("/analyses/:positionId", requirePositionAccess, async (req, res) => {
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

router.post("/assist", requirePermissionOrAdmin("canEditPositions"), async (req, res) => {
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

router.post("/feedback", requirePermissionOrAdmin("canEditPositions"), async (req, res) => {
  const {
    analysisId,
    rating,
    correctionText,
    correctedTasks,
    correctedMaterials,
    correctedWarnings,
    rememberCorrection,
    positionId
  } = req.body || {};

  if (!analysisId) {
    res.status(400).json({ error: "analysisId обов'язковий" });
    return;
  }

  if (containsSecret(correctionText)) {
    res.status(400).json({ error: "Корекція не може містити секрети або ключі" });
    return;
  }

  const analysisRow = await one(
    `SELECT ca.summary_json, ca.id, p.order_number, p.item, p.item_type, p.material
       FROM constructive_analyses ca
       JOIN position_files pf ON pf.id = ca.position_file_id
       JOIN positions p ON p.id = pf.position_id
       WHERE ca.id = $1`,
    [analysisId]
  );

  const learningMeta = analysisRow
    ? {
        orderNumber: analysisRow.order_number,
        itemName: analysisRow.item,
        itemType: analysisRow.item_type,
        material: analysisRow.material,
        aiOutput: JSON.parse(analysisRow.summary_json || "{}"),
        saveEvent: rememberCorrection !== false
      }
    : { saveEvent: rememberCorrection !== false };

  if (positionId) {
    learningMeta.entityType = "position";
    learningMeta.entityId = Number(positionId);
  }

  await saveAiFeedback({
    analysisId,
    rating,
    correctionText,
    correctedTasks,
    correctedMaterials,
    correctedWarnings,
    userId: auditActor(req)?.id,
    learningMeta
  });
  res.json({ ok: true });
});

router.get("/learning/events", requireAdmin, async (req, res) => {
  const limit = Number(req.query.limit) || 50;
  const events = await listLearningEvents({ limit });
  res.json(events);
});

router.post("/learning/events", requirePermissionOrAdmin("canEditPositions"), async (req, res) => {
  const body = req.body || {};
  if (containsSecret(body.correctionText) || containsSecret(JSON.stringify(body))) {
    res.status(400).json({ error: "Подія не може містити секрети" });
    return;
  }
  const event = await saveLearningEvent(body, auditActor(req)?.id);
  res.json(event);
});

router.get("/learning/summary", requireAdmin, async (_req, res) => {
  const summary = await getLearningSummaryForAdmin();
  res.json(summary);
});

router.get("/rules", requireAdmin, async (_req, res) => {
  const rules = await listAllRules();
  res.json(rules);
});

router.post("/rules", requireAdmin, async (req, res) => {
  const { title, ruleText, appliesTo, tags } = req.body || {};
  if (!ruleText?.trim()) {
    res.status(400).json({ error: "ruleText обов'язковий" });
    return;
  }
  const rule = await createAiRule({
    title,
    ruleText,
    appliesTo,
    tags,
    userId: auditActor(req)?.id
  });
  res.json(rule);
});

router.put("/rules/:id", requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const rule = await updateAiRule(id, {
    title: req.body?.title,
    ruleText: req.body?.ruleText,
    appliesTo: req.body?.appliesTo,
    tags: req.body?.tags,
    enabled: req.body?.enabled
  });
  if (!rule) {
    res.status(404).json({ error: "Правило не знайдено" });
    return;
  }
  res.json(rule);
});

router.delete("/rules/:id", requireAdmin, async (req, res) => {
  await deleteAiRule(Number(req.params.id));
  res.json({ ok: true });
});

export default router;
