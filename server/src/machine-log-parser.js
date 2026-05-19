/**
 * Парсер рядків логів ЧПУ / станків.
 * Профілі: generic, biesse, homag, scm
 */

const PROFILES = {
  generic: {
    progress: [
      /(?:progress|PROGRESS|виконання|выполнение)[:\s=]+(\d{1,3})\s*%?/i,
      /(\d{1,3})\s*%\s*(?:done|complete|готово|заверш)/i,
      /N\d+\s+.*?(\d{1,3})\s*%/i
    ],
    program: [
      /(?:program|PROGRAM|prog|файл|file)[:\s=]+["']?([^\s"']+\.(?:nc|cnc|mpr|pgmx?))/i,
      /(?:O\d+|замовлення|order)[:\s#]*([A-Za-zА-Яа-яІіЇїЄєҐґ0-9_\-./]+)/i
    ],
    job: [
      /(?:job|JOB|завдання|task|project)[:\s=]+["']?([^"'\n,;]+)/i,
      /(?:START|STARTED)\s+(.+)/i
    ],
    complete: [/COMPLETE|FINISHED|DONE|завершено|готово/i, /M30|M02/i],
    start: [/START(?:ED)?|RUNNING|початок|старт/i]
  },
  biesse: {
    progress: [/Progress[:\s]+(\d{1,3})/i, /(\d{1,3})%/],
    program: [/Program:\s*(\S+)/i, /File:\s*(\S+)/i],
    job: [/Job[:\s]+(\S+)/i],
    complete: [/Program completed|End program/i],
    start: [/Program start|Loading program/i]
  },
  homag: {
    progress: [/Fortschritt[:\s]+(\d{1,3})/i, /Progress[:\s]+(\d{1,3})/i],
    program: [/Programm[:\s]+(\S+)/i, /Datei[:\s]+(\S+)/i],
    job: [/Auftrag[:\s]+(\S+)/i],
    complete: [/Programm beendet|fertig/i],
    start: [/Programmstart|Start/i]
  },
  scm: {
    progress: [/Avanzamento[:\s]+(\d{1,3})/i, /Progress[:\s]+(\d{1,3})/i],
    program: [/Programma[:\s]+(\S+)/i],
    job: [/Commessa[:\s]+(\S+)/i],
    complete: [/Fine programma|completato/i],
    start: [/Inizio programma|avvio/i]
  }
};

function firstMatch(line, patterns) {
  for (const re of patterns) {
    const m = line.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return null;
}

function detectEventType(line, profile) {
  if (profile.complete.some((re) => re.test(line))) return "complete";
  if (profile.start.some((re) => re.test(line))) return "start";
  if (profile.progress.some((re) => re.test(line))) return "progress";
  if (profile.program.some((re) => re.test(line)) || profile.job.some((re) => re.test(line))) {
    return "program";
  }
  return "unknown";
}

function parseTimestamp(line) {
  const iso = line.match(/\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}/);
  if (iso) return iso[0].replace(" ", "T");

  const eu = line.match(/(\d{2})\.(\d{2})\.(\d{4})\s+(\d{2}):(\d{2}):(\d{2})/);
  if (eu) {
    const [, d, mo, y, h, mi, s] = eu;
    return `${y}-${mo}-${d}T${h}:${mi}:${s}`;
  }
  return null;
}

export function getParserProfiles() {
  return [...Object.keys(PROFILES), "kdt"];
}

/**
 * @param {string} line
 * @param {string} profileName
 */
export function parseLogLine(line, profileName = "generic") {
  const trimmed = String(line || "").trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }

  const profile = PROFILES[profileName] || PROFILES.generic;
  const eventType = detectEventType(trimmed, profile);

  let progress = null;
  for (const re of profile.progress) {
    const m = trimmed.match(re);
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n)) {
        progress = Math.max(0, Math.min(100, Math.round(n)));
        break;
      }
    }
  }
  if (eventType === "complete") progress = 100;
  if (eventType === "start" && progress === null) progress = 0;

  const programName =
    firstMatch(trimmed, profile.program) ||
    trimmed.match(/([A-Za-z0-9_\-./]+\.(?:nc|cnc|mpr|pgm))/i)?.[1] ||
    "";

  const jobRef = firstMatch(trimmed, profile.job) || "";

  return {
    eventType,
    progress,
    programName,
    jobRef,
    loggedAt: parseTimestamp(trimmed),
    tokens: extractTokens(trimmed, programName, jobRef)
  };
}

export function extractTokens(line, ...extra) {
  const parts = [line, ...extra].join(" ");
  const raw = parts.match(/[A-Za-zА-Яа-яІіЇїЄєҐґ0-9][A-Za-zА-Яа-яІіЇїЄєҐґ0-9_\-./]*/g) || [];
  const stop = new Set(["the", "and", "log", "file", "program", "progress", "start", "end"]);
  return [...new Set(raw.map((t) => t.toLowerCase()).filter((t) => t.length >= 2 && !stop.has(t)))];
}
