#!/usr/bin/env node
/**
 * Видаляє всі робочі дані, залишаючи користувачів і системні налаштування.
 *
 * Зберігає: users, role_permissions, app_settings, machine_config, schema_migrations.
 * Також очищає каталог UPLOADS_DIR.
 *
 *   node server/scripts/purge-data.mjs
 *   node server/scripts/purge-data.mjs --yes
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.join(__dirname, "..", "..", ".env") });

const KEEP_TABLES = new Set([
  "users",
  "role_permissions",
  "app_settings",
  "machine_config",
  "schema_migrations"
]);

async function purgeUploads() {
  const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, "..", "..", "data", "uploads");
  if (!fs.existsSync(uploadsDir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(uploadsDir)) {
    if (entry === ".gitkeep") continue;
    const full = path.join(uploadsDir, entry);
    fs.rmSync(full, { recursive: true, force: true });
    removed += 1;
  }
  fs.mkdirSync(uploadsDir, { recursive: true });
  return removed;
}

async function purgeDatabase(client) {
  const { rows } = await client.query(
    `SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename`
  );
  const tables = rows.map((r) => r.tablename).filter((name) => !KEEP_TABLES.has(name));
  if (tables.length === 0) {
    console.log("Немає таблиць для очищення.");
    return {};
  }

  const quoted = tables.map((t) => `"${t}"`).join(", ");
  await client.query(`TRUNCATE TABLE ${quoted} RESTART IDENTITY CASCADE`);

  await client.query(`
    UPDATE machine_config SET
      last_progress = 0,
      last_log_offset = 0,
      last_log_inode = '',
      last_match_position_id = NULL,
      last_match_confidence = 0,
      last_match_summary = '',
      last_log_event_time = '',
      updated_at = now()
  `);

  const counts = {};
  for (const table of tables) {
    const r = await client.query(`SELECT COUNT(*)::int AS n FROM "${table}"`);
    counts[table] = r.rows[0].n;
  }
  return counts;
}

async function main() {
  const autoYes = process.argv.includes("--yes");
  if (!autoYes) {
    console.error("Увага: буде видалено всі дані крім користувачів і системних налаштувань.");
    console.error("Запустіть з --yes для підтвердження.");
    process.exit(1);
  }

  const cs = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
  if (!cs) {
    console.error("DATABASE_URL_MIGRATIONS або DATABASE_URL не задано");
    process.exit(1);
  }

  const client = new pg.Client({ connectionString: cs });
  await client.connect();
  try {
    await client.query("BEGIN");
    const counts = await purgeDatabase(client);
    await client.query("COMMIT");
    const uploadsRemoved = await purgeUploads();
    const users = await client.query("SELECT COUNT(*)::int AS n FROM users");
    console.log(`Користувачів залишилось: ${users.rows[0].n}`);
    console.log(`Очищено таблиць: ${Object.keys(counts).length}`);
    console.log(`Видалено елементів у uploads: ${uploadsRemoved}`);
    console.log("Готово.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
