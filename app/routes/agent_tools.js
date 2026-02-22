/**
 * Agent Tools API Routes
 *
 * Provides tool registry and batch invocation endpoints for LLM function calling.
 *
 * Endpoints:
 * - GET /v1/agent-tools - Return OpenAI tool specifications
 * - POST /v1/agent-tools/invoke-batch - Execute tool calls as jobs
 *
 * Public API exports:
 * - registerAgentToolsRoutes(app, deps): Register all agent tool routes
 */

const crypto = require("crypto");
const { buildAgentFunctionTools, AGENT_TOOL_BY_FN } = require("../agent_tools/specs");
const { createRuntimeToolsReader, isRuntimeEnabledForAgentTool } = require("../agent_tools/policy");
const { getConfig } = require("../config");
const { safePreviewValue } = require("../utils/safePreviewValue");

module.exports = function registerAgentToolsRoutes(app, deps) {
  const { auth, db, badRequest, nowIso, recordMetricSafe } = deps;

  // Cached runtime tools reader (1.5s TTL from UI prefs)
  const readRuntimeToolsOverrides = createRuntimeToolsReader(db);

  /**
   * Load enabled job types from database
   * Filters for builtin handlers only (excludes provider-backed tools)
   * @returns {Set<string>} Set of enabled job type names
   */
  function loadEnabledJobTypes() {
    const rows = db.prepare(`
      SELECT name FROM job_types
      WHERE enabled = 1 AND handler LIKE 'builtin:%'
    `).all();
    return new Set(rows.map(r => r.name));
  }

  /**
   * Validate invoke-batch request envelope
   * @throws {Error} with validation message
   * @returns {object} Validated parameters
   */
  function validateInvokeBatchEnvelope(body) {
    if (!body || typeof body !== "object") {
      throw new Error("Request body must be an object");
    }

    const calls = body.calls;
    if (!Array.isArray(calls)) {
      throw new Error("'calls' must be an array");
    }
    if (calls.length < 1) {
      throw new Error("'calls' must have at least 1 item");
    }
    if (calls.length > 20) {
      throw new Error("'calls' must have at most 20 items");
    }

    // Validate each call
    for (let i = 0; i < calls.length; i++) {
      const call = calls[i];
      if (!call || typeof call !== "object") {
        throw new Error(`calls[${i}] must be an object`);
      }

      const callId = call.call_id;
      if (typeof callId !== "string" || !callId.trim()) {
        throw new Error(`calls[${i}].call_id is required`);
      }
      if (callId.length > 120) {
        throw new Error(`calls[${i}].call_id must be at most 120 characters`);
      }

      const name = call.name;
      if (typeof name !== "string" || !name.trim()) {
        throw new Error(`calls[${i}].name is required`);
      }

      const args = call.arguments;
      if (args !== null && (typeof args !== "object" || Array.isArray(args))) {
        throw new Error(`calls[${i}].arguments must be an object or null`);
      }
    }

    // Validate mode: "sync" | "async"
    const mode = String(body.mode || "sync").toLowerCase();
    if (mode !== "sync" && mode !== "async") {
      throw new Error("'mode' must be 'sync' or 'async'");
    }

    // Validate wait_ms
    const waitMs = parseInt(body.wait_ms || "15000", 10);
    if (!Number.isInteger(waitMs) || waitMs < 100 || waitMs > 60000) {
      throw new Error("'wait_ms' must be an integer 100..60000");
    }

    // Validate queue
    const queue = String(body.queue || "default").trim();
    const queueNamePattern = /^[a-z0-9._:-]{1,80}$/i;
    if (!queueNamePattern.test(queue)) {
      throw new Error("'queue' must match ^[a-z0-9._:-]{1,80}$");
    }

    return { calls, mode, waitMs, queue };
  }

  /**
   * Create job from tool call.
   * NOTE: This logic mirrors createJobFromPayload() in jobs.js.
   * KEEP IN SYNC when job creation logic changes.
   *
   * @param {object} toolCall - Tool call from request
   * @param {string} queue - Target queue name
   * @param {object} authInfo - Authentication info from req.auth
   * @returns {object} Creation result with {ok, call_id, name, job_id?, error?}
   */
  function createJobFromToolCall(toolCall, queue, authInfo) {
    const { call_id, name, arguments: args } = toolCall;

    // Lookup tool spec
    const spec = AGENT_TOOL_BY_FN.get(name);
    if (!spec) {
      return {
        ok: false,
        call_id,
        name,
        error: { code: "UNKNOWN_TOOL", message: `Tool '${name}' not found in registry` }
      };
    }

    // Check if job type is enabled
    const typeRow = db.prepare(`
      SELECT name, enabled, handler, default_timeout_sec, default_max_attempts
      FROM job_types
      WHERE name = ?
    `).get(spec.jobType);

    if (!typeRow || !typeRow.enabled) {
      return {
        ok: false,
        call_id,
        name,
        error: { code: "JOB_TYPE_DISABLED", message: `Job type '${spec.jobType}' is disabled` }
      };
    }

    // Check queue allowlist
    const allowedQueues = Array.isArray(authInfo?.queue_allowlist) ? authInfo.queue_allowlist : null;
    if (allowedQueues && !allowedQueues.includes(queue)) {
      return {
        ok: false,
        call_id,
        name,
        error: {
          code: "FORBIDDEN",
          message: `Queue '${queue}' is not allowed for this API key.`,
          details: { allowed_queues: allowedQueues }
        }
      };
    }

    // Create job
    const jobId = crypto.randomUUID();
    const now = nowIso();

    try {
      db.prepare(`
        INSERT INTO jobs (id, type, queue, status, priority, timeout_sec, max_attempts, attempts, callback_url, tags_json, input_json, created_at, updated_at)
        VALUES (?, ?, ?, 'queued', ?, ?, ?, 0, NULL, ?, ?, ?, ?)
      `).run(
        jobId,
        spec.jobType,
        queue,
        5, // default priority
        typeRow.default_timeout_sec || 120,
        typeRow.default_max_attempts || 1,
        JSON.stringify(["agent-tool"]), // tags
        JSON.stringify(args || {}),
        now,
        now
      );

      recordMetricSafe("agent_tools.job_created", {
        labels: { tool_name: name, job_type: spec.jobType }
      });

      return {
        ok: true,
        call_id,
        name,
        job_id: jobId,
        job_type: spec.jobType
      };
    } catch (e) {
      return {
        ok: false,
        call_id,
        name,
        error: { code: "JOB_CREATE_FAILED", message: String(e.message) }
      };
    }
  }

  /**
   * Sleep helper for polling
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Poll for job completion until wait_ms deadline.
   * Uses batched WHERE id IN (...) query for efficiency.
   *
   * @param {string[]} jobIds - Job IDs to poll
   * @param {number} waitMs - Maximum wait time in milliseconds
   * @returns {Promise<Map<string, object>>} Map of job_id -> result
   */
  async function pollForCompletion(jobIds, waitMs) {
    const deadline = Date.now() + waitMs;
    const results = new Map();
    const pendingIds = new Set(jobIds);

    // Dynamic polling: 200ms first second, then 500ms
    let pollInterval = 200;
    const firstSecondDeadline = Date.now() + 1000;

    while (pendingIds.size > 0 && Date.now() < deadline) {
      // Batch query: get all pending jobs in one SQL call
      const placeholders = jobIds.map(() => "?").join(",");
      const rows = db.prepare(`
        SELECT id, status, result_json, error_json
        FROM jobs
        WHERE id IN (${placeholders})
      `).all(...jobIds);

      for (const row of rows) {
        if (!pendingIds.has(row.id)) continue;

        if (row.status === "succeeded") {
          const output = safePreviewValue(row.result_json ? JSON.parse(row.result_json) : null);
          results.set(row.id, { ok: true, output });
          pendingIds.delete(row.id);
        } else if (row.status === "failed") {
          const error = row.error_json ? JSON.parse(row.error_json) : null;
          results.set(row.id, {
            ok: false,
            error: {
              code: error?.code || "JOB_FAILED",
              message: error?.message || "Job execution failed"
            }
          });
          pendingIds.delete(row.id);
        } else if (row.status === "cancelled") {
          results.set(row.id, {
            ok: false,
            error: { code: "JOB_CANCELLED", message: "Job was cancelled" }
          });
          pendingIds.delete(row.id);
        }
      }

      if (pendingIds.size === 0) break;

      // Switch to 500ms after first second
      if (Date.now() >= firstSecondDeadline) {
        pollInterval = 500;
      }

      await sleep(pollInterval);
    }

    // Mark any unfinished jobs as pending
    for (const jobId of pendingIds) {
      results.set(jobId, {
        ok: false,
        pending: true,
        job_id: jobId,
        error: { code: "TIMEOUT", message: "Job did not complete within wait_ms" }
      });
    }

    return results;
  }

  // ==========================================================================
  // GET /v1/agent-tools
  // ==========================================================================

  app.get("/v1/agent-tools", auth, (req, res) => {
    const enabledJobTypes = loadEnabledJobTypes();
    const runtimeTools = readRuntimeToolsOverrides();

    // Wrap isRuntimeEnabledForAgentTool to match expected signature
    const isEnabledCheck = (spec) => isRuntimeEnabledForAgentTool(spec, runtimeTools, getConfig);

    const tools = buildAgentFunctionTools({
      enabledJobTypes,
      isEnabledCheck,
      runtimeTools
    });

    // IMPORTANT: Both read and admin keys see the same filtered list
    // Registry only lists tools that are:
    // 1. builtin handler
    // 2. job_type enabled
    // 3. runtime policy enabled
    // Admin difference is invoke permission, not visibility

    recordMetricSafe("agent_tools.registry_list", {
      labels: { role: req.auth?.role || "unknown", count: tools.length }
    });

    return res.json({
      ok: true,
      tools,
      count: tools.length
    });
  });

  // ==========================================================================
  // POST /v1/agent-tools/invoke-batch
  // ==========================================================================

  app.post("/v1/agent-tools/invoke-batch", auth, async (req, res) => {
    // Explicit admin role check for POST
    if (req.auth?.role !== "admin") {
      return res.status(403).json({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "This operation requires an admin API key."
        }
      });
    }

    try {
      // Validate envelope
      const { calls, mode, waitMs, queue } = validateInvokeBatchEnvelope(req.body);

      // Create jobs for all calls
      const jobIds = [];
      const creationResults = [];

      for (const call of calls) {
        const result = createJobFromToolCall(call, queue, req.auth);
        creationResults.push(result);
        if (result.ok) {
          jobIds.push(result.job_id);
        }
      }

      // Async mode: return immediately with job_ids
      if (mode === "async") {
        return res.json({
          ok: true,
          results: creationResults,
          tool_messages: [],
          mode: "async"
        });
      }

      // Sync mode: poll for completion
      const completionResults = await pollForCompletion(jobIds, waitMs);

      // Build results array with job completion status
      const finalResults = creationResults.map(r => {
        if (!r.ok) {
          // Creation failed - include error in results
          return {
            call_id: r.call_id,
            name: r.name,
            ok: false,
            error: r.error
          };
        }

        const jobResult = completionResults[r.job_id];
        return {
          call_id: r.call_id,
          name: r.name,
          ...jobResult
        };
      });

      // Build tool_messages for EVERY call (not just successful ones)
      // This ensures LLM tool-loop doesn't hang waiting for missing responses
      const toolMessages = finalResults.map(r => {
        const contentObj = {
          ok: r.ok,
          ...(r.error ? { error: r.error } : {}),
          ...(r.output ? { result: r.output } : {}),
          ...(r.pending ? { pending: true, job_id: r.job_id } : {})
        };
        return {
          role: "tool",
          tool_call_id: r.call_id,
          name: r.name,
          content: JSON.stringify(contentObj)
        };
      });

      return res.json({
        ok: true,
        results: finalResults,
        tool_messages: toolMessages,
        mode: "sync"
      });

    } catch (e) {
      if (e.message.includes("'")) {
        return badRequest(res, "VALIDATION_ERROR", e.message);
      }
      return badRequest(res, "VALIDATION_ERROR", String(e.message || e));
    }
  });
};
