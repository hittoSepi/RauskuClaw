const fs = require("fs");
const path = require("path");
const { info, error } = require("../lib/output");
const { readEnvFile } = require("../lib/env");

function parseMemoryArgs(args) {
  const rest = Array.isArray(args) ? args.slice() : [];
  const sub = String(rest.shift() || "").trim().toLowerCase();
  if (!sub) {
    const err = new Error("Usage: rauskuclaw memory reset --yes [--scope <scope>] [--api <baseUrl>] [--json]");
    err.exitCode = 2;
    throw err;
  }
  if (sub !== "reset") {
    const err = new Error("Usage: rauskuclaw memory reset --yes [--scope <scope>] [--api <baseUrl>] [--json]");
    err.exitCode = 2;
    throw err;
  }

  const opts = {
    sub,
    yes: false,
    scope: "",
    apiBase: "",
    json: false
  };

  for (let i = 0; i < rest.length; i += 1) {
    const a = String(rest[i] || "");
    if (a === "--yes") {
      opts.yes = true;
      continue;
    }
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    if (a === "--scope") {
      const v = String(rest[i + 1] || "").trim();
      if (!v) {
        const err = new Error("Missing value for --scope");
        err.exitCode = 2;
        throw err;
      }
      if (!/^[a-z0-9._:-]{2,80}$/i.test(v)) {
        const err = new Error("Invalid --scope value. Must match ^[a-z0-9._:-]{2,80}$");
        err.exitCode = 2;
        throw err;
      }
      opts.scope = v;
      i += 1;
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
    const err = new Error(`Unknown option for memory reset: ${a}`);
    err.exitCode = 2;
    throw err;
  }

  if (!opts.yes) {
    const err = new Error("Refusing destructive memory reset without --yes.");
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

async function runMemory(ctx, args) {
  const opts = parseMemoryArgs(args);
  const apiBase = resolveApiBase(ctx.repoRoot, opts);
  const apiKey = resolveApiKey(ctx.repoRoot);

  const body = { confirm: true };
  if (opts.scope) body.scope = opts.scope;

  const headers = {
    accept: "application/json",
    "content-type": "application/json"
  };
  if (apiKey) headers["x-api-key"] = apiKey;

  let resp;
  try {
    resp = await fetch(`${apiBase}/v1/memory/reset`, {
      method: "POST",
      headers,
      body: JSON.stringify(body)
    });
  } catch (e) {
    if (opts.json) {
      printJson({
        ok: false,
        command: "memory.reset",
        error: "request_failed",
        message: String(e?.message || e),
        api_base: apiBase
      });
      return 1;
    }
    error(`Memory reset request failed: ${String(e?.message || e)}`);
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
        command: "memory.reset",
        error: "api_error",
        status: resp.status,
        message: msg,
        details: data?.error?.details || null,
        api_base: apiBase
      });
      return 1;
    }
    error(`Memory reset failed: ${msg}`);
    return 1;
  }

  const out = {
    ok: true,
    command: "memory.reset",
    scope: data?.scope ?? null,
    deleted_memories: Number(data?.deleted_memories || 0),
    deleted_vectors: Number(data?.deleted_vectors || 0),
    remaining_memories: Number(data?.remaining_memories || 0),
    remaining_vectors: Number(data?.remaining_vectors || 0),
    api_base: apiBase
  };

  if (opts.json) {
    printJson(out);
    return 0;
  }

  info(`Memory reset completed (scope=${out.scope || "ALL"}).`);
  info(`Deleted memories: ${out.deleted_memories}, deleted vectors: ${out.deleted_vectors}`);
  info(`Remaining memories: ${out.remaining_memories}, remaining vectors: ${out.remaining_vectors}`);
  return 0;
}

module.exports = {
  runMemory,
  parseMemoryArgs,
  resolveApiBase,
  resolveApiKey
};
