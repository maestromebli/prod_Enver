import { all, one } from "../db.js";
import { STAGE_STATUS_FIELD } from "../roles.js";
import { getAutomationSettings } from "./settings.js";

const STAGE_ALIASES = {
  cutting: "cutting",
  порізка: "cutting",
  edging: "edging",
  кромкування: "edging",
  drilling: "drilling",
  присадка: "drilling",
  assembly: "assembly",
  збірка: "assembly"
};

export function normalizeScanStation(station = "") {
  const key = String(station || "")
    .trim()
    .toLowerCase();
  return STAGE_ALIASES[key] || null;
}

/**
 * Прогрес сканування деталей позиції на етапі (унікальні part_id за 24 год).
 */
export async function getPositionScanProgress(positionId, { station = "", hours = 24 } = {}) {
  const totalRow = await one(
    `SELECT COUNT(*)::int AS total FROM constructive_parts WHERE position_id = $1`,
    [positionId]
  );
  const totalParts = totalRow?.total || 0;
  if (!totalParts) {
    return {
      totalParts: 0,
      scannedDistinct: 0,
      complete: false,
      stageKey: normalizeScanStation(station)
    };
  }

  const stageKey = normalizeScanStation(station);
  const scannedRows = await all(
    `SELECT COUNT(DISTINCT e.part_id)::int AS scanned
     FROM part_scan_events e
     JOIN constructive_parts p ON p.id = e.part_id
     WHERE p.position_id = $1
       AND e.created_at >= now() - ($2::text || ' hours')::interval`,
    [positionId, Math.max(1, Number(hours) || 24)]
  );
  const scannedDistinct = scannedRows[0]?.scanned || 0;

  return {
    totalParts,
    scannedDistinct,
    complete: scannedDistinct >= totalParts,
    stageKey
  };
}

export async function shouldSuggestCompleteStage(positionId, station = "") {
  const settings = await getAutomationSettings();
  if (!settings.autoCompleteStageOnFullScan) {
    return { suggest: false, reason: "disabled" };
  }

  const progress = await getPositionScanProgress(positionId, { station });
  if (!progress.complete) {
    return { suggest: false, progress };
  }

  const stageKey = progress.stageKey;
  if (!stageKey || !STAGE_STATUS_FIELD[stageKey]) {
    return { suggest: progress.complete, progress, autoComplete: false };
  }

  const field = STAGE_STATUS_FIELD[stageKey];
  const row = await one(`SELECT ${field} AS status FROM positions WHERE id = $1`, [positionId]);
  const inProgress = row?.status === "В роботі" || row?.status === "На паузі";

  return {
    suggest: inProgress,
    autoComplete: settings.autoCompleteStageOnFullScan && inProgress,
    progress,
    stageKey
  };
}
