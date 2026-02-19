const fs = require("fs");
const path = require("path");

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeBool(value, fallback = false) {
  if (value == null) return fallback;
  return value === true;
}

function normalizeInt(raw, { min, max, fallback }) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return fallback;
  return n;
}

function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizeFilesList(rawFiles) {
  if (!Array.isArray(rawFiles)) return [];
  const out = [];
  const seen = new Set();
  for (const item of rawFiles) {
    const v = clampText(item, 2000).replace(/\\/g, "/");
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= 500) break;
  }
  return out;
}

function buildMatcher(query, { regex, caseSensitive }) {
  if (!regex) {
    const needle = caseSensitive ? query : query.toLowerCase();
    return (line) => {
      const src = caseSensitive ? line : line.toLowerCase();
      const idx = src.indexOf(needle);
      return idx >= 0 ? idx : -1;
    };
  }

  const flags = caseSensitive ? "g" : "gi";
  const re = new RegExp(query, flags);
  return (line) => {
    re.lastIndex = 0;
    const m = re.exec(line);
    return m ? m.index : -1;
  };
}

function isLikelyBinary(buf) {
  const maxCheck = Math.min(buf.length, 4096);
  for (let i = 0; i < maxCheck; i += 1) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function collectFilesFromDir(root, baseDir, { includeHidden, maxScanned }) {
  const files = [];
  const stack = [baseDir];
  let scanned = 0;
  let truncated = false;

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
      if (!isPathInside(root, abs)) continue;
      if (entry.isDirectory()) {
        stack.push(abs);
      } else if (entry.isFile()) {
        files.push(abs);
      }
      scanned += 1;
      if (scanned >= maxScanned) {
        truncated = true;
        break;
      }
    }
    if (truncated) break;
  }
  return { files, scanned, truncated };
}

async function runFindInFiles(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("tools.find_in_files input must be an object");
  }
  const safeInput = input || {};
  const workspaceRoot = path.resolve(String(options.workspaceRoot || "/workspace").trim() || "/workspace");
  const query = clampText(safeInput.query || safeInput.q || safeInput.pattern, 500);
  if (!query) throw new Error("query is required");

  const regex = normalizeBool(safeInput.regex, false);
  const caseSensitive = normalizeBool(safeInput.case_sensitive, false);
  const includeHidden = normalizeBool(safeInput.include_hidden, false);
  const maxResults = normalizeInt(safeInput.max_results, { min: 1, max: 500, fallback: 100 });
  const maxBytesPerFile = normalizeInt(safeInput.max_bytes_per_file, { min: 512, max: 2 * 1024 * 1024, fallback: 262144 });
  const maxScanned = normalizeInt(safeInput.max_scanned, { min: 100, max: 50000, fallback: 5000 });
  const basePathRaw = clampText(safeInput.path || safeInput.base_path || ".", 2000) || ".";
  const baseAbs = path.resolve(workspaceRoot, basePathRaw);
  if (!isPathInside(workspaceRoot, baseAbs)) throw new Error("path escapes workspace root");

  let explicitFiles = normalizeFilesList(safeInput.files);
  const matcher = buildMatcher(query, { regex, caseSensitive });
  const results = [];
  let scannedFiles = 0;
  let truncated = false;
  let binarySkipped = 0;
  let tooLargeSkipped = 0;

  let candidateFiles = [];
  if (explicitFiles.length > 0) {
    for (const rel of explicitFiles) {
      const abs = path.resolve(workspaceRoot, rel);
      if (!isPathInside(workspaceRoot, abs)) continue;
      candidateFiles.push(abs);
    }
  } else {
    const st = fs.statSync(baseAbs);
    if (!st.isDirectory()) throw new Error("path is not a directory");
    const gathered = collectFilesFromDir(workspaceRoot, baseAbs, { includeHidden, maxScanned });
    candidateFiles = gathered.files;
    truncated = gathered.truncated;
  }

  for (const absPath of candidateFiles) {
    scannedFiles += 1;
    if (scannedFiles > maxScanned) {
      truncated = true;
      break;
    }
    let st;
    try {
      st = fs.statSync(absPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    if (st.size > maxBytesPerFile) {
      tooLargeSkipped += 1;
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(absPath);
    } catch {
      continue;
    }
    if (isLikelyBinary(raw)) {
      binarySkipped += 1;
      continue;
    }
    const text = raw.toString("utf8");
    const lines = text.split(/\r?\n/);
    const relPath = path.relative(workspaceRoot, absPath).split(path.sep).join("/");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const col = matcher(line);
      if (col < 0) continue;
      results.push({
        path: relPath,
        line: i + 1,
        column: col + 1,
        text: line.slice(0, 500)
      });
      if (results.length >= maxResults) {
        truncated = true;
        break;
      }
    }
    if (results.length >= maxResults) break;
  }

  return {
    ok: true,
    query,
    regex,
    case_sensitive: caseSensitive,
    base_path: explicitFiles.length > 0 ? null : (path.relative(workspaceRoot, baseAbs).split(path.sep).join("/") || "."),
    requested_files_count: explicitFiles.length > 0 ? explicitFiles.length : null,
    scanned_files: scannedFiles,
    result_count: results.length,
    has_more: truncated,
    truncated,
    skipped_binary_files: binarySkipped,
    skipped_too_large_files: tooLargeSkipped,
    matches: results
  };
}

module.exports = {
  runFindInFiles
};
