const fs = require("fs");
const path = require("path");
const { info, warn, error } = require("../lib/output");
const { readEnvFile } = require("../lib/env");

function parseDoctorArgs(args) {
  const opts = { json: false, fixHints: false };
  for (const a of args || []) {
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    if (a === "--fix-hints") {
      opts.fixHints = true;
      continue;
    }
    const err = new Error(`Unknown option for doctor: ${a}`);
    err.exitCode = 2;
    throw err;
  }
  return opts;
}

function buildHint(check) {
  if (check.ok) return null;
  if (check.label === "docker_compose") {
    return "Install Docker Compose plugin: https://docs.docker.com/compose/install/";
  }
  if (check.label === "docker_daemon") {
    return "Start Docker daemon and verify socket access (e.g. add user to docker group).";
  }
  if (check.label === "codex_cli") {
    return "Install Codex CLI or set CODEX_CLI_PATH in .env to the correct executable.";
  }
  if (check.label === "ollama") {
    return "Start Ollama service and verify it responds on 127.0.0.1:11434.";
  }
  if (check.label === "env_file") {
    return "Run 'rauskuclaw setup' to create .env.";
  }
  return "Check command output above and fix the failing dependency.";
}

async function checkCommand(ctx, cmd, args, label, { quiet = false } = {}) {
  try {
    const r = await ctx.exec(cmd, args, { cwd: ctx.repoRoot, capture: true, quiet });
    if (r.code === 0) return { label, ok: true, details: "ok" };
    const tail = String(r.stderr || r.stdout || "").trim().split("\n").slice(-1)[0] || "failed";
    return { label, ok: false, details: tail };
  } catch (e) {
    return { label, ok: false, details: e.message || String(e) };
  }
}

async function checkCodexCli(ctx, codexCli, { quiet = false } = {}) {
  const local = await checkCommand(ctx, codexCli, ["--version"], "codex_cli", { quiet });
  if (local.ok) return local;

  const containerChecks = [];
  containerChecks.push(
    await checkCommand(
      ctx,
      "docker",
      ["compose", "exec", "-T", "rauskuclaw-worker", codexCli, "--version"],
      "codex_cli",
      { quiet }
    )
  );
  if (codexCli !== "codex") {
    containerChecks.push(
      await checkCommand(
        ctx,
        "docker",
        ["compose", "exec", "-T", "rauskuclaw-worker", "codex", "--version"],
        "codex_cli",
        { quiet }
      )
    );
  }

  const working = containerChecks.find((c) => c.ok);
  if (working) {
    return {
      label: "codex_cli",
      ok: true,
      details: "ok (available in rauskuclaw-worker container)"
    };
  }

  const details = [
    `host: ${local.details}`
  ].concat(containerChecks.map((c, idx) => `container#${idx + 1}: ${c.details}`)).join(" | ");
  return { label: "codex_cli", ok: false, details };
}

async function checkOllama(ctx, { quiet = false } = {}) {
  const local = await checkCommand(ctx, "ollama", ["list"], "ollama", { quiet });
  if (local.ok) return local;

  const container = await checkCommand(
    ctx,
    "docker",
    ["compose", "exec", "-T", "rauskuclaw-ollama", "ollama", "list"],
    "ollama",
    { quiet }
  );
  if (container.ok) {
    return {
      label: "ollama",
      ok: true,
      details: "ok (available in rauskuclaw-ollama container)"
    };
  }

  return {
    label: "ollama",
    ok: false,
    details: `host: ${local.details} | container: ${container.details}`
  };
}

async function runDoctor(ctx, args) {
  const opts = parseDoctorArgs(args);
  const envPath = path.join(ctx.repoRoot, ".env");
  const env = fs.existsSync(envPath) ? readEnvFile(envPath) : {};
  const codexCli = String(env.CODEX_CLI_PATH || "codex").trim() || "codex";
  const localProvider = String(env.CODEX_OSS_LOCAL_PROVIDER || "ollama").trim() || "ollama";

  const checks = [];
  checks.push(await checkCommand(ctx, "docker", ["compose", "version"], "docker_compose", { quiet: opts.json }));
  checks.push(await checkCommand(ctx, "docker", ["info"], "docker_daemon", { quiet: opts.json }));
  checks.push(await checkCodexCli(ctx, codexCli, { quiet: opts.json }));

  if (localProvider === "ollama") {
    checks.push(await checkOllama(ctx, { quiet: opts.json }));
  } else if (localProvider === "lmstudio") {
    checks.push({ label: "lmstudio", ok: true, details: "manual check required (CLI probe not implemented)" });
  }

  checks.push({
    label: "env_file",
    ok: fs.existsSync(envPath),
    details: fs.existsSync(envPath) ? envPath : "missing .env"
  });
  const checksWithHints = checks.map((c) => ({ ...c, hint: buildHint(c) }));

  const allOk = checksWithHints.every((c) => c.ok);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ ok: allOk, checks: checksWithHints }, null, 2)}\n`);
  } else {
    info("Doctor checks:");
    for (const c of checksWithHints) {
      if (c.ok) info(`  [ok] ${c.label}: ${c.details}`);
      else warn(`  [fail] ${c.label}: ${c.details}`);
    }
    if (!allOk && opts.fixHints) {
      info("Suggested fixes:");
      for (const c of checksWithHints) {
        if (!c.ok && c.hint) info(`  - ${c.label}: ${c.hint}`);
      }
    }
    if (allOk) info("Doctor passed.");
    else error("Doctor found issues.");
  }

  return allOk ? 0 : 1;
}

module.exports = { runDoctor, parseDoctorArgs };
