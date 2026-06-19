import { Router } from "express";
import { all, one } from "../db.js";
import { OPERATOR_STAGES, STAGE_STATUS_FIELD } from "../roles.js";
import { requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import { PRODUCTION_FLOOR_STATUSES, sqlLiteralsIn } from "../../../shared/production/stages.js";

const router = Router();
router.use(requireAuth, requirePermissionOrAdmin("canViewProductionFloor"));

router.get("/floor", async (_req, res) => {
  const sessionRows = await all(
    `SELECT os.id, os.user_id, os.position_id, os.stage_key, os.started_at,
            u.name AS user_name,
            p.order_number, p.item, p.object, p.problem,
            p.cutting_status, p.edging_status, p.drilling_status, p.assembly_status
     FROM operator_sessions os
     JOIN users u ON u.id = os.user_id
     JOIN positions p ON p.id = os.position_id
     WHERE os.finished_at IS NULL
     ORDER BY os.started_at`
  );
  const activeSessions = sessionRows.map((row) => {
    const field = STAGE_STATUS_FIELD[row.stage_key];
    const stageStatus = field ? row[field] : "";
    return {
      sessionId: row.id,
      userId: row.user_id,
      userName: row.user_name,
      positionId: row.position_id,
      orderNumber: row.order_number,
      item: row.item,
      object: row.object,
      stageKey: row.stage_key,
      stageStatus,
      startedAt: row.started_at,
      problem: row.problem || ""
    };
  });

  const stages = [];
  for (const stage of OPERATOR_STAGES) {
    const field = STAGE_STATUS_FIELD[stage.key];
    const counts = { handed: 0, inWork: 0, paused: 0, problem: 0, overdue: 0 };
    const floorIn = sqlLiteralsIn(PRODUCTION_FLOOR_STATUSES);
    const rows = await all(
      `SELECT ${field} AS status, problem, overdue_days FROM positions
       WHERE ${field} IN (${floorIn})`
    );

    for (const r of rows) {
      if (r.status === "Передано") counts.handed += 1;
      if (r.status === "В роботі") counts.inWork += 1;
      if (r.status === "На паузі") counts.paused += 1;
      if (r.status === "Проблема" || (r.problem || "").trim()) counts.problem += 1;
      if ((r.overdue_days || 0) > 0) counts.overdue += 1;
    }

    const machine = await one(
      "SELECT last_progress, last_match_summary FROM machine_config WHERE stage_key = $1",
      [stage.key]
    );

    stages.push({
      key: stage.key,
      label: stage.label,
      ...counts,
      machineProgress: machine?.last_progress ?? 0,
      machineMatch: machine?.last_match_summary || ""
    });
  }

  const problemPositions = await all(
    `SELECT id, order_number, item, object, problem, position_status,
            cutting_status, edging_status, drilling_status, assembly_status, overdue_days
     FROM positions
     WHERE trim(problem) <> '' OR position_status = 'Проблема'
     ORDER BY overdue_days DESC, id
     LIMIT 30`
  );

  res.json({
    stages,
    activeSessions,
    problemPositions: problemPositions.map((p) => ({
      id: p.id,
      orderNumber: p.order_number,
      item: p.item,
      object: p.object,
      problem: p.problem,
      positionStatus: p.position_status,
      overdueDays: p.overdue_days || 0
    }))
  });
});

export default router;
