const fs = require("fs");
const path = require("path");
const { error, info } = require("../lib/output");
const { readEnvFile } = require("../lib/env");

function getSmokeScriptPath(repoRoot) {
  return getSmokeScriptPathForSuite(repoRoot, "m1");
}

function getSmokeScriptPathForSuite(repoRoot, suite) {
  const s = String(suite || "m1").trim().toLowerCase();
  if (s === "m3") return path.join(repoRoot, "scripts", "m3-smoke.sh");
  if (s === "m4") return path.join(repoRoot, "scripts", "m4-smoke.sh");
  return path.join(repoRoot, "scripts", "m1-smoke.sh");
}

function parseSmokeArgs(args) {
  const opts = { json: false, suite: "m1", success: false };
  for (let i = 0; i < (args || []).length; i += 1) {
    const a = args[i];
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    if (a === "--success") {
      opts.success = true;
      continue;
    }
    if (a === "--suite") {
      const v = String((args || [])[i + 1] || "").trim().toLowerCase();
      if (!v || (v !== "m1" && v !== "m3" && v !== "m4")) {
        const err = new Error("Invalid --suite value. Allowed: m1, m3, m4");
        err.exitCode = 2;
        throw err;
      }
      opts.suite = v;
      i += 1;
      continue;
    }
    const err = new Error(`Unknown option for smoke: ${a}`);
    err.exitCode = 2;
    throw err;
  }
  if (opts.success && opts.suite !== "m3") {
    const err = new Error("--success is supported only with --suite m3");
    err.exitCode = 2;
    throw err;
  }
  return opts;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

async function runSmoke(ctx, args) {
  const opts = parseSmokeArgs(args);
  const envPath = path.join(ctx.repoRoot, ".env");
  if (!fs.existsSync(envPath)) {
    if (opts.json) printJson({ ok: false, command: "smoke", suite: opts.suite, error: "missing_env_file", env_path: envPath });
    if (!opts.json) error(`Missing .env at ${envPath}. Run 'rauskuclaw setup' first.`);
    return 1;
  }
  const env = readEnvFile(envPath);
  if (!String(env.API_KEY || "").trim()) {
    if (opts.json) printJson({ ok: false, command: "smoke", suite: opts.suite, error: "missing_api_key" });
    if (!opts.json) error("API_KEY is empty in .env. Run 'rauskuclaw setup' and set API key.");
    return 1;
  }

  const script = getSmokeScriptPathForSuite(ctx.repoRoot, opts.suite);
  if (!fs.existsSync(script)) {
    if (opts.json) printJson({ ok: false, command: "smoke", suite: opts.suite, error: "missing_smoke_script", path: script });
    if (!opts.json) error(`Missing smoke script at ${script}`);
    return 1;
  }
  const r = await ctx.exec(script, [], {
    cwd: ctx.repoRoot,
    env: opts.success ? { M3_SMOKE_SUCCESS: "1" } : null,
    capture: opts.json,
    quiet: opts.json
  });
  if (r.code !== 0) {
    if (opts.json) printJson({ ok: false, command: "smoke", suite: opts.suite, error: "smoke_failed" });
    return 1;
  }
  if (opts.json) {
    printJson({ ok: true, command: "smoke", suite: opts.suite });
    return 0;
  }
  info(`Smoke checks passed (${opts.suite}).`);
  return 0;
}

module.exports = { runSmoke, getSmokeScriptPath, getSmokeScriptPathForSuite, parseSmokeArgs };
