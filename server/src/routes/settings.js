import { Router } from "express";
import { getAiSettings, maskSecret, setSetting } from "../app-settings.js";
import {
  automationSettingsForClient,
  getAutomationSettings,
  normalizeAutomationSettings,
  saveAutomationSettings
} from "../automation/settings.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireAdmin);

function aiSettingsResponse(updated, { keyUpdated = false } = {}) {
  return {
    ok: true,
    enabled: updated.enabled,
    openaiModel: updated.openaiModel,
    hasApiKey: Boolean(updated.dbApiKey),
    hasEnvKey: Boolean(updated.envApiKey),
    useLearningMemory: updated.useLearningMemory !== false,
    keyUpdated,
    openaiApiKeyMasked: maskSecret(updated.dbApiKey || updated.envApiKey),
    message: keyUpdated ? "API ключ збережено в базі" : "Налаштування збережено"
  };
}

router.get("/ai", async (_req, res) => {
  try {
    const ai = await getAiSettings();
    res.json({
      enabled: ai.enabled,
      openaiModel: ai.openaiModel,
      hasApiKey: Boolean(ai.dbApiKey),
      hasEnvKey: Boolean(ai.envApiKey),
      useLearningMemory: ai.useLearningMemory !== false,
      openaiApiKeyMasked: maskSecret(ai.dbApiKey || ai.envApiKey)
    });
  } catch (err) {
    console.error("GET /api/settings/ai:", err);
    res.status(500).json({ error: "Не вдалося прочитати налаштування ШІ з бази" });
  }
});

router.put("/ai", async (req, res) => {
  try {
    const current = await getAiSettings();
    const { enabled, openaiModel, openaiApiKey, clearApiKey } = req.body || {};

    let dbKey = current.dbApiKey;
    let keyUpdated = false;

    if (clearApiKey) {
      dbKey = "";
      keyUpdated = true;
    } else if (openaiApiKey !== undefined && openaiApiKey !== null) {
      const trimmed = String(openaiApiKey).trim();
      if (trimmed) {
        if (trimmed.includes("…") || trimmed.includes("...")) {
          res.status(400).json({ error: "Вкажіть повний API ключ, а не маску (sk-…)" });
          return;
        }
        if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(trimmed)) {
          res.status(400).json({
            error:
              "Некоректний формат ключа OpenAI (очікується sk-…, мінімум 20 символів після префікса)"
          });
          return;
        }
        dbKey = trimmed;
        keyUpdated = true;
      } else if (!current.dbApiKey && !current.envApiKey) {
        res.status(400).json({ error: "Вкажіть API ключ OpenAI (sk-…)" });
        return;
      }
    }

    await setSetting("ai", {
      enabled: enabled !== undefined ? Boolean(enabled) : current.enabled !== false,
      openaiModel: openaiModel?.trim() || current.openaiModel,
      openaiApiKey: dbKey,
      useLearningMemory:
        req.body?.useLearningMemory !== undefined
          ? Boolean(req.body.useLearningMemory)
          : current.useLearningMemory !== false
    });

    const updated = await getAiSettings();
    res.json(aiSettingsResponse(updated, { keyUpdated }));
  } catch (err) {
    console.error("PUT /api/settings/ai:", err);
    res.status(500).json({ error: "Не вдалося зберегти налаштування ШІ" });
  }
});

router.post("/ai/test", async (_req, res) => {
  const ai = await getAiSettings();
  if (!ai.openaiApiKey?.trim()) {
    res.status(400).json({ error: "Спочатку збережіть API ключ OpenAI" });
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const response = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${ai.openaiApiKey.trim()}` },
    signal: controller.signal
  });
  clearTimeout(timeout);
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    res.status(400).json({
      error: err.error?.message || `OpenAI відповів кодом ${response.status}`
    });
    return;
  }
  res.json({ ok: true, message: "Ключ дійсний, з'єднання з OpenAI успішне" });
});

router.get("/automation", async (_req, res) => {
  try {
    const settings = await getAutomationSettings();
    res.json(automationSettingsForClient(settings));
  } catch (err) {
    console.error("GET /api/settings/automation:", err);
    res.status(500).json({ error: "Не вдалося прочитати налаштування автоматизації" });
  }
});

router.put("/automation", async (req, res) => {
  try {
    const body = req.body || {};
    const saved = await saveAutomationSettings({
      autoCreateTasksFromAi: body.autoCreateTasksFromAi,
      autoCreateTasksOnPackageApprove: body.autoCreateTasksOnPackageApprove,
      autoCreateTasksMinConfidence: body.autoCreateTasksMinConfidence,
      autoCreateTasksRequireSafeQuality: body.autoCreateTasksRequireSafeQuality,
      autoCreateTasksShadowMode: body.autoCreateTasksShadowMode,
      assignRulesEnabled: body.assignRulesEnabled,
      assignRules: body.assignRules,
      productionWebhookEnabled: body.productionWebhookEnabled,
      productionWebhookUrl: body.productionWebhookUrl,
      overdueDigestEnabled: body.overdueDigestEnabled,
      overdueDigestHourKyiv: body.overdueDigestHourKyiv,
      overdueDigestWebhookUrl: body.overdueDigestWebhookUrl,
      overdueDigestSendWhenEmpty: body.overdueDigestSendWhenEmpty,
      procurementWebhookEnabled: body.procurementWebhookEnabled,
      procurementWebhookUrl: body.procurementWebhookUrl,
      stalledStageCheckEnabled: body.stalledStageCheckEnabled,
      stalledStageHours: body.stalledStageHours,
      autoCompleteStageOnFullScan: body.autoCompleteStageOnFullScan,
      blockAutoHandoffOnPartialB3d: body.blockAutoHandoffOnPartialB3d,
      autoSelectNextJob: body.autoSelectNextJob,
      autoStartStageOnOpen: body.autoStartStageOnOpen
    });
    res.json({
      ok: true,
      ...automationSettingsForClient(saved),
      message: "Налаштування автоматизації збережено"
    });
  } catch (err) {
    console.error("PUT /api/settings/automation:", err);
    res.status(500).json({ error: "Не вдалося зберегти налаштування автоматизації" });
  }
});

router.get("/automation/metrics", async (req, res) => {
  try {
    const { getAutomationMetrics } = await import("../automation/event-log.js");
    const { listFailedWebhooks } = await import("../automation/outbox.js");
    const days = Number(req.query.days) || 7;
    const metrics = await getAutomationMetrics({ days });
    const failed = await listFailedWebhooks(10);
    res.json({ ...metrics, recentFailedWebhooks: failed });
  } catch (err) {
    console.error("GET /api/settings/automation/metrics:", err);
    res.status(500).json({ error: "Не вдалося завантажити метрики автоматизації" });
  }
});

router.post("/automation/retry-webhook/:id", async (req, res) => {
  try {
    const { retryFailedWebhook } = await import("../automation/outbox.js");
    const result = await retryFailedWebhook(Number(req.params.id));
    if (!result.ok) {
      res.status(400).json({ error: result.error || "Повтор не вдався" });
      return;
    }
    res.json({ ok: true, message: "Webhook надіслано повторно" });
  } catch (err) {
    console.error("POST retry-webhook:", err);
    res.status(500).json({ error: "Помилка повтору webhook" });
  }
});

router.post("/automation/test-overdue", async (_req, res) => {
  try {
    const settings = normalizeAutomationSettings(await getAutomationSettings());
    if (!settings.overdueDigestWebhookUrl) {
      res.status(400).json({ error: "Вкажіть URL webhook для дайджесту прострочок" });
      return;
    }
    const { runOverdueDigest } = await import("../automation/overdue-digest.js");
    const result = await runOverdueDigest({ force: true });
    if (!result.ok && !result.skipped) {
      res.status(400).json({ error: result.error || "Webhook не відповів" });
      return;
    }
    res.json({
      ok: true,
      message: result.skipped
        ? `Перевірку виконано (${result.reason || "skipped"})`
        : `Дайджест надіслано: ${result.count} позицій`,
      ...result
    });
  } catch (err) {
    console.error("POST /api/settings/automation/test-overdue:", err);
    res.status(500).json({ error: "Не вдалося надіслати тестовий дайджест" });
  }
});

export default router;
