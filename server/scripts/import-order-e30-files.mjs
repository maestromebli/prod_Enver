#!/usr/bin/env node
/**
 * Одноразовий імпорт файлів замовлення Е-30 (обхід ліміту API 8 МБ для великих файлів).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { all, one, run } from "../src/db.js";
import { nextPositionId } from "../src/db/position-id.js";
import { insertPosition } from "../src/db/position-persistence.js";
import { enrichPositionRow } from "../src/position-logic.js";
import { defaultPositionRow } from "../src/order-status-workflow.js";
import { saveConstructiveFile } from "../src/file-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FILES_DIR = "/Users/enver/Downloads/Telegram Desktop";

const ORDER_NUMBER = "Е-30";
const ORDER_OBJECT = "Юнітхом Кухня";
const POSITION_ITEM = "Кухня";

const FILES = [
  {
    name: "Е_30_Специфікація_фурнітури_та_матеріалів_2.xls",
    mime: "application/vnd.ms-excel"
  },
  {
    name: "Е-30 Юнітхом Кухня.project",
    mime: "application/octet-stream"
  },
  {
    name: "Кухня (2).b3d",
    mime: "application/octet-stream"
  },
  {
    name: "Кухня Е30_Складальне креслення.pdf",
    mime: "application/pdf"
  }
];

async function ensureOrder() {
  let order = await one("SELECT * FROM orders WHERE order_number = $1", [ORDER_NUMBER]);
  if (!order) {
    order = await one(
      `INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
       VALUES ($1, $2, '', '', '', '', '', '', '')
       RETURNING *`,
      [ORDER_NUMBER, ORDER_OBJECT]
    );
    console.log(`+ замовлення ${ORDER_NUMBER}`);
  } else {
    console.log(`= замовлення ${ORDER_NUMBER} (id ${order.id})`);
  }
  return order;
}

async function ensurePosition(order) {
  let position = await one(
    `SELECT * FROM positions
     WHERE parent_id IS NULL AND (order_id = $1 OR order_number = $2)
     LIMIT 1`,
    [order.id, ORDER_NUMBER]
  );

  if (!position) {
    const id = await nextPositionId();
    const row = enrichPositionRow(
      { ...defaultPositionRow(order, id), item: POSITION_ITEM, item_type: "Кухня" },
      { planDate: order.plan_date || "" }
    );
    await insertPosition(row);
    position = await one("SELECT * FROM positions WHERE id = $1", [id]);
    console.log(`+ позиція «${POSITION_ITEM}» (id ${id})`);
  } else if (position.item !== POSITION_ITEM) {
    await run("UPDATE positions SET item = $2, item_type = $3 WHERE id = $1", [
      position.id,
      POSITION_ITEM,
      "Кухня"
    ]);
    position = await one("SELECT * FROM positions WHERE id = $1", [position.id]);
    console.log(`= позиція id ${position.id}, оновлено назву`);
  } else {
    console.log(`= позиція id ${position.id}`);
  }

  return position;
}

async function importFiles(positionId) {
  const inserted = [];

  for (const spec of FILES) {
    const fullPath = path.join(FILES_DIR, spec.name);
    if (!fs.existsSync(fullPath)) {
      throw new Error(`Файл не знайдено: ${fullPath}`);
    }

    const buffer = await fs.promises.readFile(fullPath);
    const saved = await saveConstructiveFile(positionId, {
      buffer,
      originalName: spec.name,
      mime: spec.mime
    });

    const fileRow = await one(
      `INSERT INTO position_files (position_id, kind, original_name, storage_path, mime, size_bytes, uploaded_by)
       VALUES ($1, 'constructive', $2, $3, $4, $5, NULL)
       RETURNING id, original_name, size_bytes`,
      [positionId, saved.originalName, saved.storagePath, saved.mime, saved.size]
    );
    inserted.push(fileRow);
    console.log(
      `  + ${spec.name} (${(saved.size / 1024 / 1024).toFixed(2)} МБ) → ${saved.storagePath}`
    );
  }

  await run(
    `UPDATE positions SET has_constructive_file = TRUE, constructor_name = COALESCE(NULLIF(constructor_name, ''), '')
     WHERE id = $1`,
    [positionId]
  );

  return inserted;
}

async function main() {
  const order = await ensureOrder();
  const position = await ensurePosition(order);
  const files = await importFiles(position.id);

  const allFiles = await all(
    `SELECT id, original_name, size_bytes FROM position_files WHERE position_id = $1 ORDER BY created_at`,
    [position.id]
  );

  console.log("\nПідсумок:");
  console.log(`  Замовлення: ${ORDER_NUMBER} (id ${order.id})`);
  console.log(`  Позиція: ${POSITION_ITEM} (id ${position.id})`);
  console.log(`  Файлів у БД: ${allFiles.length}`);
  for (const f of allFiles) {
    console.log(`    - ${f.original_name} (${(Number(f.size_bytes) / 1024 / 1024).toFixed(2)} МБ)`);
  }

  const latest = await one(
    `SELECT original_name FROM position_files
     WHERE position_id = $1 AND kind = 'constructive'
     ORDER BY created_at DESC LIMIT 1`,
    [position.id]
  );
  console.log(`  Активний у UI: ${latest?.original_name || "—"}`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
