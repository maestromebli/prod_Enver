import fs from "fs";
import path from "path";

/** KDT Saw — парсер логів (адаптовано з kdt_log_parser_enver.js для ENVER). */

export const KDT_EVENT_MAP = {
  清空加工数据: "clear_processing_data",
  重新获取: "reload_data",
  获取加工数据: "get_processing_data",
  数据校验成功: "data_validated",
  开始加工: "cutting_started",
  暂停加工: "cutting_paused",
  加工完成: "cutting_completed",
  大板加工完成: "main_board_completed",
  中间板加工完成: "middle_board_completed",
  "循环加工结束，全部任务已完成加工": "all_tasks_completed",
  跳转准备加工: "prepare_next_pattern",
  点击开料编辑数据确认按钮: "cutting_data_confirmed",
  "System.UriFormatException": "data_push_error"
};

export function parseKdtTimestamp(line) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3})/);
  if (!match) return null;
  return {
    raw: match[1],
    date: new Date(match[1].replace(" ", "T"))
  };
}

export function detectKdtEvent(line) {
  for (const [text, event] of Object.entries(KDT_EVENT_MAP)) {
    if (line.includes(text)) return event;
  }
  if (/项序号1[:：]\s*(-?\d+)/.test(line)) return "operation_step";
  return "unknown";
}

export function extractKdtStep(line) {
  const match = line.match(/项序号1[:：]\s*(-?\d+)/);
  return match ? Number(match[1]) : null;
}

export function extractKdtXmlPath(line) {
  const win = line.match(/([A-Za-z]:\\.*?\.xml)/i);
  if (win) return win[1];
  const unix = line.match(/(\/[^\s"']+\.xml)/i);
  return unix ? unix[1] : null;
}

export function extractJobFromXmlPath(xmlPath) {
  if (!xmlPath) return null;

  const sep = xmlPath.includes("\\") ? "\\" : "/";
  const parts = xmlPath.split(sep).filter(Boolean);
  const kdtIndex = parts.findIndex((p) => p.toLowerCase().includes("kdtsaw"));

  return {
    orderName: kdtIndex >= 0 && parts[kdtIndex + 1] ? parts[kdtIndex + 1] : null,
    materialName: kdtIndex >= 0 && parts[kdtIndex + 2] ? parts[kdtIndex + 2] : null,
    xmlFileName: parts[parts.length - 1] || null,
    xmlPath
  };
}

export function extractKdtCounters(line) {
  const result = {};
  const fileMatch = line.match(/文件[:：]\s*(-?\d+)/);
  const groupMatch = line.match(/集合[:：]\s*(-?\d+)/);
  const processMatch = line.match(/加工[:：]\s*(-?\d+)/);
  const currentMatch = line.match(/当前加工[:：]\s*(-?\d+)/);
  const qtyMatch = line.match(/数量[:：]\s*(\d+)\/(\d+)/);
  const doneMatch = line.match(/已加工[:：]\s*(\d+)\/(\d+)/);

  if (fileMatch) result.fileIndex = Number(fileMatch[1]);
  if (groupMatch) result.groupIndex = Number(groupMatch[1]);
  if (processMatch) result.processIndex = Number(processMatch[1]);
  if (currentMatch) result.currentProcess = Number(currentMatch[1]);
  if (qtyMatch) {
    result.quantityCurrent = Number(qtyMatch[1]);
    result.quantityTotal = Number(qtyMatch[2]);
  }
  if (doneMatch) {
    result.doneCurrent = Number(doneMatch[1]);
    result.doneTotal = Number(doneMatch[2]);
  }

  return Object.keys(result).length ? result : null;
}

export function extractKdtPlcRegisters(line) {
  const registers = {};
  const regex = /(D\d+)\s*-\s*(-?\d+)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    registers[match[1]] = Number(match[2]);
  }
  return Object.keys(registers).length ? registers : null;
}

export function readKdtTxtFilesRecursive(dir) {
  if (!fs.existsSync(dir)) {
    throw new Error(`Папку не знайдено: ${dir}`);
  }

  const stat = fs.statSync(dir);
  if (stat.isFile()) {
    return dir.toLowerCase().endsWith(".txt") ? [dir] : [];
  }

  const result = [];
  function walk(currentDir) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
        result.push(fullPath);
      }
    }
  }
  walk(dir);
  return result;
}

export function parseKdtLogFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const events = [];

  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const timestamp = parseKdtTimestamp(line);
    if (!timestamp) continue;

    const xmlPath = extractKdtXmlPath(line);
    events.push({
      time: timestamp.raw,
      date: timestamp.date,
      sourceFile: path.basename(filePath),
      sourcePath: filePath,
      eventType: detectKdtEvent(line),
      step: extractKdtStep(line),
      job: extractJobFromXmlPath(xmlPath),
      counters: extractKdtCounters(line),
      plcRegisters: extractKdtPlcRegisters(line),
      raw: line
    });
  }

  return events;
}

export function parseKdtAllLogs(dirOrFile) {
  const files = readKdtTxtFilesRecursive(dirOrFile);
  let allEvents = [];

  for (const filePath of files) {
    try {
      allEvents = allEvents.concat(parseKdtLogFile(filePath));
    } catch (error) {
      allEvents.push({
        time: null,
        date: new Date(0),
        sourceFile: path.basename(filePath),
        sourcePath: filePath,
        eventType: "file_read_error",
        error: error.message,
        raw: ""
      });
    }
  }

  return allEvents.filter((e) => e.time).sort((a, b) => a.date - b.date);
}

function getLastEvent(events, eventTypes) {
  const types = Array.isArray(eventTypes) ? eventTypes : [eventTypes];
  for (let i = events.length - 1; i >= 0; i--) {
    if (types.includes(events[i].eventType)) return events[i];
  }
  return null;
}

function getLastJob(events) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].job) return events[i].job;
  }
  return null;
}

export function determineKdtStatus(events) {
  if (!events.length) {
    return {
      status: "no_data",
      statusText: "Немає даних у логах KDT",
      progress: 0
    };
  }

  const lastEvent = events[events.length - 1];
  const lastStart = getLastEvent(events, "cutting_started");
  const lastPause = getLastEvent(events, "cutting_paused");
  const lastComplete = getLastEvent(events, "cutting_completed");
  const lastAllDone = getLastEvent(events, "all_tasks_completed");
  const lastValidated = getLastEvent(events, "data_validated");
  const lastGetData = getLastEvent(events, "get_processing_data");
  const lastConfirm = getLastEvent(events, "cutting_data_confirmed");
  const lastPushError = getLastEvent(events, "data_push_error");
  const lastStep = getLastEvent(events, "operation_step");

  const eventsAfterLastStart = lastStart ? events.filter((e) => e.date > lastStart.date) : [];
  const stepsAfterLastStart = eventsAfterLastStart.filter((e) => e.eventType === "operation_step");
  const currentStep = stepsAfterLastStart.length
    ? stepsAfterLastStart[stepsAfterLastStart.length - 1].step
    : null;

  let status = "unknown";
  let statusText = "Невідомий статус KDT";

  if (lastAllDone && (!lastStart || lastAllDone.date >= lastStart.date)) {
    status = "all_done";
    statusText = "Усі завдання порізки виконано";
  } else if (lastComplete && (!lastStart || lastComplete.date >= lastStart.date)) {
    status = "completed";
    statusText = "Поточний цикл порізки завершено";
  } else if (
    lastPause &&
    lastStart &&
    lastPause.date > lastStart.date &&
    (!lastComplete || lastPause.date > lastComplete.date)
  ) {
    status = "paused";
    statusText = "Порізка на паузі";
  } else if (lastStep && lastStart && lastStep.date >= lastStart.date) {
    status = "cutting";
    statusText = "Порізка виконується";
  } else if (lastStart && (!lastComplete || lastStart.date > lastComplete.date)) {
    status = "cutting_started";
    statusText = "Порізка розпочата";
  } else if (lastValidated && (!lastStart || lastValidated.date > lastStart.date)) {
    status = "ready";
    statusText = "Дані завантажено та перевірено";
  } else if (lastGetData) {
    status = "loading_data";
    statusText = "KDT завантажує дані";
  } else if (lastConfirm) {
    status = "confirmed";
    statusText = "Оператор підтвердив дані";
  }

  const progress = computeKdtProgress(events, status, lastEvent);

  return {
    status,
    statusText,
    progress,
    currentJob: getLastJob(events),
    currentStep,
    lastEvent: lastEvent
      ? {
          time: lastEvent.time,
          type: lastEvent.eventType,
          sourceFile: lastEvent.sourceFile
        }
      : null,
    alert:
      lastPushError && lastStart && lastPushError.date >= lastStart.date
        ? {
            type: "data_push_error",
            text: "Помилка передачі даних KDT — перевірте URL сервера",
            time: lastPushError.time
          }
        : null,
    totalParsedEvents: events.length,
    updatedAt: new Date().toISOString()
  };
}

function computeKdtProgress(events, status, lastEvent) {
  if (status === "all_done") return 100;
  if (status === "completed") return 95;

  for (let i = events.length - 1; i >= 0; i--) {
    const c = events[i].counters;
    if (c?.doneTotal > 0) {
      return Math.max(0, Math.min(100, Math.round((c.doneCurrent / c.doneTotal) * 100)));
    }
    if (c?.quantityTotal > 0) {
      return Math.max(0, Math.min(100, Math.round((c.quantityCurrent / c.quantityTotal) * 100)));
    }
  }

  const map = {
    cutting: 55,
    cutting_started: 15,
    paused: 40,
    ready: 8,
    loading_data: 5,
    confirmed: 10,
    no_data: 0,
    unknown: 0
  };
  if (lastEvent?.eventType === "operation_step" && lastEvent.step != null) {
    return Math.max(10, Math.min(90, 20 + lastEvent.step * 5));
  }
  return map[status] ?? 0;
}

/** Перетворення події KDT у формат ENVER для БД та AI-зіставлення. */
export function kdtEventToEnverParsed(event, kdtStatus) {
  const job = event.job || kdtStatus?.currentJob;
  const jobRef = [job?.orderName, job?.materialName, job?.xmlFileName].filter(Boolean).join(" / ");
  const progress =
    event.counters?.doneTotal > 0
      ? Math.round((event.counters.doneCurrent / event.counters.doneTotal) * 100)
      : (kdtStatus?.progress ?? null);

  let eventType = event.eventType;
  if (eventType === "cutting_completed" || eventType === "all_tasks_completed") {
    eventType = "complete";
  } else if (eventType === "cutting_started") {
    eventType = "start";
  } else if (eventType === "operation_step") {
    eventType = "progress";
  }

  const tokens = [];
  const add = (s) => {
    if (!s) return;
    String(s)
      .split(/[\s_\-./\\]+/)
      .map((t) => t.toLowerCase())
      .filter((t) => t.length >= 2)
      .forEach((t) => tokens.push(t));
  };
  add(jobRef);
  add(job?.orderName);
  add(job?.materialName);
  add(job?.xmlFileName);

  return {
    eventType,
    progress,
    programName: job?.xmlFileName || "",
    jobRef,
    loggedAt: event.time?.replace(" ", "T"),
    tokens: [...new Set(tokens)],
    kdt: {
      status: kdtStatus?.status,
      statusText: kdtStatus?.statusText,
      step: event.step,
      counters: event.counters,
      sourceFile: event.sourceFile
    }
  };
}
