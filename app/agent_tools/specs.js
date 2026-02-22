/**
 * Agent Tool Specifications
 *
 * This module defines the available tools that can be called by LLM agents.
 * It provides pure data (tool specs) and lightweight transformation functions.
 *
 * KEY PRINCIPLE: No DB or config dependencies. The worker pre-computes
 * enabled job types and passes them to buildAgentFunctionTools().
 *
 * Public API exports:
 * - AGENT_TOOL_SPECS: Array of tool specifications
 * - AGENT_TOOL_BY_FN: Map for O(1) lookup by function name
 * - normalizeToolCallName(): Sanitize tool call names
 * - parseToolCallArguments(): Parse tool call arguments from LLM
 * - buildAgentFunctionTools(): Build OpenAI function tools array
 */

/**
 * Tool specifications for agent function calling
 *
 * Each spec contains:
 * - fnName: Function name used in LLM function calls
 * - jobType: Maps to job_types.name in database
 * - description: Passed to LLM for tool selection
 * - parameters: JSON Schema for validation
 */
const AGENT_TOOL_SPECS = [
  {
    fnName: "data_file_read",
    jobType: "data.file_read",
    description: "Read a UTF-8 text file from workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Workspace-relative file path." },
        max_bytes: { type: "integer", minimum: 512, maximum: 1048576 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    fnName: "data_write_file",
    jobType: "data.write_file",
    description: "Write or patch a UTF-8 file in workspace.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        mode: { type: "string", enum: ["replace", "append", "prepend", "insert_at", "replace_range"] },
        content: { type: "string" },
        content_base64: { type: "string" },
        offset: { type: "integer", minimum: 0 },
        start: { type: "integer", minimum: 0 },
        end: { type: "integer", minimum: 0 },
        dry_run: { type: "boolean" },
        create_if_missing: { type: "boolean" },
        mkdir_p: { type: "boolean" },
        expected_sha256: { type: "string" },
        max_bytes: { type: "integer", minimum: 512, maximum: 10485760 }
      },
      required: ["path"],
      additionalProperties: false
    }
  },
  {
    fnName: "tools_file_search",
    jobType: "tools.file_search",
    description: "Search files by path/name under workspace.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        max_results: { type: "integer", minimum: 1, maximum: 200 },
        include_hidden: { type: "boolean" }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    fnName: "tools_find_in_files",
    jobType: "tools.find_in_files",
    description: "Search text content from files under workspace.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        path: { type: "string" },
        files: { type: "array", items: { type: "string" }, maxItems: 500 },
        regex: { type: "boolean" },
        case_sensitive: { type: "boolean" },
        include_hidden: { type: "boolean" },
        max_results: { type: "integer", minimum: 1, maximum: 500 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    fnName: "tools_web_search",
    jobType: "tools.web_search",
    description: "Run a web search query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        max_results: { type: "integer", minimum: 1, maximum: 20 },
        provider: { type: "string", enum: ["duckduckgo", "brave"] }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    fnName: "data_fetch",
    jobType: "data.fetch",
    description: "Fetch allowlisted HTTPS URL content.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        timeout_ms: { type: "integer", minimum: 200, maximum: 120000 },
        max_bytes: { type: "integer", minimum: 512, maximum: 1048576 }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    fnName: "tool_exec",
    jobType: "tool.exec",
    description: "Execute an allowlisted command.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string" },
        args: { type: "array", items: { type: "string" }, maxItems: 100 },
        timeout_ms: { type: "integer", minimum: 100, maximum: 120000 }
      },
      required: ["command"],
      additionalProperties: false
    }
  },
  {
    fnName: "workflow_run",
    jobType: "workflow.run",
    description: "Execute a predefined workflow from workspace/workflows.",
    parameters: {
      type: "object",
      properties: {
        workflow: { type: "string" },
        workflow_file: { type: "string" },
        params: { type: "object" },
        queue: { type: "string" }
      },
      required: ["workflow"],
      additionalProperties: false
    }
  }
];

/**
 * Lookup index for O(1) tool spec access by function name
 */
const AGENT_TOOL_BY_FN = new Map(AGENT_TOOL_SPECS.map((x) => [x.fnName, x]));

/**
 * Normalize tool call names from LLM responses
 *
 * Strips dots, hyphens, and other special characters that may
 * appear in LLM function call names.
 *
 * @param {string} raw - Raw function name from LLM
 * @returns {string} Normalized function name
 */
function normalizeToolCallName(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Parse tool call arguments from LLM response
 *
 * Handles object, string, or null inputs. Throws if invalid.
 *
 * @param {*} raw - Raw arguments from LLM (object, string, or null)
 * @returns {object} Parsed arguments object
 * @throws {Error} If arguments are invalid
 */
function parseToolCallArguments(raw) {
  if (raw == null || raw === "") return {};
  if (typeof raw === "object" && !Array.isArray(raw)) return raw;
  if (typeof raw !== "string") {
    throw new Error("tool call arguments must be JSON object or string");
  }
  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("tool call arguments JSON must decode to object");
  }
  return parsed;
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
 * Build OpenAI function tools array for LLM
 *
 * IMPORTANT: This function does NOT access the database or config.
 * The caller must pre-compute enabled job types and check policy.
 *
 * @param {object} params - Function parameters
 * @param {Set<string>} params.enabledJobTypes - Set of enabled job type names (from DB)
 * @param {Function} params.isEnabledCheck - Function(spec, runtimeTools) -> boolean
 * @param {object} params.runtimeTools - Runtime tool overrides from UI prefs
 * @returns {Array} OpenAI function tools array
 */
function buildAgentFunctionTools({ enabledJobTypes, isEnabledCheck, runtimeTools }) {
  if (!enabledJobTypes || typeof enabledJobTypes.has !== "function") {
    throw new Error("buildAgentFunctionTools requires enabledJobTypes Set");
  }
  if (typeof isEnabledCheck !== "function") {
    throw new Error("buildAgentFunctionTools requires isEnabledCheck function");
  }

  const tools = [];
  for (const spec of AGENT_TOOL_SPECS) {
    // Skip if job type is not enabled in database
    if (!enabledJobTypes.has(spec.jobType)) continue;

    // Skip if runtime policy disables this tool
    if (!isEnabledCheck(spec, runtimeTools)) continue;

    tools.push({
      type: "function",
      function: {
        name: spec.fnName,
        description: spec.description,
        parameters: spec.parameters
      }
    });
  }
  return tools;
}

module.exports = {
  AGENT_TOOL_SPECS,
  AGENT_TOOL_BY_FN,
  normalizeToolCallName,
  parseToolCallArguments,
  buildAgentFunctionTools
};
