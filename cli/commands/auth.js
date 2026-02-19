const fs = require("fs");
const path = require("path");
const { info, error } = require("../lib/output");
const { readEnvFile } = require("../lib/env");

function parseAuthArgs(args) {
  const rest = Array.isArray(args) ? args.slice() : [];
  const sub = String(rest.shift() || "").trim().toLowerCase();
  if (!sub || sub !== "whoami") {
    const err = new Error("Usage: rauskuclaw auth whoami [--api <baseUrl>] [--json]");
    err.exitCode = 2;
    throw err;
  }

  const opts = {
    sub,
    apiBase: "",
    json: false
  };

  for (let i = 0; i < rest.length; i += 1) {
    const a = String(rest[i] || "");
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    if (a === "--api") {
      const v = String(rest[i + 1] || "").trim();
      if (!v) {
        const err = new Error("Missing value for --api");
        err.exitCode = 2;
        throw err;
      }
      opts.apiBase = v;
      i += 1;
      continue;
    }
    const err = new Error(`Unknown option for auth whoami: ${a}`);
    err.exitCode = 2;
    throw err;
  }

  return opts;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function resolveApiBase(repoRoot, opts) {
  if (String(opts.apiBase || "").trim()) return String(opts.apiBase).trim().replace(/\/+$/, "");
  if (String(process.env.RAUSKUCLAW_API_BASE_URL || "").trim()) {
    return String(process.env.RAUSKUCLAW_API_BASE_URL).trim().replace(/\/+$/, "");
  }

  const envPath = path.join(repoRoot, ".env");
  const env = fs.existsSync(envPath) ? readEnvFile(envPath) : {};
  const port = String(env.PORT || process.env.PORT || "3001").trim() || "3001";
  return `http://127.0.0.1:${port}`;
}

function resolveApiKey(repoRoot) {
  if (String(process.env.API_KEY || "").trim()) return String(process.env.API_KEY).trim();
  const envPath = path.join(repoRoot, ".env");
  const env = fs.existsSync(envPath) ? readEnvFile(envPath) : {};
  return String(env.API_KEY || "").trim();
}

async function runAuth(ctx, args) {
  const opts = parseAuthArgs(args);
  const apiBase = resolveApiBase(ctx.repoRoot, opts);
  const apiKey = resolveApiKey(ctx.repoRoot);

  const headers = { accept: "application/json" };
  if (apiKey) headers["x-api-key"] = apiKey;

  let resp;
  try {
    resp = await fetch(`${apiBase}/v1/auth/whoami`, { method: "GET", headers });
  } catch (e) {
    if (opts.json) {
      printJson({
        ok: false,
        command: "auth.whoami",
        error: "request_failed",
        message: String(e?.message || e),
        api_base: apiBase
      });
      return 1;
    }
    error(`Auth whoami request failed: ${String(e?.message || e)}`);
    return 1;
  }

  const raw = await resp.text();
  let data = null;
  try { data = raw ? JSON.parse(raw) : null; } catch {}

  if (!resp.ok) {
    const msg = data?.error?.message || `HTTP ${resp.status}`;
    if (opts.json) {
      printJson({
        ok: false,
        command: "auth.whoami",
        error: "api_error",
        status: resp.status,
        message: msg,
        details: data?.error?.details || null,
        api_base: apiBase
      });
      return 1;
    }
    error(`Auth whoami failed: ${msg}`);
    return 1;
  }

  const out = {
    ok: true,
    command: "auth.whoami",
    auth: {
      name: String(data?.auth?.name || ""),
      role: String(data?.auth?.role || ""),
      sse: data?.auth?.sse === true,
      can_write: data?.auth?.can_write === true,
      queue_allowlist: Array.isArray(data?.auth?.queue_allowlist)
        ? data.auth.queue_allowlist.map((x) => String(x || "")).filter(Boolean)
        : null
    },
    api_base: apiBase
  };

  if (opts.json) {
    printJson(out);
    return 0;
  }

  info(`Auth principal: ${out.auth.name || "(unknown)"}`);
  info(`Role: ${out.auth.role || "(unknown)"}`);
  info(`SSE allowed: ${out.auth.sse ? "yes" : "no"}`);
  info(`Can write: ${out.auth.can_write ? "yes" : "no"}`);
  info(`Allowed queues: ${Array.isArray(out.auth.queue_allowlist) && out.auth.queue_allowlist.length ? out.auth.queue_allowlist.join(", ") : "all"}`);
  return 0;
}

module.exports = {
  runAuth,
  parseAuthArgs,
  resolveApiBase,
  resolveApiKey
};
