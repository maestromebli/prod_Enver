import { all, one, run } from "../db.js";
import { postAutomationWebhookDirect } from "./webhook.js";

const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 30 * 60_000];

function nextRetryAt(attempts) {
  const delay = RETRY_DELAYS_MS[Math.min(attempts, RETRY_DELAYS_MS.length - 1)] || 30 * 60_000;
  return new Date(Date.now() + delay);
}

/** Додає webhook у чергу (ідемпотентно зберігає payload). */
export async function enqueueAutomationWebhook(
  targetUrl,
  payload,
  { event, maxAttempts = 3 } = {}
) {
  const url = String(targetUrl || "").trim();
  if (!url) return { enqueued: false, reason: "url_missing" };

  const row = await one(
    `INSERT INTO automation_webhook_outbox (event, target_url, payload_json, max_attempts)
     VALUES ($1, $2, $3, $4)
     RETURNING id`,
    [event || payload?.event || "automation", url, JSON.stringify(payload || {}), maxAttempts]
  );

  const delivery = await deliverOutboxRow(row.id).catch((err) => ({
    ok: false,
    error: err?.message || String(err)
  }));

  return { enqueued: true, id: row.id, ...delivery };
}

async function loadOutboxRow(id) {
  return one(`SELECT * FROM automation_webhook_outbox WHERE id = $1`, [id]);
}

/** Намагається доставити один запис outbox. */
export async function deliverOutboxRow(id) {
  const row = await loadOutboxRow(id);
  if (!row || row.status === "sent") {
    return { ok: true, skipped: true };
  }

  const payload =
    typeof row.payload_json === "string"
      ? JSON.parse(row.payload_json || "{}")
      : row.payload_json || {};

  const result = await postAutomationWebhookDirect(row.target_url, payload, {
    event: row.event
  });

  if (result.ok) {
    await run(
      `UPDATE automation_webhook_outbox
       SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL
       WHERE id = $1`,
      [id]
    );
    return { ok: true, status: result.status };
  }

  const attempts = Number(row.attempts) + 1;
  const exhausted = attempts >= Number(row.max_attempts || 3);
  await run(
    `UPDATE automation_webhook_outbox
     SET status = $1,
         attempts = $2,
         last_error = $3,
         next_retry_at = $4
     WHERE id = $5`,
    [
      exhausted ? "failed" : "pending",
      attempts,
      String(result.error || "delivery_failed").slice(0, 500),
      nextRetryAt(attempts),
      id
    ]
  );

  return { ok: false, error: result.error, exhausted };
}

/** Обробляє pending/failed записи, готові до retry. */
export async function processWebhookOutbox({ limit = 25 } = {}) {
  const rows = await all(
    `SELECT id FROM automation_webhook_outbox
     WHERE status = 'pending' AND next_retry_at <= now()
     ORDER BY next_retry_at ASC, id ASC
     LIMIT $1`,
    [limit]
  );

  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const result = await deliverOutboxRow(row.id);
    if (result.ok && !result.skipped) sent += 1;
    else if (result.exhausted || result.ok === false) failed += 1;
  }

  return { processed: rows.length, sent, failed };
}

export async function listFailedWebhooks(limit = 20) {
  return all(
    `SELECT id, event, target_url, attempts, max_attempts, last_error, created_at, next_retry_at
     FROM automation_webhook_outbox
     WHERE status = 'failed'
     ORDER BY id DESC
     LIMIT $1`,
    [limit]
  );
}

export async function retryFailedWebhook(id) {
  await run(
    `UPDATE automation_webhook_outbox
     SET status = 'pending', next_retry_at = now(), attempts = 0, last_error = NULL
     WHERE id = $1 AND status = 'failed'`,
    [id]
  );
  return deliverOutboxRow(id);
}
