#!/usr/bin/env node
/**
 * Імпорт замовлень з Excel: колонка A — номер (напр. (Е-40)), B — назва об'єкта.
 * Перед імпортом видаляє всі позиції та замовлення.
 *
 * Використання:
 *   node server/scripts/import-orders-xlsx.mjs "/шлях/до/файлу.xlsx"
 *   node server/scripts/import-orders-xlsx.mjs --api http://localhost:3000 file.xlsx
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARSE_SCRIPT = path.join(__dirname, "parse-orders-xlsx.py");

function parseXlsx(filePath) {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) {
    throw new Error(`Файл не знайдено: ${abs}`);
  }
  const r = spawnSync("python3", [PARSE_SCRIPT, abs], { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(r.stderr || "Помилка парсингу Excel (потрібен: pip install openpyxl)");
  }
  return JSON.parse(r.stdout.trim());
}

async function importViaDb(orders) {
  const cs = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
  if (!cs) throw new Error("DATABASE_URL не задано");
  const pg = (await import("pg")).default;
  const client = new pg.Client({ connectionString: cs });
  await client.connect();
  try {
    await client.query("BEGIN");
    const pos = await client.query("DELETE FROM positions");
    const ord = await client.query("DELETE FROM orders");
    console.log(`Видалено позицій: ${pos.rowCount}, замовлень: ${ord.rowCount}`);
    let inserted = 0;
    for (const o of orders) {
      await client.query(
        `INSERT INTO orders (order_number, object, client, manager, start_date, plan_date, status, priority, comment)
         VALUES ($1, $2, '', '', '', '', '', '', '')`,
        [o.orderNumber, o.object]
      );
      inserted += 1;
    }
    await client.query("COMMIT");
    console.log(`Додано замовлень: ${inserted}`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

async function apiRequest(base, token, method, apiPath, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${base.replace(/\/$/, "")}${apiPath}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status} ${apiPath}`);
  return data;
}

async function importViaApi(base, orders, login, password) {
  const { token } = await apiRequest(base, null, "POST", "/api/auth/login", { login, password });
  const positions = await apiRequest(base, token, "GET", "/api/positions");
  const deletePositions = [...positions].sort((a, b) => {
    if (a.parentId && !b.parentId) return -1;
    if (!a.parentId && b.parentId) return 1;
    return b.id - a.id;
  });
  for (const p of deletePositions) {
    try {
      await apiRequest(base, token, "DELETE", `/api/positions/${p.id}`);
    } catch (err) {
      if (!String(err.message).includes("не знайдено")) throw err;
    }
  }
  console.log(`Видалено позицій: ${positions.length}`);
  const existing = await apiRequest(base, token, "GET", "/api/orders");
  for (const o of existing) {
    await apiRequest(base, token, "DELETE", `/api/orders/${o.id}`);
  }
  console.log(`Видалено замовлень: ${existing.length}`);
  let inserted = 0;
  for (const o of orders) {
    await apiRequest(base, token, "POST", "/api/orders", {
      orderNumber: o.orderNumber,
      object: o.object,
      client: "",
      manager: "",
      startDate: "",
      planDate: "",
      status: "",
      priority: "",
      comment: ""
    });
    inserted += 1;
  }
  console.log(`Додано замовлень: ${inserted}`);
}

async function main() {
  const args = process.argv.slice(2);
  let apiBase = null;
  let login = process.env.IMPORT_LOGIN || "admin";
  let password = process.env.IMPORT_PASSWORD || "admin";
  const files = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--api") {
      apiBase = args[++i];
    } else if (args[i] === "--login") {
      login = args[++i];
    } else if (args[i] === "--password") {
      password = args[++i];
    } else {
      files.push(args[i]);
    }
  }
  const filePath = files[0];
  if (!filePath) {
    console.error(
      "Вкажіть шлях до .xlsx:\n  node server/scripts/import-orders-xlsx.mjs file.xlsx\n  node server/scripts/import-orders-xlsx.mjs --api http://localhost:3000 file.xlsx"
    );
    process.exit(1);
  }
  const orders = parseXlsx(filePath);
  console.log(`З файлу: ${orders.length} замовлень`);
  if (apiBase) {
    await importViaApi(apiBase, orders, login, password);
  } else {
    await importViaDb(orders);
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
