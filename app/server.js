const express = require("express");
const morgan = require("morgan");
const crypto = require("crypto");
const { db } = require("./db");
const { log } = require("./worker");
const { getConfig, envOrConfig, envIntOrConfig } = require("./config");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

const port = envIntOrConfig("PORT", "api.port", 3001);
const apiKey = String(process.env.API_KEY || "").trim();
const apiAuthDisabled = process.env.API_AUTH_DISABLED != null
  ? process.env.API_AUTH_DISABLED === "1"
  : getConfig("api.auth.required", true) === false;
const apiKeyHeader = String(envOrConfig("API_KEY_HEADER", "api.auth.header", "x-api-key")).toLowerCase();
const sseApiKeyParam = String(envOrConfig("SSE_API_KEY_PARAM", "api.sse.query_api_key_param", "api_key"));

function nowIso() { return new Date().toISOString(); }

function authMisconfigured(res) {
  return res.status(503).json({
    ok: false,
    error: {
      code: "AUTH_NOT_CONFIGURED",
      message: "API auth is not configured. Set API_KEY or enable API_AUTH_DISABLED=1 for local development."
    }
  });
}

function auth(req, res, next) {
  if (!apiKey) {
    if (apiAuthDisabled) return next();
    return authMisconfigured(res);
  }
  const got = req.header(apiKeyHeader);
  if (got === apiKey) return next();
  return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
}

function authSse(req, res, next) {
  if (!apiKey) {
    if (apiAuthDisabled) return next();
    return authMisconfigured(res);
  }
  const headerKey = req.header(apiKeyHeader);
  const queryKey = req.query[sseApiKeyParam] ? String(req.query[sseApiKeyParam]) : "";
  if (headerKey === apiKey || queryKey === apiKey) return next();
  return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
}

function badRequest(res, code, message, details) {
  return res.status(400).json({ ok: false, error: { code, message, details } });
}

function stableHash(obj) {
  const s = JSON.stringify(obj ?? null);
  return crypto.createHash("sha256").update(s).digest("hex");
}

function normalizeTypeName(name) {
  return String(name || "").trim();
}

function parseOptionalInt(value, { min, max, field }) {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`'${field}' must be integer ${min}..${max}`);
  }
  return value;
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    priority: row.priority,
    timeout_sec: row.timeout_sec,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    callback_url: row.callback_url,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    input: row.input_json ? JSON.parse(row.input_json) : null,
    result: row.result_json ? JSON.parse(row.result_json) : null,
    error: row.error_json ? JSON.parse(row.error_json) : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "openclaw-api", time: nowIso() });
});

app.get("/v1/ping", auth, (req, res) => res.json({ ok: true, pong: true }));

app.get("/v1/job-types", auth, (req, res) => {
  const rows = db.prepare(`
    SELECT name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at
    FROM job_types
    ORDER BY name ASC
  `).all();

  res.json({
    ok: true,
    types: rows.map(r => ({
      name: r.name,
      enabled: !!r.enabled,
      handler: r.handler,
      default_timeout_sec: r.default_timeout_sec,
      default_max_attempts: r.default_max_attempts
    })),
    count: rows.length
  });
});

app.post("/v1/job-types", auth, (req, res) => {
  const body = req.body ?? {};
  const name = normalizeTypeName(body.name);
  const handler = String(body.handler || "").trim();

  if (!name) return badRequest(res, "VALIDATION_ERROR", "Missing/invalid 'name'");
  if (!/^[a-z0-9._-]{3,80}$/i.test(name)) {
    return badRequest(res, "VALIDATION_ERROR", "'name' must match ^[a-z0-9._-]{3,80}$");
  }
  if (!handler) return badRequest(res, "VALIDATION_ERROR", "Missing/invalid 'handler'");

  let defaultTimeoutSec;
  let defaultMaxAttempts;
  try {
    defaultTimeoutSec = parseOptionalInt(body.default_timeout_sec, { min: 1, max: 3600, field: "default_timeout_sec" }) ?? 120;
    defaultMaxAttempts = parseOptionalInt(body.default_max_attempts, { min: 1, max: 10, field: "default_max_attempts" }) ?? 1;
  } catch (e) {
    return badRequest(res, "VALIDATION_ERROR", e.message);
  }

  const enabled = body.enabled == null ? 1 : (body.enabled ? 1 : 0);
  const now = nowIso();

  try {
    db.prepare(`
      INSERT INTO job_types (name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(name, enabled, handler, defaultTimeoutSec, defaultMaxAttempts, now, now);
  } catch (e) {
    if (String(e?.message || "").toLowerCase().includes("unique")) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: "Job type already exists" }
      });
    }
    throw e;
  }

  const created = db.prepare(`
    SELECT name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at
    FROM job_types
    WHERE name = ?
  `).get(name);

  res.status(201).json({
    ok: true,
    type: {
      name: created.name,
      enabled: !!created.enabled,
      handler: created.handler,
      default_timeout_sec: created.default_timeout_sec,
      default_max_attempts: created.default_max_attempts
    }
  });
});

app.patch("/v1/job-types/:name", auth, (req, res) => {
  const name = normalizeTypeName(req.params.name);
  const existing = db.prepare(`
    SELECT name, enabled, handler, default_timeout_sec, default_max_attempts
    FROM job_types
    WHERE name = ?
  `).get(name);

  if (!existing) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job type not found" } });
  }

  const body = req.body ?? {};
  const patch = {};

  if (Object.prototype.hasOwnProperty.call(body, "enabled")) {
    patch.enabled = body.enabled ? 1 : 0;
  }
  if (Object.prototype.hasOwnProperty.call(body, "handler")) {
    const handler = String(body.handler || "").trim();
    if (!handler) return badRequest(res, "VALIDATION_ERROR", "Missing/invalid 'handler'");
    patch.handler = handler;
  }

  try {
    if (Object.prototype.hasOwnProperty.call(body, "default_timeout_sec")) {
      patch.default_timeout_sec = parseOptionalInt(body.default_timeout_sec, { min: 1, max: 3600, field: "default_timeout_sec" });
    }
    if (Object.prototype.hasOwnProperty.call(body, "default_max_attempts")) {
      patch.default_max_attempts = parseOptionalInt(body.default_max_attempts, { min: 1, max: 10, field: "default_max_attempts" });
    }
  } catch (e) {
    return badRequest(res, "VALIDATION_ERROR", e.message);
  }

  const keys = Object.keys(patch);
  if (keys.length === 0) {
    return badRequest(res, "VALIDATION_ERROR", "No updatable fields provided");
  }

  const sets = keys.map(k => `${k} = ?`);
  const vals = keys.map(k => patch[k]);
  sets.push("updated_at = ?");
  vals.push(nowIso(), name);

  db.prepare(`UPDATE job_types SET ${sets.join(", ")} WHERE name = ?`).run(...vals);

  const updated = db.prepare(`
    SELECT name, enabled, handler, default_timeout_sec, default_max_attempts, created_at, updated_at
    FROM job_types
    WHERE name = ?
  `).get(name);

  res.json({
    ok: true,
    type: {
      name: updated.name,
      enabled: !!updated.enabled,
      handler: updated.handler,
      default_timeout_sec: updated.default_timeout_sec,
      default_max_attempts: updated.default_max_attempts
    }
  });
});

/**
 * POST /v1/jobs
 * Headers:
 *  - Idempotency-Key: <string> (optional)
 */
app.post("/v1/jobs", auth, (req, res) => {
  const { type, input, priority, timeout_sec, max_attempts, callback_url, tags } = req.body ?? {};
  const idemKey = (req.header("Idempotency-Key") || "").trim();

  if (!type || typeof type !== "string") return badRequest(res, "VALIDATION_ERROR", "Missing/invalid 'type'");

  const typeRow = db.prepare(`
    SELECT name, enabled, handler, default_timeout_sec, default_max_attempts
    FROM job_types
    WHERE name = ?
  `).get(type);

  if (!typeRow || !typeRow.enabled) {
    return badRequest(res, "VALIDATION_ERROR", "Unknown or disabled 'type'");
  }

  let pr = 5;
  if (priority != null) {
    if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
      return badRequest(res, "VALIDATION_ERROR", "'priority' must be integer 0..10");
    }
    pr = priority;
  }

  let to = typeRow.default_timeout_sec;
  if (timeout_sec != null) {
    if (!Number.isInteger(timeout_sec) || timeout_sec < 1 || timeout_sec > 3600) {
      return badRequest(res, "VALIDATION_ERROR", "'timeout_sec' must be integer 1..3600");
    }
    to = timeout_sec;
  }

  let ma = typeRow.default_max_attempts;
  if (max_attempts != null) {
    if (!Number.isInteger(max_attempts) || max_attempts < 1 || max_attempts > 10) {
      return badRequest(res, "VALIDATION_ERROR", "'max_attempts' must be integer 1..10");
    }
    ma = max_attempts;
  }

  const tagsArr = Array.isArray(tags) ? tags.slice(0, 20).map(String) : [];
  const inputObj = input ?? null;

  const requestFingerprint = stableHash({
    type, input: inputObj, priority: pr, timeout_sec: to, max_attempts: ma,
    callback_url: callback_url ?? null, tags: tagsArr
  });

  if (idemKey) {
    const found = db.prepare(`SELECT * FROM idempotency_keys WHERE key = ?`).get(idemKey);
    if (found) {
      if (found.request_hash !== requestFingerprint) {
        return res.status(409).json({
          ok: false,
          error: { code: "IDEMPOTENCY_CONFLICT", message: "Idempotency-Key reused with different request" }
        });
      }
      const existing = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(found.job_id);
      if (existing) {
        return res.status(200).json({ ok: true, job: rowToJob(existing), idempotent: true });
      }
    }
  }

  const id = crypto.randomUUID();
  const now = nowIso();

  const tx = db.transaction(() => {
    db.prepare(`
      INSERT INTO jobs (id, type, status, priority, timeout_sec, max_attempts, attempts, callback_url, tags_json, input_json, created_at, updated_at)
      VALUES (?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?, ?)
    `).run(
      id,
      type,
      pr,
      to,
      ma,
      callback_url ? String(callback_url) : null,
      JSON.stringify(tagsArr),
      JSON.stringify(inputObj),
      now,
      now
    );

    if (idemKey) {
      db.prepare(`
        INSERT INTO idempotency_keys (key, request_hash, job_id, created_at)
        VALUES (?, ?, ?, ?)
      `).run(idemKey, requestFingerprint, id, now);
    }

    log(id, "info", "Job created", { type, priority: pr, timeout_sec: to, max_attempts: ma, handler: typeRow.handler });
  });

  tx();

  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
  return res.status(201).json({ ok: true, job: rowToJob(row) });
});

app.get("/v1/jobs/:id", auth, (req, res) => {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });
  res.json({ ok: true, job: rowToJob(row) });
});

app.get("/v1/jobs", auth, (req, res) => {
  const status = req.query.status ? String(req.query.status) : null;
  const type = req.query.type ? String(req.query.type) : null;
  const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);

  const where = [];
  const params = [];

  if (status) { where.push("status = ?"); params.push(status); }
  if (type) { where.push("type = ?"); params.push(type); }

  const sql = `
    SELECT * FROM jobs
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;

  params.push(limit);

  const rows = db.prepare(sql).all(...params);
  res.json({ ok: true, jobs: rows.map(rowToJob), count: rows.length });
});

app.post("/v1/jobs/:id/cancel", auth, (req, res) => {
  const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });

  if (row.status === "succeeded" || row.status === "failed") {
    return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "Job already finished" } });
  }

  db.prepare(`UPDATE jobs SET status = 'cancelled', updated_at = ?, locked_at = NULL, locked_by = NULL WHERE id = ?`)
    .run(nowIso(), row.id);

  log(row.id, "warn", "Job cancelled");

  const updated = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(row.id);
  res.json({ ok: true, job: rowToJob(updated) });
});

app.get("/v1/jobs/:id/logs", auth, (req, res) => {
  const tail = Math.min(parseInt(req.query.tail || "200", 10) || 200, 2000);
  const exists = db.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(req.params.id);
  if (!exists) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });

  const rows = db.prepare(`
    SELECT id, ts, level, message, meta_json
    FROM job_logs
    WHERE job_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(req.params.id, tail);

  rows.reverse();

  res.json({
    ok: true,
    logs: rows.map(r => ({
      id: r.id,
      ts: r.ts,
      level: r.level,
      message: r.message,
      meta: r.meta_json ? JSON.parse(r.meta_json) : null
    })),
    count: rows.length
  });
});

app.get("/v1/jobs/:id/stream", authSse, (req, res) => {
  const jobId = req.params.id;
  const exists = db.prepare(`SELECT 1 FROM jobs WHERE id = ?`).get(jobId);
  if (!exists) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });

  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");
  res.flushHeaders?.();
  res.write("retry: 2000\n\n");

  let closed = false;
  let lastLogId = 0;
  let lastFingerprint = "";
  const lastEventId = parseInt(req.header("last-event-id") || "0", 10);
  const querySinceLogId = parseInt(req.query.since_log_id || "0", 10);
  if (Number.isInteger(lastEventId) && lastEventId > 0) lastLogId = lastEventId;
  if (Number.isInteger(querySinceLogId) && querySinceLogId > lastLogId) lastLogId = querySinceLogId;

  function writeSse({ event, data, id }) {
    if (closed) return;
    if (id != null) res.write(`id: ${id}\n`);
    if (event) res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  function pushJobIfChanged() {
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
    if (!row) {
      writeSse({ event: "end", data: { reason: "deleted" } });
      return false;
    }

    const fingerprint = stableHash({
      status: row.status,
      attempts: row.attempts,
      max_attempts: row.max_attempts,
      timeout_sec: row.timeout_sec,
      priority: row.priority,
      updated_at: row.updated_at,
      result_json: row.result_json,
      error_json: row.error_json,
      locked_at: row.locked_at,
      locked_by: row.locked_by
    });

    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      writeSse({ event: "job_update", data: { job: rowToJob(row) } });
    }

    return true;
  }

  function pushNewLogs() {
    const rows = db.prepare(`
      SELECT id, ts, level, message, meta_json
      FROM job_logs
      WHERE job_id = ? AND id > ?
      ORDER BY id ASC
      LIMIT 200
    `).all(jobId, lastLogId);

    for (const r of rows) {
      lastLogId = r.id;
      writeSse({
        event: "log_append",
        id: r.id,
        data: {
          id: r.id,
          ts: r.ts,
          level: r.level,
          message: r.message,
          meta: r.meta_json ? JSON.parse(r.meta_json) : null
        }
      });
    }
  }

  function tick() {
    if (!pushJobIfChanged()) return;
    pushNewLogs();
  }

  tick();

  const pollTimer = setInterval(tick, 1000);
  const heartbeatTimer = setInterval(() => {
    if (!closed) res.write(": heartbeat\n\n");
  }, 20_000);

  req.on("close", () => {
    closed = true;
    clearInterval(pollTimer);
    clearInterval(heartbeatTimer);
  });
});

app.listen(port, "0.0.0.0", () => {
  console.log(`[openclaw-api] listening on :${port}`);
});
