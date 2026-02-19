const fs = require("fs");
const path = require("path");

function clampText(value, maxLen = 4000) {
  const s = String(value == null ? "" : value);
  return s.length > maxLen ? `${s.slice(0, maxLen)}...` : s;
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

function sanitizeValue(value, depth = 0) {
  if (depth > 4) return "[truncated-depth]";
  if (value == null) return value;
  if (typeof value === "string") return clampText(value, 2000);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((x) => sanitizeValue(x, depth + 1));
  if (typeof value === "object") {
    const out = {};
    const entries = Object.entries(value).slice(0, 100);
    for (const [k, v] of entries) out[String(k)] = sanitizeValue(v, depth + 1);
    return out;
  }
  return clampText(value, 2000);
}

function normalizeJobEntry(row, event) {
  const tags = safeJsonParse(row.tags_json);
  const input = safeJsonParse(row.input_json);
  const result = safeJsonParse(row.result_json);
  const error = safeJsonParse(row.error_json);
  return {
    id: String(row.id || ""),
    type: String(row.type || ""),
    queue: String(row.queue || "default"),
    status: String(row.status || ""),
    created_at: String(row.created_at || ""),
    updated_at: String(row.updated_at || ""),
    attempts: Number(row.attempts || 0),
    max_attempts: Number(row.max_attempts || 0),
    timeout_sec: Number(row.timeout_sec || 0),
    priority: Number(row.priority || 0),
    event: String(event || ""),
    tags: Array.isArray(tags) ? sanitizeValue(tags) : [],
    input: sanitizeValue(input),
    result: sanitizeValue(result),
    error: sanitizeValue(error)
  };
}

function readJobsJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.jobs)) {
      return parsed;
    }
  } catch {}
  return { updated_at: new Date().toISOString(), jobs: [] };
}

function writeJobToWorkspaceIndex(workspaceRoot, row, { event = "" } = {}) {
  const root = path.resolve(String(workspaceRoot || "/workspace").trim() || "/workspace");
  const dir = path.resolve(root, "jobs");
  const filePath = path.resolve(dir, "jobs.json");
  fs.mkdirSync(dir, { recursive: true });

  const existing = readJobsJson(filePath);
  const nextEntry = normalizeJobEntry(row, event);
  const list = Array.isArray(existing.jobs) ? existing.jobs.slice() : [];
  const idx = list.findIndex((x) => String(x?.id || "") === nextEntry.id);
  if (idx >= 0) list[idx] = nextEntry;
  else list.push(nextEntry);
  const trimmed = list
    .sort((a, b) => String(b.updated_at || "").localeCompare(String(a.updated_at || "")))
    .slice(0, 2000);

  const out = {
    updated_at: new Date().toISOString(),
    count: trimmed.length,
    jobs: trimmed
  };
  fs.writeFileSync(filePath, JSON.stringify(out, null, 2), "utf8");
  return { filePath, count: trimmed.length };
}

module.exports = {
  writeJobToWorkspaceIndex
};

