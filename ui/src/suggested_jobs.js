export function parseSuggestedJobs(text) {
  const raw = String(text || "");
  const block = raw.match(/```rausku_jobs\s*([\s\S]*?)```/i);
  if (!block) return [];

  let parsed;
  try {
    parsed = JSON.parse(block[1].trim());
  } catch {
    return [];
  }

  const items = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  const out = [];
  for (const job of items) {
    const type = String(job?.type || "").trim();
    if (!type) continue;

    const queueRaw = String(job?.queue || "").trim();
    const queue = /^[a-z0-9._:-]{1,80}$/i.test(queueRaw) ? queueRaw : "";
    const priority = Math.min(10, Math.max(0, Number(job?.priority) || 5));
    const timeoutSec = Math.min(3600, Math.max(1, Number(job?.timeout_sec) || 120));
    const maxAttempts = Math.min(10, Math.max(1, Number(job?.max_attempts) || 1));
    const tags = Array.isArray(job?.tags)
      ? job.tags.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20)
      : [];
    const input = job?.input && typeof job.input === "object" ? job.input : {};

    out.push({
      type,
      ...(queue ? { queue } : {}),
      input,
      priority,
      timeout_sec: timeoutSec,
      max_attempts: maxAttempts,
      tags
    });
  }
  return out;
}

function normalizePromptText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[`"'.,:;!?()[\]{}<>|/\\_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractSuggestedPrompt(job) {
  const input = job && typeof job.input === "object" ? job.input : {};
  const prompt = String(input.prompt || "").trim();
  if (prompt) return prompt;
  const messages = Array.isArray(input.messages) ? input.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (String(m?.role || "") === "user") {
      const content = String(m?.content || "").trim();
      if (content) return content;
    }
  }
  return "";
}

function tokenSet(s) {
  const norm = normalizePromptText(s);
  if (!norm) return new Set();
  return new Set(norm.split(" ").filter((x) => x.length > 2));
}

function jaccardSimilarity(a, b) {
  const aSet = tokenSet(a);
  const bSet = tokenSet(b);
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) {
    if (bSet.has(t)) inter += 1;
  }
  const union = aSet.size + bSet.size - inter;
  return union > 0 ? inter / union : 0;
}

export function isDuplicateChatSuggestion(job, { currentType, userText }) {
  const type = String(job?.type || "").trim();
  if (!type || type !== String(currentType || "").trim()) return false;
  if (!String(type).includes("chat.generate")) return false;

  const suggestedPrompt = extractSuggestedPrompt(job);
  if (!suggestedPrompt) return false;

  const userNorm = normalizePromptText(userText);
  const suggestionNorm = normalizePromptText(suggestedPrompt);
  if (!userNorm || !suggestionNorm) return false;
  if (suggestionNorm === userNorm) return true;

  return jaccardSimilarity(userNorm, suggestionNorm) >= 0.6;
}

export function filterDuplicateSuggestions(suggestions, { currentType, userText }) {
  const kept = [];
  let dropped = 0;
  for (const job of suggestions || []) {
    if (isDuplicateChatSuggestion(job, { currentType, userText })) {
      dropped += 1;
      continue;
    }
    kept.push(job);
  }
  return { kept, dropped };
}
