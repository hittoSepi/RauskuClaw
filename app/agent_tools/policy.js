/**
 * Agent Tool Policy Module
 *
 * This module handles runtime tool enablement and policy checks.
 * It manages UI prefs-based overrides and environment flag configuration.
 *
 * KEY PRINCIPLE: Policy determines WHICH tools are enabled.
 * This module has DB access (for ui_prefs) but accepts getConfig as a
 * parameter to avoid circular imports.
 *
 * Public API exports:
 * - readRuntimeToolsOverrides(db): Read UI prefs with caching
 * - normalizeRuntimeToolsOverrides(parsed): Normalize raw overrides
 * - isRuntimeEnabledForAgentTool(spec, runtimeTools, getConfig): Check if tool is enabled
 */

/**
 * Normalize runtime tool overrides from UI preferences
 *
 * Converts raw UI prefs into a structured object with defaults.
 * Handles tool_exec, data_fetch, and web_search overrides.
 *
 * @param {*} raw - Raw value from ui_prefs (object expected)
 * @returns {object} Normalized runtime tools overrides
 */
function normalizeRuntimeToolsOverrides(raw) {
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

/**
 * Split CSV list or array into array of strings
 *
 * @param {*} value - CSV string or array
 * @returns {Array<string>} Array of trimmed non-empty strings
 */
function splitCsvListOrArray(value) {
  if (Array.isArray(value)) {
    return value.map((x) => String(x || "").trim()).filter(Boolean);
  }
  // Simple CSV split - assumes splitCsv is available or we implement it
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Read runtime tool overrides from UI preferences
 *
 * Caches results for 1.5 seconds to avoid excessive DB queries.
 *
 * @param {object} db - Database connection (better-sqlite3)
 * @returns {object} Runtime tools overrides (tool_exec, data_fetch, web_search)
 */
function readRuntimeToolsOverrides(db) {
  const CACHE_TTL_MS = 1500;

  // Module-level cache (closed over in factory function)
  let cache = { at: 0, value: { tool_exec: {}, data_fetch: {}, web_search: {} } };

  return function() {
    const now = Date.now();
    if (now - cache.at < CACHE_TTL_MS) return cache.value;

    const row = db.prepare(`SELECT value_json FROM ui_prefs WHERE scope = ?`).get("runtime_tools");
    const parsed = row?.value_json ? safeJsonParse(row.value_json) : null;
    const normalized = normalizeRuntimeToolsOverrides(parsed || {});
    cache = { at: now, value: normalized };
    return normalized;
  };
}

/**
 * Factory to create a cached runtime tools reader
 *
 * Use this to create a reader function with its own cache:
 * const getRuntimeTools = createRuntimeToolsReader(db);
 * const runtimeTools = getRuntimeTools();
 *
 * @param {object} db - Database connection (better-sqlite3)
 * @returns {Function} Cached reader function
 */
function createRuntimeToolsReader(db) {
  const CACHE_TTL_MS = 1500;
  let cache = { at: 0, value: { tool_exec: {}, data_fetch: {}, web_search: {} } };

  return function() {
    const now = Date.now();
    if (now - cache.at < CACHE_TTL_MS) return cache.value;

    const row = db.prepare(`SELECT value_json FROM ui_prefs WHERE scope = ?`).get("runtime_tools");
    const parsed = row?.value_json ? safeJsonParse(row.value_json) : null;
    const normalized = normalizeRuntimeToolsOverrides(parsed || {});
    cache = { at: now, value: normalized };
    return normalized;
  };
}

/**
 * Safe JSON parse with null fallback
 *
 * @param {string} s - JSON string to parse
 * @returns {object|null} Parsed object or null on failure
 */
function safeJsonParse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch { return null; }
}

/**
 * Check if an environment flag is enabled
 *
 * @param {string} name - Environment variable name
 * @param {boolean} fallback - Default value if not set
 * @returns {boolean} True if flag is enabled
 */
function envFlagEnabled(name, fallback = false) {
  const raw = String(process.env[String(name || "")] || "").trim().toLowerCase();
  if (!raw) return fallback;
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Check if a tool is runtime-enabled for agent execution
 *
 * Checks UI prefs overrides first, then falls back to environment flags.
 * The getConfig parameter is a function to avoid circular imports.
 *
 * @param {object} spec - Tool specification object
 * @param {string} spec.jobType - Job type to check
 * @param {object} runtimeTools - Runtime tools overrides from UI prefs
 * @param {Function} getConfig - Config getter function (path, fallback) -> value
 * @returns {boolean} True if tool is enabled
 */
function isRuntimeEnabledForAgentTool(spec, runtimeTools, getConfig) {
  if (!spec || !spec.jobType) return false;

  if (spec.jobType === "tool.exec") {
    const enabledEnv = String(getConfig("handlers.exec.enabled_env", "TOOL_EXEC_ENABLED"));
    if (typeof runtimeTools?.tool_exec?.enabled === "boolean") return runtimeTools.tool_exec.enabled;
    return envFlagEnabled(enabledEnv, false);
  }

  if (spec.jobType === "data.fetch") {
    const enabledEnv = String(getConfig("handlers.data_fetch.enabled_env", "DATA_FETCH_ENABLED"));
    if (typeof runtimeTools?.data_fetch?.enabled === "boolean") return runtimeTools.data_fetch.enabled;
    return envFlagEnabled(enabledEnv, false);
  }

  if (spec.jobType === "tools.web_search") {
    const enabledEnv = String(getConfig("handlers.web_search.enabled_env", "WEB_SEARCH_ENABLED"));
    if (typeof runtimeTools?.web_search?.enabled === "boolean") return runtimeTools.web_search.enabled;
    return envFlagEnabled(enabledEnv, false);
  }

  return true;
}

module.exports = {
  normalizeRuntimeToolsOverrides,
  createRuntimeToolsReader,
  isRuntimeEnabledForAgentTool
};
