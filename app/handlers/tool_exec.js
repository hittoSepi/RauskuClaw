const { spawn } = require("node:child_process");
const path = require("node:path");

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeStringArray(raw, maxItems = 50, maxItemLen = 200) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const v = clampText(item, maxItemLen);
    if (!v) continue;
    out.push(v);
    if (out.length >= maxItems) break;
  }
  return out;
}

function normalizeAllowlist(raw) {
  const items = normalizeStringArray(raw, 100, 200);
  return Array.from(new Set(items));
}

function normalizeTimeoutMs(rawTimeout, fallbackMs = 10000) {
  if (rawTimeout == null || rawTimeout === "") return fallbackMs;
  const n = Number(rawTimeout);
  if (!Number.isInteger(n) || n < 100 || n > 120000) {
    throw new Error("timeout_ms must be an integer 100..120000");
  }
  return n;
}

function splitCommandLine(commandLine) {
  const src = clampText(commandLine, 4000);
  if (!src) return { command: "", args: [] };
  const parts = [];
  const re = /[^\s"'\\]+|"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g;
  let m;
  while ((m = re.exec(src))) {
    let token = m[0];
    if ((token.startsWith("\"") && token.endsWith("\"")) || (token.startsWith("'") && token.endsWith("'"))) {
      token = token.slice(1, -1);
    }
    token = token.replace(/\\(["'\\])/g, "$1");
    if (token) parts.push(token);
  }
  if (!parts.length) return { command: "", args: [] };
  return { command: parts[0], args: parts.slice(1) };
}

function containsShellOperators(commandLine) {
  const src = String(commandLine || "");
  if (!src.trim()) return false;
  if (/\r?\n/.test(src)) return true;
  return /(?:\|\||&&|[|;<>])/.test(src);
}

function shellQuote(value) {
  const s = String(value ?? "");
  if (!s.length) return "''";
  return `'${s.replace(/'/g, `'\"'\"'`)}'`;
}

function pickAllowlistedSh(allowlist) {
  if (!Array.isArray(allowlist)) return "";
  if (allowlist.includes("sh")) return "sh";
  if (allowlist.includes("/bin/sh")) return "/bin/sh";
  return "";
}

function validateCommandAllowed(command, allowlist) {
  if (!Array.isArray(allowlist) || allowlist.length < 1) {
    throw new Error("tool.exec allowlist is empty");
  }
  const cmd = clampText(command, 200);
  if (!cmd) throw new Error("command is required");
  const base = path.basename(cmd);
  const allowed = allowlist.includes(cmd) || allowlist.includes(base);
  if (!allowed) {
    throw new Error(`command not allowed: ${cmd}`);
  }
  return cmd;
}

async function runToolExec(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("tool.exec input must be an object");
  }
  const safeInput = input || {};
  const rawInputCommand = safeInput.command != null
    ? safeInput.command
    : (safeInput.cmd != null ? safeInput.cmd : safeInput.script);
  const allowlist = normalizeAllowlist(options.allowlist || []);
  const rawCommand = clampText(rawInputCommand, 4000);
  const parsed = splitCommandLine(rawCommand);
  const hasInlineArgs = parsed.args.length > 0;
  const explicitArgs = normalizeStringArray(safeInput.args, 100, 4000);
  const hasExplicitArgs = explicitArgs.length > 0;
  const needsShellWrap = !hasExplicitArgs &&
    containsShellOperators(rawCommand) &&
    parsed.command !== "sh" &&
    parsed.command !== "bash";

  let command = "";
  let args = [];
  if (needsShellWrap) {
    const shellCmd = pickAllowlistedSh(allowlist);
    if (!shellCmd) {
      throw new Error("command uses shell operators but 'sh' is not allowlisted");
    }
    command = validateCommandAllowed(shellCmd, allowlist);
    args = ["-lc", rawCommand];
  } else {
    const requestedCommand = hasInlineArgs ? parsed.command : safeInput.command;
    try {
      command = validateCommandAllowed(requestedCommand, allowlist);
      args = hasInlineArgs ? parsed.args : explicitArgs;
    } catch (err) {
      const shellCmd = pickAllowlistedSh(allowlist);
      const canFallback = /command not allowed:/i.test(String(err?.message || ""));
      if (!canFallback || !shellCmd) throw err;
      command = validateCommandAllowed(shellCmd, allowlist);
      const base = clampText(requestedCommand, 4000);
      const cmdline = hasInlineArgs
        ? rawCommand
        : [base, ...explicitArgs.map(shellQuote)].filter(Boolean).join(" ");
      args = ["-lc", cmdline];
    }
  }
  const timeoutMs = normalizeTimeoutMs(safeInput.timeout_ms, options.defaultTimeoutMs || 10000);
  const cwd = clampText(options.cwd, 4096) || process.cwd();

  const startedAt = Date.now();
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env
    });

    const timer = setTimeout(() => {
      if (settled) return;
      try { child.kill("SIGKILL"); } catch {}
      settled = true;
      resolve({
        ok: false,
        timed_out: true,
        code: null,
        signal: "SIGKILL",
        stdout,
        stderr,
        duration_ms: Date.now() - startedAt
      });
    }, timeoutMs);

    child.stdout.on("data", (buf) => {
      stdout += String(buf);
      if (stdout.length > 256_000) stdout = stdout.slice(0, 256_000);
    });
    child.stderr.on("data", (buf) => {
      stderr += String(buf);
      if (stderr.length > 256_000) stderr = stderr.slice(0, 256_000);
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0,
        timed_out: false,
        code: Number.isInteger(code) ? code : null,
        signal: signal || null,
        stdout,
        stderr,
        duration_ms: Date.now() - startedAt
      });
    });
  });
}

module.exports = {
  runToolExec,
  normalizeAllowlist
};
