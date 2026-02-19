import { api } from "./api.js";

const KEY_DEV_MODE = "rauskuclaw_ui_dev_mode";
const KEY_CHAT_MEMORY_DEFAULT = "rauskuclaw_chat_memory_default_enabled";
const KEY_CHAT_MEMORY_WRITE_DEFAULT = "rauskuclaw_chat_memory_write_default_enabled";
const KEY_SUGGESTED_APPROVAL_MODE = "rauskuclaw_suggested_approval_mode";
const KEY_SUGGESTED_AUTO_MAX_TIMEOUT_SEC = "rauskuclaw_suggested_auto_max_timeout_sec";
const KEY_SUGGESTED_AUTO_MAX_ATTEMPTS = "rauskuclaw_suggested_auto_max_attempts";
const KEY_SUGGESTED_AUTO_MAX_PRIORITY = "rauskuclaw_suggested_auto_max_priority";
const KEY_SUGGESTED_AUTO_ALLOW_TYPES = "rauskuclaw_suggested_auto_allow_types";
const KEY_CHAT_AGENT_PROMPT = "rauskuclaw_chat_agent_prompt";
const KEY_CHAT_PLANNER_PROMPT = "rauskuclaw_chat_planner_prompt";
const KEY_CHAT_SUMMARY_PROMPT = "rauskuclaw_chat_summary_prompt";
const KEY_CHAT_NEW_SESSION_PROMPT = "rauskuclaw_chat_new_session_prompt";
const KEY_CHAT_ROUTER_PROMPT = "rauskuclaw_chat_router_prompt";
const KEY_CHAT_NEW_SESSION_AUTO_RUN = "rauskuclaw_chat_new_session_auto_run";
const KEY_CHAT_PROMPT_INJECTIONS = "rauskuclaw_chat_prompt_injections";
const KEY_CHAT_MAX_PROMPT_TOKENS = "rauskuclaw_chat_max_prompt_tokens";
const KEY_CHAT_PLANNER_ENABLED = "rauskuclaw_chat_planner_enabled";
const KEY_CHAT_ROUTER_ENABLED = "rauskuclaw_chat_router_enabled";
const PREFS_SCOPE = "default";

let persistTimer = null;
let persistInFlight = false;
let persistQueued = false;

function readBool(key, fallback = false) {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeBool(key, value) {
  try {
    sessionStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

function readString(key, fallback = "") {
  try {
    const raw = sessionStorage.getItem(key);
    if (raw == null) return fallback;
    return String(raw);
  } catch {
    return fallback;
  }
}

function writeString(key, value) {
  try {
    sessionStorage.setItem(key, String(value ?? ""));
  } catch {}
}

function readInt(key, fallback) {
  const raw = readString(key, "");
  const n = Number(raw);
  return Number.isInteger(n) ? n : fallback;
}

function normalizeApprovalMode(mode) {
  const v = String(mode || "").trim();
  return (v === "always" || v === "never" || v === "smart") ? v : "smart";
}

function clampInt(value, { min, max, fallback }) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function normalizePrompt(value) {
  return String(value || "").slice(0, 12000);
}

function defaultInjectionConfig() {
  return {
    agents: true,
    identity: true,
    soul: true,
    user: true,
    tools_readme: true,
    memory_md: true,
    workflows_yaml: true,
    workflow_tool_md: true
  };
}

function normalizeInjectionConfig(raw, fallback = null) {
  const base = fallback || defaultInjectionConfig();
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    agents: src.agents == null ? base.agents : src.agents === true,
    identity: src.identity == null ? base.identity : src.identity === true,
    soul: src.soul == null ? base.soul : src.soul === true,
    user: src.user == null ? base.user : src.user === true,
    tools_readme: src.tools_readme == null ? base.tools_readme : src.tools_readme === true,
    memory_md: src.memory_md == null ? base.memory_md : src.memory_md === true,
    workflows_yaml: src.workflows_yaml == null ? base.workflows_yaml : src.workflows_yaml === true,
    workflow_tool_md: src.workflow_tool_md == null ? base.workflow_tool_md : src.workflow_tool_md === true
  };
}

function defaultPromptInjections() {
  return {
    agent: defaultInjectionConfig(),
    planner: defaultInjectionConfig(),
    router: {
      agents: false, identity: false, soul: false, user: false, tools_readme: false, memory_md: false, workflows_yaml: false, workflow_tool_md: false
    },
    summary: {
      agents: false, identity: false, soul: false, user: false, tools_readme: false, memory_md: false, workflows_yaml: false, workflow_tool_md: false
    },
    new_session: defaultInjectionConfig()
  };
}

function normalizePromptInjections(raw) {
  const src = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const defaults = defaultPromptInjections();
  return {
    agent: normalizeInjectionConfig(src.agent, defaults.agent),
    planner: normalizeInjectionConfig(src.planner, defaults.planner),
    router: normalizeInjectionConfig(src.router, defaults.router),
    summary: normalizeInjectionConfig(src.summary, defaults.summary),
    new_session: normalizeInjectionConfig(src.new_session, defaults.new_session)
  };
}

function normalizePrefs(input = {}) {
  return {
    devMode: input.devMode === true,
    chatMemoryDefaultEnabled: input.chatMemoryDefaultEnabled !== false,
    chatMemoryWriteDefaultEnabled: input.chatMemoryWriteDefaultEnabled === true,
    suggestedApprovalMode: normalizeApprovalMode(input.suggestedApprovalMode),
    suggestedAutoMaxTimeoutSec: clampInt(input.suggestedAutoMaxTimeoutSec, { min: 1, max: 3600, fallback: 30 }),
    suggestedAutoMaxAttempts: clampInt(input.suggestedAutoMaxAttempts, { min: 1, max: 10, fallback: 1 }),
    suggestedAutoMaxPriority: clampInt(input.suggestedAutoMaxPriority, { min: 0, max: 10, fallback: 5 }),
    suggestedAutoAllowTypes: String(input.suggestedAutoAllowTypes || "report.generate,memory.write"),
    chatAgentPrompt: normalizePrompt(input.chatAgentPrompt),
    chatPlannerPrompt: normalizePrompt(input.chatPlannerPrompt),
    chatSummaryPrompt: normalizePrompt(input.chatSummaryPrompt),
    chatNewSessionPrompt: normalizePrompt(input.chatNewSessionPrompt),
    chatRouterPrompt: normalizePrompt(input.chatRouterPrompt),
    chatNewSessionAutoRun: input.chatNewSessionAutoRun !== false,
    chatPromptInjections: normalizePromptInjections(input.chatPromptInjections),
    chatMaxPromptTokens: clampInt(input.chatMaxPromptTokens, { min: 512, max: 200000, fallback: 12000 }),
    chatPlannerEnabled: input.chatPlannerEnabled !== false,
    chatRouterEnabled: input.chatRouterEnabled !== false
  };
}

function readSessionPrefs() {
  return normalizePrefs({
    devMode: readBool(KEY_DEV_MODE, false),
    chatMemoryDefaultEnabled: readBool(KEY_CHAT_MEMORY_DEFAULT, true),
    chatMemoryWriteDefaultEnabled: readBool(KEY_CHAT_MEMORY_WRITE_DEFAULT, false),
    suggestedApprovalMode: readString(KEY_SUGGESTED_APPROVAL_MODE, "smart"),
    suggestedAutoMaxTimeoutSec: readInt(KEY_SUGGESTED_AUTO_MAX_TIMEOUT_SEC, 30),
    suggestedAutoMaxAttempts: readInt(KEY_SUGGESTED_AUTO_MAX_ATTEMPTS, 1),
    suggestedAutoMaxPriority: readInt(KEY_SUGGESTED_AUTO_MAX_PRIORITY, 5),
    suggestedAutoAllowTypes: readString(KEY_SUGGESTED_AUTO_ALLOW_TYPES, "report.generate,memory.write"),
    chatAgentPrompt: readString(KEY_CHAT_AGENT_PROMPT, ""),
    chatPlannerPrompt: readString(KEY_CHAT_PLANNER_PROMPT, ""),
    chatSummaryPrompt: readString(KEY_CHAT_SUMMARY_PROMPT, ""),
    chatNewSessionPrompt: readString(KEY_CHAT_NEW_SESSION_PROMPT, ""),
    chatRouterPrompt: readString(KEY_CHAT_ROUTER_PROMPT, ""),
    chatNewSessionAutoRun: readBool(KEY_CHAT_NEW_SESSION_AUTO_RUN, true),
    chatPlannerEnabled: readBool(KEY_CHAT_PLANNER_ENABLED, true),
    chatRouterEnabled: readBool(KEY_CHAT_ROUTER_ENABLED, true),
    chatMaxPromptTokens: readInt(KEY_CHAT_MAX_PROMPT_TOKENS, 12000),
    chatPromptInjections: (() => {
      try {
        const raw = sessionStorage.getItem(KEY_CHAT_PROMPT_INJECTIONS);
        return raw ? JSON.parse(raw) : defaultPromptInjections();
      } catch {
        return defaultPromptInjections();
      }
    })()
  });
}

function writeSessionPrefs(prefs) {
  const p = normalizePrefs(prefs);
  writeBool(KEY_DEV_MODE, p.devMode);
  writeBool(KEY_CHAT_MEMORY_DEFAULT, p.chatMemoryDefaultEnabled);
  writeBool(KEY_CHAT_MEMORY_WRITE_DEFAULT, p.chatMemoryWriteDefaultEnabled);
  writeString(KEY_SUGGESTED_APPROVAL_MODE, p.suggestedApprovalMode);
  writeString(KEY_SUGGESTED_AUTO_MAX_TIMEOUT_SEC, p.suggestedAutoMaxTimeoutSec);
  writeString(KEY_SUGGESTED_AUTO_MAX_ATTEMPTS, p.suggestedAutoMaxAttempts);
  writeString(KEY_SUGGESTED_AUTO_MAX_PRIORITY, p.suggestedAutoMaxPriority);
  writeString(KEY_SUGGESTED_AUTO_ALLOW_TYPES, p.suggestedAutoAllowTypes);
  writeString(KEY_CHAT_AGENT_PROMPT, p.chatAgentPrompt);
  writeString(KEY_CHAT_PLANNER_PROMPT, p.chatPlannerPrompt);
  writeString(KEY_CHAT_SUMMARY_PROMPT, p.chatSummaryPrompt);
  writeString(KEY_CHAT_NEW_SESSION_PROMPT, p.chatNewSessionPrompt);
  writeString(KEY_CHAT_ROUTER_PROMPT, p.chatRouterPrompt);
  writeBool(KEY_CHAT_NEW_SESSION_AUTO_RUN, p.chatNewSessionAutoRun);
  writeBool(KEY_CHAT_PLANNER_ENABLED, p.chatPlannerEnabled);
  writeBool(KEY_CHAT_ROUTER_ENABLED, p.chatRouterEnabled);
  writeString(KEY_CHAT_MAX_PROMPT_TOKENS, p.chatMaxPromptTokens);
  writeString(KEY_CHAT_PROMPT_INJECTIONS, JSON.stringify(p.chatPromptInjections));
}

async function flushPersist() {
  if (persistInFlight) {
    persistQueued = true;
    return;
  }
  persistInFlight = true;
  try {
    const prefs = readSessionPrefs();
    await api.saveUiPrefs(PREFS_SCOPE, prefs);
  } catch {
    // Keep session-local copy as fallback when API save fails.
  } finally {
    persistInFlight = false;
    if (persistQueued) {
      persistQueued = false;
      void flushPersist();
    }
  }
}

function schedulePersist() {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    void flushPersist();
  }, 250);
}

function updateAndPersist(mutator) {
  const current = readSessionPrefs();
  const nextRaw = typeof mutator === "function" ? mutator(current) : current;
  const next = normalizePrefs(nextRaw);
  writeSessionPrefs(next);
  schedulePersist();
}

export function getUiPrefs() {
  return readSessionPrefs();
}

export async function loadUiPrefsFromApi() {
  try {
    const out = await api.uiPrefs(PREFS_SCOPE);
    const prefs = normalizePrefs(out?.prefs || {});
    writeSessionPrefs(prefs);
    return prefs;
  } catch {
    return readSessionPrefs();
  }
}

export function setDevModeEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, devMode: enabled === true }));
}

export function setChatMemoryDefaultEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, chatMemoryDefaultEnabled: enabled === true }));
}

export function setChatMemoryWriteDefaultEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, chatMemoryWriteDefaultEnabled: enabled === true }));
}

export function setSuggestedApprovalMode(mode) {
  updateAndPersist((p) => ({ ...p, suggestedApprovalMode: normalizeApprovalMode(mode) }));
}

export function setSuggestedAutoMaxTimeoutSec(value) {
  updateAndPersist((p) => ({
    ...p,
    suggestedAutoMaxTimeoutSec: clampInt(value, { min: 1, max: 3600, fallback: 30 })
  }));
}

export function setSuggestedAutoMaxAttempts(value) {
  updateAndPersist((p) => ({
    ...p,
    suggestedAutoMaxAttempts: clampInt(value, { min: 1, max: 10, fallback: 1 })
  }));
}

export function setSuggestedAutoMaxPriority(value) {
  updateAndPersist((p) => ({
    ...p,
    suggestedAutoMaxPriority: clampInt(value, { min: 0, max: 10, fallback: 5 })
  }));
}

export function setSuggestedAutoAllowTypes(value) {
  updateAndPersist((p) => ({ ...p, suggestedAutoAllowTypes: String(value || "") }));
}

export function setChatAgentPrompt(value) {
  updateAndPersist((p) => ({ ...p, chatAgentPrompt: normalizePrompt(value) }));
}

export function setChatPlannerPrompt(value) {
  updateAndPersist((p) => ({ ...p, chatPlannerPrompt: normalizePrompt(value) }));
}

export function setChatSummaryPrompt(value) {
  updateAndPersist((p) => ({ ...p, chatSummaryPrompt: normalizePrompt(value) }));
}

export function setChatNewSessionPrompt(value) {
  updateAndPersist((p) => ({ ...p, chatNewSessionPrompt: normalizePrompt(value) }));
}

export function setChatRouterPrompt(value) {
  updateAndPersist((p) => ({ ...p, chatRouterPrompt: normalizePrompt(value) }));
}

export function setChatNewSessionAutoRun(enabled) {
  updateAndPersist((p) => ({ ...p, chatNewSessionAutoRun: enabled !== false }));
}

export function setChatPromptInjections(value) {
  updateAndPersist((p) => ({ ...p, chatPromptInjections: normalizePromptInjections(value) }));
}

export function setChatMaxPromptTokens(value) {
  updateAndPersist((p) => ({
    ...p,
    chatMaxPromptTokens: clampInt(value, { min: 512, max: 200000, fallback: 12000 })
  }));
}

export function setChatPlannerEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, chatPlannerEnabled: enabled !== false }));
}

export function setChatRouterEnabled(enabled) {
  updateAndPersist((p) => ({ ...p, chatRouterEnabled: enabled !== false }));
}
