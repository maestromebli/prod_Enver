import { getSetting, setSetting } from "../app-settings.js";

/** Налаштування автоматизації ENVER (app_settings.automation). */

export const AUTOMATION_SETTING_KEY = "automation";

export const DEFAULT_AUTOMATION_SETTINGS = {
  autoCreateTasksFromAi: true,
  autoCreateTasksOnPackageApprove: true,
  autoCreateTasksMinConfidence: 0.85,
  autoCreateTasksRequireSafeQuality: true,
  autoCreateTasksShadowMode: false,
  assignRulesEnabled: false,
  assignRules: {
    assembly: { directory: "Збирачі", strategy: "round_robin" }
  },
  assignRulesState: {},
  productionWebhookEnabled: false,
  productionWebhookUrl: "",
  overdueDigestEnabled: false,
  overdueDigestHourKyiv: 9,
  overdueDigestWebhookUrl: "",
  overdueDigestSendWhenEmpty: false,
  procurementWebhookEnabled: false,
  procurementWebhookUrl: "",
  stalledStageCheckEnabled: true,
  stalledStageHours: 8,
  autoCompleteStageOnFullScan: true,
  blockAutoHandoffOnPartialB3d: true,
  autoSelectNextJob: true,
  autoStartStageOnOpen: true,
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

function clampHours(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(72, Math.max(1, Math.round(n)));
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

function normalizeAssignRules(raw) {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_AUTOMATION_SETTINGS.assignRules };
  const assembly = raw.assembly || raw.default || DEFAULT_AUTOMATION_SETTINGS.assignRules.assembly;
  return {
    assembly: {
      directory: String(assembly.directory || "Збирачі").trim() || "Збирачі",
      strategy: assembly.strategy === "fixed" ? "fixed" : "round_robin",
      name: assembly.name ? String(assembly.name).trim() : ""
    }
  };
}

export function normalizeAutomationSettings(raw = {}) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    autoCreateTasksFromAi: src.autoCreateTasksFromAi !== false,
    autoCreateTasksOnPackageApprove: src.autoCreateTasksOnPackageApprove !== false,
    autoCreateTasksMinConfidence: clampConfidence(
      src.autoCreateTasksMinConfidence,
      DEFAULT_AUTOMATION_SETTINGS.autoCreateTasksMinConfidence
    ),
    autoCreateTasksRequireSafeQuality: src.autoCreateTasksRequireSafeQuality !== false,
    autoCreateTasksShadowMode: src.autoCreateTasksShadowMode === true,
    assignRulesEnabled: src.assignRulesEnabled === true,
    assignRules: normalizeAssignRules(src.assignRules),
    assignRulesState:
      src.assignRulesState && typeof src.assignRulesState === "object" ? src.assignRulesState : {},
    productionWebhookEnabled: src.productionWebhookEnabled === true,
    productionWebhookUrl: normalizeUrl(src.productionWebhookUrl),
    overdueDigestEnabled: src.overdueDigestEnabled === true,
    overdueDigestHourKyiv: clampHour(
      src.overdueDigestHourKyiv,
      DEFAULT_AUTOMATION_SETTINGS.overdueDigestHourKyiv
    ),
    overdueDigestWebhookUrl: normalizeUrl(src.overdueDigestWebhookUrl),
    overdueDigestSendWhenEmpty: src.overdueDigestSendWhenEmpty === true,
    procurementWebhookEnabled: src.procurementWebhookEnabled === true,
    procurementWebhookUrl: normalizeUrl(src.procurementWebhookUrl),
    stalledStageCheckEnabled: src.stalledStageCheckEnabled !== false,
    stalledStageHours: clampHours(
      src.stalledStageHours,
      DEFAULT_AUTOMATION_SETTINGS.stalledStageHours
    ),
    autoCompleteStageOnFullScan: src.autoCompleteStageOnFullScan !== false,
    blockAutoHandoffOnPartialB3d: src.blockAutoHandoffOnPartialB3d !== false,
    autoSelectNextJob: src.autoSelectNextJob !== false,
    autoStartStageOnOpen: src.autoStartStageOnOpen !== false,
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
    hasProcurementWebhook: Boolean(s.procurementWebhookUrl),
    hasProductionWebhook: Boolean(s.productionWebhookUrl)
  };
}

/** Підказки автоматизації для панелі оператора (без секретів). */
export function operatorAutomationHints(settings) {
  const s = normalizeAutomationSettings(settings);
  return {
    autoSelectNextJob: s.autoSelectNextJob,
    autoStartStageOnOpen: s.autoStartStageOnOpen,
    autoCompleteStageOnFullScan: s.autoCompleteStageOnFullScan
  };
}
