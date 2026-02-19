const fs = require("fs");
const path = require("path");

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeMaxBytes(raw, fallback = 262144) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 512 || n > 1024 * 1024) return fallback;
  return n;
}

function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function normalizePathVariants(rawPath) {
  const p = String(rawPath || "").trim().replace(/\\/g, "/");
  const out = [];
  const push = (v) => {
    const x = String(v || "").trim();
    if (!x || out.includes(x)) return;
    out.push(x);
  };
  push(p);
  push(p.replace(/^\.\/+/, ""));
  push(p.replace(/^workspace\/+/, ""));
  push(p.replace(/^\.\/+workspace\/+/, ""));
  return out;
}

async function runDataFileRead(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("data.file_read input must be an object");
  }
  const safeInput = input || {};
  const workspaceRoot = path.resolve(String(options.workspaceRoot || "/workspace").trim() || "/workspace");
  const maxBytes = normalizeMaxBytes(
    safeInput.max_bytes,
    normalizeMaxBytes(options.defaultMaxBytes, 262144)
  );

  const rawPath = clampText(safeInput.path || safeInput.file_path, 2000);
  if (!rawPath) throw new Error("path is required");

  const variants = normalizePathVariants(rawPath);
  const targets = variants
    .map((p) => path.resolve(workspaceRoot, p))
    .filter((t) => isPathInside(workspaceRoot, t));
  if (!targets.length) throw new Error("path escapes workspace root");

  let st;
  let target = "";
  for (const candidate of targets) {
    try {
      st = fs.statSync(candidate);
      target = candidate;
      break;
    } catch (e) {
      if (e && e.code === "ENOENT") continue;
      throw e;
    }
  }
  if (!target) throw new Error("file not found");
  if (!st.isFile()) throw new Error("path is not a file");

  const data = fs.readFileSync(target);
  const clipped = data.length > maxBytes ? data.subarray(0, maxBytes) : data;
  const relPath = path.relative(workspaceRoot, target).split(path.sep).join("/");

  return {
    ok: true,
    path: relPath || path.basename(target),
    truncated: data.length > maxBytes,
    bytes_read: clipped.length,
    total_bytes: data.length,
    content_text: clipped.toString("utf8")
  };
}

module.exports = {
  runDataFileRead
};
