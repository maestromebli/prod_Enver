import { run } from "../db.js";

const BASE_COLUMNS = [
  "id",
  "parent_id",
  "order_id",
  "order_number",
  "object",
  "item",
  "item_type",
  "manager",
  "constructor_name",
  "cutting_status",
  "edging_status",
  "drilling_status",
  "assembly_status",
  "packaging_status",
  "assembly_responsible",
  "ready_date",
  "install_date",
  "install_end_date",
  "install_time_start",
  "install_time_end",
  "install_responsible",
  "position_status",
  "progress",
  "overdue_days",
  "problem",
  "note",
  "has_constructive_file"
];

function insertSql(columns) {
  const names = columns.join(", ");
  const params = columns.map((c) => `@${c}`).join(", ");
  return `INSERT INTO positions (${names}) VALUES (${params})`;
}

function pickRow(row, columns) {
  const out = {};
  for (const col of columns) {
    out[col] = row[col];
  }
  return out;
}

/** Стандартний INSERT позиції (без полів папки). */
export async function insertPosition(row) {
  await run(insertSql(BASE_COLUMNS), pickRow(row, BASE_COLUMNS));
}

/** Повний UPDATE усіх редагованих полів позиції. */
export async function updatePositionFull(row) {
  await run(
    `UPDATE positions SET
      parent_id = @parent_id,
      order_id = @order_id,
      order_number = @order_number,
      object = @object,
      item = @item,
      item_type = @item_type,
      manager = @manager,
      constructor_name = @constructor_name,
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      packaging_status = @packaging_status,
      assembly_responsible = @assembly_responsible,
      ready_date = @ready_date,
      install_date = @install_date,
      install_end_date = @install_end_date,
      install_time_start = @install_time_start,
      install_time_end = @install_time_end,
      install_responsible = @install_responsible,
      position_status = @position_status,
      progress = @progress,
      current_stage = @current_stage,
      overdue_days = @overdue_days,
      problem = @problem,
      note = @note,
      has_constructive_file = @has_constructive_file
    WHERE id = @id`,
    row
  );
}

/** Оновлення обчислених полів етапів (оператор, reconcile сесій). */
export async function updatePositionStages(row) {
  await run(
    `UPDATE positions SET
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      packaging_status = @packaging_status,
      position_status = @position_status,
      progress = @progress,
      current_stage = @current_stage
    WHERE id = @id`,
    {
      id: row.id,
      cutting_status: row.cutting_status,
      edging_status: row.edging_status,
      drilling_status: row.drilling_status,
      assembly_status: row.assembly_status,
      packaging_status: row.packaging_status,
      position_status: row.position_status,
      progress: row.progress,
      current_stage: row.current_stage
    }
  );
}

/** Оновлення етапів після зміни статусу замовлення (без current_stage). */
export async function updatePositionStagesFromOrderSync(row) {
  await run(
    `UPDATE positions SET
      cutting_status = @cutting_status,
      edging_status = @edging_status,
      drilling_status = @drilling_status,
      assembly_status = @assembly_status,
      packaging_status = @packaging_status,
      position_status = @position_status,
      progress = @progress,
      overdue_days = @overdue_days
    WHERE id = @id`,
    {
      id: row.id,
      cutting_status: row.cutting_status,
      edging_status: row.edging_status,
      drilling_status: row.drilling_status,
      assembly_status: row.assembly_status,
      packaging_status: row.packaging_status,
      position_status: row.position_status,
      progress: row.progress,
      overdue_days: row.overdue_days
    }
  );
}

/** Колонки базового INSERT — для скриптів з позиційними плейсхолдерами ($1..$N). */
export const POSITION_BASE_COLUMNS = [...BASE_COLUMNS];
