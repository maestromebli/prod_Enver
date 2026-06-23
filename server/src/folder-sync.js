import { one } from "./db.js";
import { mapPosition } from "./mappers.js";
import { enrichPositionRow } from "./position-logic.js";

/** Деталі позиції для панелі оператора (v3 — без файлового агента). */
export async function getOperatorJobDetails(positionId) {
  const row = await one("SELECT * FROM positions WHERE id = $1", [positionId]);
  if (!row) return null;

  const file = await one(
    `SELECT original_name FROM position_files
     WHERE position_id = $1 AND kind = 'constructive'
     ORDER BY created_at DESC LIMIT 1`,
    [positionId]
  );

  return {
    position: mapPosition(enrichPositionRow(row)),
    orderNumber: row.order_number,
    object: row.object,
    item: row.item,
    material: row.material || "",
    constructiveFileName: file?.original_name || ""
  };
}
