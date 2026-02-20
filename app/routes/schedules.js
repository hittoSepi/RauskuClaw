const crypto = require("crypto");
const { rowToSchedule, validateCronExpression, nextCronRunFrom } = require("../scheduler");

module.exports = function registerSchedulesRoutes(app, deps) {
  const {
    auth,
    db,
    nowIso,
    badRequest,
    queueNamePattern,
    authQueueAllowlist,
    getAuthorizedScheduleRow,
    normalizeTypeName,
    normalizeQueueName,
    parseOptionalInt,
    hasOwn,
    nowPlusSeconds,
    schedulerCronTimezone
  } = deps;

  // GET /v1/schedules
  app.get("/v1/schedules", auth, (req, res) => {
    const enabledQ = req.query.enabled == null ? null : String(req.query.enabled);
    const typeQ = req.query.type == null ? "" : normalizeTypeName(req.query.type);
    const queueQ = req.query.queue == null ? "" : normalizeQueueName(req.query.queue);
    const limit = Math.min(parseInt(req.query.limit || "100", 10) || 100, 500);
    const allowedQueues = authQueueAllowlist(req.auth);

    if (queueQ && !queueNamePattern.test(queueQ)) {
      return badRequest(res, "VALIDATION_ERROR", "'queue' must match ^[a-z0-9._:-]{1,80}$");
    }

    if (queueQ && allowedQueues && !allowedQueues.includes(queueQ)) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: `Queue '${queueQ}' is not allowed for this API key.`,
          details: { allowed_queues: allowedQueues }
        }
      });
    }

    const where = [];
    const params = [];

    if (enabledQ === "1" || enabledQ === "true") {
      where.push("enabled = 1");
    } else if (enabledQ === "0" || enabledQ === "false") {
      where.push("enabled = 0");
    } else if (enabledQ != null && enabledQ !== "") {
      return badRequest(res, "VALIDATION_ERROR", "'enabled' must be one of: 1, 0, true, false");
    }

    if (typeQ) {
      where.push("type = ?");
      params.push(typeQ);
    }
    if (queueQ) {
      where.push("queue = ?");
      params.push(queueQ);
    }
    if (allowedQueues) {
      const queuePlaceholders = allowedQueues.map(() => "?").join(", ");
      where.push(`queue IN (${queuePlaceholders})`);
      params.push(...allowedQueues);
    }

    const rows = db.prepare(`
      SELECT
        id, name, enabled, type, queue, input_json, priority, timeout_sec, max_attempts, tags_json,
        interval_sec, cron_expr, next_run_at, last_run_at, last_job_id, last_error_json, created_at, updated_at
      FROM job_schedules
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY created_at DESC
      LIMIT ?
    `).all(...params, limit);

    return res.json({
      ok: true,
      schedules: rows.map(rowToSchedule),
      count: rows.length
    });
  });

  // GET /v1/schedules/:id
  app.get("/v1/schedules/:id", auth, (req, res) => {
    const row = getAuthorizedScheduleRow(req.params.id, req.auth);
    if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Schedule not found" } });
    return res.json({ ok: true, schedule: rowToSchedule(row) });
  });

  // POST /v1/schedules
  app.post("/v1/schedules", auth, (req, res) => {
    const body = req.body ?? {};
    const type = normalizeTypeName(body.type);
    const queue = normalizeQueueName(body.queue) || "default";
    const name = String(body.name || "").trim();
    const inputObj = body.input ?? null;
    const enabled = body.enabled == null ? 1 : (body.enabled ? 1 : 0);
    const tagsArr = Array.isArray(body.tags) ? body.tags.slice(0, 20).map(String) : [];
    const now = nowIso();

    if (!type) {
      return badRequest(res, "VALIDATION_ERROR", "Missing/invalid 'type'");
    }
    if (!/^[a-z0-9._-]{3,80}$/i.test(type)) {
      return badRequest(res, "VALIDATION_ERROR", "'type' must match ^[a-z0-9._-]{3,80}$");
    }
    if (!queueNamePattern.test(queue)) {
      return badRequest(res, "VALIDATION_ERROR", "'queue' must match ^[a-z0-9._:-]{1,80}$");
    }
    const allowedQueues = authQueueAllowlist(req.auth);
    if (allowedQueues && !allowedQueues.includes(queue)) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: `Queue '${queue}' is not allowed for this API key.`,
          details: { allowed_queues: allowedQueues }
        }
      });
    }
    if (name && name.length > 120) {
      return badRequest(res, "VALIDATION_ERROR", "'name' must be at most 120 characters");
    }

    let intervalSec;
    let startInSec;
    let priority;
    let timeoutSec;
    let maxAttempts;
    let cronExpr = null;
    try {
      const hasInterval = hasOwn(body, "interval_sec");
      const hasCron = hasOwn(body, "cron");
      if (hasInterval === hasCron) {
        return badRequest(res, "VALIDATION_ERROR", "Provide exactly one cadence: 'interval_sec' or 'cron'");
      }
      if (hasInterval) {
        intervalSec = parseOptionalInt(body.interval_sec, { min: 5, max: 86_400, field: "interval_sec" });
        if (intervalSec == null) {
          return badRequest(res, "VALIDATION_ERROR", "Missing 'interval_sec'");
        }
      } else {
        cronExpr = validateCronExpression(String(body.cron || ""), schedulerCronTimezone);
        intervalSec = 0;
      }
      startInSec = parseOptionalInt(body.start_in_sec, { min: 0, max: 86_400, field: "start_in_sec" }) ?? 0;
      priority = parseOptionalInt(body.priority, { min: 0, max: 10, field: "priority" }) ?? 5;
      timeoutSec = parseOptionalInt(body.timeout_sec, { min: 1, max: 3600, field: "timeout_sec" });
      maxAttempts = parseOptionalInt(body.max_attempts, { min: 1, max: 10, field: "max_attempts" });
    } catch (e) {
      return badRequest(res, "VALIDATION_ERROR", e.message);
    }

    const typeRow = db.prepare(`
      SELECT name, enabled, default_timeout_sec, default_max_attempts
      FROM job_types
      WHERE name = ?
    `).get(type);
    if (!typeRow || !typeRow.enabled) {
      return badRequest(res, "VALIDATION_ERROR", "Unknown or disabled 'type'");
    }

    const id = crypto.randomUUID();
    const baseNextRunAt = nowPlusSeconds(startInSec);
    const nextRunAt = cronExpr
      ? nextCronRunFrom(baseNextRunAt, cronExpr, schedulerCronTimezone)
      : baseNextRunAt;

    db.prepare(`
      INSERT INTO job_schedules (
        id, name, enabled, type, queue, input_json, priority, timeout_sec, max_attempts, tags_json,
        interval_sec, cron_expr, next_run_at, last_run_at, last_job_id, last_error_json, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      name || null,
      enabled,
      type,
      queue,
      JSON.stringify(inputObj),
      priority,
      timeoutSec ?? typeRow.default_timeout_sec ?? 120,
      maxAttempts ?? typeRow.default_max_attempts ?? 1,
      JSON.stringify(tagsArr),
      intervalSec,
      cronExpr,
      nextRunAt,
      now,
      now
    );

    const row = db.prepare(`
      SELECT
        id, name, enabled, type, queue, input_json, priority, timeout_sec, max_attempts, tags_json,
        interval_sec, cron_expr, next_run_at, last_run_at, last_job_id, last_error_json, created_at, updated_at
      FROM job_schedules
      WHERE id = ?
    `).get(id);

    return res.status(201).json({ ok: true, schedule: rowToSchedule(row) });
  });

  // PATCH /v1/schedules/:id
  app.patch("/v1/schedules/:id", auth, (req, res) => {
    const existing = getAuthorizedScheduleRow(req.params.id, req.auth);
    if (!existing) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Schedule not found" } });
    }

    const body = req.body ?? {};
    const patch = {};
    const now = nowIso();

    if (Object.prototype.hasOwnProperty.call(body, "name")) {
      const name = String(body.name || "").trim();
      if (name && name.length > 120) {
        return badRequest(res, "VALIDATION_ERROR", "'name' must be at most 120 characters");
      }
      patch.name = name || null;
    }

    if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
      patch.enabled = body.enabled ? 1 : 0;
    }

    if (Object.prototype.hasOwnProperty.call(body, "type")) {
      const type = normalizeTypeName(body.type);
      if (!type || !/^[a-z0-9._-]{3,80}$/i.test(type)) {
        return badRequest(res, "VALIDATION_ERROR", "'type' must match ^[a-z0-9._-]{3,80}$");
      }
      const typeRow = db.prepare(`SELECT name, enabled FROM job_types WHERE name = ?`).get(type);
      if (!typeRow || !typeRow.enabled) {
        return badRequest(res, "VALIDATION_ERROR", "Unknown or disabled 'type'");
      }
      patch.type = type;
    }
    if (Object.prototype.hasOwnProperty.call(body, "queue")) {
      const queue = normalizeQueueName(body.queue) || "default";
      if (!queueNamePattern.test(queue)) {
        return badRequest(res, "VALIDATION_ERROR", "'queue' must match ^[a-z0-9._:-]{1,80}$");
      }
      const allowedQueues = authQueueAllowlist(req.auth);
      if (allowedQueues && !allowedQueues.includes(queue)) {
        return res.status(403).json({
          ok: false,
          error: {
            code: "FORBIDDEN",
            message: `Queue '${queue}' is not allowed for this API key.`,
            details: { allowed_queues: allowedQueues }
          }
        });
      }
      patch.queue = queue;
    }

    let startInSecForNextRun;
    const hasInterval = hasOwn(body, "interval_sec");
    const hasCron = hasOwn(body, "cron");
    if (hasInterval && hasCron) {
      return badRequest(res, "VALIDATION_ERROR", "Provide only one cadence field: 'interval_sec' or 'cron'");
    }

    try {
      if (hasInterval) {
        const n = parseOptionalInt(body.interval_sec, { min: 5, max: 86_400, field: "interval_sec" });
        if (n == null) return badRequest(res, "VALIDATION_ERROR", "'interval_sec' is required when provided");
        patch.interval_sec = n;
        patch.cron_expr = null;
        if (String(existing.cron_expr || "").trim()) {
          patch.next_run_at = now;
        }
      }
      if (hasCron) {
        const cronExpr = validateCronExpression(String(body.cron || ""), schedulerCronTimezone);
        patch.cron_expr = cronExpr;
        patch.interval_sec = 0;
        patch.next_run_at = nextCronRunFrom(now, cronExpr, schedulerCronTimezone);
      }
      if (hasOwn(body, "priority")) {
        const n = parseOptionalInt(body.priority, { min: 0, max: 10, field: "priority" });
        if (n == null) return badRequest(res, "VALIDATION_ERROR", "'priority' is required when provided");
        patch.priority = n;
      }
      if (hasOwn(body, "timeout_sec")) {
        const n = parseOptionalInt(body.timeout_sec, { min: 1, max: 3600, field: "timeout_sec" });
        if (n == null) return badRequest(res, "VALIDATION_ERROR", "'timeout_sec' is required when provided");
        patch.timeout_sec = n;
      }
      if (hasOwn(body, "max_attempts")) {
        const n = parseOptionalInt(body.max_attempts, { min: 1, max: 10, field: "max_attempts" });
        if (n == null) return badRequest(res, "VALIDATION_ERROR", "'max_attempts' is required when provided");
        patch.max_attempts = n;
      }
      if (hasOwn(body, "start_in_sec")) {
        startInSecForNextRun = parseOptionalInt(body.start_in_sec, { min: 0, max: 86_400, field: "start_in_sec" }) ?? 0;
      }
    } catch (e) {
      return badRequest(res, "VALIDATION_ERROR", e.message);
    }

    if (startInSecForNextRun != null) {
      const base = nowPlusSeconds(startInSecForNextRun);
      const cronForNext = String(patch.cron_expr != null ? patch.cron_expr : existing.cron_expr || "").trim();
      patch.next_run_at = cronForNext
        ? nextCronRunFrom(base, cronForNext, schedulerCronTimezone)
        : base;
    }

    if (hasOwn(body, "tags")) {
      if (!Array.isArray(body.tags)) {
        return badRequest(res, "VALIDATION_ERROR", "'tags' must be an array");
      }
      patch.tags_json = JSON.stringify(body.tags.slice(0, 20).map(String));
    }

    if (hasOwn(body, "input")) {
      patch.input_json = JSON.stringify(body.input ?? null);
    }

    if (body.run_now === true) {
      patch.next_run_at = now;
    }

    const keys = Object.keys(patch);
    if (keys.length === 0) {
      return badRequest(res, "VALIDATION_ERROR", "No updatable fields provided");
    }

    const sets = keys.map((k) => `${k} = ?`);
    const vals = keys.map((k) => patch[k]);
    sets.push("updated_at = ?");
    vals.push(now, req.params.id);

    db.prepare(`UPDATE job_schedules SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
    const row = db.prepare(`
      SELECT
        id, name, enabled, type, queue, input_json, priority, timeout_sec, max_attempts, tags_json,
        interval_sec, cron_expr, next_run_at, last_run_at, last_job_id, last_error_json, created_at, updated_at
      FROM job_schedules
      WHERE id = ?
    `).get(req.params.id);

    return res.json({ ok: true, schedule: rowToSchedule(row) });
  });

  // DELETE /v1/schedules/:id
  app.delete("/v1/schedules/:id", auth, (req, res) => {
    const row = getAuthorizedScheduleRow(req.params.id, req.auth);
    if (!row) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Schedule not found" } });
    }
    db.prepare(`DELETE FROM job_schedules WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, id: req.params.id, deleted: true });
  });
};
