import { Router } from "express";
import { getAiSettings, maskSecret, setSetting } from "../app-settings.js";
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

export default router;
