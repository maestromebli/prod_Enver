import { db } from "./db.js";

/** Міграції для логів станка, зіставлення з задачами та KPI-зрізів. */
export function migrateMachineLogsSchema() {
  migrateMachineConfigColumns();
  migrateMachineLogTables();
  migrateKpiSnapshots();
}

function migrateMachineConfigColumns() {
  const cols = db.prepare("PRAGMA table_info(machine_config)").all();
  const names = new Set(cols.map((c) => c.name));

  const additions = [
    ["log_path", "TEXT NOT NULL DEFAULT ''"],
    ["log_encoding", "TEXT NOT NULL DEFAULT 'utf-8'"],
    ["parser_profile", "TEXT NOT NULL DEFAULT 'generic'"],
    ["watch_enabled", "INTEGER NOT NULL DEFAULT 0"],
    ["last_log_offset", "INTEGER NOT NULL DEFAULT 0"],
    ["last_log_inode", "TEXT NOT NULL DEFAULT ''"],
    ["ai_matching_enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["last_match_position_id", "INTEGER"],
    ["last_match_confidence", "REAL NOT NULL DEFAULT 0"],
    ["last_match_summary", "TEXT NOT NULL DEFAULT ''"],
    ["last_log_event_time", "TEXT NOT NULL DEFAULT ''"]
  ];

  for (const [name, ddl] of additions) {
    if (!names.has(name)) {
      db.exec(`ALTER TABLE machine_config ADD COLUMN ${name} ${ddl}`);
    }
  }
}

function migrateMachineLogTables() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS machine_log_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_key TEXT NOT NULL,
      raw_line TEXT NOT NULL,
      parsed_json TEXT NOT NULL DEFAULT '{}',
      event_type TEXT NOT NULL DEFAULT 'unknown',
      progress INTEGER,
      job_ref TEXT NOT NULL DEFAULT '',
      program_name TEXT NOT NULL DEFAULT '',
      logged_at TEXT,
      ingested_at TEXT NOT NULL DEFAULT (datetime('now')),
      file_offset INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_machine_log_stage_time
      ON machine_log_events(stage_key, ingested_at DESC);

    CREATE TABLE IF NOT EXISTS machine_task_matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stage_key TEXT NOT NULL,
      log_event_id INTEGER NOT NULL REFERENCES machine_log_events(id) ON DELETE CASCADE,
      position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE CASCADE,
      operator_session_id INTEGER REFERENCES operator_sessions(id) ON DELETE SET NULL,
      confidence REAL NOT NULL DEFAULT 0,
      method TEXT NOT NULL DEFAULT 'heuristic',
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'suggested',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      confirmed_at TEXT,
      confirmed_by INTEGER REFERENCES users(id)
    );

    CREATE INDEX IF NOT EXISTS idx_machine_match_stage
      ON machine_task_matches(stage_key, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_machine_match_position
      ON machine_task_matches(position_id, created_at DESC);
  `);
}

function migrateKpiSnapshots() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kpi_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      snapshot_date TEXT NOT NULL,
      active_orders INTEGER NOT NULL DEFAULT 0,
      in_production INTEGER NOT NULL DEFAULT 0,
      in_work INTEGER NOT NULL DEFAULT 0,
      overdue_count INTEGER NOT NULL DEFAULT 0,
      ready_install INTEGER NOT NULL DEFAULT 0,
      installs INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(snapshot_date)
    );
  `);
}
