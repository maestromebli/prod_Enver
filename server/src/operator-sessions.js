import { all, run } from "./db.js";
import { STAGE_STATUS_FIELD } from "./roles.js";
import { enrichPositionRow } from "./position-logic.js";
import {
  OPERATOR_SESSION_ACTIVE_STATUSES,
  sqlLiteralsIn,
  OPERATOR_SESSION_ACTIVE_STATUSES_LIST
} from "../../shared/production/stages.js";
import { updatePositionStages } from "./db/position-persistence.js";

export { OPERATOR_SESSION_ACTIVE_STATUSES as OPERATOR_ACTIVE_STATUSES };

export function stageStatusFromRow(row, stageKey) {
  const field = STAGE_STATUS_FIELD[stageKey];
  return field ? row[field] : null;
}

export function isOperatorSessionActive(row, stageKey) {
  return OPERATOR_SESSION_ACTIVE_STATUSES.has(stageStatusFromRow(row, stageKey));
}

/** Закриває сесії користувача, якщо статус позиції на етапі вже не «В роботі» / «На паузі». */
export async function reconcileOperatorSessionsForUser(userId) {
  const openSessions = await all(
    `SELECT os.id, os.stage_key,
            p.cutting_status, p.edging_status, p.drilling_status, p.assembly_status
     FROM operator_sessions os
     JOIN positions p ON p.id = os.position_id
     WHERE os.user_id = $1 AND os.finished_at IS NULL`,
    [userId]
  );

  let closed = 0;
  for (const session of openSessions) {
    if (!isOperatorSessionActive(session, session.stage_key)) {
      await run(`UPDATE operator_sessions SET finished_at = now() WHERE id = $1`, [session.id]);
      closed += 1;
    }
  }
  return closed;
}

/** Повертає «Передано», якщо етап «В роботі»/«На паузі» без відкритої сесії на цьому етапі. */
export async function reconcileStaleStageStatuses(stageKey) {
  const field = STAGE_STATUS_FIELD[stageKey];
  if (!field) return 0;

  const inList = sqlLiteralsIn(OPERATOR_SESSION_ACTIVE_STATUSES_LIST);
  const rows = await all(
    `SELECT p.*
     FROM positions p
     WHERE p.${field} IN (${inList})
       AND NOT EXISTS (
         SELECT 1 FROM operator_sessions os
         WHERE os.position_id = p.id
           AND os.stage_key = $1
           AND os.finished_at IS NULL
       )`,
    [stageKey]
  );

  let reset = 0;
  for (const row of rows) {
    row[field] = "Передано";
    const enriched = enrichPositionRow(row);
    await updatePositionStages({ ...enriched, id: row.id });
    reset += 1;
  }
  return reset;
}

/** Закриває сесії на етапах, де статус змінено ззовні (PUT позиції). */
export async function closeSessionsAfterStageStatusChanges(beforeRow, afterRow, positionId) {
  for (const [stageKey, field] of Object.entries(STAGE_STATUS_FIELD)) {
    if (beforeRow[field] === afterRow[field]) continue;
    if (!OPERATOR_SESSION_ACTIVE_STATUSES.has(afterRow[field])) {
      await closeOperatorSessionsForStage(positionId, stageKey);
    }
  }
}

/** Закриває відкриті сесії на етапі, коли статус змінено ззовні (наприклад, з картки позиції). */
export async function closeOperatorSessionsForStage(positionId, stageKey) {
  await run(
    `UPDATE operator_sessions SET finished_at = now()
     WHERE position_id = $1 AND stage_key = $2 AND finished_at IS NULL`,
    [positionId, stageKey]
  );
}
