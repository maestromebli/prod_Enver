import { one } from "../db.js";

/** Наступний id позиції через sequence (fallback для БД без міграції 0005). */
export async function nextPositionId() {
  try {
    const row = await one("SELECT nextval('positions_id_seq') AS id");
    return Number(row.id);
  } catch {
    const row = await one("SELECT COALESCE(MAX(id), 0) + 1 AS id FROM positions");
    return Number(row.id);
  }
}
