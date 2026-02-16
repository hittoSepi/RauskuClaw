const os = require("os");
const crypto = require("crypto");
const { db } = require("./db");

const workerId = process.env.WORKER_ID || os.hostname();

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

function domainAllowlisted(urlStr) {
  const allow = (process.env.CALLBACK_ALLOWLIST || "").trim();
  if (!allow) return true; // MVP: if unset, allow all
  let u;
  try { u = new URL(urlStr); } catch { return false; }
  const allowed = allow.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const host = u.hostname.toLowerCase();
  return allowed.some(d => host === d || host.endsWith("." + d));
}

async function postCallback(job) {
  if (!job.callback_url) return;
  if (!domainAllowlisted(job.callback_url)) {
    log(job.id, "warn", "Callback blocked (not allowlisted)", { callback_url: job.callback_url });
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

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);

    const resp = await fetch(job.callback_url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });

    clearTimeout(t);
    log(job.id, "info", "Callback delivered", { status: resp.status });
  } catch (e) {
    log(job.id, "warn", "Callback failed", { error: String(e?.message || e) });
  }
}

// --- Builtin handlers ---
async function runBuiltin(job, handler) {
  const input = safeJsonParse(job.input_json) || {};

  if (handler === "builtin:report.generate") {
    log(job.id, "info", "Generating report", { input });
    await sleep(400);
    return { report_id: crypto.randomUUID(), summary: "MVP report generated", input };
  }

  if (handler === "builtin:deploy.run") {
    log(job.id, "info", "Starting deploy (stub)", { input });

    const allowedTargets = (process.env.DEPLOY_TARGET_ALLOWLIST || "staging").split(",").map(s => s.trim());
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
    const job = db.prepare(`
      SELECT *
      FROM jobs
      WHERE status = 'queued'
        AND (locked_at IS NULL)
      ORDER BY priority DESC, created_at ASC
      LIMIT 1
    `).get();

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

  log(job.id, "info", "Job claimed", { worker: workerId });

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
  } catch (e) {
    const msg = String(e?.message || e);
    log(job.id, "error", "Job failed", { error: msg });

    const latest = db.prepare(`SELECT attempts, max_attempts FROM jobs WHERE id = ?`).get(job.id);
    const canRetry = latest && latest.attempts < latest.max_attempts;

    if (canRetry) {
      markJob(job.id, {
        status: "queued",
        error_json: safeJsonStringify({ message: msg, at: nowIso() }),
        locked_at: null,
        locked_by: null,
      });
      log(job.id, "warn", "Re-queued for retry");
    } else {
      markJob(job.id, {
        status: "failed",
        error_json: safeJsonStringify({ message: msg, at: nowIso() }),
        locked_at: null,
        locked_by: null,
      });
    }
  }

  const done = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
  if (done) await postCallback(done);

  return true;
}

function startWorker() {
  const intervalMs = parseInt(process.env.WORKER_POLL_MS || "300", 10);
  setInterval(() => {
    processOne().catch(() => {});
  }, intervalMs);
}

module.exports = { startWorker, log };
