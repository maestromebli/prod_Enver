#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { runSeed } from "./seed.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, "..", "migrations");

const connectionString = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
if (!connectionString) {
  console.error("DATABASE_URL_MIGRATIONS або DATABASE_URL не задано");
  process.exit(1);
}

const client = new pg.Client({ connectionString });

async function main() {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = new Set(
    (await client.query("SELECT version FROM schema_migrations")).rows.map((r) => r.version)
  );

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`= ${file} (вже застосовано)`);
      continue;
    }
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf8");
    console.log(`→ ${file}`);
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ ${file} провалилась:`, err.message);
      throw err;
    }
  }

  console.log("Міграції готові. Сідаємо…");
  await runSeed(client);

  if (!process.env.DATABASE_URL) {
    process.env.DATABASE_URL = connectionString;
  }
  try {
    const { resyncBazisOperationCodesForAllPackages } = await import(
      "../src/constructive/bazis-operation-sync.js"
    );
    const result = await resyncBazisOperationCodesForAllPackages();
    console.log(
      `Bazis sync: ${result.packages} пакетів, ${result.partsUpdated} деталей оновлено`
    );
  } catch (err) {
    console.warn("Bazis sync пропущено:", err?.message || err);
  }

  console.log("Готово.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => client.end());
