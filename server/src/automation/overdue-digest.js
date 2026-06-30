import { all } from "../db.js";
import { getAutomationSettings, saveAutomationSettings } from "./settings.js";
import { postAutomationWebhook } from "./webhook.js";

function kyivParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "numeric",
    hour12: false
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map((part) => [part.type, part.value])
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour)
  };
}

export async function loadOverduePositions(limit = 100) {
  const rows = await all(
    `SELECT p.id, p.order_number, p.item, p.overdue_days, p.position_status,
            p.problem, p.current_stage, p.progress
     FROM positions p
     WHERE p.parent_id IS NULL
       AND COALESCE(p.overdue_days, 0) > 0
       AND COALESCE(p.position_status, '') NOT IN ('Завершено', 'Архів', 'Скасовано')
     ORDER BY p.overdue_days DESC, p.id
     LIMIT $1`,
    [limit]
  );

  return rows.map((row) => ({
    positionId: row.id,
    orderNumber: row.order_number,
    item: row.item,
    overdueDays: row.overdue_days || 0,
    status: row.position_status,
    problem: row.problem || "",
    currentStage: row.current_stage || "",
    progress: row.progress ?? 0
  }));
}

export async function runOverdueDigest({ force = false, now = new Date() } = {}) {
  const settings = await getAutomationSettings();
  if (!settings.overdueDigestEnabled) {
    return { skipped: true, reason: "disabled" };
  }
  if (!settings.overdueDigestWebhookUrl) {
    return { skipped: true, reason: "no_webhook" };
  }

  const { date, hour } = kyivParts(now);
  if (!force && hour !== settings.overdueDigestHourKyiv) {
    return {
      skipped: true,
      reason: "not_due_hour",
      hour,
      expected: settings.overdueDigestHourKyiv
    };
  }
  if (!force && settings.lastOverdueDigestDate === date) {
    return { skipped: true, reason: "already_sent_today", date };
  }

  const items = await loadOverduePositions();
  if (!items.length && !settings.overdueDigestSendWhenEmpty) {
    await saveAutomationSettings({ lastOverdueDigestDate: date });
    return { skipped: true, reason: "empty", date };
  }

  const payload = {
    event: "overdue_digest",
    date,
    timezone: "Europe/Kyiv",
    count: items.length,
    items
  };

  const result = await postAutomationWebhook(settings.overdueDigestWebhookUrl, payload, {
    event: "overdue_digest"
  });

  if (!result.ok) {
    console.error("[automation] overdue digest webhook failed:", result.error);
    return { skipped: false, ok: false, error: result.error, count: items.length };
  }

  await saveAutomationSettings({ lastOverdueDigestDate: date });
  console.info(`[automation] overdue digest sent: ${items.length} items (${date})`);
  return { skipped: false, ok: true, count: items.length, date };
}

export async function sendProcurementWebhook(request, { materials = [], hardware = [] } = {}) {
  const settings = await getAutomationSettings();
  if (!settings.procurementWebhookEnabled || !settings.procurementWebhookUrl) {
    return { skipped: true, reason: "disabled" };
  }

  const payload = {
    event: "procurement_request_created",
    requestId: request.id,
    orderId: request.order_id,
    positionId: request.position_id,
    packageId: request.package_id,
    status: request.status,
    requestKind: request.request_kind,
    materialsCount: materials.length,
    hardwareCount: hardware.length,
    itemsPreview: [
      ...materials.slice(0, 12).map((m) => ({
        type: "board",
        name: m.material_name || m.name,
        qty: m.qty_estimated,
        unit: m.unit || "лист"
      })),
      ...hardware.slice(0, 12).map((h) => ({
        type: "hardware",
        name: h.name,
        article: h.article,
        qty: h.qty,
        unit: h.unit || "шт"
      }))
    ]
  };

  const result = await postAutomationWebhook(settings.procurementWebhookUrl, payload, {
    event: "procurement_request_created"
  });

  if (!result.ok) {
    console.error("[automation] procurement webhook failed:", result.error);
  } else {
    console.info(`[automation] procurement webhook sent request=${request.id}`);
  }

  return result;
}
