import { all, run } from "../db.js";

export async function logAutomationEvent(
  event,
  { entityType = null, entityId = null, outcome = "ok", detail = null } = {}
) {
  try {
    await run(
      `INSERT INTO automation_event_log (event, entity_type, entity_id, outcome, detail_json)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        String(event || "unknown"),
        entityType,
        entityId != null ? Number(entityId) : null,
        String(outcome || "ok"),
        detail ? JSON.stringify(detail) : null
      ]
    );
  } catch (err) {
    console.error("[automation] event log:", err?.message || err);
  }
}

export async function getAutomationMetrics({ days = 7 } = {}) {
  const windowDays = Math.min(90, Math.max(1, Number(days) || 7));

  const [events, failedWebhooks, taskStats] = await Promise.all([
    all(
      `SELECT event, outcome, COUNT(*)::int AS count
       FROM automation_event_log
       WHERE created_at >= now() - ($1::text || ' days')::interval
       GROUP BY event, outcome
       ORDER BY count DESC`,
      [windowDays]
    ),
    all(
      `SELECT COUNT(*)::int AS failed
       FROM automation_webhook_outbox
       WHERE status = 'failed'`
    ),
    all(
      `SELECT outcome, COUNT(*)::int AS count
       FROM automation_event_log
       WHERE event = 'auto_create_tasks'
         AND created_at >= now() - ($1::text || ' days')::interval
       GROUP BY outcome`,
      [windowDays]
    )
  ]);

  const byEvent = {};
  for (const row of events) {
    if (!byEvent[row.event]) byEvent[row.event] = {};
    byEvent[row.event][row.outcome] = row.count;
  }

  const tasks = { applied: 0, skipped: 0, shadow: 0 };
  for (const row of taskStats) {
    if (row.outcome === "applied") tasks.applied = row.count;
    else if (row.outcome === "shadow") tasks.shadow = row.count;
    else tasks.skipped += row.count;
  }

  const totalTasks = tasks.applied + tasks.skipped + tasks.shadow;
  const autoTaskRate = totalTasks ? Math.round((tasks.applied / totalTasks) * 100) : 0;

  return {
    windowDays,
    eventsByType: byEvent,
    autoCreateTasks: { ...tasks, ratePercent: autoTaskRate },
    failedWebhooks: failedWebhooks[0]?.failed || 0
  };
}
