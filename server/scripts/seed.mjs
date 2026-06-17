#!/usr/bin/env node
import pg from "pg";
import { hashPassword } from "../src/auth-utils.js";
import { DEFAULT_PERMISSIONS, OPERATOR_STAGES } from "../src/roles.js";
import { DEFAULT_DIRECTORIES } from "../src/directories-store.js";

const ADMIN_LOGIN = "admin";
const ADMIN_DEFAULT_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD || "admin";

export async function runSeed(client) {
  await seedRolePermissions(client);
  await seedMachineConfig(client);
  await seedDirectories(client);
  await seedFolderAgent(client);
  await seedAdminUser(client);
}

async function seedRolePermissions(client) {
  for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
    await client.query(
      `INSERT INTO role_permissions (role, permissions_json)
       VALUES ($1, $2)
       ON CONFLICT (role) DO NOTHING`,
      [role, JSON.stringify(perms)]
    );
  }
}

async function seedMachineConfig(client) {
  for (const stage of OPERATOR_STAGES) {
    await client.query(
      `INSERT INTO machine_config (stage_key)
       VALUES ($1)
       ON CONFLICT (stage_key) DO NOTHING`,
      [stage.key]
    );
  }
}

async function seedDirectories(client) {
  await client.query(
    `INSERT INTO app_settings (key, value_json)
     VALUES ('directories', $1)
     ON CONFLICT (key) DO NOTHING`,
    [JSON.stringify(DEFAULT_DIRECTORIES)]
  );
}

async function seedFolderAgent(client) {
  const token = process.env.AGENT_TOKEN || "enver-agent-dev-token";
  await client.query(
    `INSERT INTO app_settings (key, value_json)
     VALUES ('folder_agent', $1)
     ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json`,
    [
      JSON.stringify({
        token,
        rootPath: "\\\\NAS\\ENVER",
        enabled: true
      })
    ]
  );
}

async function seedAdminUser(client) {
  const existing = await client.query("SELECT 1 FROM users WHERE lower(login) = lower($1)", [
    ADMIN_LOGIN
  ]);
  if (existing.rowCount > 0) return;
  await client.query(
    `INSERT INTO users (name, login, password_hash, role, stages_json, active)
     VALUES ($1, $2, $3, 'admin', '[]', TRUE)`,
    ["Адміністратор", ADMIN_LOGIN, hashPassword(ADMIN_DEFAULT_PASSWORD)]
  );
  console.log(`+ створено admin/${ADMIN_DEFAULT_PASSWORD === "admin" ? "admin" : "***"}`);
}

// Прямий запуск (CLI): node server/scripts/seed.mjs
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const cs = process.env.DATABASE_URL_MIGRATIONS || process.env.DATABASE_URL;
  if (!cs) {
    console.error("DATABASE_URL_MIGRATIONS або DATABASE_URL не задано");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: cs });
  client
    .connect()
    .then(() => runSeed(client))
    .then(() => console.log("Seed готово."))
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => client.end());
}
