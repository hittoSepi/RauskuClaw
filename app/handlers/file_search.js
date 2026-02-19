const fs = require("fs");
const path = require("path");

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function foldDiacritics(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeMaxResults(raw, fallback = 30) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 200) return fallback;
  return n;
}

function normalizeCursorOffset(raw, fallback = 0) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0 || n > 10_000_000) return fallback;
  return n;
}

function normalizeMaxScanned(raw, fallback = 5000) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 100 || n > 50_000) return fallback;
  return n;
}

function uniqueQueries(primary) {
  const src = clampText(primary, 240);
  if (!src) return [];
  const out = [];
  const seen = new Set();
  const push = (v) => {
    const x = String(v || "").trim().toLowerCase();
    if (!x || seen.has(x)) return;
    seen.add(x);
    out.push(x);
  };

  push(src);
  const camelSpaced = src
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2");
  push(camelSpaced);
  push(foldDiacritics(src));
  push(foldDiacritics(camelSpaced));
  const noExt = src.replace(/\.[a-z0-9]{1,10}$/i, "");
  push(noExt);
  push(src.replace(/[_-]+/g, " "));
  push(src.replace(/\s+/g, ""));
  push(src.replace(/[_\s]+/g, "-"));
  push(src.replace(/[-\s]+/g, "_"));
  push(src.replace(/[^a-z0-9]+/gi, ""));
  if (!/\.[a-z0-9]{1,10}$/i.test(src)) {
    push(`${src}.md`);
    push(`${src}.txt`);
    push(`${src}.json`);
  }
  return out;
}

function toCompact(value) {
  return foldDiacritics(String(value || "")).toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

async function runFileSearch(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("tools.file_search input must be an object");
  }
  const safeInput = input || {};
  const workspaceRoot = path.resolve(String(options.workspaceRoot || "/workspace").trim() || "/workspace");
  const queryRaw = clampText(safeInput.query || safeInput.q || safeInput.name, 240);
  if (!queryRaw) throw new Error("query is required");

  const basePathRaw = clampText(safeInput.path || safeInput.base_path || ".", 2000) || ".";
  const includeHidden = safeInput.include_hidden === true;
  const maxResults = normalizeMaxResults(
    safeInput.max_results,
    normalizeMaxResults(options.defaultMaxResults, 30)
  );
  const cursorOffset = normalizeCursorOffset(
    safeInput.cursor_offset,
    normalizeCursorOffset(options.defaultCursorOffset, 0)
  );
  const maxScanned = normalizeMaxScanned(
    safeInput.max_scanned,
    normalizeMaxScanned(options.defaultMaxScanned, 5000)
  );

  const baseAbs = path.resolve(workspaceRoot, basePathRaw);
  if (!isPathInside(workspaceRoot, baseAbs)) throw new Error("path escapes workspace root");
  let st;
  try {
    st = fs.statSync(baseAbs);
  } catch (e) {
    if (e && e.code === "ENOENT") throw new Error("path not found");
    throw e;
  }
  if (!st.isDirectory()) throw new Error("path is not a directory");

  const queries = uniqueQueries(queryRaw);
  const primaryQuery = queries[0] || queryRaw;
  const matches = [];
  const matchedBy = new Map();
  let scanned = 0;
  let visited = 0;
  let truncated = false;
  const stack = [baseAbs];

  while (stack.length > 0) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const name = String(entry?.name || "");
      if (!name) continue;
      if (!includeHidden && name.startsWith(".")) continue;
      const abs = path.join(dir, name);
      if (!isPathInside(workspaceRoot, abs)) continue;
      const rel = path.relative(workspaceRoot, abs).split(path.sep).join("/");
      visited += 1;
      if (visited <= cursorOffset) {
        if (entry.isDirectory()) stack.push(abs);
        continue;
      }
      scanned += 1;

      const matchTarget = `${name} ${rel}`.toLowerCase();
      const compactTarget = toCompact(matchTarget);
      let matchedQuery = "";
      for (const q of queries) {
        if (matchTarget.includes(q)) {
          matchedQuery = q;
          break;
        }
        const compactQ = toCompact(q);
        if (compactQ && compactTarget.includes(compactQ)) {
          matchedQuery = q;
          break;
        }
      }
      if (matchedQuery) {
        let size = null;
        if (entry.isFile()) {
          try { size = fs.statSync(abs).size; } catch { size = null; }
        }
        if (matchedBy.has(rel)) continue;
        matchedBy.set(rel, matchedQuery);
        matches.push({
          path: rel,
          is_dir: entry.isDirectory(),
          size
        });
        if (matches.length >= maxResults) {
          truncated = true;
          break;
        }
      }
      if (entry.isDirectory()) {
        stack.push(abs);
      }
      if (scanned >= maxScanned) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }

  return {
    ok: true,
    query: primaryQuery,
    query_variants: queries,
    used_variant_fallback: matches.some((m) => matchedBy.get(m.path) !== primaryQuery),
    base_path: path.relative(workspaceRoot, baseAbs).split(path.sep).join("/") || ".",
    cursor_offset: cursorOffset,
    next_cursor_offset: cursorOffset + scanned,
    has_more: truncated,
    scanned,
    visited_total: visited,
    truncated,
    result_count: matches.length,
    matches
  };
}

module.exports = {
  runFileSearch
};
