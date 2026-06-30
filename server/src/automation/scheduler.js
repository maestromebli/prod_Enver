const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let timer = null;
let running = false;

async function tick() {
  if (running) return;
  running = true;
  try {
    const { runOverdueDigest } = await import("./overdue-digest.js");
    await runOverdueDigest();
  } catch (err) {
    console.error("[automation] scheduler tick:", err?.message || err);
  } finally {
    running = false;
  }
}

/** Запускає фонову перевірку прострочок (один інстанс monolith). */
export function startAutomationScheduler() {
  if (timer) return;
  if (!process.env.DATABASE_URL) return;

  void tick();
  timer = setInterval(() => {
    void tick();
  }, CHECK_INTERVAL_MS);
  timer.unref?.();
  console.info("[automation] scheduler started (overdue digest every 5 min check)");
}

export function stopAutomationScheduler() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
