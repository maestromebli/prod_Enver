import {
  buildNotifications,
  buildOrderGodmode,
  buildPositionGodmode
} from "../../shared/production/godmode.js";
import { enrichPositionRow } from "./position-logic.js";
import { mapOrder, mapPosition } from "./mappers.js";
import { loadStageTimestampsMap, stageTimestampsForPosition } from "./stage-timestamps.js";
import {
  buildAiNotifications,
  buildGlobalAiNotifications,
  mergeAiNotifications
} from "./ai/ai-notifications.js";
import { packageGodmodeContextFromRow } from "./constructive-package-enrich.js";

export function godmodeContextFromRow(row, extra = {}) {
  return {
    hasAiAnalysis: Number(row?.ai_analysis_count ?? row?.aiAnalysisCount) > 0,
    planDate: row?.plan_date ?? row?.planDate ?? extra.planDate,
    ...packageGodmodeContextFromRow(row || {}),
    ...extra
  };
}

export function attachGodmodeToMappedPosition(mapped, rawEnriched, context = {}) {
  const ctx = {
    ...godmodeContextFromRow(rawEnriched, context),
    stageTimestamps: context.stageTimestamps || {},
    now: context.now || new Date()
  };
  return { ...mapped, godmode: buildPositionGodmode(rawEnriched, ctx) };
}

export function enrichAndMapPosition(row, planDate, context = {}) {
  const enriched = enrichPositionRow(row, { planDate });
  const mapped = mapPosition(enriched);
  return attachGodmodeToMappedPosition(mapped, enriched, { planDate, ...context });
}

export function attachGodmodeToOrder(order, positions = [], context = {}) {
  const mappedOrder =
    typeof order.id !== "undefined" && order.orderNumber ? order : mapOrder(order);
  const mappedPositions = positions.map((p) =>
    p.godmode ? p : enrichAndMapPosition(p, context.planDate, context)
  );
  return {
    ...mappedOrder,
    godmode: buildOrderGodmode(mappedOrder, mappedPositions, context)
  };
}

export async function buildNotificationsPayload({ orders, positions, users, now }) {
  const at = now || new Date();
  const ids = positions.map((p) => p.id).filter(Boolean);
  const tsMap = await loadStageTimestampsMap(ids);
  const enriched = positions.map((row) => {
    const planDate = orders.find(
      (o) => o.id === row.order_id || o.orderNumber === row.order_number
    )?.plan_date;
    const base = enrichPositionRow(row, { planDate });
    return {
      ...base,
      has_ai_analysis: Number(row.ai_analysis_count) > 0,
      _stageTimestamps: stageTimestampsForPosition(tsMap, row.id)
    };
  });
  return buildNotifications({ orders, positions: enriched, users, now: at });
}

export async function buildNotificationsPayloadWithAi({ orders, positions, users, now }) {
  const base = await buildNotificationsPayload({ orders, positions, users, now });
  const aiPos = buildAiNotifications({ positions, now });
  const aiGlobal = await buildGlobalAiNotifications({ now });
  return mergeAiNotifications(base, [...aiPos, ...aiGlobal]);
}

export const LATEST_AI_SUMMARY_SUBQUERY = `(SELECT ca.summary_json FROM constructive_analyses ca
  JOIN position_files pf ON pf.id = ca.position_file_id
  WHERE pf.position_id = p.id
  ORDER BY ca.created_at DESC LIMIT 1) AS latest_ai_summary_json`;

export const AI_COUNT_SUBQUERY = `(SELECT COUNT(*)::int FROM constructive_analyses ca
  JOIN position_files pf ON pf.id = ca.position_file_id
  WHERE pf.position_id = p.id) AS ai_analysis_count`;

export const ACTIVE_SESSION_SUBQUERY = `(SELECT COUNT(*)::int FROM operator_sessions os
  WHERE os.position_id = p.id AND os.finished_at IS NULL) AS active_operator_sessions`;
