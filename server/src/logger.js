const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

function minLevel() {
  const raw = (process.env.LOG_LEVEL || "info").toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

function write(level, component, message, fields = {}) {
  if (LEVELS[level] < minLevel()) return;
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    message,
    ...fields
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export function createLogger(component) {
  return {
    debug: (message, fields) => write("debug", component, message, fields),
    info: (message, fields) => write("info", component, message, fields),
    warn: (message, fields) => write("warn", component, message, fields),
    error: (message, fields) => write("error", component, message, fields)
  };
}
