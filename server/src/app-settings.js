import { one, run } from "./db.js";

export async function getSetting(key, fallback = null) {
  const row = await one("SELECT value_json FROM app_settings WHERE key = $1", [key]);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value_json);
  } catch {
    return fallback;
  }
}

export async function setSetting(key, value) {
  await run(
    `INSERT INTO app_settings (key, value_json) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    [key, JSON.stringify(value)]
  );
}

export async function getAiSettings() {
  const raw = (await getSetting("ai", {})) || {};
  const dbKey = String(raw.openaiApiKey || "").trim();
  const envKey = String(process.env.OPENAI_API_KEY || "").trim();
  return {
    openaiApiKey: dbKey || envKey,
    dbApiKey: dbKey,
    envApiKey: envKey,
    openaiModel: raw.openaiModel || process.env.OPENAI_MODEL || "gpt-4o-mini",
    enabled: raw.enabled !== false
  };
}

export function maskSecret(value) {
  const str = String(value || "").trim();
  if (!str) return "";
  if (str.length <= 8) return "••••••••";
  return `${str.slice(0, 7)}...${str.slice(-4)}`;
}
