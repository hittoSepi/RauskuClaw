const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dbPath = process.env.DB_PATH || path.join(__dirname, "openclaw.sqlite");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
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
  `);
}

migrate();

// Seed default types if empty
const now = new Date().toISOString();
const c = db.prepare(`SELECT COUNT(*) AS c FROM job_types`).get().c;
if (c === 0) {
  const ins = db.prepare(`
    INSERT INTO job_types (name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at)
    VALUES (?, 1, ?, ?, ?, ?, ?)
  `);

  ins.run("report.generate", "builtin:report.generate", 120, 1, now, now);
  ins.run("deploy.run", "builtin:deploy.run", 300, 1, now, now);
  ins.run("data.fetch", "builtin:data.fetch", 60, 1, now, now);
  ins.run("code.component.generate", "builtin:code.component.generate", 120, 1, now, now);
  ins.run("design.frontpage.layout", "builtin:design.frontpage.layout", 120, 1, now, now);
}

module.exports = { db, dbPath };
