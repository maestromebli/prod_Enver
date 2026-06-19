import fs from "fs";
import path from "path";
import { all, one, run } from "./db.js";
import { parseLogLine } from "./machine-log-parser.js";
import {
  determineKdtStatus,
  detectKdtEvent,
  extractJobFromXmlPath,
  extractKdtCounters,
  extractKdtPlcRegisters,
  extractKdtStep,
  extractKdtXmlPath,
  kdtEventToEnverParsed,
  parseKdtAllLogs,
  parseKdtTimestamp
} from "./kdt-log-parser.js";
import { matchLogToTask } from "./machine-ai-matcher.js";

export function mapMachineConfig(row) {
  if (!row) return null;
  return {
    stageKey: row.stage_key,
    apiUrl: row.api_url || "",
    logPath: row.log_path || "",
    logEncoding: row.log_encoding || "utf-8",
    parserProfile: row.parser_profile || "generic",
    watchEnabled: Boolean(row.watch_enabled),
    lastLogOffset: row.last_log_offset ?? 0,
    lastLogEventTime: row.last_log_event_time || "",
    aiMatchingEnabled: row.ai_matching_enabled !== false,
    lastProgress: row.last_progress ?? 0,
    lastMatchPositionId: row.last_match_position_id,
    lastMatchConfidence: row.last_match_confidence ?? 0,
    lastMatchSummary: row.last_match_summary || "",
    updatedAt: row.updated_at
  };
}

async function getConfig(stageKey) {
  return one("SELECT * FROM machine_config WHERE stage_key = $1", [stageKey]);
}

async function insertEvent(stageKey, line, parsed, offset) {
  const result = await run(
    `INSERT INTO machine_log_events (
      stage_key, raw_line, parsed_json, event_type, progress, job_ref, program_name, logged_at, file_offset
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    RETURNING id`,
    [
      stageKey,
      line,
      JSON.stringify(parsed),
      parsed.eventType,
      parsed.progress,
      parsed.jobRef || "",
      parsed.programName || "",
      parsed.loggedAt,
      offset
    ]
  );

  return { id: result.rows[0].id, parsed };
}

async function applyProgress(stageKey, progress, statusText) {
  if (progress === null || progress === undefined) return;
  await run(
    `UPDATE machine_config SET last_progress = $1, updated_at = now() WHERE stage_key = $2`,
    [progress, stageKey]
  );
  if (statusText) {
    await run(`UPDATE machine_config SET last_match_summary = $1 WHERE stage_key = $2`, [
      String(statusText).slice(0, 200),
      stageKey
    ]);
  }
}

function isKdtProfile(profile) {
  return profile === "kdt";
}

/**
 * KDT: log_path — папка з .txt логами (рекурсивно) або один .txt файл.
 */
async function ingestKdtLogs(stageKey, config, { fullScan = false } = {}) {
  const rawPath = config.log_path?.trim();
  if (!rawPath) {
    return { ingested: 0, message: "Шлях до логів KDT не налаштовано" };
  }

  const logPath = path.resolve(rawPath);
  if (!fs.existsSync(logPath)) {
    return { ingested: 0, message: `Шлях не знайдено: ${logPath}` };
  }

  let allEvents;
  try {
    allEvents = parseKdtAllLogs(logPath);
  } catch (err) {
    return { ingested: 0, message: err.message };
  }

  const kdtStatus = determineKdtStatus(allEvents);
  let since = null;
  if (!fullScan && config.last_log_event_time) {
    since = new Date(config.last_log_event_time);
    if (Number.isNaN(since.getTime())) since = null;
  }

  let newEvents = since ? allEvents.filter((e) => e.date > since) : allEvents;
  if (!since && newEvents.length > 300) {
    newEvents = newEvents.slice(-300);
  }

  let ingested = 0;
  let lastEventTime = config.last_log_event_time || "";

  for (const event of newEvents) {
    const parsed = kdtEventToEnverParsed(event, kdtStatus);
    const { id, parsed: p } = await insertEvent(stageKey, event.raw, parsed, 0);
    ingested += 1;
    if (event.time) lastEventTime = event.time;

    if (config.ai_matching_enabled !== false) {
      await matchLogToTask(stageKey, { ...p, tokens: parsed.tokens }, id);
    }
  }

  if (allEvents.length) {
    const last = allEvents[allEvents.length - 1];
    if (last.time) lastEventTime = last.time;
  }

  await applyProgress(stageKey, kdtStatus.progress, kdtStatus.statusText);

  await run(
    `UPDATE machine_config SET last_log_event_time = $1, last_log_offset = 0, updated_at = now()
     WHERE stage_key = $2`,
    [lastEventTime, stageKey]
  );

  return {
    ingested,
    lastProgress: kdtStatus.progress,
    kdtStatus: kdtStatus.status,
    message:
      ingested > 0
        ? `KDT: ${kdtStatus.statusText} (+${ingested} подій)`
        : kdtStatus.statusText || "Нових подій KDT немає"
  };
}

/**
 * Звичайний режим: один текстовий файл, читання з offset.
 */
async function ingestPlainLogFile(stageKey, config, { fullScan = false } = {}) {
  const logPath = path.resolve(config.log_path.trim());
  if (!fs.existsSync(logPath)) {
    return { ingested: 0, message: `Файл не знайдено: ${logPath}` };
  }

  const stat = fs.statSync(logPath);
  if (!stat.isFile()) {
    return {
      ingested: 0,
      message: "Для цього профілю вкажіть файл логу або оберіть парсер KDT для папки"
    };
  }

  const inode = `${stat.ino}-${stat.dev}`;
  let offset = fullScan ? 0 : (config.last_log_offset ?? 0);

  if (config.last_log_inode && config.last_log_inode !== inode) {
    offset = 0;
  }
  if (stat.size < offset) offset = 0;

  const encoding = config.log_encoding || "utf-8";
  const fd = fs.openSync(logPath, "r");
  const buffer = Buffer.alloc(Math.min(stat.size - offset, 512 * 1024));
  const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, offset);
  fs.closeSync(fd);

  const chunk = buffer.slice(0, bytesRead).toString(encoding);
  const lines = chunk.split(/\r?\n/);
  let ingested = 0;
  let lastProgress = config.last_progress ?? 0;
  let newOffset = offset + bytesRead;

  if (bytesRead === buffer.length && !chunk.endsWith("\n")) {
    const lastNl = chunk.lastIndexOf("\n");
    if (lastNl >= 0) {
      lines.splice(lines.length - 1, 1);
      newOffset = offset + Buffer.byteLength(chunk.slice(0, lastNl + 1), encoding);
    }
  }

  const profile = config.parser_profile || "generic";

  for (const line of lines) {
    const parsed = parseLogLine(line, profile);
    if (!parsed) continue;

    const { id, parsed: p } = await insertEvent(stageKey, line, parsed, newOffset);
    ingested += 1;

    if (p.progress !== null && p.progress !== undefined) {
      lastProgress = p.progress;
    }

    if (config.ai_matching_enabled !== false) {
      await matchLogToTask(stageKey, { ...p, tokens: parsed.tokens }, id);
    }
  }

  await applyProgress(stageKey, lastProgress);

  await run(
    `UPDATE machine_config SET last_log_offset = $1, last_log_inode = $2, updated_at = now()
     WHERE stage_key = $3`,
    [newOffset, inode, stageKey]
  );

  return {
    ingested,
    lastProgress,
    newOffset,
    message: ingested ? `Додано ${ingested} подій` : "Нових рядків немає"
  };
}

export async function ingestLogFile(stageKey, { fullScan = false } = {}) {
  const config = await getConfig(stageKey);
  if (!config?.log_path?.trim()) {
    return { ingested: 0, message: "Шлях до логу не налаштовано" };
  }

  if (config.log_path.trim().startsWith("browser://")) {
    return {
      ingested: 0,
      message:
        "Папка обрана в браузері — натисніть «Сканувати логи» у цьому вікні на ПК, де обрано папку"
    };
  }

  if (isKdtProfile(config.parser_profile)) {
    return ingestKdtLogs(stageKey, config, { fullScan });
  }

  const resolved = path.resolve(config.log_path.trim());
  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return {
      ingested: 0,
      message: "Для папки логів оберіть профіль парсера «kdt» (KDT Saw)"
    };
  }

  return ingestPlainLogFile(stageKey, config, { fullScan });
}

export async function ingestLogText(stageKey, text) {
  const config = await getConfig(stageKey);
  if (!config) return { ingested: 0, message: "Етап не знайдено" };

  if (isKdtProfile(config.parser_profile)) {
    let ingested = 0;
    const fakeEvents = [];
    for (const line of String(text || "").split(/\r?\n/)) {
      if (!line.trim()) continue;
      const timestamp = parseKdtTimestamp(line);
      if (!timestamp) continue;
      const xmlPath = extractKdtXmlPath(line);
      fakeEvents.push({
        time: timestamp.raw,
        date: timestamp.date,
        raw: line,
        eventType: detectKdtEvent(line),
        step: extractKdtStep(line),
        job: extractJobFromXmlPath(xmlPath),
        counters: extractKdtCounters(line),
        plcRegisters: extractKdtPlcRegisters(line),
        sourceFile: "upload"
      });
    }
    const kdtStatus = determineKdtStatus(fakeEvents);
    for (const event of fakeEvents) {
      const parsed = kdtEventToEnverParsed(event, kdtStatus);
      const { id, parsed: p } = await insertEvent(stageKey, event.raw, parsed, 0);
      ingested += 1;
      if (config.ai_matching_enabled !== false) {
        await matchLogToTask(stageKey, { ...p, tokens: parsed.tokens }, id);
      }
    }
    await applyProgress(stageKey, kdtStatus.progress, kdtStatus.statusText);
    return {
      ingested,
      lastProgress: kdtStatus.progress,
      message: `KDT: імпортовано ${ingested} подій`
    };
  }

  const profile = config.parser_profile || "generic";
  let ingested = 0;
  let lastProgress = config.last_progress ?? 0;

  for (const line of String(text || "").split(/\r?\n/)) {
    const parsed = parseLogLine(line, profile);
    if (!parsed) continue;
    const { id, parsed: p } = await insertEvent(stageKey, line, parsed, 0);
    ingested += 1;
    if (p.progress !== null && p.progress !== undefined) lastProgress = p.progress;
    if (config.ai_matching_enabled !== false) {
      await matchLogToTask(stageKey, { ...p, tokens: parsed.tokens }, id);
    }
  }

  await applyProgress(stageKey, lastProgress);
  return { ingested, lastProgress, message: `Імпортовано ${ingested} подій` };
}

export async function getRecentLogEvents(stageKey, limit = 30) {
  const rows = await all(
    `SELECT id, raw_line, event_type, progress, job_ref, program_name, logged_at, ingested_at
     FROM machine_log_events WHERE stage_key = $1
     ORDER BY id DESC LIMIT $2`,
    [stageKey, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    rawLine: r.raw_line,
    eventType: r.event_type,
    progress: r.progress,
    jobRef: r.job_ref,
    programName: r.program_name,
    loggedAt: r.logged_at,
    ingestedAt: r.ingested_at
  }));
}
