const express = require("express");
const morgan = require("morgan");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { db } = require("./db");
const { log } = require("./worker");
const { getConfig, envOrConfig, envIntOrConfig, envBoolOrConfig } = require("./config");
const { prewarmRepoContextSummaries } = require("./providers/openai");
const { getMemoryVectorSettings } = require("./memory/settings");
const { embedText } = require("./memory/ollama_embed");
const { searchMemoryVectors } = require("./memory/vector_store");
const { rowToSchedule, validateCronExpression, nextCronRunFrom } = require("./scheduler");
const { getObservabilitySettings, recordMetric, collectMetricCounters, getJobStatusSnapshot, buildRuntimeAlerts } = require("./metrics");
const {
  generateSessionId,
  saveWorkingMemoryState,
  loadWorkingMemoryState,
  clearWorkingMemoryState,
  listRecentWorkingMemorySessions,
  buildWorkingMemoryContext,
  getLatestWorkingMemorySession
} = require("./memory/working_memory");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

const port = envIntOrConfig("PORT", "api.port", 3001);
const workspaceRoot = path.resolve(String(envOrConfig("WORKSPACE_ROOT", "providers.codex_oss.working_directory", "/workspace")).trim() || "/workspace");
const workspaceFileViewMaxBytes = Math.max(1024, envIntOrConfig("WORKSPACE_FILE_VIEW_MAX_BYTES", "api.workspace.file_view_max_bytes", 262144));
const workspaceFileWriteMaxBytes = Math.max(1024, envIntOrConfig("WORKSPACE_FILE_WRITE_MAX_BYTES", "api.workspace.file_write_max_bytes", 262144));
const workspaceUploadMaxBytes = Math.max(1024, envIntOrConfig("WORKSPACE_UPLOAD_MAX_BYTES", "api.workspace.upload_max_bytes", 4 * 1024 * 1024));
const schedulerCronTimezone = String(envOrConfig("SCHEDULER_CRON_TZ", "worker.scheduler.cron_timezone", "UTC")).trim() || "UTC";
const apiKey = String(process.env.API_KEY || "").trim();
const apiAuthDisabled = process.env.API_AUTH_DISABLED != null
  ? process.env.API_AUTH_DISABLED === "1"
  : getConfig("api.auth.required", true) === false;
const apiKeyHeader = String(envOrConfig("API_KEY_HEADER", "api.auth.header", "x-api-key")).toLowerCase();
const sseApiKeyParam = String(envOrConfig("SSE_API_KEY_PARAM", "api.sse.query_api_key_param", "api_key"));
const memoryVectorSettings = getMemoryVectorSettings();
const allowedAuthRoles = new Set(["admin", "read"]);
const queueNamePattern = /^[a-z0-9._:-]{1,80}$/i;

function normalizeQueueAllowlist(raw, idx) {
  if (raw == null) return null;
  const source = Array.isArray(raw) ? raw : String(raw).split(",");
  const out = [];
  for (const item of source) {
    const queue = String(item || "").trim();
    if (!queue) continue;
    if (!queueNamePattern.test(queue)) {
      throw new Error(`api.auth.keys[${idx}].queue_allowlist has invalid queue '${queue}'`);
    }
    if (!out.includes(queue)) out.push(queue);
  }
  return out.length > 0 ? out : null;
}

function normalizeAuthKeyEntry(raw, idx) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`api.auth.keys[${idx}] must be an object`);
  }
  const key = String(raw.key || "").trim();
  if (!key) throw new Error(`api.auth.keys[${idx}].key is required`);
  const role = String(raw.role || "admin").trim().toLowerCase();
  if (!allowedAuthRoles.has(role)) {
    throw new Error(`api.auth.keys[${idx}].role must be one of: admin, read`);
  }
  return {
    name: String(raw.name || `key-${idx + 1}`).trim() || `key-${idx + 1}`,
    key,
    role,
    sse: raw.sse == null ? true : Boolean(raw.sse),
    queue_allowlist: normalizeQueueAllowlist(raw.queue_allowlist, idx)
  };
}

function buildApiAuthKeys() {
  let source = [];
  const rawEnv = String(process.env.API_KEYS_JSON || "").trim();
  if (rawEnv) {
    let parsed;
    try {
      parsed = JSON.parse(rawEnv);
    } catch (e) {
      throw new Error(`invalid API_KEYS_JSON JSON: ${String(e?.message || e)}`);
    }
    if (!Array.isArray(parsed)) throw new Error("API_KEYS_JSON must be a JSON array");
    source = parsed;
  } else {
    const configured = getConfig("api.auth.keys", []);
    source = Array.isArray(configured) ? configured : [];
  }

  if (source.length > 0) return source.map((entry, idx) => normalizeAuthKeyEntry(entry, idx));
  if (apiKey) return [{ name: "legacy-api-key", key: apiKey, role: "admin", sse: true, queue_allowlist: null }];
  return [];
}

let apiAuthKeys = [];
try {
  apiAuthKeys = buildApiAuthKeys();
} catch (e) {
  console.error(`[auth] ${String(e?.message || e)}`);
  process.exit(1);
}

function nowIso() { return new Date().toISOString(); }

function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

function recordMetricSafe(name, opts = {}) {
  try {
    recordMetric(db, name, opts);
  } catch {}
}

function authMisconfigured(res) {
  return res.status(503).json({
    ok: false,
    error: {
      code: "AUTH_NOT_CONFIGURED",
      message: "API auth is not configured. Set API_KEY/API_KEYS_JSON or enable API_AUTH_DISABLED=1 for local development."
    }
  });
}

function timingSafeEqualString(a, b) {
  const aBuf = Buffer.from(String(a || ""), "utf8");
  const bBuf = Buffer.from(String(b || ""), "utf8");
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function findPrincipalByKey(candidate) {
  const key = String(candidate || "");
  if (!key) return null;
  for (const principal of apiAuthKeys) {
    if (timingSafeEqualString(key, principal.key)) return principal;
  }
  return null;
}

function authenticate(req, { allowQuery = false } = {}) {
  if (apiAuthKeys.length < 1) {
    if (apiAuthDisabled) return { ok: true, principal: { name: "auth-disabled", role: "admin", sse: true, queue_allowlist: null } };
    return { ok: false, reason: "misconfigured" };
  }

  const fromHeader = findPrincipalByKey(req.header(apiKeyHeader));
  if (fromHeader) return { ok: true, principal: fromHeader };

  if (allowQuery) {
    const queryValue = req.query[sseApiKeyParam] ? String(req.query[sseApiKeyParam]) : "";
    const fromQuery = findPrincipalByKey(queryValue);
    if (fromQuery) return { ok: true, principal: fromQuery };
  }

  return { ok: false, reason: "unauthorized" };
}

function isWriteMethod(method) {
  const m = String(method || "").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function auth(req, res, next) {
  const out = authenticate(req);
  if (!out.ok) {
    if (out.reason === "misconfigured") return authMisconfigured(res);
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
  }
  req.auth = {
    name: out.principal.name,
    role: out.principal.role,
    sse: Boolean(out.principal.sse),
    queue_allowlist: Array.isArray(out.principal.queue_allowlist) ? out.principal.queue_allowlist.slice() : null
  };
  if (isWriteMethod(req.method) && out.principal.role !== "admin") {
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "This operation requires an admin API key." }
    });
  }
  return next();
}

function authSse(req, res, next) {
  const out = authenticate(req, { allowQuery: true });
  if (!out.ok) {
    if (out.reason === "misconfigured") return authMisconfigured(res);
    return res.status(401).json({ ok: false, error: { code: "UNAUTHORIZED", message: "Unauthorized" } });
  }
  req.auth = {
    name: out.principal.name,
    role: out.principal.role,
    sse: Boolean(out.principal.sse),
    queue_allowlist: Array.isArray(out.principal.queue_allowlist) ? out.principal.queue_allowlist.slice() : null
  };
  if (!out.principal.sse) {
    return res.status(403).json({
      ok: false,
      error: { code: "FORBIDDEN", message: "This API key is not allowed to access SSE streams." }
    });
  }
  return next();
}

function badRequest(res, code, message, details) {
  return res.status(400).json({ ok: false, error: { code, message, details } });
}

function normalizeTypeName(name) {
  return String(name || "").trim();
}

function normalizeQueueName(name) {
  return String(name || "").trim();
}

function parseOptionalInt(value, { min, max, field }) {
  if (value == null) return undefined;
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`'${field}' must be integer ${min}..${max}`);
  }
  return value;
}

function splitCsvList(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function splitCsvListOrArray(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  return splitCsvList(value);
}

function normalizeRuntimeToolsPrefs(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const toolExec = src.tool_exec && typeof src.tool_exec === "object" ? src.tool_exec : {};
  const dataFetch = src.data_fetch && typeof src.data_fetch === "object" ? src.data_fetch : {};
  const webSearch = src.web_search && typeof src.web_search === "object" ? src.web_search : {};

  const out = {
    tool_exec: {},
    data_fetch: {},
    web_search: {}
  };

  if (typeof toolExec.enabled === "boolean") out.tool_exec.enabled = toolExec.enabled;
  if (toolExec.allowlist != null) out.tool_exec.allowlist = splitCsvListOrArray(toolExec.allowlist);
  if (Number.isInteger(Number(toolExec.timeout_ms))) out.tool_exec.timeout_ms = Number(toolExec.timeout_ms);

  if (typeof dataFetch.enabled === "boolean") out.data_fetch.enabled = dataFetch.enabled;
  if (dataFetch.allowlist != null) out.data_fetch.allowlist = splitCsvListOrArray(dataFetch.allowlist);
  if (Number.isInteger(Number(dataFetch.timeout_ms))) out.data_fetch.timeout_ms = Number(dataFetch.timeout_ms);
  if (Number.isInteger(Number(dataFetch.max_bytes))) out.data_fetch.max_bytes = Number(dataFetch.max_bytes);

  if (typeof webSearch.enabled === "boolean") out.web_search.enabled = webSearch.enabled;
  if (typeof webSearch.provider === "string") out.web_search.provider = String(webSearch.provider || "").trim().toLowerCase();
  if (Number.isInteger(Number(webSearch.timeout_ms))) out.web_search.timeout_ms = Number(webSearch.timeout_ms);
  if (Number.isInteger(Number(webSearch.max_results))) out.web_search.max_results = Number(webSearch.max_results);
  if (typeof webSearch.base_url === "string") out.web_search.base_url = String(webSearch.base_url || "").trim();
  if (typeof webSearch.brave_api_key === "string") out.web_search.brave_api_key = String(webSearch.brave_api_key || "").trim();
  if (typeof webSearch.brave_endpoint === "string") out.web_search.brave_endpoint = String(webSearch.brave_endpoint || "").trim();

  return out;
}

function readRuntimeToolsPrefs() {
  const row = db.prepare(`SELECT value_json FROM ui_prefs WHERE scope = ?`).get("runtime_tools");
  const parsed = row?.value_json ? safeJsonParse(row.value_json) : null;
  return normalizeRuntimeToolsPrefs(parsed || {});
}

function ensureInputObjectForHandler(inputObj, handlerName) {
  if (!inputObj || typeof inputObj !== "object" || Array.isArray(inputObj)) {
    throw new Error(`${handlerName} requires 'input' object`);
  }
  return inputObj;
}

function validateJobInputByHandler(handler, inputObj) {
  const handlerName = String(handler || "");
  const genericInput = inputObj && typeof inputObj === "object" && !Array.isArray(inputObj) ? inputObj : null;
  if (genericInput && genericInput.depends_on != null) {
    if (!Array.isArray(genericInput.depends_on)) {
      throw new Error("input.depends_on must be an array of job id strings");
    }
    if (genericInput.depends_on.length > 50) {
      throw new Error("input.depends_on supports at most 50 dependency ids");
    }
    for (const dep of genericInput.depends_on) {
      const id = String(dep || "").trim();
      if (!id) throw new Error("input.depends_on entries must be non-empty strings");
      if (id.length > 120) throw new Error("input.depends_on entries must be at most 120 characters");
    }
  }

  if (handlerName === "builtin:tool.exec") {
    const input = ensureInputObjectForHandler(inputObj, "tool.exec");
    const command = String(input.command || input.cmd || input.script || "").trim();
    if (!command) throw new Error("tool.exec requires input.command");
    if (command.length > 4000) throw new Error("tool.exec input.command must be at most 4000 characters");
    if (input.args != null) {
      if (!Array.isArray(input.args)) throw new Error("tool.exec input.args must be an array of strings");
      if (input.args.length > 100) throw new Error("tool.exec input.args supports at most 100 entries");
      for (const arg of input.args) {
        if (typeof arg !== "string") throw new Error("tool.exec input.args must be an array of strings");
        if (arg.length > 4000) throw new Error("tool.exec args entries must be at most 4000 characters");
      }
    }
    if (input.timeout_ms != null) {
      parseOptionalInt(input.timeout_ms, { min: 100, max: 120000, field: "input.timeout_ms" });
    }
    return;
  }

  if (handlerName === "builtin:data.fetch") {
    const input = ensureInputObjectForHandler(inputObj, "data.fetch");
    const urlRaw = String(input.url || "").trim();
    if (!urlRaw) throw new Error("data.fetch requires input.url");
    let parsed;
    try {
      parsed = new URL(urlRaw);
    } catch {
      throw new Error("data.fetch input.url must be valid absolute URL");
    }
    if (parsed.protocol !== "https:") {
      throw new Error("data.fetch input.url must use https://");
    }
    if (input.timeout_ms != null) {
      parseOptionalInt(input.timeout_ms, { min: 200, max: 120000, field: "input.timeout_ms" });
    }
    if (input.max_bytes != null) {
      parseOptionalInt(input.max_bytes, { min: 512, max: 1024 * 1024, field: "input.max_bytes" });
    }
    return;
  }

  if (handlerName === "builtin:data.file_read") {
    const input = ensureInputObjectForHandler(inputObj, "data.file_read");
    const filePath = String(input.path || input.file_path || "").trim();
    if (!filePath) throw new Error("data.file_read requires input.path");
    if (filePath.length > 2000) throw new Error("data.file_read input.path must be at most 2000 characters");
    if (input.max_bytes != null) {
      parseOptionalInt(input.max_bytes, { min: 512, max: 1024 * 1024, field: "input.max_bytes" });
    }
    return;
  }

  if (handlerName === "builtin:data.write_file") {
    const input = ensureInputObjectForHandler(inputObj, "data.write_file");
    const filePath = String(input.path || input.file_path || "").trim();
    if (!filePath) throw new Error("data.write_file requires input.path");
    if (filePath.length > 2000) throw new Error("data.write_file input.path must be at most 2000 characters");
    const mode = String(input.mode || "replace").trim().toLowerCase();
    if (!["replace", "append", "prepend", "insert_at", "replace_range"].includes(mode)) {
      throw new Error("data.write_file input.mode must be one of: replace, append, prepend, insert_at, replace_range");
    }
    const hasContent = input.content != null;
    const hasContentBase64 = input.content_base64 != null;
    if (hasContent && hasContentBase64) {
      throw new Error("data.write_file input.content and input.content_base64 are mutually exclusive");
    }
    if (hasContent) {
      const content = String(input.content || "");
      if (Buffer.byteLength(content, "utf8") > 10 * 1024 * 1024) {
        throw new Error("data.write_file input.content must be at most 10485760 bytes");
      }
    }
    if (hasContentBase64) {
      const b64 = String(input.content_base64 || "").trim();
      if (!/^[A-Za-z0-9+/=\s]+$/.test(b64)) {
        throw new Error("data.write_file input.content_base64 must be base64 text");
      }
      if (Buffer.byteLength(b64, "utf8") > 14 * 1024 * 1024) {
        throw new Error("data.write_file input.content_base64 must be at most 14680064 bytes");
      }
    }
    if (mode === "insert_at") {
      parseOptionalInt(input.offset, { min: 0, max: 10 * 1024 * 1024, field: "input.offset" });
    }
    if (mode === "replace_range") {
      parseOptionalInt(input.start, { min: 0, max: 10 * 1024 * 1024, field: "input.start" });
      parseOptionalInt(input.end, { min: 0, max: 10 * 1024 * 1024, field: "input.end" });
    }
    if ((mode === "insert_at" || mode === "replace_range") && input.create_if_missing === true) {
      throw new Error(`data.write_file input.create_if_missing is not allowed with mode '${mode}' (targeted modes require existing file)`);
    }
    if (input.max_bytes != null) {
      parseOptionalInt(input.max_bytes, { min: 512, max: 10 * 1024 * 1024, field: "input.max_bytes" });
    }
    if (input.dry_run != null && typeof input.dry_run !== "boolean") throw new Error("data.write_file input.dry_run must be boolean");
    if (input.create_if_missing != null && typeof input.create_if_missing !== "boolean") throw new Error("data.write_file input.create_if_missing must be boolean");
    if (input.mkdir_p != null && typeof input.mkdir_p !== "boolean") throw new Error("data.write_file input.mkdir_p must be boolean");
    if (input.expected_sha256 != null) {
      const v = String(input.expected_sha256 || "").trim().toLowerCase();
      if (!/^[a-f0-9]{64}$/.test(v)) throw new Error("data.write_file input.expected_sha256 must be 64 hex chars");
    }
    return;
  }

  if (handlerName === "builtin:tools.file_search") {
    const input = ensureInputObjectForHandler(inputObj, "tools.file_search");
    const query = String(input.query || input.q || input.name || "").trim();
    if (!query) throw new Error("tools.file_search requires input.query");
    if (query.length > 240) throw new Error("tools.file_search input.query must be at most 240 characters");
    const dirPath = String(input.path || input.base_path || ".").trim();
    if (dirPath.length > 2000) throw new Error("tools.file_search input.path must be at most 2000 characters");
    if (input.max_results != null) {
      parseOptionalInt(input.max_results, { min: 1, max: 200, field: "input.max_results" });
    }
    return;
  }

  if (handlerName === "builtin:tools.find_in_files") {
    const input = ensureInputObjectForHandler(inputObj, "tools.find_in_files");
    const query = String(input.query || input.q || input.pattern || "").trim();
    if (!query) throw new Error("tools.find_in_files requires input.query");
    if (query.length > 500) throw new Error("tools.find_in_files input.query must be at most 500 characters");

    const dirPath = String(input.path || input.base_path || ".").trim();
    if (dirPath.length > 2000) throw new Error("tools.find_in_files input.path must be at most 2000 characters");

    if (input.files != null) {
      if (!Array.isArray(input.files)) throw new Error("tools.find_in_files input.files must be an array of paths");
      if (input.files.length > 500) throw new Error("tools.find_in_files input.files supports at most 500 entries");
      for (const item of input.files) {
        const fp = String(item || "").trim();
        if (!fp) throw new Error("tools.find_in_files input.files entries must be non-empty paths");
        if (fp.length > 2000) throw new Error("tools.find_in_files input.files entries must be at most 2000 characters");
      }
    }

    if (input.max_results != null) {
      parseOptionalInt(input.max_results, { min: 1, max: 500, field: "input.max_results" });
    }
    if (input.max_bytes_per_file != null) {
      parseOptionalInt(input.max_bytes_per_file, { min: 512, max: 2 * 1024 * 1024, field: "input.max_bytes_per_file" });
    }
    if (input.max_scanned != null) {
      parseOptionalInt(input.max_scanned, { min: 100, max: 50000, field: "input.max_scanned" });
    }
    if (input.regex != null && typeof input.regex !== "boolean") throw new Error("tools.find_in_files input.regex must be boolean");
    if (input.case_sensitive != null && typeof input.case_sensitive !== "boolean") throw new Error("tools.find_in_files input.case_sensitive must be boolean");
    if (input.include_hidden != null && typeof input.include_hidden !== "boolean") throw new Error("tools.find_in_files input.include_hidden must be boolean");
    return;
  }

  if (handlerName === "builtin:tools.web_search") {
    const input = ensureInputObjectForHandler(inputObj, "tools.web_search");
    const query = String(input.query || input.q || "").trim();
    if (!query) throw new Error("tools.web_search requires input.query");
    if (query.length > 500) throw new Error("tools.web_search input.query must be at most 500 characters");
    if (input.provider != null) {
      const provider = String(input.provider || "").trim().toLowerCase();
      if (!provider || (provider !== "duckduckgo" && provider !== "brave")) {
        throw new Error("tools.web_search input.provider must be one of: duckduckgo, brave");
      }
    }
    if (input.max_results != null) {
      parseOptionalInt(input.max_results, { min: 1, max: 20, field: "input.max_results" });
    }
    if (input.timeout_ms != null) {
      parseOptionalInt(input.timeout_ms, { min: 200, max: 120000, field: "input.timeout_ms" });
    }
  }

  if (handlerName === "builtin:workflow.run") {
    const input = ensureInputObjectForHandler(inputObj, "workflow.run");
    const workflow = String(input.workflow || input.name || "").trim();
    if (!workflow) throw new Error("workflow.run requires input.workflow");
    if (workflow.length > 240) throw new Error("workflow.run input.workflow must be at most 240 characters");
    if (input.workflow_file != null) {
      const workflowFile = String(input.workflow_file || "").trim();
      if (!workflowFile) throw new Error("workflow.run input.workflow_file must be non-empty when provided");
      if (workflowFile.length > 240) throw new Error("workflow.run input.workflow_file must be at most 240 characters");
    }
    if (input.params != null) {
      if (!input.params || typeof input.params !== "object" || Array.isArray(input.params)) {
        throw new Error("workflow.run input.params must be an object");
      }
    }
    if (input.vars != null) {
      if (!input.vars || typeof input.vars !== "object" || Array.isArray(input.vars)) {
        throw new Error("workflow.run input.vars must be an object");
      }
    }
    if (input.queue != null) {
      const queueName = String(input.queue || "").trim();
      if (!queueNamePattern.test(queueName)) throw new Error("workflow.run input.queue has invalid queue name");
    }
    return;
  }
}

function parseUiPrefsScope(raw) {
  const scope = String(raw || "default").trim() || "default";
  if (!/^[a-z0-9._:-]{1,80}$/i.test(scope)) {
    throw new Error("'scope' must match ^[a-z0-9._:-]{1,80}$");
  }
  return scope;
}

function normalizeUiPrefsValue(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("'prefs' must be an object");
  }
  const json = JSON.stringify(raw);
  if (Buffer.byteLength(json, "utf8") > 32 * 1024) {
    throw new Error("'prefs' exceeds max size (32KB)");
  }
  return raw;
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function formatWorkspaceEntry(baseDir, dirent) {
  const abs = path.join(baseDir, dirent.name);
  let st = null;
  try {
    st = fs.statSync(abs);
  } catch {
    st = null;
  }
  const relPath = path.relative(workspaceRoot, abs) || ".";
  return {
    name: dirent.name,
    path: relPath.split(path.sep).join("/"),
    is_dir: !!dirent.isDirectory(),
    size: st && st.isFile() ? st.size : null,
    modified_at: st ? new Date(st.mtimeMs).toISOString() : null
  };
}

function shouldHideWorkspaceEntry(dirent) {
  const name = String(dirent?.name || "");
  if (!name) return false;
  if (name === ".gitkeep") return true;
  if (name === ".codex-home") return true;
  return false;
}

function isLikelyBinary(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return false;
  const sampleLen = Math.min(buffer.length, 8192);
  for (let i = 0; i < sampleLen; i += 1) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

function decodeBase64Payload(raw) {
  const s = String(raw || "").trim();
  if (!s) throw new Error("Empty base64 payload");
  const payload = s.startsWith("data:") ? String(s.split(",")[1] || "") : s;
  if (!payload) throw new Error("Invalid data URL payload");
  if (!/^[A-Za-z0-9+/=\r\n]+$/.test(payload)) throw new Error("Invalid base64 characters");
  const buf = Buffer.from(payload, "base64");
  if (!Buffer.isBuffer(buf) || buf.length < 1) throw new Error("Invalid base64 content");
  return buf;
}

function validateWorkspacePathOrBadRequest(res, rawPath, fieldName = "path") {
  const p = String(rawPath || "").trim();
  if (!p) {
    badRequest(res, "VALIDATION_ERROR", `Missing '${fieldName}'.`);
    return null;
  }
  const abs = path.resolve(workspaceRoot, p);
  if (!isPathInside(workspaceRoot, abs)) {
    badRequest(res, "VALIDATION_ERROR", `Requested ${fieldName} escapes workspace root.`);
    return null;
  }
  return { rel: p, abs };
}

function rowToJob(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    queue: row.queue || "default",
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

function normalizeMemoryToken(value) {
  return String(value || "").trim();
}

function escapeSqlLike(value) {
  return String(value || "").replace(/([\\%_])/g, "\\$1");
}

function nowPlusSeconds(sec) {
  return new Date(Date.now() + (sec * 1000)).toISOString();
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

function getAuthorizedScheduleRow(scheduleId, authInfo) {
  const row = db.prepare(`SELECT * FROM job_schedules WHERE id = ?`).get(scheduleId);
  if (!row) return null;
  if (!isQueueAllowedForAuth(authInfo, row.queue || "default")) return null;
  return row;
}

function rowToMemory(row) {
  if (!row) return null;
  return {
    id: row.id,
    scope: row.scope,
    key: row.key,
    value: row.value_json ? JSON.parse(row.value_json) : null,
    tags: row.tags_json ? JSON.parse(row.tags_json) : [],
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at || null,
    embedding_status: row.embedding_status || "pending",
    embedding_error: row.embedding_error_json ? JSON.parse(row.embedding_error_json) : null,
    embedded_at: row.embedded_at || null
  };
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
  const queue = normalizeQueueName(opts.queue) || "default";
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

app.get("/health", (req, res) => {
  res.json({ ok: true, service: "rauskuclaw-api", time: nowIso() });
});

// Dev routes
const registerDevRoutes = require("./routes/dev");
registerDevRoutes(app, { auth, db, rowToJob, nowIso, log, badRequest });

// Jobs routes
const registerJobsRoutes = require("./routes/jobs");
registerJobsRoutes(app, {
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
});

app.get("/v1/ping", auth, (req, res) => res.json({ ok: true, pong: true }));

app.get("/v1/auth/whoami", auth, (req, res) => {
  const role = String(req.auth?.role || "read");
  return res.json({
    ok: true,
    auth: {
      name: String(req.auth?.name || ""),
      role,
      sse: req.auth?.sse === true,
      can_write: role === "admin",
      queue_allowlist: Array.isArray(req.auth?.queue_allowlist) ? req.auth.queue_allowlist : null
    }
  });
});

app.get("/v1/runtime/providers", auth, (req, res) => {
  const codexEnabled = envBoolOrConfig("CODEX_OSS_ENABLED", "providers.codex_oss.enabled", false);
  const codexExecMode = String(envOrConfig("CODEX_EXEC_MODE", "providers.codex_oss.exec_mode", "online")).trim().toLowerCase();
  const codexModel = String(process.env.CODEX_OSS_MODEL || getConfig("providers.codex_oss.model", "") || "").trim();
  const codexLocalProvider = String(envOrConfig("CODEX_OSS_LOCAL_PROVIDER", "providers.codex_oss.local_provider", "ollama")).trim().toLowerCase();
  const codexCliPath = String(envOrConfig("CODEX_CLI_PATH", "providers.codex_oss.cli_path", "codex")).trim();
  const codexTimeoutMs = envIntOrConfig("CODEX_OSS_TIMEOUT_MS", "providers.codex_oss.timeout_ms", 60000);

  const openAiEnabled = envBoolOrConfig("OPENAI_ENABLED", "providers.openai.enabled", false);
  const openAiModel = String(envOrConfig("OPENAI_MODEL", "providers.openai.model", "gpt-4.1-mini")).trim();
  const openAiBaseUrl = String(envOrConfig("OPENAI_BASE_URL", "providers.openai.base_url", "https://api.openai.com")).trim();
  const openAiChatCompletionsPath = String(
    envOrConfig("OPENAI_CHAT_COMPLETIONS_PATH", "providers.openai.chat_completions_path", "/v1/chat/completions")
  ).trim();
  const openAiTimeoutMs = envIntOrConfig("OPENAI_TIMEOUT_MS", "providers.openai.timeout_ms", 30000);

  if (String(req.auth?.role || "") === "read") {
    return res.json({
      ok: true,
      providers: {
        codex: { enabled: codexEnabled },
        openai: { enabled: openAiEnabled }
      }
    });
  }

  res.json({
    ok: true,
    providers: {
      codex: {
        enabled: codexEnabled,
        exec_mode: codexExecMode,
        model: codexModel || null,
        local_provider: codexExecMode === "oss" ? codexLocalProvider : null,
        cli_path: codexCliPath || "codex",
        timeout_ms: codexTimeoutMs
      },
      openai: {
        enabled: openAiEnabled,
        model: openAiModel || null,
        base_url: openAiBaseUrl,
        chat_completions_path: openAiChatCompletionsPath || "/v1/chat/completions",
        timeout_ms: openAiTimeoutMs
      }
    }
  });
});

app.get("/v1/runtime/handlers", auth, (req, res) => {
  const runtimeTools = readRuntimeToolsPrefs();
  const deployAllowlistEnvName = String(getConfig("handlers.deploy.allowlist_env", "DEPLOY_TARGET_ALLOWLIST"));
  const deployFallbackTargets = getConfig("handlers.deploy.default_allowed_targets", ["staging"]);
  const deployFallbackCsv = Array.isArray(deployFallbackTargets) ? deployFallbackTargets.join(",") : "staging";
  const deployTargets = splitCsvList(process.env[deployAllowlistEnvName] || deployFallbackCsv);

  const toolExecEnabledEnvName = String(getConfig("handlers.exec.enabled_env", "TOOL_EXEC_ENABLED"));
  const toolExecAllowlistEnvName = String(getConfig("handlers.exec.allowlist_env", "TOOL_EXEC_ALLOWLIST"));
  const toolExecTimeoutEnvName = String(getConfig("handlers.exec.timeout_env", "TOOL_EXEC_TIMEOUT_MS"));
  const toolExecEnabled = envBoolOrConfig(toolExecEnabledEnvName, "handlers.exec.enabled", false);
  const toolExecAllowlist = splitCsvList(process.env[toolExecAllowlistEnvName] || "");
  const toolExecTimeoutMs = envIntOrConfig(toolExecTimeoutEnvName, "handlers.exec.default_timeout_ms", 10000);
  const toolExecEffectiveEnabled = typeof runtimeTools.tool_exec.enabled === "boolean" ? runtimeTools.tool_exec.enabled : toolExecEnabled;
  const toolExecEffectiveAllowlist = Array.isArray(runtimeTools.tool_exec.allowlist) && runtimeTools.tool_exec.allowlist.length > 0
    ? runtimeTools.tool_exec.allowlist
    : toolExecAllowlist;
  const toolExecEffectiveTimeoutMs = Number.isInteger(runtimeTools.tool_exec.timeout_ms)
    ? runtimeTools.tool_exec.timeout_ms
    : toolExecTimeoutMs;

  const dataFetchEnabledEnvName = String(getConfig("handlers.data_fetch.enabled_env", "DATA_FETCH_ENABLED"));
  const dataFetchAllowlistEnvName = String(getConfig("handlers.data_fetch.allowlist_env", "DATA_FETCH_ALLOWLIST"));
  const dataFetchTimeoutEnvName = String(getConfig("handlers.data_fetch.timeout_env", "DATA_FETCH_TIMEOUT_MS"));
  const dataFetchMaxBytesEnvName = String(getConfig("handlers.data_fetch.max_bytes_env", "DATA_FETCH_MAX_BYTES"));
  const dataFetchEnabled = envBoolOrConfig(dataFetchEnabledEnvName, "handlers.data_fetch.enabled", false);
  const dataFetchAllowlist = splitCsvList(process.env[dataFetchAllowlistEnvName] || "");
  const dataFetchTimeoutMs = envIntOrConfig(dataFetchTimeoutEnvName, "handlers.data_fetch.default_timeout_ms", 8000);
  const dataFetchMaxBytes = envIntOrConfig(dataFetchMaxBytesEnvName, "handlers.data_fetch.default_max_bytes", 65536);
  const dataFetchEffectiveEnabled = typeof runtimeTools.data_fetch.enabled === "boolean" ? runtimeTools.data_fetch.enabled : dataFetchEnabled;
  const dataFetchEffectiveAllowlist = Array.isArray(runtimeTools.data_fetch.allowlist) && runtimeTools.data_fetch.allowlist.length > 0
    ? runtimeTools.data_fetch.allowlist
    : dataFetchAllowlist;
  const dataFetchEffectiveTimeoutMs = Number.isInteger(runtimeTools.data_fetch.timeout_ms)
    ? runtimeTools.data_fetch.timeout_ms
    : dataFetchTimeoutMs;
  const dataFetchEffectiveMaxBytes = Number.isInteger(runtimeTools.data_fetch.max_bytes)
    ? runtimeTools.data_fetch.max_bytes
    : dataFetchMaxBytes;

  const webSearchEnabledEnvName = String(getConfig("handlers.web_search.enabled_env", "WEB_SEARCH_ENABLED"));
  const webSearchProviderEnvName = String(getConfig("handlers.web_search.provider_env", "WEB_SEARCH_PROVIDER"));
  const webSearchTimeoutEnvName = String(getConfig("handlers.web_search.timeout_env", "WEB_SEARCH_TIMEOUT_MS"));
  const webSearchMaxResultsEnvName = String(getConfig("handlers.web_search.max_results_env", "WEB_SEARCH_MAX_RESULTS"));
  const webSearchBaseUrlEnvName = String(getConfig("handlers.web_search.base_url_env", "WEB_SEARCH_BASE_URL"));
  const webSearchBraveApiKeyEnvName = String(getConfig("handlers.web_search.brave_api_key_env", "WEB_SEARCH_BRAVE_API_KEY"));
  const webSearchEnabled = envBoolOrConfig(webSearchEnabledEnvName, "handlers.web_search.enabled", false);
  const webSearchProvider = String(envOrConfig(webSearchProviderEnvName, "handlers.web_search.default_provider", "duckduckgo")).trim().toLowerCase() || "duckduckgo";
  const webSearchTimeoutMs = envIntOrConfig(webSearchTimeoutEnvName, "handlers.web_search.default_timeout_ms", 8000);
  const webSearchMaxResults = envIntOrConfig(webSearchMaxResultsEnvName, "handlers.web_search.default_max_results", 5);
  const webSearchBaseUrl = String(envOrConfig(webSearchBaseUrlEnvName, "handlers.web_search.default_base_url", "https://api.duckduckgo.com"));
  const webSearchBraveApiKey = String(process.env[webSearchBraveApiKeyEnvName] || "").trim();
  const webSearchEffectiveEnabled = typeof runtimeTools.web_search.enabled === "boolean" ? runtimeTools.web_search.enabled : webSearchEnabled;
  const webSearchProviderOverride = String(runtimeTools.web_search.provider || "").trim().toLowerCase();
  const webSearchEffectiveProvider = (webSearchProviderOverride === "duckduckgo" || webSearchProviderOverride === "brave")
    ? webSearchProviderOverride
    : webSearchProvider;
  const webSearchEffectiveTimeoutMs = Number.isInteger(runtimeTools.web_search.timeout_ms)
    ? runtimeTools.web_search.timeout_ms
    : webSearchTimeoutMs;
  const webSearchEffectiveMaxResults = Number.isInteger(runtimeTools.web_search.max_results)
    ? runtimeTools.web_search.max_results
    : webSearchMaxResults;
  const webSearchEffectiveBaseUrl = String(runtimeTools.web_search.base_url || webSearchBaseUrl || "").trim() || "https://api.duckduckgo.com";
  const webSearchEffectiveBraveApiKey = Object.prototype.hasOwnProperty.call(runtimeTools.web_search, "brave_api_key")
    ? String(runtimeTools.web_search.brave_api_key || "").trim()
    : webSearchBraveApiKey;
  const webSearchEffectiveBraveConfigured = webSearchEffectiveBraveApiKey.length > 0;

  if (String(req.auth?.role || "") === "read") {
    return res.json({
      ok: true,
      handlers: {
        deploy: { enabled: deployTargets.length > 0 },
        tool_exec: { enabled: toolExecEffectiveEnabled },
        data_fetch: { enabled: dataFetchEffectiveEnabled },
        web_search: { enabled: webSearchEffectiveEnabled, provider: webSearchEffectiveProvider }
      }
    });
  }

  return res.json({
    ok: true,
    handlers: {
      deploy: {
        enabled: deployTargets.length > 0,
        allowed_targets: deployTargets
      },
      tool_exec: {
        enabled: toolExecEffectiveEnabled,
        allowlist_count: toolExecEffectiveAllowlist.length,
        allowlist: toolExecEffectiveAllowlist,
        timeout_ms: toolExecEffectiveTimeoutMs
      },
      data_fetch: {
        enabled: dataFetchEffectiveEnabled,
        allowlist_count: dataFetchEffectiveAllowlist.length,
        allowlist: dataFetchEffectiveAllowlist,
        timeout_ms: dataFetchEffectiveTimeoutMs,
        max_bytes: dataFetchEffectiveMaxBytes
      },
      web_search: {
        enabled: webSearchEffectiveEnabled,
        provider: webSearchEffectiveProvider,
        brave_api_key_configured: webSearchEffectiveBraveConfigured,
        timeout_ms: webSearchEffectiveTimeoutMs,
        max_results: webSearchEffectiveMaxResults,
        base_url: webSearchEffectiveBaseUrl
      }
    }
  });
});

app.post("/v1/runtime/repo-context/prewarm", auth, (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const type = String(body.type || "").trim();
  const input = body.input && typeof body.input === "object" ? body.input : {};
  if (type && type !== "ai.chat.generate") {
    return res.json({
      ok: true,
      skipped: true,
      reason: `type '${type}' is not supported for repo-context prewarm`
    });
  }
  try {
    const out = prewarmRepoContextSummaries(input);
    return res.json({ ok: true, type: "ai.chat.generate", ...out });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: {
        code: "PREWARM_FAILED",
        message: String(e?.message || e)
      }
    });
  }
});

app.get("/v1/ui-prefs", auth, (req, res) => {
  let scope;
  try {
    scope = parseUiPrefsScope(req.query.scope);
  } catch (e) {
    return badRequest(res, "VALIDATION_ERROR", String(e?.message || e));
  }
  const row = db.prepare(`
    SELECT scope, value_json, created_at, updated_at
    FROM ui_prefs
    WHERE scope = ?
  `).get(scope);
  const prefs = row?.value_json ? safeJsonParse(row.value_json) : {};
  return res.json({
    ok: true,
    scope,
    prefs: prefs && typeof prefs === "object" && !Array.isArray(prefs) ? prefs : {},
    created_at: row?.created_at || null,
    updated_at: row?.updated_at || null
  });
});

app.put("/v1/ui-prefs", auth, (req, res) => {
  let scope;
  let prefs;
  try {
    scope = parseUiPrefsScope(req.query.scope);
    prefs = normalizeUiPrefsValue(req.body?.prefs ?? req.body ?? {});
  } catch (e) {
    return badRequest(res, "VALIDATION_ERROR", String(e?.message || e));
  }
  const now = nowIso();
  db.prepare(`
    INSERT INTO ui_prefs (scope, value_json, created_at, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(scope) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = excluded.updated_at
  `).run(scope, JSON.stringify(prefs), now, now);
  const row = db.prepare(`
    SELECT scope, value_json, created_at, updated_at
    FROM ui_prefs
    WHERE scope = ?
  `).get(scope);
  return res.json({
    ok: true,
    scope,
    prefs: row?.value_json ? (safeJsonParse(row.value_json) || {}) : {},
    created_at: row?.created_at || now,
    updated_at: row?.updated_at || now
  });
});

app.get("/v1/runtime/metrics", auth, (req, res) => {
  const settings = getObservabilitySettings();
  const windowSec = Math.max(60, Math.min(7 * 24 * 3600, parseInt(String(req.query.window_sec || settings.alertWindowSec), 10) || settings.alertWindowSec));
  const queueParam = normalizeQueueName(req.query.queue);
  if (queueParam && !queueNamePattern.test(queueParam)) {
    return badRequest(res, "VALIDATION_ERROR", "'queue' must match ^[a-z0-9._:-]{1,80}$");
  }
  const allowedQueues = Array.isArray(req.auth?.queue_allowlist) ? req.auth.queue_allowlist : null;
  if (allowedQueues && queueParam && !allowedQueues.includes(queueParam)) {
    return res.status(403).json({
      ok: false,
      error: {
        code: "FORBIDDEN",
        message: `Queue '${queueParam}' is not allowed for this API key.`,
        details: { allowed_queues: allowedQueues }
      }
    });
  }
  const queueScope = queueParam ? [queueParam] : (allowedQueues || null);
  const metricAgg = collectMetricCounters(db, windowSec, queueScope);
  const jobStatus = getJobStatusSnapshot(db, queueScope);
  const alerts = buildRuntimeAlerts(db, settings, windowSec, queueScope);
  return res.json({
    ok: true,
    metrics: {
      enabled: settings.enabled,
      generated_at: nowIso(),
      window_sec: metricAgg.windowSec,
      counters: metricAgg.counters,
      job_status: jobStatus
    },
    alerts
  });
});

app.get("/v1/workspace/files", auth, (req, res) => {
  const requestedPath = String(req.query.path || ".").trim() || ".";
  const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
  const target = path.resolve(workspaceRoot, requestedPath);

  if (!isPathInside(workspaceRoot, target)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace path not found" } });
  }

  let entries;
  try {
    entries = fs.readdirSync(target, { withFileTypes: true });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }

  const sorted = entries
    .filter((d) => !shouldHideWorkspaceEntry(d))
    .slice()
    .sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, limit)
    .map((d) => formatWorkspaceEntry(target, d));

  return res.json({
    ok: true,
    root: workspaceRoot.split(path.sep).join("/"),
    path: path.relative(workspaceRoot, target).split(path.sep).join("/") || ".",
    entries: sorted,
    count: sorted.length
  });
});

app.get("/v1/workspace/file", auth, (req, res) => {
  const requestedPath = String(req.query.path || "").trim();
  if (!requestedPath) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'path' query parameter.");
  }

  const target = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(workspaceRoot, target)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }
  if (!st.isFile()) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
  }
  if (st.size > workspaceFileViewMaxBytes) {
    return res.status(413).json({
      ok: false,
      error: {
        code: "WORKSPACE_FILE_TOO_LARGE",
        message: `File exceeds view limit (${workspaceFileViewMaxBytes} bytes).`,
        details: { size: st.size, max_bytes: workspaceFileViewMaxBytes }
      }
    });
  }

  let contentBuffer;
  try {
    contentBuffer = fs.readFileSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }
  if (isLikelyBinary(contentBuffer)) {
    return res.status(415).json({
      ok: false,
      error: { code: "WORKSPACE_FILE_BINARY", message: "Binary file preview is not supported." }
    });
  }

  return res.json({
    ok: true,
    file: {
      path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
      size: st.size,
      modified_at: new Date(st.mtimeMs).toISOString(),
      content: contentBuffer.toString("utf8")
    }
  });
});

app.get("/v1/workspace/download", auth, (req, res) => {
  const requestedPath = String(req.query.path || "").trim();
  if (!requestedPath) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'path' query parameter.");
  }
  const target = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(workspaceRoot, target)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }
  if (!st.isFile()) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
  }

  return res.download(target, path.basename(target), (err) => {
    if (!err || res.headersSent) return;
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_DOWNLOAD_FAILED", message: String(err?.message || err) }
    });
  });
});

app.post("/v1/workspace/upload", auth, (req, res) => {
  const body = req.body ?? {};
  const requestedPath = String(body.path || "").trim();
  const overwrite = body.overwrite === true;
  const contentBase64 = body.content_base64;

  if (!requestedPath) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'path'.");
  }
  if (typeof contentBase64 !== "string" || !contentBase64.trim()) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'content_base64'.");
  }

  const target = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(workspaceRoot, target)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
  }

  const parentDir = path.dirname(target);
  if (!isPathInside(workspaceRoot, parentDir)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested parent path escapes workspace root.");
  }
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    return badRequest(res, "VALIDATION_ERROR", "Target parent directory does not exist.");
  }
  if (fs.existsSync(target) && !overwrite) {
    return res.status(409).json({
      ok: false,
      error: { code: "CONFLICT", message: "Target file already exists. Set overwrite=true to replace." }
    });
  }
  if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
    return badRequest(res, "VALIDATION_ERROR", "Target path points to a directory.");
  }

  let data;
  try {
    data = decodeBase64Payload(contentBase64);
  } catch (e) {
    return badRequest(res, "VALIDATION_ERROR", `Invalid content_base64: ${String(e?.message || e)}`);
  }
  if (data.length > workspaceUploadMaxBytes) {
    return res.status(413).json({
      ok: false,
      error: {
        code: "WORKSPACE_FILE_TOO_LARGE",
        message: `Upload exceeds limit (${workspaceUploadMaxBytes} bytes).`,
        details: { size: data.length, max_bytes: workspaceUploadMaxBytes }
      }
    });
  }

  try {
    fs.writeFileSync(target, data);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
    });
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch {
    st = { size: data.length, mtimeMs: Date.now() };
  }

  return res.status(201).json({
    ok: true,
    file: {
      path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
      size: st.size,
      modified_at: new Date(st.mtimeMs).toISOString(),
      overwritten: overwrite
    }
  });
});

app.post("/v1/workspace/create", auth, (req, res) => {
  const body = req.body ?? {};
  const requestedPath = validateWorkspacePathOrBadRequest(res, body.path, "path");
  if (!requestedPath) return;

  const kindRaw = String(body.kind || "file").trim().toLowerCase();
  const kind = kindRaw === "dir" ? "dir" : "file";
  const overwrite = body.overwrite === true;
  const content = body.content == null ? "" : body.content;

  if (kind === "file" && typeof content !== "string") {
    return badRequest(res, "VALIDATION_ERROR", "'content' must be a string.");
  }

  const target = requestedPath.abs;
  const parentDir = path.dirname(target);
  if (!isPathInside(workspaceRoot, parentDir)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested parent path escapes workspace root.");
  }
  if (!fs.existsSync(parentDir) || !fs.statSync(parentDir).isDirectory()) {
    return badRequest(res, "VALIDATION_ERROR", "Target parent directory does not exist.");
  }

  if (kind === "dir") {
    if (fs.existsSync(target)) {
      const st = fs.statSync(target);
      if (!st.isDirectory()) {
        return badRequest(res, "VALIDATION_ERROR", "Target path points to a file.");
      }
      if (!overwrite) {
        return res.status(409).json({
          ok: false,
          error: { code: "CONFLICT", message: "Target directory already exists. Set overwrite=true to continue." }
        });
      }
      return res.status(201).json({
        ok: true,
        entry: {
          path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
          kind: "dir",
          overwritten: true
        }
      });
    }
    try {
      fs.mkdirSync(target, { recursive: false });
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
      });
    }
    return res.status(201).json({
      ok: true,
      entry: {
        path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
        kind: "dir",
        overwritten: false
      }
    });
  }

  const contentBuffer = Buffer.from(String(content), "utf8");
  if (contentBuffer.length > workspaceFileWriteMaxBytes) {
    return res.status(413).json({
      ok: false,
      error: {
        code: "WORKSPACE_FILE_TOO_LARGE",
        message: `File exceeds write limit (${workspaceFileWriteMaxBytes} bytes).`,
        details: { size: contentBuffer.length, max_bytes: workspaceFileWriteMaxBytes }
      }
    });
  }

  if (fs.existsSync(target)) {
    const st = fs.statSync(target);
    if (st.isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Target path points to a directory.");
    }
    if (!overwrite) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: "Target file already exists. Set overwrite=true to replace." }
      });
    }
  }

  try {
    fs.writeFileSync(target, String(content), "utf8");
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
    });
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch {
    st = { size: contentBuffer.length, mtimeMs: Date.now() };
  }

  return res.status(201).json({
    ok: true,
    entry: {
      path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
      kind: "file",
      size: st.size,
      modified_at: new Date(st.mtimeMs).toISOString(),
      overwritten: overwrite
    }
  });
});

app.patch("/v1/workspace/move", auth, (req, res) => {
  const body = req.body ?? {};
  const fromPath = validateWorkspacePathOrBadRequest(res, body.from_path, "from_path");
  if (!fromPath) return;
  const toPath = validateWorkspacePathOrBadRequest(res, body.to_path, "to_path");
  if (!toPath) return;

  const overwrite = body.overwrite === true;

  if (!fs.existsSync(fromPath.abs)) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Source path not found" } });
  }
  if (fromPath.abs === toPath.abs) {
    return res.json({
      ok: true,
      moved: false,
      from_path: fromPath.rel,
      to_path: toPath.rel
    });
  }

  const fromStat = fs.statSync(fromPath.abs);
  const toParent = path.dirname(toPath.abs);
  if (!fs.existsSync(toParent) || !fs.statSync(toParent).isDirectory()) {
    return badRequest(res, "VALIDATION_ERROR", "Destination parent directory does not exist.");
  }
  if (fromStat.isDirectory() && isPathInside(fromPath.abs, toPath.abs)) {
    return badRequest(res, "VALIDATION_ERROR", "Cannot move a directory inside itself.");
  }

  if (fs.existsSync(toPath.abs)) {
    const toStat = fs.statSync(toPath.abs);
    if (!overwrite) {
      return res.status(409).json({
        ok: false,
        error: { code: "CONFLICT", message: "Destination already exists. Set overwrite=true to replace." }
      });
    }
    if (toStat.isDirectory() && !fromStat.isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Destination is a directory.");
    }
    if (!toStat.isDirectory() && fromStat.isDirectory()) {
      return badRequest(res, "VALIDATION_ERROR", "Cannot replace file with directory.");
    }
    try {
      if (toStat.isDirectory()) fs.rmSync(toPath.abs, { recursive: true, force: true });
      else fs.unlinkSync(toPath.abs);
    } catch (e) {
      return res.status(500).json({
        ok: false,
        error: { code: "WORKSPACE_MOVE_FAILED", message: String(e?.message || e) }
      });
    }
  }

  try {
    fs.renameSync(fromPath.abs, toPath.abs);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_MOVE_FAILED", message: String(e?.message || e) }
    });
  }

  return res.json({
    ok: true,
    moved: true,
    from_path: path.relative(workspaceRoot, fromPath.abs).split(path.sep).join("/"),
    to_path: path.relative(workspaceRoot, toPath.abs).split(path.sep).join("/")
  });
});

app.put("/v1/workspace/file", auth, (req, res) => {
  const body = req.body ?? {};
  const requestedPath = String(body.path || "").trim();
  const content = body.content;

  if (!requestedPath) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'path'.");
  }
  if (typeof content !== "string") {
    return badRequest(res, "VALIDATION_ERROR", "'content' must be a string.");
  }

  const target = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(workspaceRoot, target)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }
  if (!st.isFile()) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
  }

  const nextBuffer = Buffer.from(content, "utf8");
  if (nextBuffer.length > workspaceFileWriteMaxBytes) {
    return res.status(413).json({
      ok: false,
      error: {
        code: "WORKSPACE_FILE_TOO_LARGE",
        message: `File exceeds write limit (${workspaceFileWriteMaxBytes} bytes).`,
        details: { size: nextBuffer.length, max_bytes: workspaceFileWriteMaxBytes }
      }
    });
  }

  let currentBuffer;
  try {
    currentBuffer = fs.readFileSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }
  if (isLikelyBinary(currentBuffer)) {
    return res.status(415).json({
      ok: false,
      error: { code: "WORKSPACE_FILE_BINARY", message: "Binary file edit is not supported." }
    });
  }

  try {
    fs.writeFileSync(target, content, "utf8");
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_WRITE_FAILED", message: String(e?.message || e) }
    });
  }

  let nextStat;
  try {
    nextStat = fs.statSync(target);
  } catch {
    nextStat = { size: nextBuffer.length, mtimeMs: Date.now() };
  }

  return res.json({
    ok: true,
    file: {
      path: path.relative(workspaceRoot, target).split(path.sep).join("/"),
      size: nextStat.size,
      modified_at: new Date(nextStat.mtimeMs).toISOString()
    }
  });
});

app.delete("/v1/workspace/file", auth, (req, res) => {
  const requestedPath = String(req.query.path || "").trim();
  if (!requestedPath) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'path' query parameter.");
  }

  const target = path.resolve(workspaceRoot, requestedPath);
  if (!isPathInside(workspaceRoot, target)) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path escapes workspace root.");
  }
  if (!fs.existsSync(target)) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Workspace file not found" } });
  }

  let st;
  try {
    st = fs.statSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_READ_FAILED", message: String(e?.message || e) }
    });
  }
  if (!st.isFile()) {
    return badRequest(res, "VALIDATION_ERROR", "Requested path is not a file.");
  }

  try {
    fs.unlinkSync(target);
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: { code: "WORKSPACE_DELETE_FAILED", message: String(e?.message || e) }
    });
  }

  return res.json({
    ok: true,
    deleted: true,
    file: {
      path: path.relative(workspaceRoot, target).split(path.sep).join("/")
    }
  });
});

app.get("/v1/memory", auth, (req, res) => {
  const scope = req.query.scope ? normalizeMemoryToken(req.query.scope) : "";
  const key = req.query.key ? normalizeMemoryToken(req.query.key) : "";
  const includeExpired = String(req.query.include_expired || "0") === "1";
  const limit = Math.min(parseInt(req.query.limit || "100", 10) || 100, 500);

  const where = [];
  const params = [];
  if (!includeExpired) {
    where.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(nowIso());
  }
  if (scope) {
    where.push("scope = ?");
    params.push(scope);
  }
  if (key) {
    where.push("key = ?");
    params.push(key);
  }

  const sql = `
    SELECT id, scope, key, value_json, tags_json, created_at, updated_at, expires_at, embedding_status, embedding_error_json, embedded_at
    FROM memories
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY updated_at DESC
    LIMIT ?
  `;
  params.push(limit);
  const rows = db.prepare(sql).all(...params);

  res.json({
    ok: true,
    memories: rows.map(rowToMemory),
    count: rows.length
  });
});

app.post("/v1/memory", auth, (req, res) => {
  const body = req.body ?? {};
  const scope = normalizeMemoryToken(body.scope);
  const key = normalizeMemoryToken(body.key);
  const value = body.value;
  const tagsArr = Array.isArray(body.tags) ? body.tags.slice(0, 50).map(String) : [];
  const ttlSec = parseOptionalInt(body.ttl_sec, { min: 1, max: 31_536_000, field: "ttl_sec" });

  if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
    return badRequest(res, "VALIDATION_ERROR", "'scope' must match ^[a-z0-9._:-]{2,80}$");
  }
  if (!key || !/^[a-z0-9._:-]{2,120}$/i.test(key)) {
    return badRequest(res, "VALIDATION_ERROR", "'key' must match ^[a-z0-9._:-]{2,120}$");
  }
  if (value === undefined) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'value'");
  }

  const now = nowIso();
  const expiresAt = ttlSec ? nowPlusSeconds(ttlSec) : null;
  const memoryId = crypto.randomUUID();

  db.prepare(`
    INSERT INTO memories (
      id, scope, key, value_json, tags_json, created_at, updated_at, expires_at,
      embedding_status, embedding_error_json, embedded_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
    ON CONFLICT(scope, key) DO UPDATE SET
      value_json = excluded.value_json,
      tags_json = excluded.tags_json,
      updated_at = excluded.updated_at,
      expires_at = excluded.expires_at,
      embedding_status = 'pending',
      embedding_error_json = NULL,
      embedded_at = NULL
  `).run(
    memoryId,
    scope,
    key,
    JSON.stringify(value),
    JSON.stringify(tagsArr),
    now,
    now,
    expiresAt
  );

  const row = db.prepare(`
    SELECT id, scope, key, value_json, tags_json, created_at, updated_at, expires_at, embedding_status, embedding_error_json, embedded_at
    FROM memories
    WHERE scope = ? AND key = ?
  `).get(scope, key);

  if (memoryVectorSettings.enabled && row?.id) {
    try {
      enqueueInternalJob(
        memoryVectorSettings.embedQueueType,
        { memory_id: row.id },
        { priority: 9, timeoutSec: 60, maxAttempts: 3, tags: ["memory", "embedding"] }
      );
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
          code: "MEMORY_EMBED_QUEUE_FAILED",
          message: String(e?.message || e),
          at: ts
        }),
        ts,
        row.id
      );
      return res.status(503).json({
        ok: false,
        error: {
          code: "MEMORY_EMBED_QUEUE_FAILED",
          message: "Memory saved but embedding job enqueue failed.",
          details: { memory_id: row.id, queue_type: memoryVectorSettings.embedQueueType }
        }
      });
    }
  }

  return res.status(201).json({ ok: true, memory: rowToMemory(row) });
});

app.get("/v1/memory/scopes", auth, (req, res) => {
  const includeExpired = String(req.query.include_expired || "0") === "1";
  const q = normalizeMemoryToken(req.query.q || "");
  const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
  const now = nowIso();

  const where = [];
  const params = [];
  if (!includeExpired) {
    where.push("(expires_at IS NULL OR expires_at > ?)");
    params.push(now);
  }
  if (q) {
    where.push("scope LIKE ? ESCAPE '\\'");
    params.push(`%${escapeSqlLike(q)}%`);
  }

  const sql = `
    SELECT
      scope,
      COUNT(*) AS total_count,
      SUM(CASE WHEN embedding_status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
      SUM(CASE WHEN embedding_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN embedding_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      MAX(updated_at) AS latest_updated_at
    FROM memories
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
    GROUP BY scope
    ORDER BY latest_updated_at DESC, scope ASC
    LIMIT ?
  `;
  const rows = db.prepare(sql).all(...params, limit);
  const scopes = rows.map((r) => ({
    scope: r.scope,
    total_count: Number(r.total_count || 0),
    ready_count: Number(r.ready_count || 0),
    pending_count: Number(r.pending_count || 0),
    failed_count: Number(r.failed_count || 0),
    latest_updated_at: r.latest_updated_at || null
  }));
  return res.json({
    ok: true,
    include_expired: includeExpired,
    query: q || "",
    count: scopes.length,
    scopes
  });
});

app.get("/v1/memory/:id", auth, (req, res) => {
  const row = db.prepare(`
    SELECT id, scope, key, value_json, tags_json, created_at, updated_at, expires_at, embedding_status, embedding_error_json, embedded_at
    FROM memories
    WHERE id = ?
  `).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Memory not found" } });
  if (row.expires_at && row.expires_at <= nowIso()) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Memory expired" } });
  }
  return res.json({ ok: true, memory: rowToMemory(row) });
});

app.delete("/v1/memory/:id", auth, (req, res) => {
  const row = db.prepare(`SELECT id FROM memories WHERE id = ?`).get(req.params.id);
  if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Memory not found" } });
  db.prepare(`DELETE FROM memories WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true, id: req.params.id, deleted: true });
});

app.post("/v1/memory/reset", auth, (req, res) => {
  const body = req.body ?? {};
  const confirm = body.confirm === true;
  if (!confirm) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'confirm=true' for destructive memory reset.");
  }

  let scope = "";
  if (hasOwn(body, "scope")) {
    scope = normalizeMemoryToken(body.scope);
    if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
      return badRequest(res, "VALIDATION_ERROR", "'scope' must match ^[a-z0-9._:-]{2,80}$");
    }
  }

  const byScope = !!scope;
  const where = byScope ? "WHERE scope = ?" : "";
  const params = byScope ? [scope] : [];

  const resetTx = db.transaction(() => {
    const matchedMemories = Number(db.prepare(`SELECT COUNT(*) AS n FROM memories ${where}`).get(...params)?.n || 0);
    const matchedVectors = Number(db.prepare(`
      SELECT COUNT(*) AS n
      FROM memory_vectors
      WHERE memory_id IN (SELECT id FROM memories ${where})
    `).get(...params)?.n || 0);
    const deletedMemories = Number(db.prepare(`DELETE FROM memories ${where}`).run(...params).changes || 0);
    const remainingMemories = Number(db.prepare(`SELECT COUNT(*) AS n FROM memories`).get()?.n || 0);
    const remainingVectors = Number(db.prepare(`SELECT COUNT(*) AS n FROM memory_vectors`).get()?.n || 0);
    return {
      matchedMemories,
      matchedVectors,
      deletedMemories,
      remainingMemories,
      remainingVectors
    };
  });

  const out = resetTx();
  return res.json({
    ok: true,
    scope: byScope ? scope : null,
    deleted_memories: out.deletedMemories,
    deleted_vectors: out.matchedVectors,
    matched_memories: out.matchedMemories,
    remaining_memories: out.remainingMemories,
    remaining_vectors: out.remainingVectors
  });
});

app.post("/v1/memory/search", auth, async (req, res) => {
  if (!memoryVectorSettings.enabled) {
    return res.status(503).json({
      ok: false,
      error: {
        code: "VECTOR_NOT_ENABLED",
        message: "Memory vector search is disabled. Set MEMORY_VECTOR_ENABLED=1."
      }
    });
  }

  const body = req.body ?? {};
  const scope = normalizeMemoryToken(body.scope);
  const query = String(body.query || "").trim();
  const includeExpired = body.include_expired === true || String(body.include_expired || "") === "1";
  let topK;

  if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
    return badRequest(res, "VALIDATION_ERROR", "'scope' must match ^[a-z0-9._:-]{2,80}$");
  }
  if (!query) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'query'");
  }

  try {
    topK = parseOptionalInt(body.top_k, {
      min: 1,
      max: memoryVectorSettings.searchTopKMax,
      field: "top_k"
    }) ?? memoryVectorSettings.searchTopKDefault;
  } catch (e) {
    return badRequest(res, "VALIDATION_ERROR", e.message);
  }

  const availabilitySql = `
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN m.embedding_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN m.embedding_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN mv.memory_id IS NULL THEN 1 ELSE 0 END) AS missing_vector_count
    FROM memories m
    LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
    WHERE m.scope = ?
      ${includeExpired ? "" : "AND (m.expires_at IS NULL OR m.expires_at > ?)"}
  `;
  const availabilityParams = [scope];
  if (!includeExpired) availabilityParams.push(nowIso());
  const availability = db.prepare(availabilitySql).get(...availabilityParams);

  const pendingCount = Number(availability?.pending_count || 0);
  const failedCount = Number(availability?.failed_count || 0);
  const missingVectorCount = Number(availability?.missing_vector_count || 0);

  if (pendingCount > 0 || failedCount > 0 || missingVectorCount > 0) {
    return res.status(503).json({
      ok: false,
      error: {
        code: "MEMORY_EMBEDDING_UNAVAILABLE",
        message: "Some memories in scope are not embedded yet.",
        details: {
          scope,
          pending_count: pendingCount,
          failed_count: failedCount,
          missing_vector_count: missingVectorCount
        }
      }
    });
  }

  let embedded;
  try {
    embedded = await embedText(query, { settings: memoryVectorSettings });
  } catch (e) {
    return res.status(503).json({
      ok: false,
      error: {
        code: e?.code || "MEMORY_EMBEDDING_UNAVAILABLE",
        message: String(e?.message || e),
        details: e?.details || null
      }
    });
  }

  let rows;
  try {
    rows = searchMemoryVectors(db, memoryVectorSettings, {
      scope,
      queryEmbedding: embedded.embedding,
      topK,
      includeExpired
    });
  } catch (e) {
    return res.status(503).json({
      ok: false,
      error: {
        code: e?.code || "MEMORY_VECTOR_SEARCH_FAILED",
        message: String(e?.message || e),
        details: e?.details || null
      }
    });
  }

  const matches = rows.map((row) => {
    const distance = Number(row.distance);
    const safeDistance = Number.isFinite(distance) ? distance : null;
    const score = safeDistance == null ? null : Number((1 / (1 + safeDistance)).toFixed(6));
    return {
      memory: rowToMemory(row),
      score,
      distance: safeDistance
    };
  });

  return res.json({
    ok: true,
    matches,
    count: matches.length
  });
});

// Working Memory API endpoints

app.get("/v1/working-memory", auth, (req, res) => {
  const sessionId = String(req.query.session_id || "").trim();
  const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "10"), 10) || 10));

  if (sessionId) {
    const state = loadWorkingMemoryState(db, sessionId);
    if (!state) {
      return res.status(404).json({
        ok: false,
        error: { code: "NOT_FOUND", message: "Working memory session not found" }
      });
    }
    return res.json({ ok: true, state });
  }

  const sessions = listRecentWorkingMemorySessions(db, limit);
  return res.json({
    ok: true,
    sessions,
    count: sessions.length
  });
});

app.get("/v1/working-memory/latest", auth, (req, res) => {
  const state = getLatestWorkingMemorySession(db);
  if (!state) {
    return res.json({
      ok: true,
      state: null,
      message: "No active working memory session found"
    });
  }
  return res.json({ ok: true, state });
});

app.post("/v1/working-memory", auth, (req, res) => {
  const body = req.body ?? {};
  const sessionId = String(body.session_id || generateSessionId()).trim();
  const state = body.state && typeof body.state === "object" ? body.state : {};
  const ttlSec = parseOptionalInt(body.ttl_sec, { min: 60, max: 7 * 24 * 3600, field: "ttl_sec" });

  if (!sessionId || !/^session\.[a-z0-9._-]+$/i.test(sessionId)) {
    return badRequest(res, "VALIDATION_ERROR", "'session_id' must match pattern session.xxx");
  }

  try {
    const result = saveWorkingMemoryState(db, sessionId, state, ttlSec || undefined);
    const saved = loadWorkingMemoryState(db, sessionId);
    return res.status(201).json({
      ok: true,
      session_id: result.session_id,
      updated_at: result.updated_at,
      state: saved
    });
  } catch (e) {
    return res.status(400).json({
      ok: false,
      error: { code: "VALIDATION_ERROR", message: String(e?.message || e) }
    });
  }
});

app.delete("/v1/working-memory", auth, (req, res) => {
  const sessionId = String(req.query.session_id || "").trim();
  if (!sessionId) {
    return badRequest(res, "VALIDATION_ERROR", "Missing 'session_id' query parameter");
  }

  const result = clearWorkingMemoryState(db, sessionId);
  return res.json({
    ok: true,
    session_id: sessionId,
    deleted_entries: result.deleted
  });
});

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

app.get("/v1/schedules/:id", auth, (req, res) => {
  const row = getAuthorizedScheduleRow(req.params.id, req.auth);
  if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Schedule not found" } });
  return res.json({ ok: true, schedule: rowToSchedule(row) });
});

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

app.delete("/v1/schedules/:id", auth, (req, res) => {
  const row = getAuthorizedScheduleRow(req.params.id, req.auth);
  if (!row) {
    return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Schedule not found" } });
  }
  db.prepare(`DELETE FROM job_schedules WHERE id = ?`).run(req.params.id);
  return res.json({ ok: true, id: req.params.id, deleted: true });
});

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

app.listen(port, "0.0.0.0", () => {
  console.log(`[rauskuclaw-api] listening on :${port}`);
});
