import { Router } from "express";
import { getAiSettings, maskSecret, setSetting } from "../app-settings.js";
import { requireAdmin, requireAuth } from "../middleware/auth.js";

const router = Router();
router.use(requireAuth, requireAdmin);

router.get("/ai", (_req, res) => {
  const ai = getAiSettings();
  res.json({
    enabled: ai.enabled,
    openaiModel: ai.openaiModel,
    hasApiKey: Boolean(ai.openaiApiKey),
    openaiApiKeyMasked: maskSecret(ai.openaiApiKey)
  });
});

router.put("/ai", (req, res) => {
  const current = getAiSettings();
  const { enabled, openaiModel, openaiApiKey, clearApiKey } = req.body || {};

  let key = current.openaiApiKey;
  if (clearApiKey) {
    key = "";
  } else if (typeof openaiApiKey === "string" && openaiApiKey.trim()) {
    const trimmed = openaiApiKey.trim();
    const masked = maskSecret(current.openaiApiKey);
    if (trimmed !== masked && !trimmed.includes("…")) {
      key = trimmed;
    }
  }

  setSetting("ai", {
    enabled: enabled !== undefined ? Boolean(enabled) : current.enabled !== false,
    openaiModel: openaiModel?.trim() || current.openaiModel,
    openaiApiKey: key
  });

  const updated = getAiSettings();
  res.json({
    enabled: updated.enabled,
    openaiModel: updated.openaiModel,
    hasApiKey: Boolean(updated.openaiApiKey),
    openaiApiKeyMasked: maskSecret(updated.openaiApiKey)
  });
});

router.post("/ai/test", async (req, res, next) => {
  try {
    const ai = getAiSettings();
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
    res.json({ ok: true, message: "Ключ дійсний, з’єднання з OpenAI успішне" });
  } catch (err) {
    next(err);
  }
});

export default router;
