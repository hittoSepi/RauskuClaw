const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { db } = require("../db");
const { getConfig, envOrConfig, envIntOrConfig, envBoolOrConfig } = require("../config");
const { createProviderError, toProviderError } = require("./errors");
const {
  getLatestWorkingMemorySession,
  buildWorkingMemoryContext
} = require("../memory/working_memory");

const { holviHttp } = require("../lib/holviClient");

const OPENAI_ALIAS = process.env.HOLVI_OPENAI_ALIAS || "sec://openai_api_key";
const SUMMARY_CACHE_MAX = 128;
const summaryCache = new Map();

function cacheSet(cacheKey, value) {
  if (summaryCache.has(cacheKey)) summaryCache.delete(cacheKey);
  summaryCache.set(cacheKey, value);
  if (summaryCache.size > SUMMARY_CACHE_MAX) {
    const first = summaryCache.keys().next().value;
    if (first) summaryCache.delete(first);
  }
}

function summarizeMarkdownCached(raw, maxChars = 2000) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const hash = crypto.createHash("sha1").update(text).digest("hex");
  const cacheKey = `${maxChars}:${hash}`;
  const hit = summaryCache.get(cacheKey);
  if (typeof hit === "string") return hit;
  const out = summarizeMarkdown(text, maxChars);
  cacheSet(cacheKey, out);
  return out;
}

function extractAssistantText(choice) {
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

const VALID_ROLES = new Set(["system", "user", "assistant", "tool"]);

function normalizeMessages(input) {
  const system = String(input?.system || "").trim();
  if (Array.isArray(input?.messages) && input.messages.length > 0) {
    const normalized = input.messages
      .map((m) => {
        const role = String(m?.role || "user");
        const msg = { role };
        
        // Handle content (can be string, null, or array for multimodal)
        if (m.content !== undefined && m.content !== null) {
          if (typeof m.content === "string") {
            msg.content = m.content;
          } else if (Array.isArray(m.content)) {
            msg.content = m.content;
          } else {
            msg.content = String(m.content);
          }
        } else {
          msg.content = "";
        }
        
        // Handle tool_calls for assistant messages
        if (role === "assistant" && m.tool_calls) {
          msg.tool_calls = m.tool_calls;
        }
        
        // Handle tool_call_id for tool role messages
        if (role === "tool" && m.tool_call_id) {
          msg.tool_call_id = m.tool_call_id;
        }
        
        // Handle name for tool messages (optional)
        if (m.name) {
          msg.name = m.name;
        }
        
        return msg;
      })
      .filter((m) => {
        // Must have valid role
        if (!VALID_ROLES.has(m.role)) return false;
        // Tool messages must have tool_call_id
        if (m.role === "tool" && !m.tool_call_id) return false;
        // Other messages need content or tool_calls
        if (m.role !== "tool") {
          const hasContent = (typeof m.content === "string" && m.content.trim().length > 0) ||
                             (Array.isArray(m.content) && m.content.length > 0);
          const hasToolCalls = m.tool_calls && m.tool_calls.length > 0;
          if (!hasContent && !hasToolCalls) return false;
        }
        return true;
      });
    if (!system) return normalized;
    const hasLeadingSystem = normalized.length > 0 && normalized[0].role === "system" && normalized[0].content.trim() === system;
    return hasLeadingSystem ? normalized : [{ role: "system", content: system }, ...normalized];
  }

  const prompt = String(input?.prompt || "").trim();
  if (!prompt) throw createProviderError("PROVIDER_INPUT", "OpenAI chat input requires 'prompt' or 'messages'");

  const out = [];
  if (system) out.push({ role: "system", content: system });
  out.push({ role: "user", content: prompt });
  return out;
}

function readAgentsMdContent(options = {}) {
  if (typeof options.agentsMdContent === "string") {
    return options.agentsMdContent.trim();
  }
  if (options.agentsMdContent === null) return "";

  const explicitPath = String(process.env.OPENAI_AGENTS_MD_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/AGENTS.md"),
    path.resolve(workspaceRoot, "AGENTS.md"),
    path.resolve(process.cwd(), "AGENTS.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readToolsReadmeContent(options = {}) {
  if (typeof options.toolsReadmeContent === "string") {
    return options.toolsReadmeContent.trim();
  }
  if (options.toolsReadmeContent === null) return "";

  const explicitPath = String(process.env.OPENAI_TOOLS_README_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/tools/README.md"),
    path.resolve(workspaceRoot, "tools/README.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readIdentityMdContent(options = {}) {
  if (typeof options.identityMdContent === "string") {
    return options.identityMdContent.trim();
  }
  if (options.identityMdContent === null) return "";

  const explicitPath = String(process.env.OPENAI_IDENTITY_MD_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/IDENTITY.md"),
    path.resolve(workspaceRoot, "IDENTITY.md"),
    path.resolve(process.cwd(), "IDENTITY.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readSoulMdContent(options = {}) {
  if (typeof options.soulMdContent === "string") {
    return options.soulMdContent.trim();
  }
  if (options.soulMdContent === null) return "";

  const explicitPath = String(process.env.OPENAI_SOUL_MD_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/SOUL.md"),
    path.resolve(workspaceRoot, "SOUL.md"),
    path.resolve(process.cwd(), "SOUL.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readUserMdContent(options = {}) {
  if (typeof options.userMdContent === "string") {
    return options.userMdContent.trim();
  }
  if (options.userMdContent === null) return "";

  const explicitPath = String(process.env.OPENAI_USER_MD_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/USER.md"),
    path.resolve(workspaceRoot, "USER.md"),
    path.resolve(process.cwd(), "USER.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readMemoryMdContent(options = {}) {
  if (typeof options.memoryMdContent === "string") {
    return options.memoryMdContent.trim();
  }
  if (options.memoryMdContent === null) return "";

  const explicitPath = String(process.env.OPENAI_MEMORY_MD_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/rauskuAssets/MEMORY.md"),
    path.resolve(workspaceRoot, "rauskuAssets/MEMORY.md"),
    path.resolve(process.cwd(), "workspace/MEMORY.md"),
    path.resolve(workspaceRoot, "MEMORY.md"),
    path.resolve(process.cwd(), "MEMORY.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readWorkflowsYamlContent(options = {}) {
  if (typeof options.workflowsYamlContent === "string") {
    return options.workflowsYamlContent.trim();
  }
  if (options.workflowsYamlContent === null) return "";

  const explicitPath = String(process.env.OPENAI_WORKFLOWS_YAML_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/workflows/workflows.yaml"),
    path.resolve(workspaceRoot, "workflows/workflows.yaml")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function readWorkflowToolMdContent(options = {}) {
  if (typeof options.workflowToolMdContent === "string") {
    return options.workflowToolMdContent.trim();
  }
  if (options.workflowToolMdContent === null) return "";

  const explicitPath = String(process.env.OPENAI_WORKFLOW_TOOL_MD_PATH || "").trim();
  const workspaceRoot = String(process.env.WORKSPACE_ROOT || process.env.CODEX_OSS_WORKDIR || "/workspace").trim() || "/workspace";
  const candidates = [
    explicitPath,
    path.resolve(process.cwd(), "workspace/tools/workflow.run/TOOL.md"),
    path.resolve(workspaceRoot, "tools/workflow.run/TOOL.md")
  ].filter(Boolean);

  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const raw = fs.readFileSync(p, "utf8");
      if (String(raw || "").trim()) return String(raw || "").trim();
    } catch {}
  }
  return "";
}

function shouldIncludeWorkflowToolContext(input) {
  const i = input && typeof input === "object" ? input : {};
  const chunks = [];
  if (typeof i.prompt === "string") chunks.push(i.prompt);
  if (typeof i.system === "string") chunks.push(i.system);
  if (Array.isArray(i.messages)) {
    for (const m of i.messages) {
      const c = String(m?.content || "").trim();
      if (c) chunks.push(c);
    }
  }
  const text = chunks.join("\n").toLowerCase();
  if (!text) return false;
  return /\bworkflow\.run\b/.test(text) || /\bworkflows?\.yaml\b/.test(text) || /\bworkflow\b/.test(text);
}

function shouldUseFullRepoContext(input) {
  const i = input && typeof input === "object" ? input : {};
  const chunks = [];
  if (typeof i.prompt === "string") chunks.push(i.prompt);
  // Skip system here: system prompts often contain words like "policy",
  // which would otherwise force full context on almost every turn.
  if (Array.isArray(i.messages)) {
    for (const m of i.messages) {
      const c = String(m?.content || "").trim();
      if (c) chunks.push(c);
    }
  }
  const text = chunks.join("\n").toLowerCase();
  if (!text) return false;
  return (
    /\bverbatim\b/.test(text) ||
    /\bexact\b/.test(text) ||
    /\bfull\b/.test(text) ||
    /\bfull\s+(text|content|context|file)\b/.test(text) ||
    /\bexact\s+(text|content|context|file)\b/.test(text) ||
    /\bshow\s+(full|exact|verbatim)\b/.test(text) ||
    /\bagents\.md\b/.test(text) ||
    /\bidentity\.md\b/.test(text) ||
    /\bsoul\.md\b/.test(text) ||
    /\buser\.md\b/.test(text)
  );
}

function summarizeMarkdown(raw, maxChars = 2000) {
  const text = String(raw || "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;

  const lines = text.split(/\r?\n/);
  const picked = [];
  let chars = 0;
  const push = (line) => {
    const s = String(line || "").trim();
    if (!s) return;
    if (chars + s.length + 1 > maxChars) return;
    picked.push(s);
    chars += s.length + 1;
  };

  for (const line of lines) {
    if (/^\s*#/.test(line) || /^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) push(line);
    if (chars >= Math.floor(maxChars * 0.75)) break;
  }

  if (picked.length < 4) {
    for (const line of lines) {
      push(line);
      if (chars >= maxChars) break;
    }
  }

  const out = picked.join("\n").trim();
  return out.length < text.length ? `${out}\n\n[context summarized]` : out;
}

function withAgentsMdSystemMessage(messages, options = {}, repoContext = null, sourceInput = null) {
  const ctx = repoContext && typeof repoContext === "object" ? repoContext : {};
  const agentsMd = ctx.agents === false ? "" : readAgentsMdContent(options);
  const toolsReadme = ctx.tools_readme === false ? "" : readToolsReadmeContent(options);
  const identityMd = ctx.identity === false ? "" : readIdentityMdContent(options);
  const soulMd = ctx.soul === false ? "" : readSoulMdContent(options);
  const userMd = ctx.user === false ? "" : readUserMdContent(options);
  const memoryMd = ctx.memory_md === false ? "" : readMemoryMdContent(options);
  const workflowsYaml = ctx.workflows_yaml === false ? "" : readWorkflowsYamlContent(options);
  const workflowToolMd = ctx.workflow_tool_md === false
    ? ""
    : (shouldIncludeWorkflowToolContext(sourceInput) ? readWorkflowToolMdContent(options) : "");
  if (!agentsMd && !toolsReadme && !identityMd && !soulMd && !userMd && !memoryMd && !workflowsYaml && !workflowToolMd) return messages;

  const parts = [];
  if (agentsMd) {
    parts.push("Repository policy from AGENTS.md (follow these instructions):");
  //  parts.push(agentsMd.slice(0, 12000));
  }
  if (identityMd) {
    parts.push("Project identity from IDENTITY.md:");
  //  parts.push(summarizeMarkdownCached(identityMd, 1600).slice(0, 6000));
  }
  if (soulMd) {
    parts.push("Project soul from SOUL.md:");
//    parts.push(summarizeMarkdownCached(soulMd, 1600).slice(0, 6000));
  }
  if (userMd) {
    parts.push("User profile and preferences from USER.md:");
  //  parts.push(userMd.slice(0, 6000));
  }
  if (toolsReadme) {
    parts.push("Tool directory index from workspace/tools/README.md:");
 //   parts.push(toolsReadme.slice(0, 8000));
  }
  if (memoryMd) {
    parts.push("Working memory from rauskuAssets/MEMORY.md (important long-lived notes):");
  //  parts.push(memoryMd.slice(0, 8000));
  }
  if (workflowsYaml) {
    parts.push("Workflow catalog from workspace/workflows/workflows.yaml:");
  // parts.push(workflowsYaml.slice(0, 12000));
  }
  if (workflowToolMd) {
    parts.push("Workflow execution contract from workspace/tools/workflow.run/TOOL.md:");
   //parts.push(workflowToolMd.slice(0, 6000));
  }
  const content = parts.join("\n\n");
  return [{ role: "system", content }, ...messages];
}

function prewarmRepoContextSummaries(input = {}, options = {}) {
  const repoContext = resolveRepoContext(input);
  if (!repoContext.enabled) {
    return { enabled: false, full_context: false, warmed_summaries: 0, included_sections: 0 };
  }
  const fullContext = shouldUseFullRepoContext(input);
  const ctx = repoContext.selections || {};
  const sources = [
    { enabled: ctx.agents !== false, summarize: false, maxChars: 2600, read: () => readAgentsMdContent(options) },
    { enabled: ctx.identity !== false, summarize: true, maxChars: 1600, read: () => readIdentityMdContent(options) },
    { enabled: ctx.soul !== false, summarize: true, maxChars: 1600, read: () => readSoulMdContent(options) },
    { enabled: ctx.user !== false, summarize: false, maxChars: 1600, read: () => readUserMdContent(options) },
    { enabled: ctx.tools_readme !== false, summarize: false, maxChars: 1800, read: () => readToolsReadmeContent(options) },
    { enabled: ctx.memory_md !== false, summarize: false, maxChars: 2200, read: () => readMemoryMdContent(options) },
    { enabled: ctx.workflows_yaml !== false, summarize: false, maxChars: 2600, read: () => readWorkflowsYamlContent(options) },
    {
      enabled: ctx.workflow_tool_md !== false && shouldIncludeWorkflowToolContext(input),
      summarize: false,
      maxChars: 1600,
      read: () => readWorkflowToolMdContent(options)
    }
  ];

  let included = 0;
  let warmed = 0;
  for (const src of sources) {
    if (!src.enabled) continue;
    const raw = String(src.read() || "").trim();
    if (!raw) continue;
    included += 1;
    if (src.summarize === true) {
      summarizeMarkdownCached(raw, src.maxChars);
      warmed += 1;
    }
  }

  return {
    enabled: true,
    full_context: fullContext,
    warmed_summaries: warmed,
    included_sections: included
  };
}

function shouldInjectRepoContext(input) {
  const i = input && typeof input === "object" ? input : {};
  return i.skip_repo_context !== true;
}

function withWorkingMemoryContext(messages, options = {}) {
  if (options.skip_working_memory === true) return messages;
  
  try {
    const workingMemoryState = getLatestWorkingMemorySession(db);
    if (!workingMemoryState) return messages;
    
    const context = buildWorkingMemoryContext(workingMemoryState);
    if (!context) return messages;
    
    // Prepend working memory context as system message
    return [{ role: "system", content: context }, ...messages];
  } catch {
    return messages;
  }
}

function resolveRepoContext(input) {
  const i = input && typeof input === "object" ? input : {};
  if (i.skip_repo_context === true) {
    return { enabled: false, selections: {} };
  }
  const custom = i.repo_context && typeof i.repo_context === "object" ? i.repo_context : {};
  const selections = {
    agents: custom.agents !== false,
    identity: custom.identity !== false,
    soul: custom.soul !== false,
    user: custom.user !== false,
    tools_readme: custom.tools_readme !== false,
    memory_md: custom.memory_md !== false,
    workflows_yaml: custom.workflows_yaml !== false,
    workflow_tool_md: custom.workflow_tool_md !== false
  };
  const enabled = selections.agents
    || selections.identity
    || selections.soul
    || selections.user
    || selections.tools_readme
    || selections.memory_md
    || selections.workflows_yaml
    || selections.workflow_tool_md;
  return { enabled, selections };
}

function openAiSettings() {
  const enabled = envBoolOrConfig("OPENAI_ENABLED", "providers.openai.enabled", false);
  const apiKeyEnv = String(getConfig("providers.openai.api_key_env", "OPENAI_API_KEY"));
  const apiKey = String(process.env[apiKeyEnv] || "").trim();
  const baseUrl = String(envOrConfig("OPENAI_BASE_URL", "providers.openai.base_url", "https://api.openai.com")).replace(/\/+$/, "");
  const chatCompletionsPath = String(
    envOrConfig("OPENAI_CHAT_COMPLETIONS_PATH", "providers.openai.chat_completions_path", "/v1/chat/completions")
  ).trim();
  const model = String(envOrConfig("OPENAI_MODEL", "providers.openai.model", "gpt-4.1-mini")).trim();
  const timeoutMs = envIntOrConfig("OPENAI_TIMEOUT_MS", "providers.openai.timeout_ms", 30000);

  return { enabled, apiKeyEnv, apiKey, baseUrl, chatCompletionsPath, model, timeoutMs };
}

function buildCompletionsUrl(settings) {
  const path = String(settings?.chatCompletionsPath || "").trim();
  if (!path) {
    throw createProviderError("PROVIDER_CONFIG", "OpenAI chat completions path is empty.");
  }
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = `/${path.replace(/^\/+/, "")}`;
  return `${settings.baseUrl}${normalizedPath}`;
}

async function runOpenAiChat(input, options = {}) {
  const s = options.settings || openAiSettings();
  const fetchImpl = options.fetchImpl || fetch;
  if (!s.enabled) {
    throw createProviderError("PROVIDER_DISABLED", "OpenAI provider disabled. Set OPENAI_ENABLED=1 (or providers.openai.enabled=true).");
  }
  if (!s.apiKey) {
    throw createProviderError("PROVIDER_CONFIG", `OpenAI API key missing. Set ${s.apiKeyEnv}.`);
  }
  if (!s.model) {
    throw createProviderError("PROVIDER_CONFIG", "OpenAI model is empty.");
  }
  const completionsUrl = buildCompletionsUrl(s);

  const baseMessages = normalizeMessages(input || {});
  const repoContext = resolveRepoContext(input);
  let messages = repoContext.enabled
    ? withAgentsMdSystemMessage(baseMessages, options, repoContext.selections, input)
    : baseMessages;
  
  // Inject working memory context
  messages = withWorkingMemoryContext(messages, options);
  
  const payload = { model: s.model, messages };

  if (Number.isFinite(Number(input?.temperature))) {
    payload.temperature = Number(input.temperature);
  }
  if (Number.isInteger(input?.max_tokens) && input.max_tokens > 0) {
    payload.max_tokens = input.max_tokens;
  }
  
  // Function calling support: tools and tool_choice
  if (Array.isArray(input?.tools) && input.tools.length > 0) {
    payload.tools = input.tools;
  }
  if (input?.tool_choice && typeof input.tool_choice === "string") {
    payload.tool_choice = input.tool_choice;
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1, s.timeoutMs));
  try {
    const resp = await fetchImpl(completionsUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${s.apiKey}`
      },
      body: JSON.stringify(payload),
      signal: ctrl.signal
    });

    const text = await resp.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }

    if (!resp.ok) {
      const msg = data?.error?.message || data?.error || text || `OpenAI error ${resp.status}`;
      throw createProviderError("PROVIDER_HTTP", String(msg), { status: resp.status });
    }

    const choice = data?.choices?.[0];
    const outputText = extractAssistantText(choice);
    const finishReason = choice?.finish_reason || null;
    
    // Extract tool_calls if present (for function calling)
    const toolCalls = choice?.message?.tool_calls || null;
    
    // Allow empty text if tool_calls are present (function calling scenario)
    if (!outputText.trim() && !toolCalls) {
      throw createProviderError("PROVIDER_RESPONSE", "OpenAI returned empty assistant output.");
    }
    
    return {
      provider: "openai",
      model: data?.model || s.model,
      output_text: outputText,
      finish_reason: finishReason,
      tool_calls: toolCalls,
      usage: data?.usage || null,
      id: data?.id || null
    };
  } catch (e) {
    if (e?.name === "AbortError") {
      throw createProviderError("PROVIDER_TIMEOUT", `OpenAI request timed out after ${s.timeoutMs}ms.`);
    }
    throw toProviderError(e, "PROVIDER_NETWORK", "OpenAI request failed");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runOpenAiChat,
  prewarmRepoContextSummaries,
  normalizeMessages,
  openAiSettings,
  extractAssistantText,
  buildCompletionsUrl,
  readAgentsMdContent,
  readToolsReadmeContent,
  readIdentityMdContent,
  readSoulMdContent,
  readUserMdContent,
  withAgentsMdSystemMessage,
  withWorkingMemoryContext,
  shouldInjectRepoContext,
  resolveRepoContext
};
