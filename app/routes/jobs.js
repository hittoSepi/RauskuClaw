const crypto = require("crypto");
const { writeJobToWorkspaceIndex } = require("../jobs_workspace_index");

module.exports = function registerJobsRoutes(app, deps) {
  const {
    auth,
    authSse,
    db,
    rowToJob,
    nowIso,
    log,
    badRequest,
    workspaceRoot,
    authenticate,
    authMisconfigured,
    recordMetricSafe
  } = deps;

  // Helper functions (inlined from server.js)
  const queueNamePattern = /^[a-z0-9._:-]{1,80}$/i;

  function normalizeQueueName(name) {
    return String(name || "").trim();
  }

  function stableHash(obj) {
    const s = JSON.stringify(obj ?? null);
    return crypto.createHash("sha256").update(s).digest("hex");
  }

  function apiError(status, code, message, details) {
    const err = new Error(String(message || "Request failed"));
    err.httpStatus = Number(status) || 400;
    err.errorCode = String(code || "VALIDATION_ERROR");
    if (details && typeof details === "object") err.errorDetails = details;
    return err;
  }

  function validateJobInputByHandler(handler, inputObj) {
    const handlerName = String(handler || "");
    const genericInput = inputObj && typeof inputObj === "object" && !Array.isArray(inputObj) ? inputObj : null;
    if (genericInput && genericInput.depends_on != null) {
      if (!Array.isArray(genericInput.depends_on)) {
        throw new Error("'input.depends_on' must be an array");
      }
      for (const id of genericInput.depends_on) {
        if (typeof id !== "string" || !id) {
          throw new Error("'input.depends_on' must contain non-empty strings");
        }
      }
    }
    if (genericInput && genericInput.memory != null) {
      if (genericInput.memory !== false && (typeof genericInput.memory !== "object" || Array.isArray(genericInput.memory))) {
        throw new Error("'input.memory' must be false or an object");
      }
    }
    if (genericInput && genericInput.memory_write != null) {
      if (typeof genericInput.memory_write !== "object" || Array.isArray(genericInput.memory_write)) {
        throw new Error("'input.memory_write' must be an object");
      }
      const { scope, key, ttl_sec } = genericInput.memory_write;
      if (typeof scope !== "string" || !scope) {
        throw new Error("'input.memory_write.scope' must be a non-empty string");
      }
      if (typeof key !== "string" || !key) {
        throw new Error("'input.memory_write.key' must be a non-empty string");
      }
      if (ttl_sec != null && (!Number.isInteger(ttl_sec) || ttl_sec < 0)) {
        throw new Error("'input.memory_write.ttl_sec' must be a non-negative integer");
      }
    }
    if (handlerName.startsWith("tool.") && genericInput) {
      if (genericInput.tool != null) {
        if (typeof genericInput.tool !== "string" || !genericInput.tool) {
          throw new Error("'input.tool' must be a non-empty string for tool handlers");
        }
      }
    }
  }

  function parseJobCreatePayload(body) {
    const { type, queue, input, priority, timeout_sec, max_attempts, callback_url, tags } = body ?? {};
    if (!type || typeof type !== "string") throw apiError(400, "VALIDATION_ERROR", "Missing/invalid 'type'");

    const typeRow = db.prepare(`
      SELECT name, enabled, handler, default_timeout_sec, default_max_attempts
      FROM job_types
      WHERE name = ?
    `).get(type);

    if (!typeRow || !typeRow.enabled) {
      throw apiError(400, "VALIDATION_ERROR", "Unknown or disabled 'type'");
    }

    let pr = 5;
    if (priority != null) {
      if (!Number.isInteger(priority) || priority < 0 || priority > 10) {
        throw apiError(400, "VALIDATION_ERROR", "'priority' must be integer 0..10");
      }
      pr = priority;
    }

    let to = typeRow.default_timeout_sec;
    if (timeout_sec != null) {
      if (!Number.isInteger(timeout_sec) || timeout_sec < 1 || timeout_sec > 3600) {
        throw apiError(400, "VALIDATION_ERROR", "'timeout_sec' must be integer 1..3600");
      }
      to = timeout_sec;
    }

    let ma = typeRow.default_max_attempts;
    if (max_attempts != null) {
      if (!Number.isInteger(max_attempts) || max_attempts < 1 || max_attempts > 10) {
        throw apiError(400, "VALIDATION_ERROR", "'max_attempts' must be integer 1..10");
      }
      ma = max_attempts;
    }

    const tagsArr = Array.isArray(tags) ? tags.slice(0, 20).map(String) : [];
    const inputObj = input ?? null;
    try {
      validateJobInputByHandler(typeRow.handler, inputObj);
    } catch (e) {
      throw apiError(400, "VALIDATION_ERROR", String(e?.message || e));
    }
    const queueName = normalizeQueueName(queue) || "default";
    if (!queueNamePattern.test(queueName)) {
      throw apiError(400, "VALIDATION_ERROR", "'queue' must match ^[a-z0-9._:-]{1,80}$");
    }

    return {
      type: String(type),
      typeRow,
      queueName,
      inputObj,
      pr,
      to,
      ma,
      callback_url: callback_url ? String(callback_url) : null,
      tagsArr
    };
  }

  function createJobFromPayload(body, { authInfo = null, idempotencyKey = "" } = {}) {
    const parsed = parseJobCreatePayload(body);
    const allowedQueues = Array.isArray(authInfo?.queue_allowlist) ? authInfo.queue_allowlist : null;
    if (allowedQueues && !allowedQueues.includes(parsed.queueName)) {
      throw apiError(
        403,
        "FORBIDDEN",
        `Queue '${parsed.queueName}' is not allowed for this API key.`,
        { allowed_queues: allowedQueues }
      );
    }

    const idemKey = String(idempotencyKey || "").trim();
    const requestFingerprint = stableHash({
      type: parsed.type,
      queue: parsed.queueName,
      input: parsed.inputObj,
      priority: parsed.pr,
      timeout_sec: parsed.to,
      max_attempts: parsed.ma,
      callback_url: parsed.callback_url ?? null,
      tags: parsed.tagsArr
    });

    if (idemKey) {
      const found = db.prepare(`SELECT * FROM idempotency_keys WHERE key = ?`).get(idemKey);
      if (found) {
        if (found.request_hash !== requestFingerprint) {
          throw apiError(409, "IDEMPOTENCY_CONFLICT", "Idempotency-Key reused with different request");
        }
        const existing = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(found.job_id);
        if (existing) {
          recordMetricSafe("job.idempotency_hit", { source: "api", labels: { type: parsed.type } });
          return { row: existing, idempotent: true };
        }
      }
    }

    const id = crypto.randomUUID();
    const now = nowIso();
    const tx = db.transaction(() => {
      db.prepare(`
        INSERT INTO jobs (id, type, queue, status, priority, timeout_sec, max_attempts, attempts, callback_url, tags_json, input_json, created_at, updated_at)
        VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, ?, ?, ?, ?, ?)
      `).run(
        id,
        parsed.type,
        parsed.queueName,
        parsed.pr,
        parsed.to,
        parsed.ma,
        parsed.callback_url,
        JSON.stringify(parsed.tagsArr),
        JSON.stringify(parsed.inputObj),
        now,
        now
      );

      if (idemKey) {
        db.prepare(`
          INSERT INTO idempotency_keys (key, request_hash, job_id, created_at)
          VALUES (?, ?, ?, ?)
        `).run(idemKey, requestFingerprint, id, now);
      }

      log(id, "info", "Job created", {
        type: parsed.type,
        queue: parsed.queueName,
        priority: parsed.pr,
        timeout_sec: parsed.to,
        max_attempts: parsed.ma,
        handler: parsed.typeRow.handler
      });
      recordMetricSafe("job.created", { source: "api", labels: { type: parsed.type, queue: parsed.queueName } });
    });

    tx();
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(id);
    try {
      if (row) writeJobToWorkspaceIndex(workspaceRoot, row, { event: "created" });
    } catch {}
    return { row, idempotent: false };
  }

  function deriveFileSearchQueryForManager(userText) {
    const s = String(userText || "").trim();
    if (!s) return "README";
    const directPath = s.match(/([A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,10})/);
    if (directPath?.[1]) return String(directPath[1]).trim();
    if (/readme/i.test(s)) return /readme\.md/i.test(s) ? "README.md" : "README";
    const words = s.split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9._-]/g, "")).filter(Boolean);
    return words.find((w) => w.length >= 3 && w.length <= 80) || "README";
  }

  function toolDocPathForType(typeName) {
    const type = String(typeName || "").trim();
    if (!type) return "";
    if (!/^(tool|tools|data)\./.test(type)) return "";
    return `tools/${type}/TOOL.md`;
  }

  function authQueueAllowlist(authInfo) {
    const raw = authInfo?.queue_allowlist;
    if (!Array.isArray(raw)) return null;
    const out = raw.map((x) => String(x || "").trim()).filter(Boolean);
    return out.length > 0 ? out : null;
  }

  function isQueueAllowedForAuth(authInfo, queueName) {
    const allowlist = authQueueAllowlist(authInfo);
    if (!allowlist) return true;
    return allowlist.includes(String(queueName || "default").trim() || "default");
  }

  function getAuthorizedJobRow(jobId, authInfo) {
    const row = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(jobId);
    if (!row) return null;
    if (!isQueueAllowedForAuth(authInfo, row.queue || "default")) return null;
    return row;
  }

  // POST /v1/jobs
  app.post("/v1/jobs", auth, (req, res) => {
    try {
      const out = createJobFromPayload(req.body ?? {}, {
        authInfo: req.auth,
        idempotencyKey: req.header("Idempotency-Key")
      });
      return res.status(out.idempotent ? 200 : 201).json({ ok: true, job: rowToJob(out.row), idempotent: out.idempotent });
    } catch (e) {
      if (Number(e?.httpStatus) > 0) {
        const payload = { ok: false, error: { code: e.errorCode || "VALIDATION_ERROR", message: e.message } };
        if (e?.errorDetails && typeof e.errorDetails === "object") payload.error.details = e.errorDetails;
        return res.status(Number(e.httpStatus)).json(payload);
      }
      return badRequest(res, "VALIDATION_ERROR", String(e?.message || e));
    }
  });

  // POST /v1/jobs/submit-intent
  app.post("/v1/jobs/submit-intent", auth, (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const jobsIn = Array.isArray(body.jobs) ? body.jobs : [];
    const userText = String(body.user_text || "").trim();
    const options = body.options && typeof body.options === "object" ? body.options : {};
    const injectToolDocs = options.inject_tool_docs !== false;
    const repair = options.repair !== false;

    if (!jobsIn.length) return badRequest(res, "VALIDATION_ERROR", "Missing 'jobs' array");
    if (jobsIn.length > 40) return badRequest(res, "VALIDATION_ERROR", "'jobs' length must be <= 40");

    const createdJobs = [];
    const normalizedJobs = [];
    const skipped = [];
    const repairs = [];
    const createdByIndex = new Map();
    const toolDocInjected = new Set();

    for (let i = 0; i < jobsIn.length; i += 1) {
      const src = jobsIn[i] && typeof jobsIn[i] === "object" ? jobsIn[i] : {};
      const normalized = {
        type: String(src.type || "").trim(),
        queue: String(normalizeQueueName(src.queue) || "default"),
        input: (src.input && typeof src.input === "object" && !Array.isArray(src.input)) ? { ...src.input } : {},
        priority: Number.isInteger(src.priority) ? src.priority : 5,
        timeout_sec: Number.isInteger(src.timeout_sec) ? src.timeout_sec : 120,
        max_attempts: Number.isInteger(src.max_attempts) ? src.max_attempts : 1,
        tags: Array.isArray(src.tags) ? src.tags.map((x) => String(x || "").trim()).filter(Boolean) : ["chat"]
      };

      if (repair && normalized.type === "tools.file_search") {
        const q = String(normalized.input.query || "").trim();
        if (!q || q.length > 120 || /\r?\n/.test(q)) {
          normalized.input.query = deriveFileSearchQueryForManager(userText);
          repairs.push({ idx: i + 1, kind: "file_search_query", value: normalized.input.query });
        }
      }
      if (repair && normalized.type === "data.write_file") {
        const mode = String(normalized.input.mode || "replace").trim().toLowerCase();
        if (["replace", "append", "prepend"].includes(mode)) {
          if (normalized.input.create_if_missing !== true) {
            normalized.input.create_if_missing = true;
            repairs.push({ idx: i + 1, kind: "write_create_if_missing", value: true });
          }
          if (normalized.input.mkdir_p !== true) {
            normalized.input.mkdir_p = true;
            repairs.push({ idx: i + 1, kind: "write_mkdir_p", value: true });
          }
        }
      }

      const depLast = (
        normalized.input.depends_on_last_job === true
        || String(normalized.input.depends_on_last_job || "").trim().toLowerCase() === "true"
        || Number(normalized.input.depends_on_last_job) === 1
      );
      if (depLast && createdJobs.length > 0) {
        const prevId = String(createdJobs[createdJobs.length - 1]?.job?.id || "").trim();
        if (prevId) {
          const existing = Array.isArray(normalized.input.depends_on)
            ? normalized.input.depends_on.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          if (!existing.includes(prevId)) existing.push(prevId);
          normalized.input.depends_on = existing;
        }
      }
      if (Array.isArray(normalized.input.depends_on_idx) && normalized.input.depends_on_idx.length) {
        const depIds = normalized.input.depends_on_idx
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n > 0 && n <= jobsIn.length)
          .map((n) => createdByIndex.get(n))
          .filter((id) => String(id || "").trim());
        if (depIds.length) {
          const existing = Array.isArray(normalized.input.depends_on)
            ? normalized.input.depends_on.map((x) => String(x || "").trim()).filter(Boolean)
            : [];
          for (const depId of depIds) {
            if (!existing.includes(depId)) existing.push(depId);
          }
          normalized.input.depends_on = existing;
        }
      }
      delete normalized.input.depends_on_last_job;
      delete normalized.input.depends_on_idx;

      if (injectToolDocs) {
        const docPath = toolDocPathForType(normalized.type);
        const isDocRead = normalized.type === "data.file_read" && /tools\/[^/]+\/TOOL\.md$/i.test(String(normalized.input.path || ""));
        if (docPath && !isDocRead && !toolDocInjected.has(normalized.type)) {
          try {
            const docJobPayload = {
              type: "data.file_read",
              queue: normalized.queue,
              input: { path: docPath },
              priority: 5,
              timeout_sec: 30,
              max_attempts: 1,
              tags: ["chat", "tool-doc"]
            };
            const docCreated = createJobFromPayload(docJobPayload, { authInfo: req.auth });
            const docRow = rowToJob(docCreated.row);
            createdJobs.push({ source_idx: i + 1, kind: "tool_doc", tool_type: normalized.type, job: docRow });
            const existing = Array.isArray(normalized.input.depends_on)
              ? normalized.input.depends_on.map((x) => String(x || "").trim()).filter(Boolean)
              : [];
            if (!existing.includes(docRow.id)) existing.push(docRow.id);
            normalized.input.depends_on = existing;
            toolDocInjected.add(normalized.type);
          } catch (e) {
            skipped.push({ idx: i + 1, type: normalized.type, code: e?.errorCode || "VALIDATION_ERROR", message: String(e?.message || e) });
            continue;
          }
        }
      }

      normalizedJobs.push({ idx: i + 1, ...normalized });
      try {
        const created = createJobFromPayload(normalized, { authInfo: req.auth });
        const row = rowToJob(created.row);
        createdJobs.push({ source_idx: i + 1, kind: "intent", job: row });
        createdByIndex.set(i + 1, row.id);
      } catch (e) {
        skipped.push({ idx: i + 1, type: normalized.type, code: e?.errorCode || "VALIDATION_ERROR", message: String(e?.message || e) });
      }
    }

    return res.status(createdJobs.length > 0 ? 201 : 200).json({
      ok: true,
      created_jobs: createdJobs,
      normalized_jobs: normalizedJobs,
      repairs,
      skipped
    });
  });

  // GET /v1/jobs/:id
  app.get("/v1/jobs/:id", auth, (req, res) => {
    const row = getAuthorizedJobRow(req.params.id, req.auth);
    if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });
    res.json({ ok: true, job: rowToJob(row) });
  });

  // GET /v1/jobs
  app.get("/v1/jobs", auth, (req, res) => {
    const status = req.query.status ? String(req.query.status) : null;
    const type = req.query.type ? String(req.query.type) : null;
    const queue = req.query.queue ? String(req.query.queue).trim() : null;
    const limit = Math.min(parseInt(req.query.limit || "50", 10) || 50, 200);
    const allowedQueues = authQueueAllowlist(req.auth);

    if (queue && allowedQueues && !allowedQueues.includes(queue)) {
      return res.status(403).json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: `Queue '${queue}' is not allowed for this API key.`,
          details: { allowed_queues: allowedQueues }
        }
      });
    }

    const where = [];
    const params = [];

    if (status) { where.push("status = ?"); params.push(status); }
    if (type) { where.push("type = ?"); params.push(type); }
    if (queue) { where.push("queue = ?"); params.push(queue); }
    if (allowedQueues) {
      const queuePlaceholders = allowedQueues.map(() => "?").join(", ");
      where.push(`queue IN (${queuePlaceholders})`);
      params.push(...allowedQueues);
    }

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

  // POST /v1/jobs/:id/cancel
  app.post("/v1/jobs/:id/cancel", auth, (req, res) => {
    const row = getAuthorizedJobRow(req.params.id, req.auth);
    if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });

    if (row.status === "succeeded" || row.status === "failed") {
      return res.status(409).json({ ok: false, error: { code: "CONFLICT", message: "Job already finished" } });
    }

    db.prepare(`UPDATE jobs SET status = 'cancelled', updated_at = ?, locked_at = NULL, locked_by = NULL WHERE id = ?`)
      .run(nowIso(), row.id);

    log(row.id, "warn", "Job cancelled");
    recordMetricSafe("job.cancelled", { source: "api", labels: { type: row.type || "unknown" } });

    const updated = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(row.id);
    try {
      if (updated) writeJobToWorkspaceIndex(workspaceRoot, updated, { event: "cancelled" });
    } catch {}
    res.json({ ok: true, job: rowToJob(updated) });
  });

  // GET /v1/jobs/:id/logs
  app.get("/v1/jobs/:id/logs", auth, (req, res) => {
    const tail = Math.min(parseInt(req.query.tail || "200", 10) || 200, 2000);
    const job = getAuthorizedJobRow(req.params.id, req.auth);
    if (!job) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });

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

  // GET /v1/jobs/:id/stream
  app.get("/v1/jobs/:id/stream", authSse, (req, res) => {
    const jobId = req.params.id;
    const job = getAuthorizedJobRow(jobId, req.auth);
    if (!job) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Job not found" } });

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
};
