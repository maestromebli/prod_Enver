import { one } from "./db.js";
import { mapPosition } from "./mappers.js";
import { enrichPositionRow } from "./position-logic.js";
import { listConstructiveFiles } from "./constructive-files-service.js";

/** Деталі позиції для панелі оператора (v3 — без файлового агента). */
export async function getOperatorJobDetails(positionId) {
  const row = await one("SELECT * FROM positions WHERE id = $1", [positionId]);
  if (!row) return null;

  const files = await listConstructiveFiles(positionId);
  const latest = files.length ? files[files.length - 1] : null;

  return {
    position: mapPosition(enrichPositionRow(row)),
    orderNumber: row.order_number,
    object: row.object,
    item: row.item,
    material: row.material || "",
    constructiveFileName: latest?.fileName || "",
    constructiveFiles: files
  };
}
