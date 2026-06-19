import { all } from "./db.js";
import { ingestLogFile } from "./machine-log-ingest.js";

const POLL_MS = 3000;
let timer = null;

export function startMachineLogWatchers() {
  if (timer) return;
  timer = setInterval(tickAll, POLL_MS);
  timer.unref?.();
  tickAll().catch(() => {});
}

export function stopMachineLogWatchers() {
  if (timer) clearInterval(timer);
  timer = null;
}

async function tickAll() {
  const rows = await all(
    `SELECT stage_key FROM machine_config
     WHERE watch_enabled = TRUE AND log_path <> '' AND log_path NOT LIKE 'browser://%'`
  );

  for (const row of rows) {
    try {
      await ingestLogFile(row.stage_key);
    } catch (err) {
      console.error(`[machine-log] ${row.stage_key}:`, err.message);
    }
  }
}
