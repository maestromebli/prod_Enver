import { getAutomationSettings } from "./settings.js";
import { enqueueAutomationWebhook } from "./outbox.js";
import { logAutomationEvent } from "./event-log.js";

const PRODUCTION_EVENTS = new Set([
  "position_ready_for_production",
  "package_approved",
  "ai_analysis_needs_review",
  "stage_completed",
  "stage_stalled",
  "missing_assignment"
]);

function resolveWebhookUrls(event, settings) {
  const urls = [];

  if (
    event === "overdue_digest" &&
    settings.overdueDigestEnabled &&
    settings.overdueDigestWebhookUrl
  ) {
    urls.push(settings.overdueDigestWebhookUrl);
  }

  if (
    event === "procurement_request_created" &&
    settings.procurementWebhookEnabled &&
    settings.procurementWebhookUrl
  ) {
    urls.push(settings.procurementWebhookUrl);
  }

  if (
    PRODUCTION_EVENTS.has(event) &&
    settings.productionWebhookEnabled &&
    settings.productionWebhookUrl
  ) {
    urls.push(settings.productionWebhookUrl);
  }

  return [...new Set(urls)];
}

/**
 * Центральна відправка події автоматизації: журнал + webhook(и) через outbox.
 */
export async function dispatchAutomationEvent(
  event,
  payload = {},
  { settings: settingsIn, entityType = null, entityId = null, outcome = "ok" } = {}
) {
  const settings = settingsIn || (await getAutomationSettings());
  const body = { event, ...payload };

  await logAutomationEvent(event, {
    entityType,
    entityId,
    outcome,
    detail: payload
  });

  const urls = resolveWebhookUrls(event, settings);
  if (!urls.length) {
    return { dispatched: false, reason: "no_webhook" };
  }

  const results = [];
  for (const url of urls) {
    const result = await enqueueAutomationWebhook(url, body, { event });
    results.push(result);
  }

  return { dispatched: true, results };
}

export async function notifyPackageApproved(positionId, detail = {}) {
  return dispatchAutomationEvent(
    "package_approved",
    { positionId, ...detail },
    { entityType: "position", entityId: positionId }
  );
}

export async function notifyPositionReadyForProduction(positionId, detail = {}) {
  return dispatchAutomationEvent(
    "position_ready_for_production",
    { positionId, ...detail },
    { entityType: "position", entityId: positionId, outcome: "applied" }
  );
}

export async function notifyAiNeedsReview(positionId, detail = {}) {
  return dispatchAutomationEvent(
    "ai_analysis_needs_review",
    { positionId, ...detail },
    { entityType: "position", entityId: positionId, outcome: "needs_review" }
  );
}

export async function notifyStageCompleted(positionId, detail = {}) {
  return dispatchAutomationEvent(
    "stage_completed",
    { positionId, ...detail },
    { entityType: "position", entityId: positionId }
  );
}

export async function notifyStageStalled(positionId, detail = {}) {
  return dispatchAutomationEvent(
    "stage_stalled",
    { positionId, ...detail },
    { entityType: "position", entityId: positionId, outcome: "stalled" }
  );
}

export async function notifyMissingAssignment(positionId, detail = {}) {
  return dispatchAutomationEvent(
    "missing_assignment",
    { positionId, ...detail },
    { entityType: "position", entityId: positionId, outcome: "missing_assignment" }
  );
}
