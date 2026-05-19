import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import seedData from "./seed-data.json" with { type: "json" };
import { migrateToUkrainian } from "./migrate-locale.js";
import { hashPassword } from "./auth-utils.js";
import { DEFAULT_DIRECTORIES } from "./directories-store.js";
import { DEFAULT_PERMISSIONS, OPERATOR_STAGES } from "./roles.js";
import { migrateMachineLogsSchema } from "./migrate-machine-logs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "enver.db");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

export function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_number TEXT NOT NULL UNIQUE,
      object TEXT NOT NULL DEFAULT '',
      client TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL DEFAULT '',
      plan_date TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '',
      priority TEXT NOT NULL DEFAULT '',
      comment TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS change_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      changes_json TEXT NOT NULL DEFAULT '[]',
      order_number TEXT NOT NULL DEFAULT '',
      item_label TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_history_entity ON change_history(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_history_created ON change_history(created_at DESC);

    CREATE TABLE IF NOT EXISTS positions (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER REFERENCES positions(id) ON DELETE CASCADE,
      order_id INTEGER REFERENCES orders(id) ON DELETE SET NULL,
      order_number TEXT NOT NULL DEFAULT '',
      object TEXT NOT NULL DEFAULT '',
      item TEXT NOT NULL DEFAULT '',
      item_type TEXT NOT NULL DEFAULT '',
      manager TEXT NOT NULL DEFAULT '',
      constructor_name TEXT NOT NULL DEFAULT '',
      cutting_status TEXT NOT NULL DEFAULT '',
      edging_status TEXT NOT NULL DEFAULT '',
      drilling_status TEXT NOT NULL DEFAULT '',
      assembly_status TEXT NOT NULL DEFAULT '',
      assembly_responsible TEXT NOT NULL DEFAULT '',
      ready_date TEXT NOT NULL DEFAULT '',
      install_date TEXT NOT NULL DEFAULT '',
      install_responsible TEXT NOT NULL DEFAULT '',
      position_status TEXT NOT NULL DEFAULT '',
      progress INTEGER NOT NULL DEFAULT 0,
      overdue_days INTEGER NOT NULL DEFAULT 0,
      problem TEXT NOT NULL DEFAULT '',
      note TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      login TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'operator',
      stages_json TEXT NOT NULL DEFAULT '[]',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS role_permissions (
      role TEXT PRIMARY KEY,
      permissions_json TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS machine_config (
      stage_key TEXT PRIMARY KEY,
      api_url TEXT NOT NULL DEFAULT '',
      api_token TEXT NOT NULL DEFAULT '',
      last_progress INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS operator_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      stage_key TEXT NOT NULL,
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      finished_at TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_operator_sessions_active
      ON operator_sessions(stage_key, finished_at);

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL DEFAULT '{}'
    );
  `);
  migrateParentIdColumn();
  migrateInstallTimeColumns();
  migrateHistoryUserColumns();
  migrateMachineLogsSchema();
  seedUsersIfEmpty();
  if (process.env.NODE_ENV !== "production") {
    repairDemoOperators();
    repairProductionHead();
  }
  seedMachineConfig();
  seedRolePermissions();
  ensureRolePermissions();
  seedDirectoriesSettingIfEmpty();
}

function seedDirectoriesSettingIfEmpty() {
  const row = db.prepare("SELECT value_json FROM app_settings WHERE key = 'directories'").get();
  if (row) return;
  db.prepare(`
    INSERT INTO app_settings (key, value_json) VALUES ('directories', @value_json)
  `).run({ value_json: JSON.stringify(DEFAULT_DIRECTORIES) });
}

function migrateHistoryUserColumns() {
  const cols = db.prepare("PRAGMA table_info(change_history)").all();
  if (!cols.some((c) => c.name === "user_id")) {
    db.exec(`ALTER TABLE change_history ADD COLUMN user_id INTEGER`);
  }
  if (!cols.some((c) => c.name === "user_name")) {
    db.exec(`ALTER TABLE change_history ADD COLUMN user_name TEXT NOT NULL DEFAULT ''`);
  }
}

function migrateParentIdColumn() {
  const cols = db.prepare("PRAGMA table_info(positions)").all();
  if (cols.some((c) => c.name === "parent_id")) return;
  db.exec(`
    ALTER TABLE positions ADD COLUMN parent_id INTEGER REFERENCES positions(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_positions_parent ON positions(parent_id);
  `);
}

function migrateInstallTimeColumns() {
  const cols = db.prepare("PRAGMA table_info(positions)").all();
  if (!cols.some((c) => c.name === "install_time_start")) {
    db.exec(`ALTER TABLE positions ADD COLUMN install_time_start TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.some((c) => c.name === "install_time_end")) {
    db.exec(`ALTER TABLE positions ADD COLUMN install_time_end TEXT NOT NULL DEFAULT ''`);
  }
  if (!cols.some((c) => c.name === "install_end_date")) {
    db.exec(`ALTER TABLE positions ADD COLUMN install_end_date TEXT NOT NULL DEFAULT ''`);
  }
  db.prepare(`
    UPDATE positions SET install_end_date = install_date
    WHERE install_date != '' AND (install_end_date IS NULL OR install_end_date = '')
  `).run();
}

function seedIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM orders").get().c;
  if (count > 0) return;

  const insertOrder = db.prepare(`
    INSERT INTO orders (id, order_number, object, client, manager, start_date, plan_date, status, priority, comment)
    VALUES (@id, @order_number, @object, @client, @manager, @start_date, @plan_date, @status, @priority, @comment)
  `);

  const orderNumberToId = new Map();

  const insertOrders = db.transaction(() => {
    for (const o of seedData.orders) {
      insertOrder.run({
        id: o.id,
        order_number: o.orderNumber,
        object: o.object,
        client: o.client,
        manager: o.manager,
        start_date: o.startDate,
        plan_date: o.planDate,
        status: o.status,
        priority: o.priority,
        comment: o.comment
      });
      orderNumberToId.set(o.orderNumber, o.id);
    }
  });
  insertOrders();

  const insertPosition = db.prepare(`
    INSERT INTO positions (
      id, parent_id, order_id, order_number, object, item, item_type, manager, constructor_name,
      cutting_status, edging_status, drilling_status, assembly_status, assembly_responsible,
      ready_date, install_date, install_end_date, install_time_start, install_time_end, install_responsible, position_status, progress, overdue_days, problem, note
    ) VALUES (
      @id, @parent_id, @order_id, @order_number, @object, @item, @item_type, @manager, @constructor_name,
      @cutting_status, @edging_status, @drilling_status, @assembly_status, @assembly_responsible,
      @ready_date, @install_date, @install_end_date, @install_time_start, @install_time_end, @install_responsible, @position_status, @progress, @overdue_days, @problem, @note
    )
  `);

  const insertPositions = db.transaction(() => {
    for (const p of seedData.positions) {
      insertPosition.run({
        id: p.id,
        parent_id: p.parentId ?? null,
        order_id: orderNumberToId.get(p.orderNumber) ?? null,
        order_number: p.orderNumber,
        object: p.object,
        item: p.item,
        item_type: p.itemType,
        manager: p.manager,
        constructor_name: p.constructor,
        cutting_status: p.cuttingStatus,
        edging_status: p.edgingStatus,
        drilling_status: p.drillingStatus,
        assembly_status: p.assemblyStatus,
        assembly_responsible: p.assemblyResponsible,
        ready_date: p.readyDate,
        install_date: p.installDate,
        install_end_date: p.installEndDate ?? p.installDate ?? "",
        install_time_start: "",
        install_time_end: "",
        install_responsible: p.installResponsible,
        position_status: p.positionStatus,
        progress: p.progress,
        overdue_days: p.overdueDays,
        problem: p.problem,
        note: p.note
      });
    }
  });
  insertPositions();

  const maxId = db.prepare("SELECT MAX(id) AS id FROM orders").get().id ?? 0;
  const seqRow = db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'orders'").get();
  if (seqRow) {
    db.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'orders'").run(maxId);
  } else {
    db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('orders', ?)").run(maxId);
  }
}

/** Завжди відновлює демо-операторів (пароль 1234, етапи) — якщо їх змінили вручну. */
function repairProductionHead() {
  const upsert = db.prepare(`
    INSERT INTO users (name, login, password_hash, role, stages_json, active)
    VALUES (@name, @login, @password_hash, @role, @stages_json, 1)
    ON CONFLICT(login) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = excluded.role,
      active = 1
  `);
  upsert.run({
    name: "Начальник виробництва",
    login: "virobnytstvo",
    password_hash: hashPassword("1234"),
    role: "production",
    stages_json: "[]"
  });
}

/** Додає права для нових ролей у вже існуючій базі. */
function ensureRolePermissions() {
  const upsert = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role, permissions_json)
    VALUES (@role, @permissions_json)
  `);
  for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
    upsert.run({ role, permissions_json: JSON.stringify(perms) });
  }
}

function repairDemoOperators() {
  const demos = [
    { name: "Оператор порізки", login: "porizka", password: "1234", role: "operator", stages: ["cutting"] },
    { name: "Оператор крайкування", login: "krayka", password: "1234", role: "operator", stages: ["edging"] },
    { name: "Оператор присадки", login: "prisadka", password: "1234", role: "operator", stages: ["drilling"] },
    { name: "Оператор збірки", login: "zbirka", password: "1234", role: "operator", stages: ["assembly"] }
  ];

  const upsert = db.prepare(`
    INSERT INTO users (name, login, password_hash, role, stages_json, active)
    VALUES (@name, @login, @password_hash, @role, @stages_json, 1)
    ON CONFLICT(login) DO UPDATE SET
      name = excluded.name,
      password_hash = excluded.password_hash,
      role = excluded.role,
      stages_json = excluded.stages_json,
      active = 1
  `);

  const tx = db.transaction(() => {
    for (const u of demos) {
      upsert.run({
        name: u.name,
        login: u.login,
        password_hash: hashPassword(u.password),
        role: u.role,
        stages_json: JSON.stringify(u.stages)
      });
    }
  });
  tx();
}

function seedUsersIfEmpty() {
  const count = db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  if (count > 0) return;

  const insert = db.prepare(`
    INSERT INTO users (name, login, password_hash, role, stages_json, active)
    VALUES (@name, @login, @password_hash, @role, @stages_json, 1)
  `);

  const defaults = [
    { name: "Адміністратор", login: "admin", password: "admin", role: "admin", stages: [] },
    { name: "Начальник виробництва", login: "virobnytstvo", password: "1234", role: "production", stages: [] },
    { name: "Оператор порізки", login: "porizka", password: "1234", role: "operator", stages: ["cutting"] },
    { name: "Оператор крайкування", login: "krayka", password: "1234", role: "operator", stages: ["edging"] },
    { name: "Оператор присадки", login: "prisadka", password: "1234", role: "operator", stages: ["drilling"] },
    { name: "Оператор збірки", login: "zbirka", password: "1234", role: "operator", stages: ["assembly"] }
  ];

  const tx = db.transaction(() => {
    for (const u of defaults) {
      insert.run({
        name: u.name,
        login: u.login,
        password_hash: hashPassword(u.password),
        role: u.role,
        stages_json: JSON.stringify(u.stages)
      });
    }
  });
  tx();
}

function seedMachineConfig() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO machine_config (stage_key, api_url, api_token)
    VALUES (@stage_key, '', '')
  `);
  const tx = db.transaction(() => {
    for (const stage of OPERATOR_STAGES) {
      insert.run({ stage_key: stage.key });
    }
  });
  tx();
}

function seedRolePermissions() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO role_permissions (role, permissions_json)
    VALUES (@role, @permissions_json)
  `);
  const tx = db.transaction(() => {
    for (const [role, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
      insert.run({ role, permissions_json: JSON.stringify(perms) });
    }
  });
  tx();
}

function migrateAuthTables() {
  const names = new Set(
    db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((r) => r.name)
  );

  if (!names.has("users")) {
    db.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        login TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'operator',
        stages_json TEXT NOT NULL DEFAULT '[]',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seedUsersIfEmpty();
    repairDemoOperators();
  }

  if (!names.has("role_permissions")) {
    db.exec(`
      CREATE TABLE role_permissions (
        role TEXT PRIMARY KEY,
        permissions_json TEXT NOT NULL DEFAULT '{}'
      );
    `);
    seedRolePermissions();
  }

  if (!names.has("machine_config")) {
    db.exec(`
      CREATE TABLE machine_config (
        stage_key TEXT PRIMARY KEY,
        api_url TEXT NOT NULL DEFAULT '',
        api_token TEXT NOT NULL DEFAULT '',
        last_progress INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    seedMachineConfig();
  }

  if (!names.has("operator_sessions")) {
    db.exec(`
      CREATE TABLE operator_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
        stage_key TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        finished_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operator_sessions_active
        ON operator_sessions(stage_key, finished_at);
    `);
  } else {
    seedMachineConfig();
    seedRolePermissions();
  }
}

export function bootstrapDatabase() {
  initSchema();
  migrateAuthTables();
  seedIfEmpty();
  migrateToUkrainian();
}

bootstrapDatabase();
