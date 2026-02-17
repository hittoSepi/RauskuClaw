const path = require("path");
const fs = require("fs");
const { info, warn, error } = require("../lib/output");
const { readEnvFile, maskSecret } = require("../lib/env");

const REQUIRED_KEYS = [
  "API_KEY",
  "PORT",
  "DB_PATH",
  "WORKER_POLL_MS",
  "CODEX_OSS_ENABLED",
  "CODEX_OSS_LOCAL_PROVIDER"
];

function parseConfigArgs(args) {
  const rest = Array.isArray(args) ? args.slice() : [];
  let json = false;
  const filtered = [];
  for (const a of rest) {
    if (a === "--json") {
      json = true;
      continue;
    }
    filtered.push(a);
  }
  const sub = filtered[0] || "show";
  if (!["show", "validate", "path"].includes(sub)) {
    const err = new Error("Usage: rauskuclaw config [show|validate|path] [--json]");
    err.exitCode = 2;
    throw err;
  }
  return { sub, json };
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function showConfig(repoRoot, { json = false } = {}) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    if (json) printJson({ ok: false, error: "missing_env_file", env_path: envPath });
    if (!json) warn(`Missing .env at ${envPath}`);
    return 1;
  }
  const env = readEnvFile(envPath);
  const values = {};
  for (const k of REQUIRED_KEYS) {
    const v = env[k];
    values[k] = (k.includes("KEY") && v) ? maskSecret(v) : (v == null ? "(unset)" : v);
  }
  if (json) {
    printJson({ ok: true, env_path: envPath, values });
    return 0;
  }
  for (const k of REQUIRED_KEYS) {
    info(`${k}=${values[k]}`);
  }
  return 0;
}

function validateConfig(repoRoot, { json = false } = {}) {
  const envPath = path.join(repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    if (json) printJson({ ok: false, error: "missing_env_file", env_path: envPath });
    if (!json) error(`Missing .env at ${envPath}`);
    return 1;
  }
  const env = readEnvFile(envPath);
  const missing = REQUIRED_KEYS.filter((k) => !String(env[k] || "").trim());
  if (missing.length) {
    if (json) printJson({ ok: false, error: "missing_required_keys", missing });
    if (!json) error(`Missing required keys: ${missing.join(", ")}`);
    return 1;
  }
  if (env.CODEX_OSS_ENABLED === "1" && !String(env.CODEX_OSS_MODEL || "").trim()) {
    if (json) printJson({ ok: false, error: "missing_codex_model" });
    if (!json) error("CODEX_OSS_ENABLED=1 requires CODEX_OSS_MODEL.");
    return 1;
  }
  if (json) {
    printJson({ ok: true });
    return 0;
  }
  info("Config looks valid.");
  return 0;
}

function showPaths(repoRoot, { json = false } = {}) {
  const envPath = path.join(repoRoot, ".env");
  const configPath = path.join(repoRoot, "rauskuclaw.json");
  if (json) {
    printJson({
      ok: true,
      repo_root: repoRoot,
      env_path: envPath,
      config_path: configPath
    });
    return 0;
  }
  info(`repo_root=${repoRoot}`);
  info(`env_path=${envPath}`);
  info(`config_path=${configPath}`);
  return 0;
}

async function runConfig(ctx, args) {
  const opts = parseConfigArgs(args);
  if (opts.sub === "show") return showConfig(ctx.repoRoot, opts);
  if (opts.sub === "validate") return validateConfig(ctx.repoRoot, opts);
  return showPaths(ctx.repoRoot, opts);
}

module.exports = { runConfig, parseConfigArgs };
