#!/usr/bin/env node
/**
 * Увімкнення автоматизації на production (merge з поточними app_settings.automation).
 *
 * Env (опційно):
 *   AUTOMATION_PRODUCTION_WEBHOOK_URL
 *   AUTOMATION_OVERDUE_WEBHOOK_URL
 *   AUTOMATION_PROCUREMENT_WEBHOOK_URL
 *   AUTOMATION_SHADOW_MODE=true — лише лог auto-tasks
 */
import pg from "pg";
import {
  DEFAULT_AUTOMATION_SETTINGS,
  normalizeAutomationSettings
} from "../src/automation/settings.js";

const connectionString = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL_MIGRATIONS або DATABASE_URL не задано");
  process.exit(1);
}

function envUrl(key) {
  const v = String(process.env[key] || "").trim();
  return v || "";
}

const patch = {
  autoCreateTasksFromAi: true,
  autoCreateTasksOnPackageApprove: true,
  autoCreateTasksRequireSafeQuality: true,
  autoCreateTasksMinConfidence: 0.85,
  autoCreateTasksShadowMode: process.env.AUTOMATION_SHADOW_MODE === "true",
  assignRulesEnabled: true,
  stalledStageCheckEnabled: true,
  stalledStageHours: 8,
  autoCompleteStageOnFullScan: true,
  autoSelectNextJob: true,
  autoStartStageOnOpen: true,
  blockAutoHandoffOnPartialB3d: true,
  productionWebhookEnabled: Boolean(envUrl("AUTOMATION_PRODUCTION_WEBHOOK_URL")),
  productionWebhookUrl: envUrl("AUTOMATION_PRODUCTION_WEBHOOK_URL"),
  overdueDigestEnabled: Boolean(envUrl("AUTOMATION_OVERDUE_WEBHOOK_URL")),
  overdueDigestWebhookUrl: envUrl("AUTOMATION_OVERDUE_WEBHOOK_URL"),
  overdueDigestHourKyiv: 9,
  procurementWebhookEnabled: Boolean(envUrl("AUTOMATION_PROCUREMENT_WEBHOOK_URL")),
  procurementWebhookUrl: envUrl("AUTOMATION_PROCUREMENT_WEBHOOK_URL")
};

const client = new pg.Client({ connectionString });

try {
  await client.connect();
  const row = await client.query(`SELECT value_json FROM app_settings WHERE key = 'automation'`);
  let current = DEFAULT_AUTOMATION_SETTINGS;
  if (row.rows[0]?.value_json) {
    try {
      current =
        typeof row.rows[0].value_json === "string"
          ? JSON.parse(row.rows[0].value_json)
          : row.rows[0].value_json;
    } catch {
      current = DEFAULT_AUTOMATION_SETTINGS;
    }
  }

  const next = normalizeAutomationSettings({ ...current, ...patch });
  await client.query(
    `INSERT INTO app_settings (key, value_json) VALUES ('automation', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    [JSON.stringify(next)]
  );

  console.log("✓ Налаштування автоматизації застосовано:");
  console.log("  autoCreateTasksFromAi:", next.autoCreateTasksFromAi);
  console.log("  autoCreateTasksShadowMode:", next.autoCreateTasksShadowMode);
  console.log("  assignRulesEnabled:", next.assignRulesEnabled);
  console.log(
    "  autoSelectNextJob / autoStartStageOnOpen:",
    next.autoSelectNextJob,
    next.autoStartStageOnOpen
  );
  console.log(
    "  productionWebhook:",
    next.productionWebhookEnabled ? "увімкнено" : "вимкнено (немає URL)"
  );
  console.log("  overdueDigest:", next.overdueDigestEnabled ? "увімкнено" : "вимкнено (немає URL)");
  console.log(
    "  procurementWebhook:",
    next.procurementWebhookEnabled ? "увімкнено" : "вимкнено (немає URL)"
  );
} catch (err) {
  console.error("✗", err.message || err);
  process.exitCode = 1;
} finally {
  await client.end();
}
