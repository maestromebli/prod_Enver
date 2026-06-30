import { getSetting, setSetting } from "../app-settings.js";

/** Налаштування автоматизації ENVER (app_settings.automation). */

export const AUTOMATION_SETTING_KEY = "automation";

export const DEFAULT_AUTOMATION_SETTINGS = {
  autoCreateTasksFromAi: false,
  autoCreateTasksMinConfidence: 0.8,
  autoCreateTasksRequireSafeQuality: true,
  overdueDigestEnabled: false,
  overdueDigestHourKyiv: 9,
  overdueDigestWebhookUrl: "",
  overdueDigestSendWhenEmpty: false,
  procurementWebhookEnabled: false,
  procurementWebhookUrl: "",
  lastOverdueDigestDate: ""
};

function clampHour(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(23, Math.max(0, Math.round(n)));
}

function clampConfidence(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0.5, Math.round(n * 100) / 100));
}

function normalizeUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function normalizeAutomationSettings(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    autoCreateTasksFromAi: src.autoCreateTasksFromAi === true,
    autoCreateTasksMinConfidence: clampConfidence(
      src.autoCreateTasksMinConfidence,
      DEFAULT_AUTOMATION_SETTINGS.autoCreateTasksMinConfidence
    ),
    autoCreateTasksRequireSafeQuality: src.autoCreateTasksRequireSafeQuality !== false,
    overdueDigestEnabled: src.overdueDigestEnabled === true,
    overdueDigestHourKyiv: clampHour(
      src.overdueDigestHourKyiv,
      DEFAULT_AUTOMATION_SETTINGS.overdueDigestHourKyiv
    ),
    overdueDigestWebhookUrl: normalizeUrl(src.overdueDigestWebhookUrl),
    overdueDigestSendWhenEmpty: src.overdueDigestSendWhenEmpty === true,
    procurementWebhookEnabled: src.procurementWebhookEnabled === true,
    procurementWebhookUrl: normalizeUrl(src.procurementWebhookUrl),
    lastOverdueDigestDate: String(src.lastOverdueDigestDate || "").slice(0, 10)
  };
}

export async function getAutomationSettings() {
  const raw = await getSetting(AUTOMATION_SETTING_KEY, DEFAULT_AUTOMATION_SETTINGS);
  return normalizeAutomationSettings(raw);
}

export async function saveAutomationSettings(patch = {}) {
  const current = await getAutomationSettings();
  const next = normalizeAutomationSettings({ ...current, ...patch });
  await setSetting(AUTOMATION_SETTING_KEY, next);
  return next;
}

export function automationSettingsForClient(settings) {
  const s = normalizeAutomationSettings(settings);
  return {
    ...s,
    hasOverdueWebhook: Boolean(s.overdueDigestWebhookUrl),
    hasProcurementWebhook: Boolean(s.procurementWebhookUrl)
  };
}
