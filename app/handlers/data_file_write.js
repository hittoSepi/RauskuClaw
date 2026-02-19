const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ALLOWED_MODES = new Set(["replace", "append", "prepend", "insert_at", "replace_range"]);
const TARGETED_MODES = new Set(["insert_at", "replace_range"]);

function clampText(value, maxLen) {
  return String(value || "").slice(0, maxLen);
}

function normalizeMaxBytes(raw, fallback = 1024 * 1024) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 512 || n > 10 * 1024 * 1024) return fallback;
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

function ensureBoolOrEmpty(value, fieldName) {
  if (value == null) return;
  if (typeof value !== "boolean") throw new Error(`${fieldName} must be boolean`);
}

function decodeBase64Utf8(raw, fieldName) {
  const src = String(raw || "").trim();
  if (!src) return "";
  let buf;
  try {
    buf = Buffer.from(src, "base64");
  } catch {
    throw new Error(`${fieldName} must be valid base64`);
  }
  if (!buf || buf.length < 1) throw new Error(`${fieldName} must be valid base64`);
  const normalized = buf.toString("base64").replace(/=+$/g, "");
  const inputNormalized = src.replace(/\s+/g, "").replace(/=+$/g, "");
  if (normalized !== inputNormalized) throw new Error(`${fieldName} must be valid base64`);
  return buf.toString("utf8");
}

function parseOptionalNonNegativeInt(value, fieldName) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${fieldName} must be integer >= 0`);
  return n;
}

function sha256Hex(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

function preview(text, maxLen = 300) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)} ...(truncated)`;
}

function applyWriteMode({ mode, beforeText, content, offset, start, end }) {
  const base = String(beforeText || "");
  const add = String(content || "");

  if (mode === "replace") return add;
  if (mode === "append") return `${base}${add}`;
  if (mode === "prepend") return `${add}${base}`;
  if (mode === "insert_at") {
    const at = Math.min(parseOptionalNonNegativeInt(offset, "input.offset"), base.length);
    return `${base.slice(0, at)}${add}${base.slice(at)}`;
  }
  if (mode === "replace_range") {
    const from = Math.min(parseOptionalNonNegativeInt(start, "input.start"), base.length);
    const to = Math.min(parseOptionalNonNegativeInt(end, "input.end"), base.length);
    if (to < from) throw new Error("input.end must be >= input.start");
    return `${base.slice(0, from)}${add}${base.slice(to)}`;
  }
  throw new Error(`unsupported mode '${mode}'`);
}

async function runDataFileWrite(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("data.write_file input must be an object");
  }
  const safeInput = input || {};
  const workspaceRoot = path.resolve(String(options.workspaceRoot || "/workspace").trim() || "/workspace");
  const maxBytes = normalizeMaxBytes(
    safeInput.max_bytes,
    normalizeMaxBytes(options.defaultMaxBytes, 1024 * 1024)
  );

  const rawPath = clampText(safeInput.path || safeInput.file_path, 2000);
  if (!rawPath) throw new Error("path is required");
  const mode = String(safeInput.mode || "replace").trim().toLowerCase();
  if (!ALLOWED_MODES.has(mode)) throw new Error("mode must be one of: replace, append, prepend, insert_at, replace_range");
  const hasContent = safeInput.content != null;
  const hasContentBase64 = safeInput.content_base64 != null;
  if (hasContent && hasContentBase64) {
    throw new Error("input.content and input.content_base64 are mutually exclusive");
  }
  const content = hasContentBase64
    ? decodeBase64Utf8(safeInput.content_base64, "input.content_base64")
    : String(safeInput.content || "");
  const contentBytes = Buffer.byteLength(content, "utf8");
  if (contentBytes > maxBytes) throw new Error(`content too large (max ${maxBytes} bytes)`);

  ensureBoolOrEmpty(safeInput.dry_run, "input.dry_run");
  ensureBoolOrEmpty(safeInput.create_if_missing, "input.create_if_missing");
  ensureBoolOrEmpty(safeInput.mkdir_p, "input.mkdir_p");
  const dryRun = safeInput.dry_run === true;
  const createIfMissing = safeInput.create_if_missing === true;
  const mkdirP = safeInput.mkdir_p === true;

  const variants = normalizePathVariants(rawPath);
  const targets = variants
    .map((p) => path.resolve(workspaceRoot, p))
    .filter((t) => isPathInside(workspaceRoot, t));
  if (!targets.length) throw new Error("path escapes workspace root");
  const target = targets[0];

  let existed = false;
  let beforeText = "";
  try {
    const st = fs.statSync(target);
    if (!st.isFile()) throw new Error("path is not a file");
    beforeText = fs.readFileSync(target, "utf8");
    existed = true;
  } catch (e) {
    if (e && e.code !== "ENOENT") throw e;
    if (TARGETED_MODES.has(mode)) {
      throw new Error(`mode '${mode}' requires an existing file (read it first with data.file_read)`);
    }
    if (!createIfMissing) throw new Error("file not found (set create_if_missing=true to create)");
  }

  const expectedSha = String(safeInput.expected_sha256 || "").trim().toLowerCase();
  if (expectedSha) {
    if (!/^[a-f0-9]{64}$/.test(expectedSha)) throw new Error("input.expected_sha256 must be 64 hex chars");
    const current = sha256Hex(beforeText);
    if (current !== expectedSha) {
      throw new Error(`sha256 mismatch: expected ${expectedSha}, got ${current}`);
    }
  }

  const afterText = applyWriteMode({
    mode,
    beforeText,
    content,
    offset: safeInput.offset,
    start: safeInput.start,
    end: safeInput.end
  });

  const changed = afterText !== beforeText;
  const relPath = path.relative(workspaceRoot, target).split(path.sep).join("/");
  if (!dryRun) {
    const dir = path.dirname(target);
    if (mkdirP) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(dir)) throw new Error("parent directory does not exist (set mkdir_p=true)");
    fs.writeFileSync(target, afterText, "utf8");
  }

  return {
    ok: true,
    path: relPath || path.basename(target),
    mode,
    dry_run: dryRun,
    changed,
    created: !existed && (createIfMissing || dryRun),
    bytes_before: Buffer.byteLength(beforeText, "utf8"),
    bytes_after: Buffer.byteLength(afterText, "utf8"),
    sha256_before: sha256Hex(beforeText),
    sha256_after: sha256Hex(afterText),
    preview_before: preview(beforeText),
    preview_after: preview(afterText)
  };
}

module.exports = {
  runDataFileWrite
};
