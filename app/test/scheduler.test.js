const test = require("node:test");
const assert = require("node:assert/strict");
const Database = require("better-sqlite3");
const { dispatchDueSchedules, rowToSchedule, nextCronRunFrom } = require("../scheduler");

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      queue TEXT NOT NULL DEFAULT 'default',
      status TEXT NOT NULL,
      priority INTEGER NOT NULL,
      timeout_sec INTEGER NOT NULL,
      max_attempts INTEGER NOT NULL,
      attempts INTEGER NOT NULL,
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

    CREATE TABLE job_types (
      name TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      handler TEXT NOT NULL,
      default_timeout_sec INTEGER NOT NULL DEFAULT 120,
      default_max_attempts INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE job_schedules (
      id TEXT PRIMARY KEY,
      name TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      type TEXT NOT NULL,
      queue TEXT NOT NULL DEFAULT 'default',
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
  `);
  return db;
}

function insertType(db, name, enabled = 1) {
  const now = "2026-02-17T00:00:00.000Z";
  db.prepare(`
    INSERT INTO job_types (name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at)
    VALUES (?, ?, ?, 120, 1, ?, ?)
  `).run(name, enabled, "builtin:test.handler", now, now);
}

function insertSchedule(db, row) {
  db.prepare(`
    INSERT INTO job_schedules (
      id, name, enabled, type, queue, input_json, priority, timeout_sec, max_attempts, tags_json,
      interval_sec, cron_expr, next_run_at, last_run_at, last_job_id, last_error_json, created_at, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.id,
    row.name || null,
    row.enabled == null ? 1 : row.enabled,
    row.type,
    row.queue || "default",
    JSON.stringify(row.input ?? null),
    row.priority == null ? 5 : row.priority,
    row.timeout_sec == null ? 120 : row.timeout_sec,
    row.max_attempts == null ? 1 : row.max_attempts,
    JSON.stringify(row.tags || []),
    row.interval_sec == null ? 0 : row.interval_sec,
    row.cron_expr || null,
    row.next_run_at,
    row.last_run_at || null,
    row.last_job_id || null,
    row.last_error_json || null,
    row.created_at,
    row.updated_at
  );
}

test("dispatchDueSchedules enqueues queued job from due schedule", () => {
  const db = setupDb();
  const now = "2026-02-17T01:00:00.000Z";
  insertType(db, "report.generate", 1);
  insertSchedule(db, {
    id: "s1",
    name: "report-every-minute",
    type: "report.generate",
    queue: "alpha",
    input: { hello: "world" },
    tags: ["sched"],
    interval_sec: 60,
    cron_expr: null,
    next_run_at: "2026-02-17T00:59:00.000Z",
    created_at: "2026-02-17T00:00:00.000Z",
    updated_at: "2026-02-17T00:00:00.000Z"
  });

  const out = dispatchDueSchedules(db, { batchSize: 5, nowIsoValue: now });
  assert.equal(out.claimed, 1);
  assert.equal(out.dispatched, 1);
  assert.equal(out.errors, 0);
  assert.equal(out.jobs.length, 1);

  const job = db.prepare(`SELECT * FROM jobs LIMIT 1`).get();
  assert.equal(job.status, "queued");
  assert.equal(job.type, "report.generate");
  assert.equal(job.queue, "alpha");

  const scheduleRow = db.prepare(`SELECT * FROM job_schedules WHERE id = 's1'`).get();
  assert.equal(typeof scheduleRow.last_job_id, "string");
  assert.ok(scheduleRow.last_job_id.length > 10);
  assert.equal(scheduleRow.last_error_json, null);
  assert.notEqual(scheduleRow.next_run_at, "2026-02-17T00:59:00.000Z");
});

test("dispatchDueSchedules records schedule error when target type is disabled or missing", () => {
  const db = setupDb();
  const now = "2026-02-17T01:00:00.000Z";
  insertType(db, "report.generate", 0);
  insertSchedule(db, {
    id: "s2",
    type: "report.generate",
    interval_sec: 60,
    cron_expr: null,
    next_run_at: "2026-02-17T00:59:00.000Z",
    created_at: "2026-02-17T00:00:00.000Z",
    updated_at: "2026-02-17T00:00:00.000Z"
  });

  const out = dispatchDueSchedules(db, { batchSize: 5, nowIsoValue: now });
  assert.equal(out.claimed, 1);
  assert.equal(out.dispatched, 0);
  assert.equal(out.errors, 1);

  const jobsCount = db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n;
  assert.equal(jobsCount, 0);

  const scheduleRow = db.prepare(`SELECT * FROM job_schedules WHERE id = 's2'`).get();
  const err = JSON.parse(scheduleRow.last_error_json);
  assert.equal(err.code, "SCHEDULE_TYPE_UNAVAILABLE");
});

test("dispatchDueSchedules respects batch size and rowToSchedule normalizes JSON fields", () => {
  const db = setupDb();
  const now = "2026-02-17T01:00:00.000Z";
  insertType(db, "report.generate", 1);
  insertSchedule(db, {
    id: "s3",
    type: "report.generate",
    interval_sec: 60,
    cron_expr: null,
    next_run_at: "2026-02-17T00:59:00.000Z",
    created_at: "2026-02-17T00:00:00.000Z",
    updated_at: "2026-02-17T00:00:00.000Z",
    tags: ["a"]
  });
  insertSchedule(db, {
    id: "s4",
    type: "report.generate",
    interval_sec: 60,
    cron_expr: null,
    next_run_at: "2026-02-17T00:58:00.000Z",
    created_at: "2026-02-17T00:00:00.000Z",
    updated_at: "2026-02-17T00:00:00.000Z",
    tags: ["b"]
  });

  const out = dispatchDueSchedules(db, { batchSize: 1, nowIsoValue: now });
  assert.equal(out.claimed, 1);
  assert.equal(out.dispatched, 1);
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n, 1);

  const raw = db.prepare(`SELECT * FROM job_schedules WHERE id = 's3'`).get();
  const mapped = rowToSchedule(raw);
  assert.equal(Array.isArray(mapped.tags), true);
  assert.equal(typeof mapped.input, "object");
});

test("dispatchDueSchedules supports cron cadence", () => {
  const db = setupDb();
  const now = "2026-02-17T01:00:00.000Z";
  insertType(db, "report.generate", 1);
  insertSchedule(db, {
    id: "s5",
    type: "report.generate",
    interval_sec: 0,
    cron_expr: "*/2 * * * *",
    next_run_at: "2026-02-17T00:59:00.000Z",
    created_at: "2026-02-17T00:00:00.000Z",
    updated_at: "2026-02-17T00:00:00.000Z"
  });

  const out = dispatchDueSchedules(db, { batchSize: 5, nowIsoValue: now, cronTimezone: "UTC" });
  assert.equal(out.claimed, 1);
  assert.equal(out.dispatched, 1);
  assert.equal(out.errors, 0);

  const scheduleRow = db.prepare(`SELECT * FROM job_schedules WHERE id = 's5'`).get();
  const expected = nextCronRunFrom(now, "*/2 * * * *", "UTC");
  assert.equal(scheduleRow.next_run_at, expected);

  const mapped = rowToSchedule(scheduleRow);
  assert.equal(mapped.cron, "*/2 * * * *");
  assert.equal(mapped.interval_sec, null);
});
