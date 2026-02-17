export function normalizeTypeList(raw) {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.map((x) => String(x || "").trim()).filter(Boolean)));
  }
  return Array.from(new Set(String(raw || "").split(",").map((x) => x.trim()).filter(Boolean)));
}

export function getSuggestedJobDecision(job, policy = {}) {
  const mode = String(policy.mode || "smart");
  if (mode === "never") return { auto: true, reasons: [] };
  if (mode === "always") return { auto: false, reasons: ["policy mode: always require approval"] };

  const reasons = [];
  const timeoutSec = Number(job?.timeout_sec) || 0;
  const maxAttempts = Number(job?.max_attempts) || 0;
  const priority = Number(job?.priority) || 0;
  const type = String(job?.type || "").trim();

  const maxTimeoutSec = Number(policy.maxTimeoutSec || 30);
  const maxAttemptsAllowed = Number(policy.maxAttempts || 1);
  const maxPriority = Number(policy.maxPriority || 5);
  const allowTypes = normalizeTypeList(policy.allowTypes);

  if (timeoutSec > maxTimeoutSec) {
    reasons.push(`timeout ${timeoutSec}s > ${maxTimeoutSec}s`);
  }
  if (maxAttempts > maxAttemptsAllowed) {
    reasons.push(`attempts ${maxAttempts} > ${maxAttemptsAllowed}`);
  }
  if (priority > maxPriority) {
    reasons.push(`priority ${priority} > ${maxPriority}`);
  }
  if (allowTypes.length > 0 && !allowTypes.includes(type)) {
    reasons.push(`type '${type}' not in auto allowlist`);
  }
  return { auto: reasons.length === 0, reasons };
}
