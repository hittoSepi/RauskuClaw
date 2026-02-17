const os = require("os");
const crypto = require("crypto");
const { db } = require("./db");
const { getConfig, envOrConfig, envIntOrConfig, envBoolOrConfig, splitCsv } = require("./config");
const { runProviderHandler } = require("./providers");
const { getMemoryVectorSettings } = require("./memory/settings");
const { embedText } = require("./memory/ollama_embed");
const { projectMemoryForEmbedding } = require("./memory/projection");
const { upsertMemoryVector } = require("./memory/vector_store");
const { parseChatMemoryRequest, buildChatMemoryContext, injectChatMemoryContext } = require("./memory/chat_context");
const { parseChatMemoryWriteRequest, applyChatMemoryWriteback } = require("./memory/writeback");
const { dispatchDueSchedules } = require("./scheduler");
const { HEADER_TIMESTAMP, HEADER_SIGNATURE, getCallbackSigningSettings, signCallbackPayload } = require("./callback_signing");
const { recordMetric } = require("./metrics");

const workerIdEnvName = String(getConfig("worker.worker_id_source.env", "WORKER_ID"));
const workerId = process.env[workerIdEnvName] || os.hostname();
const workerQueueAllowlistEnvName = String(getConfig("worker.queue.allowlist_env", "WORKER_QUEUE_ALLOWLIST"));
const workerQueueDefaultAllowed = (() => {
  const cfg = getConfig("worker.queue.default_allowed", ["default"]);
  return Array.isArray(cfg) ? cfg.map((x) => String(x || "").trim()).filter(Boolean) : ["default"];
})();
const workerQueueAllowlist = (() => {
  const fromEnv = splitCsv(process.env[workerQueueAllowlistEnvName] || "");
  const raw = fromEnv.length > 0 ? fromEnv : workerQueueDefaultAllowed;
  const normalized = Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
  return normalized.length > 0 ? normalized : ["default"];
})();
const memoryVectorSettings = getMemoryVectorSettings();

function nowIso() {
  return new Date().toISOString();
}

function log(jobId, level, message, meta) {
  db.prepare(`
    INSERT INTO job_logs (job_id, ts, level, message, meta_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(jobId, nowIso(), level, message, meta ? JSON.stringify(meta) : null);
}

function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function safeJsonStringify(v) {
  return JSON.stringify(v ?? null);
}

function recordMetricSafe(name, opts = {}) {
  try {
    recordMetric(db, name, opts);
  } catch {}
}

function enqueueInternalJob(type, input, opts = {}) {
  const typeRow = db.prepare(`
    SELECT name, enabled, default_timeout_sec, default_max_attempts
    FROM job_types
    WHERE name = ?
  `).get(type);
  if (!typeRow || !typeRow.enabled) {
    throw new Error(`Internal job type missing or disabled: ${type}`);
  }

  const id = crypto.randomUUID();
  const now = nowIso();
  const queue = String(opts.queue || "").trim() || "default";
  const priority = Number.isInteger(opts.priority) ? opts.priority : 9;
  const timeoutSec = Number.isInteger(opts.timeoutSec) ? opts.timeoutSec : (typeRow.default_timeout_sec || 60);
  const maxAttempts = Number.isInteger(opts.maxAttempts) ? opts.maxAttempts : (typeRow.default_max_attempts || 3);
  const tags = Array.isArray(opts.tags) ? opts.tags.map((t) => String(t)).slice(0, 20) : [];

  db.prepare(`
    INSERT INTO jobs (id, type, queue, status, priority, timeout_sec, max_attempts, attempts, callback_url, tags_json, input_json, created_at, updated_at)
    VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, NULL, ?, ?, ?, ?)
  `).run(
    id,
    type,
    queue,
    priority,
    timeoutSec,
    maxAttempts,
    JSON.stringify(tags),
    JSON.stringify(input ?? null),
    now,
    now
  );

  log(id, "info", "System job created", { type, input });
  return id;
}

function domainAllowlisted(urlStr) {
  const callbackAllowlistEnv = String(getConfig("callbacks.allowlist_env", "CALLBACK_ALLOWLIST"));
  const allow = String(process.env[callbackAllowlistEnv] || "").trim();
  const emptyBehavior = String(getConfig("callbacks.allowlist_behavior_when_empty", "allow_all"));
  if (!allow) return emptyBehavior === "allow_all";
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const allowed = splitCsv(allow).map(s => s.toLowerCase());
  const host = u.hostname.toLowerCase();
  return allowed.some(d => host === d || host.endsWith("." + d));
}

async function postCallback(job) {
  if (!job.callback_url) return;
  const callbacksEnabled = Boolean(getConfig("callbacks.enabled", true));
  if (!callbacksEnabled) {
    log(job.id, "info", "Callback skipped (callbacks.enabled=false)", { callback_url: job.callback_url });
    recordMetricSafe("callback.skipped_disabled", { source: "worker" });
    return;
  }
  if (!domainAllowlisted(job.callback_url)) {
    log(job.id, "warn", "Callback blocked (not allowlisted)", { callback_url: job.callback_url });
    recordMetricSafe("callback.blocked_allowlist", { source: "worker" });
    return;
  }

  const payload = {
    id: job.id,
    type: job.type,
    status: job.status,
    attempts: job.attempts,
    max_attempts: job.max_attempts,
    result: safeJsonParse(job.result_json),
    error: safeJsonParse(job.error_json),
    updated_at: job.updated_at,
  };
  const payloadString = JSON.stringify(payload);
  const signing = getCallbackSigningSettings();

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const headers = { "content-type": "application/json" };
    if (signing.enabled) {
      if (!signing.secret) {
        clearTimeout(t);
        log(job.id, "warn", "Callback skipped (signing enabled but secret missing)", {
          callback_url: job.callback_url,
          secret_env: signing.secretEnvName
        });
        recordMetricSafe("callback.skipped_signing_secret_missing", { source: "worker" });
        return;
      }
      const signed = signCallbackPayload(payloadString, signing.secret);
      headers[HEADER_TIMESTAMP] = String(signed.timestampSec);
      headers[HEADER_SIGNATURE] = signed.signature;
    }

    const resp = await fetch(job.callback_url, {
      method: "POST",
      headers,
      body: payloadString,
      signal: ctrl.signal,
    });

    clearTimeout(t);
    log(job.id, "info", "Callback delivered", { status: resp.status });
    recordMetricSafe("callback.delivered", { source: "worker", labels: { status: String(resp.status) } });
  } catch (e) {
    log(job.id, "warn", "Callback failed", { error: String(e?.message || e) });
    recordMetricSafe("callback.failed", { source: "worker" });
  }
}

// --- Builtin handlers ---
async function runBuiltin(job, handler) {
  const input = safeJsonParse(job.input_json) || {};

  if (handler.startsWith("builtin:provider.")) {
    log(job.id, "info", "Starting provider-backed handler", { handler });
    const memoryRequest = parseChatMemoryRequest(input, memoryVectorSettings);
    const memoryWriteRequest = parseChatMemoryWriteRequest(input, job.id);
    let memoryContext = null;
    let providerInput = input;

    if (memoryRequest) {
      try {
        memoryContext = await buildChatMemoryContext({
          db,
          settings: memoryVectorSettings,
          request: memoryRequest
        });
        providerInput = injectChatMemoryContext(input, memoryContext);
        log(job.id, "info", "Chat memory context attached", {
          scope: memoryContext.request.scope,
          query: memoryContext.request.query,
          top_k: memoryContext.request.topK,
          required: memoryContext.request.required,
          match_count: memoryContext.matches.length,
          embedding_model: memoryContext.embeddingModel || null
        });
      } catch (e) {
        if (memoryRequest.required) {
          log(job.id, "error", "Required chat memory context unavailable", {
            scope: memoryRequest.scope,
            query: memoryRequest.query,
            top_k: memoryRequest.topK,
            code: e?.code || "MEMORY_CONTEXT_UNAVAILABLE",
            details: e?.details || null,
            error: String(e?.message || e)
          });
          throw e;
        }
        log(job.id, "warn", "Chat memory context unavailable; continuing without memory", {
          scope: memoryRequest.scope,
          query: memoryRequest.query,
          top_k: memoryRequest.topK,
          code: e?.code || "MEMORY_CONTEXT_UNAVAILABLE",
          details: e?.details || null,
          error: String(e?.message || e)
        });
      }
    }

    try {
      const out = await runProviderHandler(handler, providerInput);
      if (memoryContext && out && typeof out === "object") {
        out.memory_context = {
          scope: memoryContext.request.scope,
          query: memoryContext.request.query,
          top_k: memoryContext.request.topK,
          required: memoryContext.request.required,
          match_count: memoryContext.matches.length
        };
      }
      if (memoryWriteRequest && out && typeof out === "object") {
        try {
          const writeMeta = applyChatMemoryWriteback({
            db,
            settings: memoryVectorSettings,
            request: memoryWriteRequest,
            providerOutput: out,
            job,
            enqueueInternalJob
          });
          out.memory_write = writeMeta;
          log(job.id, "info", "Chat memory write-back saved", {
            scope: writeMeta.scope,
            key: writeMeta.key,
            memory_id: writeMeta.memory_id,
            embedding_queued: writeMeta.embedding_queued
          });
        } catch (e) {
          if (memoryWriteRequest.required) {
            log(job.id, "error", "Required chat memory write-back failed", {
              scope: memoryWriteRequest.scope,
              key: memoryWriteRequest.key,
              code: e?.code || "MEMORY_WRITE_UNAVAILABLE",
              details: e?.details || null,
              error: String(e?.message || e)
            });
            throw e;
          }
          log(job.id, "warn", "Chat memory write-back failed; continuing", {
            scope: memoryWriteRequest.scope,
            key: memoryWriteRequest.key,
            code: e?.code || "MEMORY_WRITE_UNAVAILABLE",
            details: e?.details || null,
            error: String(e?.message || e)
          });
        }
      }
      log(job.id, "info", "Provider-backed handler completed", {
        handler,
        provider: out?.provider || null,
        model: out?.model || null,
        local_provider: out?.local_provider || null,
        command_preview: out?.command_preview || null,
        auth_mode: out?.auth_mode || null,
        memory_scope: memoryContext?.request?.scope || null,
        memory_matches: memoryContext ? memoryContext.matches.length : null,
        memory_write_scope: memoryWriteRequest?.scope || null,
        memory_write_key: memoryWriteRequest?.key || null
      });
      return out;
    } catch (e) {
      const providerHint = handler.includes("codex.oss")
        ? "codex-oss"
        : (handler.includes("openai") ? "openai" : "unknown");
      log(job.id, "error", "Provider-backed handler failed", {
        handler,
        provider: providerHint,
        code: e?.code || null,
        details: e?.details || null,
        error: String(e?.message || e)
      });
      throw e;
    }
  }

  if (handler === "builtin:report.generate") {
    log(job.id, "info", "Generating report", { input });
    await sleep(400);
    return { report_id: crypto.randomUUID(), summary: "MVP report generated", input };
  }

  if (handler === "builtin:memory.embed.sync") {
    if (!memoryVectorSettings.enabled) {
      throw new Error("Memory vector embedding is disabled (MEMORY_VECTOR_ENABLED=0).");
    }

    const memoryId = String(input.memory_id || "").trim();
    if (!memoryId) {
      throw new Error("memory.embed.sync requires input.memory_id");
    }

    const row = db.prepare(`
      SELECT id, scope, key, value_json, tags_json, expires_at
      FROM memories
      WHERE id = ?
    `).get(memoryId);

    if (!row) {
      log(job.id, "warn", "Memory row missing; skipping embed job", { memory_id: memoryId });
      return { skipped: true, reason: "not_found", memory_id: memoryId };
    }
    if (row.expires_at && row.expires_at <= nowIso()) {
      log(job.id, "info", "Memory row expired; skipping embed job", { memory_id: memoryId, expires_at: row.expires_at });
      return { skipped: true, reason: "expired", memory_id: memoryId };
    }

    const memory = {
      scope: row.scope,
      key: row.key,
      tags: safeJsonParse(row.tags_json) || [],
      value: safeJsonParse(row.value_json)
    };
    const text = projectMemoryForEmbedding(memory);

    try {
      const embedded = await embedText(text, { settings: memoryVectorSettings });
      const vectorMeta = upsertMemoryVector(
        db,
        memoryVectorSettings,
        row.id,
        embedded.embedding,
        embedded.model
      );
      const ts = nowIso();
      db.prepare(`
        UPDATE memories
        SET embedding_status = 'ready',
            embedding_error_json = NULL,
            embedded_at = ?,
            updated_at = ?
        WHERE id = ?
      `).run(ts, ts, row.id);

      return {
        memory_id: row.id,
        embedding_status: "ready",
        dimension: vectorMeta.dimension,
        model: embedded.model
      };
    } catch (e) {
      const ts = nowIso();
      db.prepare(`
        UPDATE memories
        SET embedding_status = 'failed',
            embedding_error_json = ?,
            updated_at = ?
        WHERE id = ?
      `).run(
        JSON.stringify({
          code: e?.code || "MEMORY_EMBED_ERROR",
          message: String(e?.message || e),
          details: e?.details || null,
          at: ts
        }),
        ts,
        row.id
      );
      throw e;
    }
  }

  if (handler === "builtin:deploy.run") {
    log(job.id, "info", "Starting deploy (stub)", { input });

    const allowlistEnvName = String(getConfig("handlers.deploy.allowlist_env", "DEPLOY_TARGET_ALLOWLIST"));
    const fallbackTargets = getConfig("handlers.deploy.default_allowed_targets", ["staging"]);
    const fallbackCsv = Array.isArray(fallbackTargets) ? fallbackTargets.join(",") : "staging";
    const allowedTargets = splitCsv(process.env[allowlistEnvName] || fallbackCsv);
    const target = input.target || "staging";
    if (!allowedTargets.includes(target)) {
      throw new Error(`target not allowed: ${target}`);
    }

    await sleep(600);
    log(job.id, "info", "Deploy step completed (stub)", { target });

    return { deployment_id: crypto.randomUUID(), target, message: "Stub deploy completed" };
  }

  if (handler === "builtin:data.fetch") {
    throw new Error("data.fetch disabled in MVP (SSRF protection)");
  }

  if (handler === "builtin:code.component.generate") {
    log(job.id, "info", "Generating component skeleton (stub)");
    await sleep(300);
    return {
      files: [
        { path: "Component.vue", content: "<template><div>TODO</div></template>\n<script setup>\n</script>\n" }
      ]
    };
  }

  if (handler === "builtin:design.frontpage.layout") {
    log(job.id, "info", "Designing layout (stub)");
    await sleep(300);
    return { layout: { sections: ["hero","features","cta","footer"], notes: "MVP layout suggestion" } };
  }

  throw new Error(`Unknown handler: ${handler}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function withTimeout(promise, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => ctrl.signal.addEventListener("abort", () => rej(new Error("timeout"))))
    ]);
  } finally {
    clearTimeout(t);
  }
}

function claimNextJob() {
  const tx = db.transaction(() => {
    const placeholders = workerQueueAllowlist.map(() => "?").join(", ");
    const job = db.prepare(`
      SELECT *
      FROM jobs
      WHERE status = 'queued'
        AND queue IN (${placeholders})
        AND (locked_at IS NULL)
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get(...workerQueueAllowlist);

    if (!job) return null;

    db.prepare(`
      UPDATE jobs
      SET locked_at = ?, locked_by = ?, status = 'running', updated_at = ?
      WHERE id = ?
    `).run(nowIso(), workerId, nowIso(), job.id);

    return { ...job, status: "running", locked_at: nowIso(), locked_by: workerId, updated_at: nowIso() };
  });

  return tx();
}

function markJob(jobId, fields) {
  const sets = [];
  const vals = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    vals.push(v);
  }
  sets.push(`updated_at = ?`);
  vals.push(nowIso());
  vals.push(jobId);

  db.prepare(`UPDATE jobs SET ${sets.join(", ")} WHERE id = ?`).run(...vals);
}

async function processOne() {
  const job = claimNextJob();
  if (!job) return false;

  log(job.id, "info", "Job claimed", { worker: workerId, queue: job.queue || "default" });
  recordMetricSafe("job.claimed", { source: "worker", labels: { type: job.type || "unknown", queue: job.queue || "default" } });

  const typeRow = db.prepare(`
    SELECT name, enabled, handler
    FROM job_types
    WHERE name = ?
  `).get(job.type);

  if (!typeRow || !typeRow.enabled) {
    throw new Error(`Unknown/disabled job type: ${job.type}`);
  }

  const fresh = db.prepare(`SELECT status, timeout_sec, attempts, max_attempts FROM jobs WHERE id = ?`).get(job.id);
  if (!fresh || fresh.status === "cancelled") return true;

  const attempts = (fresh.attempts || 0) + 1;
  markJob(job.id, { attempts });

  try {
    const timeoutMs = (fresh.timeout_sec || 120) * 1000;
    const result = await withTimeout(runBuiltin(job, typeRow.handler), timeoutMs);

    markJob(job.id, {
      status: "succeeded",
      result_json: safeJsonStringify(result),
      error_json: null,
      locked_at: null,
      locked_by: null,
    });

    log(job.id, "info", "Job succeeded");
    recordMetricSafe("job.succeeded", { source: "worker", labels: { type: job.type || "unknown", queue: job.queue || "default" } });
  } catch (e) {
    const msg = String(e?.message || e);
    const code = e?.code || null;
    const details = e?.details || null;
    log(job.id, "error", "Job failed", { error: msg, code, details, handler: typeRow?.handler || null });

    const latest = db.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(job.id);
    const canRetry = latest && latest.attempts < latest.max_attempts;

    if (canRetry) {
      markJob(job.id, {
        status: "queued",
        error_json: safeJsonStringify({ message: msg, code, details, at: nowIso() }),
        locked_at: null,
        locked_by: null,
      });
      log(job.id, "warn", "Re-queued for retry");
      recordMetricSafe("job.retried", { source: "worker", labels: { type: job.type || "unknown", queue: job.queue || "default" } });
    } else {
      markJob(job.id, {
        status: "failed",
        error_json: safeJsonStringify({ message: msg, code, details, at: nowIso() }),
        locked_at: null,
        locked_by: null,
      });
      recordMetricSafe("job.failed_terminal", { source: "worker", labels: { type: job.type || "unknown", queue: job.queue || "default", code: code || "unknown" } });
    }
  }

  const done = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
  if (done) await postCallback(done);

  return true;
}

function startWorker() {
  const intervalMs = envIntOrConfig("WORKER_POLL_MS", "worker.poll_interval_ms", 300);
  const schedulerEnabled = envBoolOrConfig("SCHEDULER_ENABLED", "worker.scheduler.enabled", true);
  const schedulerBatchSize = Math.max(1, Math.min(100, envIntOrConfig("SCHEDULER_BATCH_SIZE", "worker.scheduler.batch_size", 5)));
  const schedulerCronTimezone = String(envOrConfig("SCHEDULER_CRON_TZ", "worker.scheduler.cron_timezone", "UTC")).trim() || "UTC";
  console.log(`[rauskuclaw-worker] queue allowlist: ${workerQueueAllowlist.join(", ")}`);
  setInterval(() => {
    if (schedulerEnabled) {
      try {
        const out = dispatchDueSchedules(db, {
          batchSize: schedulerBatchSize,
          cronTimezone: schedulerCronTimezone,
          onDispatch(jobId, schedule, meta) {
            log(jobId, "info", "Job scheduled", {
              schedule_id: meta.schedule_id,
              schedule_name: meta.schedule_name,
              schedule_next_run_at: meta.schedule_next_run_at,
              type: schedule.type
            });
          },
          onError(schedule, err) {
            console.warn("[rauskuclaw-worker] scheduler dispatch error", {
              schedule_id: schedule?.id || null,
              type: schedule?.type || null,
              error: err?.message || String(err)
            });
          }
        });
        if (out.dispatched > 0) {
          console.log(`[rauskuclaw-worker] scheduled ${out.dispatched} job(s) from recurrence`);
          recordMetricSafe("schedule.dispatched_jobs", { source: "worker", value: out.dispatched });
        }
      } catch (e) {
        console.warn("[rauskuclaw-worker] scheduler tick failed", String(e?.message || e));
        recordMetricSafe("schedule.tick_failed", { source: "worker" });
      }
    }

    processOne().catch(() => {});
  }, intervalMs);
}

module.exports = { startWorker, log };
