import { all } from "../db.js";
import { STAGE_STATUS_FIELD } from "../roles.js";
import { getAutomationSettings } from "./settings.js";
import { notifyStageStalled, notifyMissingAssignment } from "./dispatch.js";
import { stageRequiresAssignment } from "../../../shared/production/next-action.js";
import { STAGES } from "../../../shared/production/stages.js";

const STALLED_STATUSES = new Set(["В роботі", "На паузі"]);
const HANDOFF_WAIT_STATUSES = new Set(["Передано"]);

export async function runStalledStageChecks({ now = new Date() } = {}) {
  const settings = await getAutomationSettings();
  if (!settings.stalledStageCheckEnabled) {
    return { skipped: true, reason: "disabled" };
  }

  const hours = Math.max(1, Number(settings.stalledStageHours) || 8);
  const stalled = [];
  const missingAssign = [];

  const rows = await all(
    `SELECT p.id, p.order_number, p.item,
            p.cutting_status, p.edging_status, p.drilling_status, p.assembly_status,
            p.assembly_responsible, p.updated_at
     FROM positions p
     WHERE p.parent_id IS NULL
       AND COALESCE(p.position_status, '') NOT IN ('Завершено', 'Архів', 'Скасовано')`
  );

  for (const row of rows) {
    for (const stage of STAGES) {
      if (stage.type === "constructor" || stage.key === "install") continue;
      const field = STAGE_STATUS_FIELD[stage.key];
      if (!field) continue;
      const status = row[field];
      if (!status) continue;

      if (STALLED_STATUSES.has(status)) {
        const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
        if (updatedAt && now - updatedAt >= hours * 60 * 60 * 1000) {
          stalled.push({
            positionId: row.id,
            orderNumber: row.order_number,
            item: row.item,
            stageKey: stage.key,
            status,
            hoursInStatus: Math.round((now - updatedAt) / (60 * 60 * 1000))
          });
        }
      }

      if (
        HANDOFF_WAIT_STATUSES.has(status) &&
        stageRequiresAssignment(stage) &&
        !String(row.assembly_responsible || "").trim()
      ) {
        const updatedAt = row.updated_at ? new Date(row.updated_at) : null;
        if (updatedAt && now - updatedAt >= 2 * 60 * 60 * 1000) {
          missingAssign.push({
            positionId: row.id,
            orderNumber: row.order_number,
            item: row.item,
            stageKey: stage.key
          });
        }
      }
    }
  }

  for (const item of stalled.slice(0, 30)) {
    await notifyStageStalled(item.positionId, item);
  }
  for (const item of missingAssign.slice(0, 30)) {
    await notifyMissingAssignment(item.positionId, item);
  }

  return {
    skipped: false,
    stalledCount: stalled.length,
    missingAssignmentCount: missingAssign.length
  };
}
