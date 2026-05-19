import { one, run } from "./db.js";
import { getLatestMatch } from "./machine-ai-matcher.js";
import { ingestLogFile } from "./machine-log-ingest.js";

function parseProgressPayload(data) {
  if (typeof data === "number" && Number.isFinite(data)) {
    return Math.max(0, Math.min(100, Math.round(data)));
  }
  if (!data || typeof data !== "object") return null;
  const raw = data.progress ?? data.percent ?? data.percentage ?? data.completion ?? data.value;
  if (raw === undefined || raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

async function getConfig(stageKey) {
  return one("SELECT * FROM machine_config WHERE stage_key = $1", [stageKey]);
}

async function simulatedProgress(stageKey) {
  const session = await one(
    `SELECT * FROM operator_sessions
     WHERE stage_key = $1 AND finished_at IS NULL
     ORDER BY started_at DESC LIMIT 1`,
    [stageKey]
  );

  if (!session) return 0;

  const started = new Date(session.started_at).getTime();
  const elapsed = Date.now() - started;
  const minutes = elapsed / 60000;
  const simulated = Math.min(95, Math.round(minutes * 12));
  return Math.max(5, simulated);
}

async function progressFromLogs(stageKey) {
  const config = await getConfig(stageKey);
  if (!config?.log_path?.trim()) return null;

  await ingestLogFile(stageKey).catch(() => {});

  const refreshed = await getConfig(stageKey);
  const match = await getLatestMatch(stageKey);

  return {
    stageKey,
    progress: refreshed?.last_progress ?? 0,
    source: "logs",
    message: match
      ? `Задача: ${match.orderNumber} — ${match.item} (${Math.round(match.confidence * 100)}%, ${match.method})`
      : "Лог читається — очікується зіставлення з задачею",
    match
  };
}

async function progressFromApi(stageKey, config) {
  const headers = { Accept: "application/json" };
  if (config.api_token?.trim()) {
    headers.Authorization = `Bearer ${config.api_token.trim()}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const response = await fetch(config.api_url.trim(), {
    headers,
    signal: controller.signal
  });
  clearTimeout(timeout);

  if (!response.ok) {
    throw new Error(`Станок відповів кодом ${response.status}`);
  }

  const data = await response.json();
  const progress = parseProgressPayload(data);
  if (progress === null) {
    throw new Error("Невідомий формат відповіді станка");
  }

  await run(
    `UPDATE machine_config SET last_progress = $1, updated_at = now() WHERE stage_key = $2`,
    [progress, stageKey]
  );

  return {
    stageKey,
    progress,
    source: "api",
    message: null,
    match: await getLatestMatch(stageKey)
  };
}

export async function fetchMachineProgress(stageKey) {
  const config = await getConfig(stageKey);
  const fallback = await simulatedProgress(stageKey);

  const fromLogs = await progressFromLogs(stageKey);
  if (fromLogs) return fromLogs;

  if (config?.api_url?.trim()) {
    try {
      return await progressFromApi(stageKey, config);
    } catch (err) {
      return {
        stageKey,
        progress: config.last_progress ?? fallback,
        source: "cached",
        message: err.message || "Помилка з'єднання з API станка",
        match: await getLatestMatch(stageKey)
      };
    }
  }

  return {
    stageKey,
    progress: fallback,
    source: "simulated",
    message: "Налаштуйте шлях до логу станка або URL API",
    match: await getLatestMatch(stageKey)
  };
}
