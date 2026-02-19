const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const readline = require("readline/promises");
const { stdin, stdout } = require("process");
const { info, error, warn } = require("../lib/output");
const {
  readEnvFile,
  readEnvTemplate,
  mergeEnvPreservingUnknown,
  generateApiKey,
  maskSecret
} = require("../lib/env");

function parseSetupArgs(args) {
  const opts = { nonInteractive: false, force: false, sets: {} };
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--non-interactive") {
      opts.nonInteractive = true;
      continue;
    }
    if (a === "--force") {
      opts.force = true;
      continue;
    }
    if (a === "--set") {
      const kv = args[i + 1];
      if (!kv || !kv.includes("=")) {
        const err = new Error("Expected --set KEY=VALUE");
        err.exitCode = 2;
        throw err;
      }
      const eq = kv.indexOf("=");
      const key = kv.slice(0, eq).trim();
      const value = kv.slice(eq + 1);
      if (!key) {
        const err = new Error("Invalid --set key");
        err.exitCode = 2;
        throw err;
      }
      opts.sets[key] = value;
      i += 1;
      continue;
    }
    const err = new Error(`Unknown option for setup: ${a}`);
    err.exitCode = 2;
    throw err;
  }
  return opts;
}

function withDefault(v, fallback) {
  const s = String(v == null ? "" : v).trim();
  return s || String(fallback || "");
}

function summarizeDiff(prev, next) {
  const keys = Array.from(new Set([...Object.keys(prev), ...Object.keys(next)])).sort();
  const lines = [];
  for (const k of keys) {
    const before = prev[k];
    const after = next[k];
    if (String(before ?? "") === String(after ?? "")) continue;
    const shouldMask = k.includes("KEY") || k.includes("SECRET");
    const b = shouldMask ? maskSecret(before || "") : String(before ?? "(unset)");
    const a = shouldMask ? maskSecret(after || "") : String(after ?? "(unset)");
    lines.push(`${k}: ${b} -> ${a}`);
  }
  return lines;
}

function parseBool(value, fallback = false) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "y") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "n") return false;
  return fallback;
}

function parseIntOr(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function ensureObj(parent, key) {
  if (!parent[key] || typeof parent[key] !== "object" || Array.isArray(parent[key])) parent[key] = {};
  return parent[key];
}

function updateRauskuclawConfig(repoRoot, envValues) {
  const configPath = path.join(repoRoot, "rauskuclaw.json");
  if (!fs.existsSync(configPath)) return null;

  const raw = fs.readFileSync(configPath, "utf8");
  let cfg;
  try {
    cfg = JSON.parse(raw);
  } catch (e) {
    throw new Error(`Failed to parse rauskuclaw.json: ${String(e?.message || e)}`);
  }

  const api = ensureObj(cfg, "api");
  const auth = ensureObj(api, "auth");
  const worker = ensureObj(cfg, "worker");
  const scheduler = ensureObj(worker, "scheduler");
  const workerQueue = ensureObj(worker, "queue");
  const database = ensureObj(cfg, "database");
  const callbacks = ensureObj(cfg, "callbacks");
  const callbackSigning = ensureObj(callbacks, "signing");
  const observability = ensureObj(cfg, "observability");
  const metrics = ensureObj(observability, "metrics");
  const metricAlerts = ensureObj(metrics, "alerts");
  const providers = ensureObj(cfg, "providers");
  const openai = ensureObj(providers, "openai");
  const codex = ensureObj(providers, "codex_oss");
  const memory = ensureObj(cfg, "memory");
  const vector = ensureObj(memory, "vector");
  const sqlite = ensureObj(vector, "sqlite");
  const embedding = ensureObj(memory, "embedding");
  const ollama = ensureObj(embedding, "ollama");
  const search = ensureObj(memory, "search");

  api.port = parseIntOr(envValues.PORT, api.port || 3001);
  worker.poll_interval_ms = parseIntOr(envValues.WORKER_POLL_MS, worker.poll_interval_ms || 300);
  workerQueue.allowlist_env = withDefault(workerQueue.allowlist_env, "WORKER_QUEUE_ALLOWLIST");
  if (!Array.isArray(workerQueue.default_allowed) || workerQueue.default_allowed.length < 1) {
    workerQueue.default_allowed = ["default"];
  }
  scheduler.enabled = parseBool(envValues.SCHEDULER_ENABLED, Boolean(scheduler.enabled));
  scheduler.batch_size = parseIntOr(envValues.SCHEDULER_BATCH_SIZE, scheduler.batch_size || 5);
  scheduler.cron_timezone = withDefault(envValues.SCHEDULER_CRON_TZ, scheduler.cron_timezone || "UTC");
  database.path = withDefault(envValues.DB_PATH, database.path || "/data/rauskuclaw.sqlite");
  callbackSigning.enabled = parseBool(envValues.CALLBACK_SIGNING_ENABLED, Boolean(callbackSigning.enabled));
  callbackSigning.secret_env = withDefault(callbackSigning.secret_env, "CALLBACK_SIGNING_SECRET");
  callbackSigning.tolerance_sec = parseIntOr(envValues.CALLBACK_SIGNING_TOLERANCE_SEC, callbackSigning.tolerance_sec || 300);
  metrics.enabled = parseBool(envValues.METRICS_ENABLED, Boolean(metrics.enabled));
  metrics.retention_days = parseIntOr(envValues.METRICS_RETENTION_DAYS, metrics.retention_days || 7);
  metricAlerts.window_sec = parseIntOr(envValues.ALERT_WINDOW_SEC, metricAlerts.window_sec || 3600);
  metricAlerts.queue_stalled_sec = parseIntOr(envValues.ALERT_QUEUE_STALLED_SEC, metricAlerts.queue_stalled_sec || 900);
  metricAlerts.failure_rate_pct = parseIntOr(envValues.ALERT_FAILURE_RATE_PCT, metricAlerts.failure_rate_pct || 50);
  metricAlerts.failure_rate_min_completed = parseIntOr(envValues.ALERT_FAILURE_RATE_MIN_COMPLETED, metricAlerts.failure_rate_min_completed || 20);

  const authDisabled = parseBool(envValues.API_AUTH_DISABLED, false);
  auth.required = !authDisabled;

  openai.enabled = parseBool(envValues.OPENAI_ENABLED, Boolean(openai.enabled));
  openai.base_url = withDefault(envValues.OPENAI_BASE_URL, openai.base_url || "https://api.openai.com");
  openai.model = withDefault(envValues.OPENAI_MODEL, openai.model || "gpt-4.1-mini");
  openai.timeout_ms = parseIntOr(envValues.OPENAI_TIMEOUT_MS, openai.timeout_ms || 30000);

  codex.enabled = parseBool(envValues.CODEX_OSS_ENABLED, Boolean(codex.enabled));
  codex.exec_mode = withDefault(envValues.CODEX_EXEC_MODE, codex.exec_mode || "online");
  codex.local_provider = withDefault(envValues.CODEX_OSS_LOCAL_PROVIDER, codex.local_provider || "ollama");
  codex.timeout_ms = parseIntOr(envValues.CODEX_OSS_TIMEOUT_MS, codex.timeout_ms || 60000);
  codex.working_directory = withDefault(envValues.CODEX_OSS_WORKDIR, codex.working_directory || "/workspace");
  codex.cli_path = withDefault(envValues.CODEX_CLI_PATH, codex.cli_path || "codex");
  const codexModel = String(envValues.CODEX_OSS_MODEL || "").trim();
  if (codexModel) codex.model = codexModel;
  else delete codex.model;

  vector.enabled = parseBool(envValues.MEMORY_VECTOR_ENABLED, Boolean(vector.enabled));
  sqlite.extension_path = withDefault(envValues.SQLITE_VECTOR_EXTENSION_PATH, sqlite.extension_path || "");
  embedding.queue_type = withDefault(envValues.MEMORY_EMBED_QUEUE_TYPE, embedding.queue_type || "system.memory.embed.sync");
  ollama.base_url = withDefault(envValues.OLLAMA_BASE_URL, ollama.base_url || "http://rauskuclaw-ollama:11434");
  ollama.model = withDefault(envValues.OLLAMA_EMBED_MODEL, ollama.model || "embeddinggemma:300m-qat-q8_0");
  ollama.timeout_ms = parseIntOr(envValues.OLLAMA_EMBED_TIMEOUT_MS, ollama.timeout_ms || 15000);
  search.top_k_default = parseIntOr(envValues.MEMORY_SEARCH_TOP_K_DEFAULT, search.top_k_default || 10);
  search.top_k_max = parseIntOr(envValues.MEMORY_SEARCH_TOP_K_MAX, search.top_k_max || 100);

  fs.writeFileSync(configPath, `${JSON.stringify(cfg, null, 2)}\n`, "utf8");
  return configPath;
}

function copyMissingFreshDeployTemplates(repoRoot) {
  const templatesRoot = path.join(repoRoot, "fresh_deploy", "templates");
  if (!fs.existsSync(templatesRoot)) return [];

  const copied = [];
  const walk = (srcDir, relDir = "") => {
    const entries = fs.readdirSync(srcDir, { withFileTypes: true });
    for (const ent of entries) {
      const relPath = relDir ? path.join(relDir, ent.name) : ent.name;
      const srcPath = path.join(srcDir, ent.name);
      const dstPath = path.join(repoRoot, relPath);
      if (ent.isDirectory()) {
        walk(srcPath, relPath);
        continue;
      }
      if (!ent.isFile()) continue;
      if (fs.existsSync(dstPath)) continue;
      fs.mkdirSync(path.dirname(dstPath), { recursive: true });
      fs.copyFileSync(srcPath, dstPath);
      copied.push(relPath.split(path.sep).join("/"));
    }
  };

  walk(templatesRoot, "");
  return copied;
}

function buildNextValues(base, sets, defaultsFromTemplate) {
  const next = { ...base, ...defaultsFromTemplate, ...sets };
  next.API_KEY = withDefault(next.API_KEY, generateApiKey());
  next.PORT = withDefault(next.PORT, "3001");
  next.API_AUTH_DISABLED = withDefault(next.API_AUTH_DISABLED, "0");
  next.DB_PATH = withDefault(next.DB_PATH, "/data/rauskuclaw.sqlite");
  next.WORKER_POLL_MS = withDefault(next.WORKER_POLL_MS, "300");
  next.WORKER_QUEUE_ALLOWLIST = withDefault(next.WORKER_QUEUE_ALLOWLIST, "default");
  next.SCHEDULER_ENABLED = withDefault(next.SCHEDULER_ENABLED, "1");
  next.SCHEDULER_BATCH_SIZE = withDefault(next.SCHEDULER_BATCH_SIZE, "5");
  next.SCHEDULER_CRON_TZ = withDefault(next.SCHEDULER_CRON_TZ, "UTC");
  next.CALLBACK_SIGNING_ENABLED = withDefault(next.CALLBACK_SIGNING_ENABLED, "0");
  next.CALLBACK_SIGNING_TOLERANCE_SEC = withDefault(next.CALLBACK_SIGNING_TOLERANCE_SEC, "300");
  next.CALLBACK_SIGNING_SECRET = withDefault(next.CALLBACK_SIGNING_SECRET, "");
  next.METRICS_ENABLED = withDefault(next.METRICS_ENABLED, "1");
  next.METRICS_RETENTION_DAYS = withDefault(next.METRICS_RETENTION_DAYS, "7");
  next.ALERT_WINDOW_SEC = withDefault(next.ALERT_WINDOW_SEC, "3600");
  next.ALERT_QUEUE_STALLED_SEC = withDefault(next.ALERT_QUEUE_STALLED_SEC, "900");
  next.ALERT_FAILURE_RATE_PCT = withDefault(next.ALERT_FAILURE_RATE_PCT, "50");
  next.ALERT_FAILURE_RATE_MIN_COMPLETED = withDefault(next.ALERT_FAILURE_RATE_MIN_COMPLETED, "20");

  next.CODEX_OSS_ENABLED = withDefault(next.CODEX_OSS_ENABLED, "0");
  next.CODEX_EXEC_MODE = withDefault(next.CODEX_EXEC_MODE, "online");
  next.CODEX_OSS_LOCAL_PROVIDER = withDefault(next.CODEX_OSS_LOCAL_PROVIDER, "ollama");
  next.CODEX_OSS_TIMEOUT_MS = withDefault(next.CODEX_OSS_TIMEOUT_MS, "60000");
  next.CODEX_OSS_WORKDIR = withDefault(next.CODEX_OSS_WORKDIR, "/workspace");
  next.CODEX_CLI_PATH = withDefault(next.CODEX_CLI_PATH, "codex");

  next.MEMORY_VECTOR_ENABLED = withDefault(next.MEMORY_VECTOR_ENABLED, "0");
  next.OLLAMA_BASE_URL = withDefault(next.OLLAMA_BASE_URL, "http://rauskuclaw-ollama:11434");
  next.OLLAMA_EMBED_MODEL = withDefault(next.OLLAMA_EMBED_MODEL, "embeddinggemma:300m-qat-q8_0");
  next.OLLAMA_EMBED_TIMEOUT_MS = withDefault(next.OLLAMA_EMBED_TIMEOUT_MS, "15000");
  next.SQLITE_VECTOR_EXTENSION_PATH = withDefault(next.SQLITE_VECTOR_EXTENSION_PATH, "");
  next.MEMORY_SEARCH_TOP_K_DEFAULT = withDefault(next.MEMORY_SEARCH_TOP_K_DEFAULT, "10");
  next.MEMORY_SEARCH_TOP_K_MAX = withDefault(next.MEMORY_SEARCH_TOP_K_MAX, "100");
  next.MEMORY_EMBED_QUEUE_TYPE = withDefault(next.MEMORY_EMBED_QUEUE_TYPE, "system.memory.embed.sync");

  next.OPENAI_ENABLED = withDefault(next.OPENAI_ENABLED, "0");
  next.OPENAI_MODEL = withDefault(next.OPENAI_MODEL, "gpt-4.1-mini");
  next.OPENAI_BASE_URL = withDefault(next.OPENAI_BASE_URL, "https://api.openai.com");
  next.OPENAI_TIMEOUT_MS = withDefault(next.OPENAI_TIMEOUT_MS, "30000");
  next.RAUSKUCLAW_CONFIG_PATH = withDefault(next.RAUSKUCLAW_CONFIG_PATH, "/config/rauskuclaw.json");

  return next;
}

async function runInteractiveReadline(baseValues) {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    const next = { ...baseValues };
    const ask = async (key, label, fallback, { secret = false } = {}) => {
      const current = withDefault(next[key], fallback);
      const q = `${label} [${secret ? maskSecret(current) : current}]: `;
      const a = await rl.question(q);
      const v = a.trim();
      if (v) next[key] = v;
      else next[key] = current;
    };

    await ask("API_KEY", "API key (leave empty keeps/generates)", generateApiKey(), { secret: true });
    await ask("API_AUTH_DISABLED", "Disable API auth in dev (0/1)", "0");
    await ask("DB_PATH", "SQLite DB path", "/data/rauskuclaw.sqlite");
    await ask("WORKER_POLL_MS", "Worker poll interval ms", "300");
    await ask("WORKER_QUEUE_ALLOWLIST", "Worker queue allowlist (csv)", "default");
    await ask("SCHEDULER_ENABLED", "Enable scheduler loop (0/1)", "1");
    await ask("SCHEDULER_BATCH_SIZE", "Scheduler batch size", "5");
    await ask("SCHEDULER_CRON_TZ", "Scheduler cron timezone", "UTC");
    await ask("METRICS_ENABLED", "Enable runtime metrics (0/1)", "1");
    await ask("METRICS_RETENTION_DAYS", "Metrics retention days", "7");
    await ask("ALERT_WINDOW_SEC", "Alert evaluation window sec", "3600");
    await ask("ALERT_QUEUE_STALLED_SEC", "Queue stalled alert threshold sec", "900");
    await ask("ALERT_FAILURE_RATE_PCT", "Failure rate alert threshold pct", "50");
    await ask("ALERT_FAILURE_RATE_MIN_COMPLETED", "Failure rate min completed jobs", "20");

    await ask("CODEX_OSS_ENABLED", "Enable Codex OSS provider (0/1)", "0");
    if (next.CODEX_OSS_ENABLED === "1") {
      await ask("CODEX_OSS_MODEL", "Codex OSS model", "");
    } else {
      next.CODEX_OSS_MODEL = withDefault(next.CODEX_OSS_MODEL, "");
    }
    await ask("CODEX_EXEC_MODE", "Codex exec mode (online/oss)", "online");
    await ask("CODEX_OSS_LOCAL_PROVIDER", "Codex OSS local provider (ollama/lmstudio)", "ollama");
    await ask("CODEX_OSS_TIMEOUT_MS", "Codex OSS timeout ms", "60000");
    await ask("CODEX_OSS_WORKDIR", "Codex OSS working directory", "/workspace");
    await ask("CODEX_CLI_PATH", "Codex CLI path", "codex");

    await ask("MEMORY_VECTOR_ENABLED", "Enable semantic memory vectors (0/1)", "0");
    if (next.MEMORY_VECTOR_ENABLED === "1") {
      await ask("SQLITE_VECTOR_EXTENSION_PATH", "sqlite-vector extension path", "");
    }
    await ask("OLLAMA_BASE_URL", "Ollama base URL", "http://rauskuclaw-ollama:11434");
    await ask("OLLAMA_EMBED_MODEL", "Ollama embedding model", "embeddinggemma:300m-qat-q8_0");
    await ask("OLLAMA_EMBED_TIMEOUT_MS", "Ollama embedding timeout ms", "15000");
    await ask("MEMORY_SEARCH_TOP_K_DEFAULT", "Memory search top-k default", "10");
    await ask("MEMORY_SEARCH_TOP_K_MAX", "Memory search top-k max", "100");
    await ask("MEMORY_EMBED_QUEUE_TYPE", "Embedding queue job type", "system.memory.embed.sync");
    return next;
  } finally {
    rl.close();
  }
}

async function runInteractive(baseValues) {
  if (!stdin.isTTY || !stdout.isTTY) {
    return { cancelled: false, confirmed: true, values: await runInteractiveReadline(baseValues) };
  }
  try {
    const modPath = pathToFileURL(path.join(__dirname, "setup-ink.mjs")).href;
    const mod = await import(modPath);
    const result = await mod.runSetupInkWizard(baseValues);
    if (!result || result.cancelled) return { cancelled: true, confirmed: false, values: baseValues };
    return { cancelled: false, confirmed: Boolean(result.confirmed), values: result.values || baseValues };
  } catch (e) {
    warn(`Ink wizard unavailable, falling back to readline: ${e.message || String(e)}`);
    return { cancelled: false, confirmed: true, values: await runInteractiveReadline(baseValues) };
  }
}

async function runSetup(ctx, args) {
  const opts = parseSetupArgs(args);
  const envPath = path.join(ctx.repoRoot, ".env");
  const existing = readEnvFile(envPath);
  const template = readEnvTemplate(ctx.repoRoot);
  const templateDefaults = {};
  for (const line of template.lines || []) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) templateDefaults[m[1]] = m[2];
  }

  let next = buildNextValues(existing, opts.sets, templateDefaults);
  let inkConfirmed = false;
  if (!opts.nonInteractive) {
    info("Starting interactive setup wizard.");
    const interactiveResult = await runInteractive(next);
    if (interactiveResult.cancelled) {
      warn("Setup cancelled. No files changed.");
      return 1;
    }
    inkConfirmed = interactiveResult.confirmed;
    next = interactiveResult.values;
  } else {
    info("Running setup in non-interactive mode.");
  }

  if (next.CODEX_OSS_ENABLED === "1" && !String(next.CODEX_OSS_MODEL || "").trim()) {
    error("CODEX_OSS_ENABLED=1 requires CODEX_OSS_MODEL.");
    return 1;
  }
  if (next.MEMORY_VECTOR_ENABLED === "1" && !String(next.SQLITE_VECTOR_EXTENSION_PATH || "").trim()) {
    error("MEMORY_VECTOR_ENABLED=1 requires SQLITE_VECTOR_EXTENSION_PATH.");
    return 1;
  }

  const diff = summarizeDiff(existing, next);
  if (!diff.length) {
    info("No changes needed.");
    return 0;
  }

  info("Planned .env changes:");
  for (const line of diff) info(`  ${line}`);

  if (!opts.force && !opts.nonInteractive && !inkConfirmed) {
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const answer = (await rl.question("Write changes to .env? [y/N]: ")).trim().toLowerCase();
      if (answer !== "y" && answer !== "yes") {
        warn("Aborted by user. No files changed.");
        return 1;
      }
    } finally {
      rl.close();
    }
  } else if (!opts.force && opts.nonInteractive) {
    error("Non-interactive mode requires --force to write .env.");
    return 2;
  }

  const outPath = mergeEnvPreservingUnknown(ctx.repoRoot, next);
  if (!fs.existsSync(outPath)) {
    error("Failed to write .env");
    return 1;
  }
  info(`Saved environment to ${outPath}`);

  try {
    const configOutPath = updateRauskuclawConfig(ctx.repoRoot, next);
    if (configOutPath) info(`Synced config values to ${configOutPath}`);
  } catch (e) {
    error(e.message || String(e));
    return 1;
  }
  const seeded = copyMissingFreshDeployTemplates(ctx.repoRoot);
  if (seeded.length > 0) {
    info("Seeded fresh_deploy defaults:");
    for (const rel of seeded) info(`  + ${rel}`);
  }
  return 0;
}

module.exports = { runSetup, parseSetupArgs, buildNextValues, summarizeDiff, copyMissingFreshDeployTemplates };
