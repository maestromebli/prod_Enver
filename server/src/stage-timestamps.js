import { all } from "./db.js";

const STAGE_KEYS = new Set([
  "cutting",
  "edging",
  "drilling",
  "assembly",
  "packaging",
  "constructor"
]);

/** Останній час зміни статусу етапу з audit та operator_sessions. */
export async function loadStageTimestampsMap(positionIds = []) {
  const map = new Map();
  if (!positionIds.length) return map;

  for (const id of positionIds) {
    map.set(id, {});
  }

  const sessions = await all(
    `SELECT position_id, stage_key, started_at
     FROM operator_sessions
     WHERE position_id = ANY($1)
     ORDER BY started_at DESC`,
    [positionIds]
  );

  for (const row of sessions) {
    const bucket = map.get(row.position_id);
    if (!bucket || bucket[row.stage_key]) continue;
    bucket[row.stage_key] = new Date(row.started_at);
  }

  const history = await all(
    `SELECT entity_id, changes_json, created_at
     FROM change_history
     WHERE entity_type = 'position'
       AND entity_id = ANY($1)
       AND action IN ('stage_change', 'auto_handoff', 'update')
     ORDER BY created_at DESC
     LIMIT 3000`,
    [positionIds]
  );

  for (const row of history) {
    const bucket = map.get(row.entity_id);
    if (!bucket) continue;
    let changes = [];
    try {
      changes = JSON.parse(row.changes_json || "[]");
    } catch {
      changes = [];
    }
    const at = new Date(row.created_at);
    for (const ch of changes) {
      const key = ch?.field;
      if (!STAGE_KEYS.has(key)) continue;
      if (!bucket[key] || at > bucket[key]) {
        bucket[key] = at;
      }
    }
  }

  return map;
}

export function stageTimestampsForPosition(map, positionId) {
  return map.get(positionId) || {};
}
