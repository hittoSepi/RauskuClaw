import { filterDuplicateSuggestions, parseSuggestedJobs } from "./suggested_jobs.js";
import { getSuggestedJobDecision } from "./suggested_job_policy.js";

function toPolicy(policy) {
  return {
    mode: policy?.mode,
    maxTimeoutSec: policy?.maxTimeoutSec,
    maxAttempts: policy?.maxAttempts,
    maxPriority: policy?.maxPriority,
    allowTypes: policy?.allowTypes
  };
}

export function evaluateSuggestedJobDecisions(jobs, policy) {
  const p = toPolicy(policy);
  return (Array.isArray(jobs) ? jobs : []).map((job) => getSuggestedJobDecision(job, p));
}

export function parseFilterAndDecideSuggestedJobs({ text, currentType, userText, policy }) {
  const suggestions = parseSuggestedJobs(text);
  const enabledTypes = (Array.isArray(policy?.enabledTypes) ? policy.enabledTypes : [])
    .map((x) => String(x || "").trim())
    .filter(Boolean);
  const enabledSet = new Set(enabledTypes);
  const normalizedSuggestions = suggestions.map((job) => ({
    ...job,
    type: normalizeChatGenerateType(job?.type, { currentType, enabledTypes })
  }));
  const typeFiltered = enabledSet.size > 0
    ? normalizedSuggestions.filter((job) => enabledSet.has(String(job?.type || "").trim()))
    : normalizedSuggestions.slice();
  const droppedUnknownTypes = normalizedSuggestions.length - typeFiltered.length;

  const dupFiltered = filterDuplicateSuggestions(typeFiltered, { currentType, userText });
  const filtered = {
    kept: dupFiltered.kept,
    dropped: Number(dupFiltered.dropped || 0) + droppedUnknownTypes
  };
  const decisions = evaluateSuggestedJobDecisions(filtered.kept, policy);
  const autoCount = decisions.filter((x) => x?.auto === true).length;
  const approvalCount = decisions.length - autoCount;
  return { suggestions: normalizedSuggestions, filtered, decisions, autoCount, approvalCount };
}

function normalizeChatGenerateType(rawType, { currentType, enabledTypes }) {
  const type = String(rawType || "").trim();
  if (!type || !type.endsWith(".chat.generate")) return type;

  const enabled = Array.isArray(enabledTypes) ? enabledTypes : [];
  if (enabled.includes(type)) return type;

  const current = String(currentType || "").trim();
  if (current.endsWith(".chat.generate") && enabled.includes(current)) return current;

  const enabledChatTypes = enabled.filter((t) => t.endsWith(".chat.generate"));
  if (enabledChatTypes.length === 1) return enabledChatTypes[0];
  if (enabled.includes("ai.chat.generate")) return "ai.chat.generate";
  if (enabled.includes("codex.chat.generate")) return "codex.chat.generate";
  return type;
}

export function selectSuggestedJobsForCreation({ jobs, decisions, mode = "all", enabledTypes = [] }) {
  const normalizedMode = String(mode || "all").trim();
  const sourceJobs = (Array.isArray(jobs) ? jobs : []).map((job, index) => ({ job, index }));
  const decisionList = Array.isArray(decisions) ? decisions : [];

  const selected = sourceJobs.filter(({ index }) => {
    if (normalizedMode === "auto") return decisionList[index]?.auto === true;
    if (normalizedMode === "approval") return decisionList[index]?.auto !== true;
    return true;
  });

  const enabled = new Set(
    (Array.isArray(enabledTypes) ? enabledTypes : [])
      .map((x) => String(x || "").trim())
      .filter(Boolean)
  );

  const valid = selected.filter(({ job }) => enabled.has(String(job?.type || "").trim()));
  const invalidTypes = selected
    .map(({ job }) => String(job?.type || "").trim())
    .filter((t) => t && !enabled.has(t));

  return { normalizedMode, selected, valid, invalidTypes };
}

export function buildCreateJobPayload(job) {
  return {
    type: job?.type,
    queue: job?.queue || undefined,
    input: job?.input,
    priority: job?.priority,
    timeout_sec: job?.timeout_sec,
    max_attempts: job?.max_attempts,
    tags: job?.tags
  };
}
