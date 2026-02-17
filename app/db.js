const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const { envOrConfig } = require("./config");
const { getMemoryVectorSettings } = require("./memory/settings");
const { initVectorStore } = require("./memory/vector_store");

const dbPath = String(envOrConfig("DB_PATH", "database.path", path.join(__dirname, "rauskuclaw.sqlite")));
const journalMode = String(envOrConfig("DB_JOURNAL_MODE", "database.mode", "WAL")).toUpperCase();
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma(`journal_mode = ${journalMode}`);
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      queue TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 5,
      timeout_sec INTEGER NOT NULL DEFAULT 120,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      attempts INTEGER NOT NULL DEFAULT 0,
      callback_url TEXT,
      tags_json TEXT,
      input_json TEXT NOT NULL,
      result_json TEXT,
      error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      locked_at TEXT,
      locked_by TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_jobs_status_created ON jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_jobs_type_created ON jobs(type, created_at);

    CREATE TABLE IF NOT EXISTS job_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      ts TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      meta_json TEXT,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_job_logs_job_id_ts ON job_logs(job_id, ts);

    CREATE TABLE IF NOT EXISTS idempotency_keys (
      key TEXT PRIMARY KEY,
      request_hash TEXT NOT NULL,
      job_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(job_id) REFERENCES jobs(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS job_types (
      name TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      handler TEXT NOT NULL,
      default_timeout_sec INTEGER NOT NULL DEFAULT 120,
      default_max_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_types_enabled ON job_types(enabled);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      tags_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      expires_at TEXT,
      embedding_status TEXT NOT NULL DEFAULT 'pending',
      embedding_error_json TEXT,
      embedded_at TEXT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_memories_scope_key ON memories(scope, key);
    CREATE INDEX IF NOT EXISTS idx_memories_scope_updated ON memories(scope, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_memories_expires_at ON memories(expires_at);

    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY,
      embedding_blob BLOB NOT NULL,
      dimension INTEGER NOT NULL,
      model TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memory_vectors_updated_at ON memory_vectors(updated_at);

    CREATE TABLE IF NOT EXISTS job_schedules (
      id TEXT PRIMARY KEY,
      name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      input_json TEXT,
      priority INTEGER NOT NULL DEFAULT 5,
      timeout_sec INTEGER NOT NULL DEFAULT 120,
      max_attempts INTEGER NOT NULL DEFAULT 1,
      tags_json TEXT,
      interval_sec INTEGER NOT NULL,
      cron_expr TEXT,
      next_run_at TEXT NOT NULL,
      last_run_at TEXT,
      last_job_id TEXT,
      last_error_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_job_schedules_enabled_next_run_at
      ON job_schedules(enabled, next_run_at);
    CREATE INDEX IF NOT EXISTS idx_job_schedules_type
      ON job_schedules(type);

    CREATE TABLE IF NOT EXISTS ui_prefs (
      scope TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS metrics_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL,
      source TEXT NOT NULL,
      name TEXT NOT NULL,
      value REAL NOT NULL DEFAULT 1,
      labels_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_metrics_events_ts ON metrics_events(ts);
    CREATE INDEX IF NOT EXISTS idx_metrics_events_name_ts ON metrics_events(name, ts);
  `);

  ensureMemoryColumns();
  ensureScheduleColumns();
  ensureJobsQueueColumn();
  ensureJobsQueueIndex();
  db.exec("CREATE INDEX IF NOT EXISTS idx_memories_scope_embedding_status ON memories(scope, embedding_status)");
}

migrate();

function hasColumn(table, column) {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r && r.name === column);
}

function ensureMemoryColumns() {
  if (!hasColumn("memories", "embedding_status")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding_status TEXT NOT NULL DEFAULT 'pending'");
  }
  if (!hasColumn("memories", "embedding_error_json")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedding_error_json TEXT");
  }
  if (!hasColumn("memories", "embedded_at")) {
    db.exec("ALTER TABLE memories ADD COLUMN embedded_at TEXT");
  }
}

function ensureScheduleColumns() {
  if (!hasColumn("job_schedules", "cron_expr")) {
    db.exec("ALTER TABLE job_schedules ADD COLUMN cron_expr TEXT");
  }
}

function ensureJobsQueueColumn() {
  if (!hasColumn("jobs", "queue")) {
    db.exec("ALTER TABLE jobs ADD COLUMN queue TEXT NOT NULL DEFAULT 'default'");
  }
}

function ensureJobsQueueIndex() {
  db.exec("DROP INDEX IF EXISTS idx_jobs_status_created");
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_status_queue_created ON jobs(status, queue, created_at)");
}

const memoryVectorSettings = getMemoryVectorSettings();
initVectorStore(db, memoryVectorSettings);

// Ensure default types exist (including newer types on older DBs).
const now = new Date().toISOString();
const ins = db.prepare(`
  INSERT OR IGNORE INTO job_types
  (name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);
const defaults = [
  ["report.generate", 1, "builtin:report.generate", 120, 1],
  ["deploy.run", 1, "builtin:deploy.run", 300, 1],
  ["data.fetch", 1, "builtin:data.fetch", 60, 1],
  ["code.component.generate", 1, "builtin:code.component.generate", 120, 1],
  ["design.frontpage.layout", 1, "builtin:design.frontpage.layout", 120, 1],
  ["system.memory.embed.sync", 1, "builtin:memory.embed.sync", 60, 3],
  // Disabled by default until Codex CLI settings/login are configured.
  ["codex.chat.generate", 0, "builtin:provider.codex.oss.chat", 180, 1],
  // Disabled by default until provider creds/guardrails are configured.
  ["ai.chat.generate", 0, "builtin:provider.openai.chat", 180, 1]
];
for (const [name, enabled, handler, timeoutSec, maxAttempts] of defaults) {
  ins.run(name, enabled, handler, timeoutSec, maxAttempts, now, now);
}

// Migrate codex type to Codex CLI handler if it was switched to OpenAI.
db.prepare(`
  UPDATE job_types
  SET handler = ?, updated_at = ?
  WHERE name = ? AND handler = ?
`).run(
  "builtin:provider.codex.oss.chat",
  now,
  "codex.chat.generate",
  "builtin:provider.openai.chat"
);

module.exports = { db, dbPath };
