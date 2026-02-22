const os = require("os");
const crypto = require("crypto");
const { db } = require("./db");
const { getConfig, envOrConfig, envIntOrConfig, envBoolOrConfig, splitCsv } = require("./config");
const { writeJobToWorkspaceIndex } = require("./jobs_workspace_index");
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
const { generateReport } = require("./handlers/report");
const { buildDeployPlan } = require("./handlers/deploy");
const { generateComponentFiles } = require("./handlers/component");
const { generateFrontpageLayout } = require("./handlers/layout");
const { runToolExec } = require("./handlers/tool_exec");
const { runDataFetch } = require("./handlers/data_fetch");
const { runDataFileRead } = require("./handlers/data_file_read");
const { runDataFileWrite } = require("./handlers/data_file_write");
const { runFileSearch } = require("./handlers/file_search");
const { runFindInFiles } = require("./handlers/find_in_files");
const { runWorkflow } = require("./handlers/workflow_run");
const { runWebSearch } = require("./handlers/web_search");
const {
  AGENT_TOOL_SPECS,
  AGENT_TOOL_BY_FN,
  normalizeToolCallName,
  parseToolCallArguments,
  buildAgentFunctionTools
} = require("./agent_tools/specs");
const {
  createRuntimeToolsReader,
  isRuntimeEnabledForAgentTool
} = require("./agent_tools/policy");

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
const workspaceRootForIndex = String(getConfig("providers.codex_oss.working_directory", "/workspace")).trim() || "/workspace";

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

// Runtime tools reader - uses factory from policy module
const readRuntimeToolsOverrides = createRuntimeToolsReader(db);

function safePreviewValue(value, maxChars = 12000) {
  const raw = safeJsonStringify(value);
  if (!raw) return null;
  if (raw.length <= maxChars) return value;
  return {
    truncated: true,
    bytes: Buffer.byteLength(raw, "utf8"),
    preview: raw.slice(0, maxChars)
  };
}

function normalizeConversationMessages(input) {
  const src = input && typeof input === "object" ? input : {};
  const out = [];
  const system = String(src.system || "").trim();
  if (system) out.push({ role: "system", content: system });
  const sourceMessages = Array.isArray(src.messages) ? src.messages : [];
  for (const m of sourceMessages) {
    const role = String(m?.role || "").trim().toLowerCase();
    if (!role) continue;
    const msg = { role };
    if (m && Object.prototype.hasOwnProperty.call(m, "content")) {
      if (Array.isArray(m.content)) {
        msg.content = m.content;
      } else if (m.content == null) {
        msg.content = "";
      } else {
        msg.content = String(m.content);
      }
    } else {
      msg.content = "";
    }
    if (role === "assistant" && Array.isArray(m?.tool_calls) && m.tool_calls.length > 0) {
      msg.tool_calls = m.tool_calls;
    }
    if (role === "tool" && m?.tool_call_id) {
      msg.tool_call_id = String(m.tool_call_id);
    }
    if (m?.name) {
      msg.name = String(m.name);
    }
    out.push(msg);
  }
  const prompt = String(src.prompt || "").trim();
  if (prompt) out.push({ role: "user", content: prompt });
  return out;
}

async function executeAgentToolCalls(job, toolCalls, runtimeTools) {
  const calls = Array.isArray(toolCalls) ? toolCalls : [];
  const toolMessages = [];
  const toolRuns = [];
  for (let i = 0; i < calls.length; i += 1) {
    const call = calls[i] && typeof calls[i] === "object" ? calls[i] : {};
    const callId = String(call?.id || `tool_call_${i + 1}`);
    const fnName = normalizeToolCallName(call?.function?.name);
    const spec = AGENT_TOOL_BY_FN.get(fnName);
    const runInfo = { id: callId, function: fnName || null, job_type: spec?.jobType || null, ok: false, error: null };

    let payload;
    if (!spec) {
      payload = {
        ok: false,
        error: { code: "TOOL_UNKNOWN", message: `Unknown tool function '${fnName || "unknown"}'.` }
      };
      runInfo.error = payload.error;
      toolRuns.push(runInfo);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: fnName || "unknown", content: safeJsonStringify(payload) });
      continue;
    }
    if (!isRuntimeEnabledForAgentTool(spec, runtimeTools)) {
      payload = {
        ok: false,
        error: { code: "TOOL_DISABLED", message: `Tool '${spec.jobType}' is disabled by runtime policy.` }
      };
      runInfo.error = payload.error;
      toolRuns.push(runInfo);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: spec.fnName, content: safeJsonStringify(payload) });
      continue;
    }

    const typeRow = db.prepare(`SELECT name, enabled, handler FROM job_types WHERE name = ?`).get(spec.jobType);
    const handlerName = String(typeRow?.handler || "");
    if (!typeRow || !typeRow.enabled || !handlerName.startsWith("builtin:") || handlerName.startsWith("builtin:provider.") || handlerName === "builtin:memory.embed.sync") {
      payload = {
        ok: false,
        error: { code: "TOOL_HANDLER_BLOCKED", message: `Tool '${spec.jobType}' handler is not allowed for agent execution.` }
      };
      runInfo.error = payload.error;
      toolRuns.push(runInfo);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: spec.fnName, content: safeJsonStringify(payload) });
      continue;
    }

    try {
      const args = parseToolCallArguments(call?.function?.arguments);
      const toolJob = {
        ...job,
        type: spec.jobType,
        input_json: safeJsonStringify(args)
      };
      log(job.id, "info", "Executing agent tool call", { function: spec.fnName, job_type: spec.jobType, call_id: callId });
      const result = await runBuiltin(toolJob, handlerName);
      payload = { ok: true, result: safePreviewValue(result) };
      runInfo.ok = true;
      toolRuns.push(runInfo);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: spec.fnName, content: safeJsonStringify(payload) });
    } catch (e) {
      payload = {
        ok: false,
        error: {
          code: String(e?.code || "TOOL_EXEC_ERROR"),
          message: String(e?.message || e),
          details: safePreviewValue(e?.details || null, 4000)
        }
      };
      runInfo.error = payload.error;
      toolRuns.push(runInfo);
      toolMessages.push({ role: "tool", tool_call_id: callId, name: spec.fnName, content: safeJsonStringify(payload) });
    }
  }
  return { toolMessages, toolRuns };
}

function safeJsonStringify(v) {
  return JSON.stringify(v ?? null);
}

function parseJobDependencies(job) {
  const input = safeJsonParse(job?.input_json) || {};
  const raw = input?.depends_on;
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const id = String(item || "").trim();
    if (!id) continue;
    if (!out.includes(id)) out.push(id);
    if (out.length >= 50) break;
  }
  return out;
}

function resolveDependencyState(depIds) {
  const ids = Array.isArray(depIds) ? depIds : [];
  if (ids.length < 1) return { state: "ready", missing: [], failed: [], waiting: [] };
  const placeholders = ids.map(() => "?").join(", ");
  const rows = db.prepare(`SELECT id, status FROM jobs WHERE id IN (${placeholders})`).all(...ids);
  const byId = new Map(rows.map((r) => [String(r.id || ""), String(r.status || "")]));
  const missing = ids.filter((id) => !byId.has(id));
  const failed = ids.filter((id) => {
    const st = byId.get(id);
    return st === "failed" || st === "cancelled";
  });
  const waiting = ids.filter((id) => {
    const st = byId.get(id);
    return st && st !== "succeeded" && st !== "failed" && st !== "cancelled";
  });
  if (missing.length > 0 || failed.length > 0) return { state: "blocked", missing, failed, waiting };
  if (waiting.length > 0) return { state: "waiting", missing, failed, waiting };
  return { state: "ready", missing, failed, waiting };
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
  const runtimeTools = readRuntimeToolsOverrides();

  if (handler.startsWith("builtin:provider.")) {
    log(job.id, "info", "Starting provider-backed handler", { handler });
    const memoryRequest = parseChatMemoryRequest(input, memoryVectorSettings);
    const memoryWriteRequest = parseChatMemoryWriteRequest(input, job.id);
    let memoryContext = null;
    let providerInput = input;
    const isOpenAiProvider = handler === "builtin:provider.openai.chat";

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
      if (isOpenAiProvider && providerInput?.agent_tools === true && (!Array.isArray(providerInput.tools) || providerInput.tools.length < 1)) {
        // Pre-compute enabled job types from database
        const jobTypeRows = db.prepare(`SELECT name, enabled FROM job_types WHERE enabled = 1`).all();
        const enabledJobTypes = new Set(
          (Array.isArray(jobTypeRows) ? jobTypeRows : [])
            .map((r) => String(r?.name || "").trim())
            .filter(Boolean)
        );
        // Build agent function tools with pre-computed enabled job types
        const autoTools = buildAgentFunctionTools({
          enabledJobTypes,
          isEnabledCheck: (spec, rt) => isRuntimeEnabledForAgentTool(spec, rt, getConfig),
          runtimeTools
        });
        if (autoTools.length > 0) {
          providerInput = {
            ...providerInput,
            tools: autoTools,
            tool_choice: providerInput?.tool_choice || "auto"
          };
          log(job.id, "info", "Agent tool calling enabled", { tool_count: autoTools.length });
        } else {
          log(job.id, "warn", "Agent tool calling requested but no runtime-enabled tools available");
        }
      }

      let out = await runProviderHandler(handler, providerInput);
      if (isOpenAiProvider) {
        const maxRoundsRaw = Number(envOrConfig("AGENT_TOOL_MAX_ROUNDS", "worker.agent_tool.max_rounds", 3));
        const maxRounds = Math.max(1, Math.min(6, Number.isInteger(maxRoundsRaw) ? maxRoundsRaw : 3));
        let rounds = 0;
        let toolRuns = [];
        let conversation = normalizeConversationMessages(providerInput);

        while (Array.isArray(out?.tool_calls) && out.tool_calls.length > 0 && rounds < maxRounds) {
          rounds += 1;
          log(job.id, "info", "Provider returned tool calls", {
            round: rounds,
            tool_call_count: out.tool_calls.length
          });
          const toolExec = await executeAgentToolCalls(job, out.tool_calls, runtimeTools);
          toolRuns = toolRuns.concat(toolExec.toolRuns);

          conversation.push({
            role: "assistant",
            content: String(out.output_text || ""),
            tool_calls: out.tool_calls
          });
          conversation.push(...toolExec.toolMessages);

          providerInput = {
            ...providerInput,
            prompt: "",
            system: "",
            messages: conversation
          };
          out = await runProviderHandler(handler, providerInput);
        }

        if (Array.isArray(out?.tool_calls) && out.tool_calls.length > 0) {
          log(job.id, "warn", "Stopping tool-calling loop at max rounds", {
            max_rounds: maxRounds,
            remaining_tool_calls: out.tool_calls.length
          });
        }
        if (toolRuns.length > 0 && out && typeof out === "object") {
          out.tool_execution = {
            rounds,
            max_rounds: maxRounds,
            call_count: toolRuns.length,
            calls: toolRuns
          };
        }
      }
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
    await sleep(200);
    return generateReport(input);
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
    log(job.id, "info", "Building deploy dry-run plan", { input });

    const allowlistEnvName = String(getConfig("handlers.deploy.allowlist_env", "DEPLOY_TARGET_ALLOWLIST"));
    const fallbackTargets = getConfig("handlers.deploy.default_allowed_targets", ["staging"]);
    const fallbackCsv = Array.isArray(fallbackTargets) ? fallbackTargets.join(",") : "staging";
    const allowedTargets = splitCsv(process.env[allowlistEnvName] || fallbackCsv);

    await sleep(250);
    const plan = buildDeployPlan(input, { allowedTargets });
    log(job.id, "info", "Deploy dry-run plan ready", {
      target: plan.target,
      strategy: plan.strategy,
      service_count: plan.services.length,
      dry_run: plan.dry_run
    });
    return plan;
  }

  if (handler === "builtin:data.fetch") {
    const enabledEnvName = String(getConfig("handlers.data_fetch.enabled_env", "DATA_FETCH_ENABLED"));
    const allowlistEnvName = String(getConfig("handlers.data_fetch.allowlist_env", "DATA_FETCH_ALLOWLIST"));
    const timeoutEnvName = String(getConfig("handlers.data_fetch.timeout_env", "DATA_FETCH_TIMEOUT_MS"));
    const maxBytesEnvName = String(getConfig("handlers.data_fetch.max_bytes_env", "DATA_FETCH_MAX_BYTES"));
    const defaultAllowlist = getConfig("handlers.data_fetch.default_allowed_domains", []);
    const defaultTimeoutMs = Number(getConfig("handlers.data_fetch.default_timeout_ms", 8000)) || 8000;
    const defaultMaxBytes = Number(getConfig("handlers.data_fetch.default_max_bytes", 65536)) || 65536;
    const runtimeDataFetch = runtimeTools.data_fetch || {};

    const enabledRaw = String(process.env[enabledEnvName] || "").trim().toLowerCase();
    const enabledFromEnv = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
    const enabled = typeof runtimeDataFetch.enabled === "boolean" ? runtimeDataFetch.enabled : enabledFromEnv;
    if (!enabled) {
      throw new Error(`${enabledEnvName}=1 required for data.fetch`);
    }

    const envAllowlist = splitCsv(process.env[allowlistEnvName] || "");
    const allowlist = Array.isArray(runtimeDataFetch.allowlist) && runtimeDataFetch.allowlist.length > 0
      ? runtimeDataFetch.allowlist
      : envAllowlist.length > 0
      ? envAllowlist
      : (Array.isArray(defaultAllowlist) ? defaultAllowlist.map((x) => String(x || "").trim()).filter(Boolean) : []);
    if (allowlist.length < 1) {
      throw new Error(`No allowed fetch domains configured. Set ${allowlistEnvName}.`);
    }

    const timeoutRaw = Number(process.env[timeoutEnvName]);
    const maxBytesRaw = Number(process.env[maxBytesEnvName]);
    const timeoutOverride = Number(runtimeDataFetch.timeout_ms);
    const maxBytesOverride = Number(runtimeDataFetch.max_bytes);
    const timeoutMs = Number.isInteger(timeoutRaw) && timeoutRaw >= 200 && timeoutRaw <= 120000
      ? timeoutRaw
      : defaultTimeoutMs;
    const effectiveTimeoutMs = Number.isInteger(timeoutOverride) && timeoutOverride >= 200 && timeoutOverride <= 120000
      ? timeoutOverride
      : timeoutMs;
    const maxBytes = Number.isInteger(maxBytesRaw) && maxBytesRaw >= 512 && maxBytesRaw <= 1024 * 1024
      ? maxBytesRaw
      : defaultMaxBytes;
    const effectiveMaxBytes = Number.isInteger(maxBytesOverride) && maxBytesOverride >= 512 && maxBytesOverride <= 1024 * 1024
      ? maxBytesOverride
      : maxBytes;

    log(job.id, "info", "Fetching allowlisted URL", { url: String(input?.url || "") });
    return await runDataFetch(input, {
      allowlist,
      defaultTimeoutMs: effectiveTimeoutMs,
      defaultMaxBytes: effectiveMaxBytes
    });
  }

  if (handler === "builtin:data.file_read") {
    const enabledEnvName = String(getConfig("handlers.file_read.enabled_env", "DATA_FILE_READ_ENABLED"));
    const maxBytesEnvName = String(getConfig("handlers.file_read.max_bytes_env", "DATA_FILE_READ_MAX_BYTES"));
    const defaultMaxBytes = Number(getConfig("handlers.file_read.default_max_bytes", 262144)) || 262144;
    const rootFromConfig = String(
      getConfig("handlers.file_read.workspace_root", getConfig("providers.codex_oss.working_directory", "/workspace"))
    ).trim() || "/workspace";
    const enabledRaw = String(process.env[enabledEnvName] || "1").trim().toLowerCase();
    const enabled = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
    if (!enabled) {
      throw new Error(`${enabledEnvName}=1 required for data.file_read`);
    }
    const configuredMaxBytes = Number(process.env[maxBytesEnvName]);
    const effectiveMaxBytes = Number.isInteger(configuredMaxBytes) && configuredMaxBytes >= 512 && configuredMaxBytes <= 1024 * 1024
      ? configuredMaxBytes
      : defaultMaxBytes;

    log(job.id, "info", "Reading workspace file", { path: String(input?.path || input?.file_path || "") });
    return await runDataFileRead(input, {
      workspaceRoot: rootFromConfig,
      defaultMaxBytes: effectiveMaxBytes
    });
  }

  if (handler === "builtin:data.write_file") {
    const enabledEnvName = String(getConfig("handlers.file_write.enabled_env", "DATA_FILE_WRITE_ENABLED"));
    const maxBytesEnvName = String(getConfig("handlers.file_write.max_bytes_env", "DATA_FILE_WRITE_MAX_BYTES"));
    const defaultMaxBytes = Number(getConfig("handlers.file_write.default_max_bytes", 1024 * 1024)) || (1024 * 1024);
    const rootFromConfig = String(
      getConfig("handlers.file_write.workspace_root", getConfig("providers.codex_oss.working_directory", "/workspace"))
    ).trim() || "/workspace";
    const enabledRaw = String(process.env[enabledEnvName] || "1").trim().toLowerCase();
    const enabled = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
    if (!enabled) {
      throw new Error(`${enabledEnvName}=1 required for data.write_file`);
    }
    const configuredMaxBytes = Number(process.env[maxBytesEnvName]);
    const effectiveMaxBytes = Number.isInteger(configuredMaxBytes) && configuredMaxBytes >= 512 && configuredMaxBytes <= 10 * 1024 * 1024
      ? configuredMaxBytes
      : defaultMaxBytes;

    log(job.id, "info", "Writing workspace file", {
      path: String(input?.path || input?.file_path || ""),
      mode: String(input?.mode || "replace"),
      dry_run: input?.dry_run === true
    });
    return await runDataFileWrite(input, {
      workspaceRoot: rootFromConfig,
      defaultMaxBytes: effectiveMaxBytes
    });
  }

  if (handler === "builtin:tools.file_search") {
    const rootFromConfig = String(getConfig("providers.codex_oss.working_directory", "/workspace")).trim() || "/workspace";
    log(job.id, "info", "Searching files in workspace", {
      query: String(input?.query || input?.q || ""),
      path: String(input?.path || ".")
    });
    return await runFileSearch(input, {
      workspaceRoot: rootFromConfig,
      defaultMaxResults: 30
    });
  }

  if (handler === "builtin:tools.find_in_files") {
    const rootFromConfig = String(getConfig("providers.codex_oss.working_directory", "/workspace")).trim() || "/workspace";
    log(job.id, "info", "Searching text inside workspace files", {
      query: String(input?.query || input?.q || input?.pattern || ""),
      path: String(input?.path || "."),
      files: Array.isArray(input?.files) ? input.files.length : 0
    });
    return await runFindInFiles(input, {
      workspaceRoot: rootFromConfig
    });
  }

  if (handler === "builtin:code.component.generate") {
    log(job.id, "info", "Generating component files", { input });
    await sleep(180);
    return generateComponentFiles(input);
  }

  if (handler === "builtin:design.frontpage.layout") {
    log(job.id, "info", "Generating frontpage layout plan", { input });
    await sleep(180);
    return generateFrontpageLayout(input);
  }

  if (handler === "builtin:tool.exec") {
    const enabledEnvName = String(getConfig("handlers.exec.enabled_env", "TOOL_EXEC_ENABLED"));
    const allowlistEnvName = String(getConfig("handlers.exec.allowlist_env", "TOOL_EXEC_ALLOWLIST"));
    const timeoutEnvName = String(getConfig("handlers.exec.timeout_env", "TOOL_EXEC_TIMEOUT_MS"));
    const defaultAllowed = getConfig("handlers.exec.default_allowed_commands", []);
    const defaultTimeoutMs = Number(getConfig("handlers.exec.default_timeout_ms", 10000)) || 10000;
    const runtimeToolExec = runtimeTools.tool_exec || {};
    const enabledRaw = String(process.env[enabledEnvName] || "").trim().toLowerCase();
    const enabledFromEnv = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
    const enabled = typeof runtimeToolExec.enabled === "boolean" ? runtimeToolExec.enabled : enabledFromEnv;
    if (!enabled) {
      throw new Error(`${enabledEnvName}=1 required for tool.exec`);
    }
    const fromEnv = splitCsv(process.env[allowlistEnvName] || "");
    const allowlist = Array.isArray(runtimeToolExec.allowlist) && runtimeToolExec.allowlist.length > 0
      ? runtimeToolExec.allowlist
      : fromEnv.length > 0
      ? fromEnv
      : (Array.isArray(defaultAllowed) ? defaultAllowed.map((x) => String(x || "").trim()).filter(Boolean) : []);
    if (allowlist.length < 1) {
      throw new Error(`No allowed commands configured. Set ${allowlistEnvName}.`);
    }
    const configuredTimeoutRaw = process.env[timeoutEnvName];
    const configuredTimeout = Number(configuredTimeoutRaw);
    const timeoutOverride = Number(runtimeToolExec.timeout_ms);
    const timeoutFromConfig = Number.isInteger(configuredTimeout) && configuredTimeout >= 100 && configuredTimeout <= 120000
      ? configuredTimeout
      : defaultTimeoutMs;
    const effectiveTimeoutMs = Number.isInteger(timeoutOverride) && timeoutOverride >= 100 && timeoutOverride <= 120000
      ? timeoutOverride
      : timeoutFromConfig;
    const workspaceRoot = String(getConfig("providers.codex_oss.working_directory", "/workspace")).trim() || "/workspace";

    log(job.id, "info", "Executing allowlisted tool command", {
      command: String(input?.command || ""),
      args: Array.isArray(input?.args) ? input.args.length : 0
    });
    const out = await runToolExec(input, {
      allowlist,
      defaultTimeoutMs: effectiveTimeoutMs,
      cwd: workspaceRoot
    });
    if (!out.ok) {
      const reason = out.timed_out ? "tool.exec timeout" : `tool.exec failed with exit ${out.code}`;
      const e = new Error(reason);
      e.details = {
        timed_out: out.timed_out,
        code: out.code,
        signal: out.signal,
        stdout_tail: String(out.stdout || "").slice(-4000),
        stderr_tail: String(out.stderr || "").slice(-4000),
        duration_ms: out.duration_ms
      };
      throw e;
    }
    return {
      command: String(input?.command || ""),
      args: Array.isArray(input?.args) ? input.args.map((x) => String(x)) : [],
      duration_ms: out.duration_ms,
      stdout: out.stdout,
      stderr: out.stderr,
      code: out.code
    };
  }

  if (handler === "builtin:tools.web_search") {
    const enabledEnvName = String(getConfig("handlers.web_search.enabled_env", "WEB_SEARCH_ENABLED"));
    const providerEnvName = String(getConfig("handlers.web_search.provider_env", "WEB_SEARCH_PROVIDER"));
    const timeoutEnvName = String(getConfig("handlers.web_search.timeout_env", "WEB_SEARCH_TIMEOUT_MS"));
    const maxResultsEnvName = String(getConfig("handlers.web_search.max_results_env", "WEB_SEARCH_MAX_RESULTS"));
    const baseUrlEnvName = String(getConfig("handlers.web_search.base_url_env", "WEB_SEARCH_BASE_URL"));
    const braveApiKeyEnvName = String(getConfig("handlers.web_search.brave_api_key_env", "WEB_SEARCH_BRAVE_API_KEY"));
    const braveEndpointEnvName = String(getConfig("handlers.web_search.brave_endpoint_env", "WEB_SEARCH_BRAVE_ENDPOINT"));
    const defaultTimeoutMs = Number(getConfig("handlers.web_search.default_timeout_ms", 8000)) || 8000;
    const defaultMaxResults = Number(getConfig("handlers.web_search.default_max_results", 5)) || 5;
    const providerDefault = String(getConfig("handlers.web_search.default_provider", "duckduckgo")).trim() || "duckduckgo";
    const runtimeWebSearch = runtimeTools.web_search || {};
    const enabledRaw = String(process.env[enabledEnvName] || "").trim().toLowerCase();
    const enabledFromEnv = enabledRaw === "1" || enabledRaw === "true" || enabledRaw === "yes";
    const enabled = typeof runtimeWebSearch.enabled === "boolean" ? runtimeWebSearch.enabled : enabledFromEnv;
    if (!enabled) {
      throw new Error(`${enabledEnvName}=1 required for tools.web_search`);
    }
    const configuredTimeout = Number(process.env[timeoutEnvName]);
    const configuredMaxResults = Number(process.env[maxResultsEnvName]);
    const timeoutOverride = Number(runtimeWebSearch.timeout_ms);
    const maxResultsOverride = Number(runtimeWebSearch.max_results);
    const timeoutFromConfig = Number.isInteger(configuredTimeout) && configuredTimeout >= 200 && configuredTimeout <= 120000
      ? configuredTimeout
      : defaultTimeoutMs;
    const maxResultsFromConfig = Number.isInteger(configuredMaxResults) && configuredMaxResults >= 1 && configuredMaxResults <= 20
      ? configuredMaxResults
      : defaultMaxResults;
    const effectiveTimeoutMs = Number.isInteger(timeoutOverride) && timeoutOverride >= 200 && timeoutOverride <= 120000
      ? timeoutOverride
      : timeoutFromConfig;
    const effectiveMaxResults = Number.isInteger(maxResultsOverride) && maxResultsOverride >= 1 && maxResultsOverride <= 20
      ? maxResultsOverride
      : maxResultsFromConfig;
    const providerFromConfig = String(process.env[providerEnvName] || providerDefault).trim().toLowerCase() || "duckduckgo";
    const providerOverride = String(runtimeWebSearch.provider || "").trim().toLowerCase();
    const provider = (providerOverride === "duckduckgo" || providerOverride === "brave") ? providerOverride : providerFromConfig;
    const baseUrlFromConfig = String(process.env[baseUrlEnvName] || "").trim() || String(getConfig("handlers.web_search.default_base_url", "https://api.duckduckgo.com"));
    const baseUrl = String(runtimeWebSearch.base_url || "").trim() || baseUrlFromConfig;
    const braveApiKey = Object.prototype.hasOwnProperty.call(runtimeWebSearch, "brave_api_key")
      ? String(runtimeWebSearch.brave_api_key || "").trim()
      : String(process.env[braveApiKeyEnvName] || "").trim();
    const braveEndpointFromConfig = String(process.env[braveEndpointEnvName] || "").trim() || String(getConfig("handlers.web_search.default_brave_endpoint", "https://api.search.brave.com/res/v1/web/search"));
    const braveEndpoint = String(runtimeWebSearch.brave_endpoint || "").trim() || braveEndpointFromConfig;

    log(job.id, "info", "Executing web search", {
      query: String(input?.query || input?.q || ""),
      max_results: Number(input?.max_results) || effectiveMaxResults,
      provider
    });
    return await runWebSearch(input, {
      provider,
      baseUrl,
      braveApiKey,
      braveEndpoint,
      defaultTimeoutMs: effectiveTimeoutMs,
      defaultMaxResults: effectiveMaxResults
    });
  }

  if (handler === "builtin:workflow.run") {
    const rootFromConfig = String(getConfig("providers.codex_oss.working_directory", "/workspace")).trim() || "/workspace";
    log(job.id, "info", "Executing workflow", {
      workflow: String(input?.workflow || input?.name || "")
    });
    return await runWorkflow(input, {
      workspaceRoot: rootFromConfig,
      createJob: (type, nextInput, opts) => enqueueInternalJob(type, nextInput, opts),
      waitJob: async (waitJobId, waitOpts = {}) => {
        const timeoutMs = Math.max(1000, Number(waitOpts?.timeoutMs) || 120000);
        const started = Date.now();
        while (Date.now() - started < timeoutMs) {
          const row = db.prepare(`SELECT status, result_json, error_json FROM jobs WHERE id = ?`).get(waitJobId);
          if (!row) return { status: "missing", result: null, error: { message: "job not found" } };
          const status = String(row.status || "");
          if (status === "succeeded") {
            return {
              status,
              result: safeJsonParse(row.result_json) || null,
              error: safeJsonParse(row.error_json) || null
            };
          }
          if (status === "failed" || status === "cancelled") {
            return {
              status,
              result: safeJsonParse(row.result_json) || null,
              error: safeJsonParse(row.error_json) || null
            };
          }
          await sleep(250);
        }
        return { status: "timeout", result: null, error: { message: "wait timeout" } };
      }
    });
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
    const candidates = db.prepare(`
      SELECT *
      FROM jobs
      WHERE status = 'queued'
        AND queue IN (${placeholders})
        AND (locked_at IS NULL)
      ORDER BY priority DESC, created_at ASC
      LIMIT 100
    `).all(...workerQueueAllowlist);

    if (!Array.isArray(candidates) || candidates.length < 1) return null;

    for (const job of candidates) {
      const depIds = parseJobDependencies(job);
      if (depIds.length > 0) {
        const depState = resolveDependencyState(depIds);
        if (depState.state === "waiting") continue;
        if (depState.state === "blocked") {
          const details = {
            depends_on: depIds,
            missing_dependencies: depState.missing,
            failed_dependencies: depState.failed
          };
          db.prepare(`
            UPDATE jobs
            SET status = 'failed', error_json = ?, locked_at = NULL, locked_by = NULL, updated_at = ?
            WHERE id = ?
          `).run(
            safeJsonStringify({
              message: "Dependency failed or missing",
              code: "DEPENDENCY_BLOCKED",
              details,
              at: nowIso()
            }),
            nowIso(),
            job.id
          );
          db.prepare(`
            INSERT INTO job_logs (job_id, ts, level, message, meta_json)
            VALUES (?, ?, ?, ?, ?)
          `).run(job.id, nowIso(), "error", "Dependency blocked job", safeJsonStringify(details));
          continue;
        }
      }

      db.prepare(`
        UPDATE jobs
        SET locked_at = ?, locked_by = ?, status = 'running', updated_at = ?
        WHERE id = ?
      `).run(nowIso(), workerId, nowIso(), job.id);

      return { ...job, status: "running", locked_at: nowIso(), locked_by: workerId, updated_at: nowIso() };
    }

    return null;
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

function canAutoRetryWriteFileWithMkdirP(job, typeRow, err) {
  if (!job || !typeRow) return false;
  if (String(typeRow.name || "") !== "data.write_file") return false;
  if (String(typeRow.handler || "") !== "builtin:data.write_file") return false;
  const msg = String(err?.message || err || "").toLowerCase();
  const missingParent =
    msg.includes("parent directory does not exist")
    || (msg.includes("enoent") && msg.includes("no such file or directory"));
  if (!missingParent) return false;
  const input = safeJsonParse(job.input_json);
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  if (input.mkdir_p === true) return false;
  if (input.__auto_retry_mkdir_p_attempted === true) return false;
  return true;
}

function buildWriteFileAutoRetryInput(job) {
  const base = safeJsonParse(job?.input_json) || {};
  return {
    ...base,
    mkdir_p: true,
    __auto_retry_mkdir_p_attempted: true
  };
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
  const timeoutMs = (fresh.timeout_sec || 120) * 1000;

  const attempts = (fresh.attempts || 0) + 1;
  markJob(job.id, { attempts });

  try {
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
    if (canAutoRetryWriteFileWithMkdirP(job, typeRow, e)) {
      const retryInput = buildWriteFileAutoRetryInput(job);
      markJob(job.id, { input_json: safeJsonStringify(retryInput) });
      log(job.id, "warn", "Auto-retrying data.write_file with mkdir_p=true after missing parent directory error");
      try {
        const retriedJob = { ...job, input_json: safeJsonStringify(retryInput) };
        const retryResult = await withTimeout(runBuiltin(retriedJob, typeRow.handler), timeoutMs);
        markJob(job.id, {
          status: "succeeded",
          input_json: safeJsonStringify(retryInput),
          result_json: safeJsonStringify(retryResult),
          error_json: null,
          locked_at: null,
          locked_by: null,
        });
        log(job.id, "info", "Job succeeded after auto-retry with mkdir_p=true");
        recordMetricSafe("job.succeeded", { source: "worker", labels: { type: job.type || "unknown", queue: job.queue || "default" } });
        const done = db.prepare(`SELECT * FROM jobs WHERE id = ?`).get(job.id);
        try {
          if (done) writeJobToWorkspaceIndex(workspaceRootForIndex, done, { event: "finished" });
        } catch {}
        if (done) await postCallback(done);
        return true;
      } catch (retryErr) {
        e = retryErr;
      }
    }

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
  try {
    if (done) writeJobToWorkspaceIndex(workspaceRootForIndex, done, { event: "finished" });
  } catch {}
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

module.exports = { startWorker, log, parseJobDependencies, resolveDependencyState };
