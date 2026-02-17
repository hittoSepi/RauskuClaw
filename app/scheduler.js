const crypto = require("crypto");
const { CronExpressionParser } = require("cron-parser");

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(s, fallback) {
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

function safeJsonStringify(v) {
  return JSON.stringify(v ?? null);
}

function clampBatchSize(value, fallback = 5) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(100, Math.floor(n));
}

function nextRunFrom(nowIsoValue, intervalSec) {
  const baseMs = Date.parse(nowIsoValue);
  const deltaMs = Math.max(1, Number(intervalSec) || 1) * 1000;
  return new Date(baseMs + deltaMs).toISOString();
}

function normalizeCron(expr) {
  return String(expr || "").trim();
}

function validateCronExpression(expr, cronTimezone = "UTC") {
  const cronExpr = normalizeCron(expr);
  if (!cronExpr) {
    throw new Error("Cron expression is empty.");
  }
  CronExpressionParser.parse(cronExpr, {
    currentDate: new Date(),
    tz: String(cronTimezone || "UTC")
  });
  return cronExpr;
}

function nextCronRunFrom(baseIso, expr, cronTimezone = "UTC") {
  const cronExpr = validateCronExpression(expr, cronTimezone);
  const it = CronExpressionParser.parse(cronExpr, {
    currentDate: new Date(baseIso),
    tz: String(cronTimezone || "UTC")
  });
  const next = it.next();
  return next.toISOString();
}

function computeNextRunAtForScheduleRow(row, claimedAtIso, cronTimezone = "UTC") {
  const cronExpr = normalizeCron(row?.cron_expr);
  if (cronExpr) return nextCronRunFrom(claimedAtIso, cronExpr, cronTimezone);
  return nextRunFrom(claimedAtIso, row?.interval_sec);
}

function rowToSchedule(row) {
  if (!row) return null;
  const cronExpr = normalizeCron(row.cron_expr) || null;
  return {
    id: row.id,
    name: row.name || null,
    enabled: !!row.enabled,
    type: row.type,
    input: safeJsonParse(row.input_json, null),
    priority: row.priority,
    timeout_sec: row.timeout_sec,
    max_attempts: row.max_attempts,
    tags: safeJsonParse(row.tags_json, []),
    interval_sec: cronExpr ? null : row.interval_sec,
    cron: cronExpr,
    next_run_at: row.next_run_at,
    last_run_at: row.last_run_at || null,
    last_job_id: row.last_job_id || null,
    last_error: safeJsonParse(row.last_error_json, null),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function createClaimOneTx(db) {
  const selectStmt = db.prepare(`
    SELECT
      id, name, enabled, type, input_json, priority, timeout_sec, max_attempts, tags_json,
      interval_sec, cron_expr, next_run_at, last_run_at, last_job_id, last_error_json, created_at, updated_at
    FROM job_schedules
    WHERE enabled = 1
      AND next_run_at <= ?
    ORDER BY next_run_at ASC
    LIMIT 1
  `);
  const updateStmt = db.prepare(`
    UPDATE job_schedules
    SET last_run_at = ?,
        next_run_at = ?,
        updated_at = ?
    WHERE id = ?
      AND enabled = 1
      AND next_run_at = ?
  `);
  const updateInvalidStmt = db.prepare(`
    UPDATE job_schedules
    SET last_error_json = ?,
        next_run_at = ?,
        updated_at = ?
    WHERE id = ?
      AND enabled = 1
      AND next_run_at = ?
  `);

  return db.transaction((claimedAtIso, cronTimezone) => {
    const row = selectStmt.get(claimedAtIso);
    if (!row) return null;
    let nextRunAt;
    try {
      nextRunAt = computeNextRunAtForScheduleRow(row, claimedAtIso, cronTimezone);
    } catch (e) {
      const retryAt = nextRunFrom(claimedAtIso, 60);
      const err = {
        code: "SCHEDULE_CRON_INVALID",
        message: String(e?.message || e),
        at: nowIso()
      };
      updateInvalidStmt.run(
        safeJsonStringify(err),
        retryAt,
        claimedAtIso,
        row.id,
        row.next_run_at
      );
      return null;
    }
    const u = updateStmt.run(claimedAtIso, nextRunAt, claimedAtIso, row.id, row.next_run_at);
    if (!u || u.changes !== 1) return null;
    return { ...row, last_run_at: claimedAtIso, next_run_at: nextRunAt, updated_at: claimedAtIso };
  });
}

function dispatchDueSchedules(db, opts = {}) {
  const batchSize = clampBatchSize(opts.batchSize, 5);
  const claimedAtIso = String(opts.nowIsoValue || nowIso());
  const cronTimezone = String(opts.cronTimezone || "UTC");
  const onDispatch = typeof opts.onDispatch === "function" ? opts.onDispatch : null;
  const onError = typeof opts.onError === "function" ? opts.onError : null;

  const claimOne = createClaimOneTx(db);
  const insertJobStmt = db.prepare(`
    INSERT INTO jobs (
      id, type, status, priority, timeout_sec, max_attempts, attempts,
      callback_url, tags_json, input_json, created_at, updated_at
    )
    VALUES (?, ?, 'queued', ?, ?, ?, 0, NULL, ?, ?, ?, ?)
  `);
  const updateScheduleSuccessStmt = db.prepare(`
    UPDATE job_schedules
    SET last_job_id = ?,
        last_error_json = NULL,
        updated_at = ?
    WHERE id = ?
  `);
  const updateScheduleErrorStmt = db.prepare(`
    UPDATE job_schedules
    SET last_error_json = ?,
        next_run_at = ?,
        updated_at = ?
    WHERE id = ?
  `);
  const typeLookupStmt = db.prepare(`
    SELECT name, enabled, default_timeout_sec, default_max_attempts
    FROM job_types
    WHERE name = ?
  `);

  let claimed = 0;
  let dispatched = 0;
  let errors = 0;
  const jobs = [];

  for (let i = 0; i < batchSize; i += 1) {
    const schedule = claimOne(claimedAtIso, cronTimezone);
    if (!schedule) break;
    claimed += 1;

    try {
      const typeRow = typeLookupStmt.get(schedule.type);
      if (!typeRow || !typeRow.enabled) {
        const err = {
          code: "SCHEDULE_TYPE_UNAVAILABLE",
          message: `Scheduled type is unknown or disabled: ${schedule.type}`,
          at: nowIso()
        };
        updateScheduleErrorStmt.run(safeJsonStringify(err), nextRunFrom(claimedAtIso, 60), nowIso(), schedule.id);
        errors += 1;
        if (onError) onError(schedule, err);
        continue;
      }

      const createdAt = nowIso();
      const jobId = crypto.randomUUID();
      const timeoutSec = Number.isInteger(schedule.timeout_sec)
        ? schedule.timeout_sec
        : (typeRow.default_timeout_sec || 120);
      const maxAttempts = Number.isInteger(schedule.max_attempts)
        ? schedule.max_attempts
        : (typeRow.default_max_attempts || 1);

      insertJobStmt.run(
        jobId,
        schedule.type,
        schedule.priority,
        timeoutSec,
        maxAttempts,
        schedule.tags_json || "[]",
        schedule.input_json || "null",
        createdAt,
        createdAt
      );
      updateScheduleSuccessStmt.run(jobId, createdAt, schedule.id);

      const meta = {
        schedule_id: schedule.id,
        schedule_name: schedule.name || null,
        schedule_next_run_at: schedule.next_run_at
      };
      jobs.push({ job_id: jobId, type: schedule.type, ...meta });
      dispatched += 1;
      if (onDispatch) onDispatch(jobId, schedule, meta);
    } catch (e) {
      const err = {
        code: "SCHEDULE_DISPATCH_ERROR",
        message: String(e?.message || e),
        at: nowIso()
      };
      updateScheduleErrorStmt.run(safeJsonStringify(err), nextRunFrom(claimedAtIso, 60), nowIso(), schedule.id);
      errors += 1;
      if (onError) onError(schedule, err);
    }
  }

  return { claimed, dispatched, errors, jobs };
}

module.exports = {
  rowToSchedule,
  dispatchDueSchedules,
  nextRunFrom,
  clampBatchSize,
  validateCronExpression,
  nextCronRunFrom,
  computeNextRunAtForScheduleRow
};
