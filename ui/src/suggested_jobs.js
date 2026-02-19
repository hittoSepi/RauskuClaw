function normalizeSuggestedType(rawType) {
  const type = String(rawType || "").trim();
  if (!type) return "";
  const lower = type.toLowerCase();
  if (lower === "tools.exec" || lower === "tools.command" || lower === "tools.terminal" || lower === "tools.bash") {
    return "tool.exec";
  }
  if (lower === "tool.web_search" || lower === "web.search" || lower === "web_search") {
    return "tools.web_search";
  }
  if (lower === "file.search" || lower === "workspace.file_search" || lower === "data.file_search") {
    return "tools.file_search";
  }
  if (lower === "find.in_files" || lower === "tools.find_in_file" || lower === "tools.find_in_files") {
    return "tools.find_in_files";
  }
  if (lower === "shell.exec" || lower === "command.exec" || lower === "terminal.exec" || lower === "bash.exec") {
    return "tool.exec";
  }
  return type;
}

export function parseSuggestedJobs(text) {
  const raw = String(text || "");
  const parsed = parseSuggestedJobsPayload(raw);
  if (!parsed) return [];

  const items = Array.isArray(parsed?.jobs) ? parsed.jobs : [];
  const out = [];
  for (const job of items) {
    const type = normalizeSuggestedType(job?.type);
    if (!type) continue;

    const queueRaw = String(job?.queue || "").trim();
    const queue = /^[a-z0-9._:-]{1,80}$/i.test(queueRaw) ? queueRaw : "";
    const priority = Math.min(10, Math.max(0, Number(job?.priority) || 5));
    const timeoutSec = Math.min(3600, Math.max(1, Number(job?.timeout_sec) || 120));
    const maxAttempts = Math.min(10, Math.max(1, Number(job?.max_attempts) || 1));
    const tags = Array.isArray(job?.tags)
      ? job.tags.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 20)
      : [];
    const rawInput = job?.input && typeof job.input === "object" ? job.input : {};
    const input = normalizeSuggestedInput(type, rawInput);

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

function parseSuggestedJobsPayload(raw) {
  const fenced = raw.match(/```rausku_jobs\s*([\s\S]*?)```/i);
  if (fenced) {
    try {
      return JSON.parse(String(fenced[1] || "").trim());
    } catch {}
  }

  const afterFence = raw.match(/```rausku_jobs\s*([\s\S]*)$/i);
  if (afterFence) {
    const start = String(afterFence[1] || "").indexOf("{");
    if (start >= 0) {
      const candidate = extractBalancedJsonObject(String(afterFence[1] || ""), start);
      if (candidate) {
        try {
          return JSON.parse(candidate);
        } catch {}
      }
    }
  }

  const jobsIdx = raw.search(/"\s*jobs\s*"\s*:/i);
  if (jobsIdx >= 0) {
    const start = raw.lastIndexOf("{", jobsIdx);
    if (start >= 0) {
      const candidate = extractBalancedJsonObject(raw, start);
      if (candidate) {
        try {
          return JSON.parse(candidate);
        } catch {}
      }
    }
  }
  return null;
}

function extractBalancedJsonObject(text, startIndex) {
  const src = String(text || "");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = startIndex; i < src.length; i += 1) {
    const ch = src[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }
    if (ch === "\"") {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
      continue;
    }
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(startIndex, i + 1);
      if (depth < 0) return null;
    }
  }
  return null;
}

function normalizeSuggestedInput(type, input) {
  const out = input && typeof input === "object" ? { ...input } : {};
  const t = String(type || "").trim();

  if (t === "tools.file_search") {
    const q = String(out.query || "").trim();
    const pattern = String(out.pattern || "").trim();
    if (!q && pattern) out.query = pattern;
  }
  if (t === "tools.web_search") {
    const q = String(out.query || "").trim();
    const pattern = String(out.pattern || "").trim();
    if (!q && pattern) out.query = pattern;
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
