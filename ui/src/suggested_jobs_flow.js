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
  const filtered = filterDuplicateSuggestions(suggestions, { currentType, userText });
  const decisions = evaluateSuggestedJobDecisions(filtered.kept, policy);
  const autoCount = decisions.filter((x) => x?.auto === true).length;
  const approvalCount = decisions.length - autoCount;
  return { suggestions, filtered, decisions, autoCount, approvalCount };
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
