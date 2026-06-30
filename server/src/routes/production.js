import { Router } from "express";
import { all } from "../db.js";
import { OPERATOR_STAGES, STAGE_STATUS_FIELD } from "../roles.js";
import { requireAuth, requirePermissionOrAdmin } from "../middleware/auth.js";
import { PRODUCTION_FLOOR_STATUSES, sqlLiteralsIn } from "../../../shared/production/stages.js";
import {
  deriveCurrentStage,
  hasConstructive,
  isOnConstructorStage
} from "../../../shared/production/position-logic.js";
import { listPositionSummaries } from "../constructive/procurement-service.js";
import {
  HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY,
  PACKAGE_PARTS_COUNT_SUBQUERY
} from "../constructive-package-enrich.js";

const router = Router();
router.use(requireAuth, requirePermissionOrAdmin("canViewProductionFloor"));

function emptyStageCounts() {
  return { handed: 0, inWork: 0, paused: 0, problem: 0, overdue: 0 };
}

function bumpProblemOverdue(counts, row) {
  if (row.problem?.trim()) counts.problem += 1;
  if ((row.overdue_days || 0) > 0) counts.overdue += 1;
}

function countConstructorStage(rows) {
  const counts = emptyStageCounts();
  for (const row of rows) {
    if (!isOnConstructorStage(row)) continue;
    if (hasConstructive(row)) counts.inWork += 1;
    else counts.handed += 1;
    bumpProblemOverdue(counts, row);
  }
  return counts;
}

function countInstallStage(rows) {
  const counts = emptyStageCounts();
  for (const row of rows) {
    if (deriveCurrentStage(row) !== "install") continue;
    const status = String(row.position_status || "").trim();
    if (status === "На встановленні") counts.inWork += 1;
    else if (status === "На паузі") counts.paused += 1;
    else counts.handed += 1;
    bumpProblemOverdue(counts, row);
  }
  return counts;
}

router.get("/floor", async (_req, res) => {
  const positionRows = await all(
    `SELECT has_constructive_file, cutting_status, edging_status, drilling_status, assembly_status,
            position_status, problem, overdue_days,
            ${HAS_CONSTRUCTIVE_PACKAGE_SUBQUERY},
            ${PACKAGE_PARTS_COUNT_SUBQUERY}
     FROM positions
     WHERE trim(coalesce(position_status, '')) <> 'Завершено'`
  );

  const sessionRows = await all(
    `SELECT os.id, os.user_id, os.position_id, os.stage_key, os.started_at,
            u.name AS user_name,
            p.order_number, p.item, p.object, p.problem,
            p.cutting_status, p.edging_status, p.drilling_status, p.assembly_status, p.packaging_status
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

  const stages = [
    {
      key: "constructor",
      label: "Конструктив",
      ...countConstructorStage(positionRows)
    }
  ];

  const floorIn = sqlLiteralsIn(PRODUCTION_FLOOR_STATUSES);
  for (const stage of OPERATOR_STAGES) {
    const field = STAGE_STATUS_FIELD[stage.key];
    const counts = emptyStageCounts();
    const rows = await all(
      `SELECT ${field} AS status, problem, overdue_days FROM positions
       WHERE ${field} IN (${floorIn})
         AND trim(coalesce(position_status, '')) <> 'Завершено'`
    );

    for (const r of rows) {
      if (r.status === "Передано") counts.handed += 1;
      if (r.status === "В роботі") counts.inWork += 1;
      if (r.status === "На паузі") counts.paused += 1;
      if (r.status === "Проблема" || (r.problem || "").trim()) counts.problem += 1;
      if ((r.overdue_days || 0) > 0) counts.overdue += 1;
    }

    stages.push({
      key: stage.key,
      label: stage.label,
      ...counts
    });
  }

  stages.push({
    key: "install",
    label: "Монтаж",
    ...countInstallStage(positionRows)
  });

  const problemPositions = await all(
    `SELECT id, order_number, item, object, problem, position_status,
            cutting_status, edging_status, drilling_status, assembly_status, packaging_status, overdue_days
     FROM positions
     WHERE trim(problem) <> '' OR position_status = 'Проблема'
     ORDER BY overdue_days DESC, id
     LIMIT 30`
  );

  const procurementSummaries = await listPositionSummaries();
  const procurementByPosition = Object.fromEntries(
    procurementSummaries.map((s) => [s.positionId, s])
  );

  res.json({
    stages,
    activeSessions,
    procurementByPosition,
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
