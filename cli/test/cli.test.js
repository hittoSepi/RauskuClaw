const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseArgv, runCli } = require("../index");
const { mapService, parseLogsArgs, analyzeSecurityLines, runLogs } = require("../commands/logs");
const { getSmokeScriptPath, getSmokeScriptPathForSuite } = require("../commands/smoke");
const { mergeEnvPreservingUnknown } = require("../lib/env");
const { runSetup, copyMissingFreshDeployTemplates } = require("../commands/setup");
const { runRestart } = require("../commands/restart");
const { runStart, parseStartArgs } = require("../commands/start");
const { runDoctor, parseDoctorArgs } = require("../commands/doctor");
const { runStatus, parseStatusArgs } = require("../commands/status");
const { runConfig, parseConfigArgs } = require("../commands/config");
const { parseStopArgs } = require("../commands/stop");
const { parseSmokeArgs, runSmoke } = require("../commands/smoke");
const { parseCodexArgs, runCodex } = require("../commands/codex");
const { parseMemoryArgs, runMemory } = require("../commands/memory");
const { parseAuthArgs, runAuth } = require("../commands/auth");

function mkRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rauskuclaw-cli-test-"));
  fs.writeFileSync(path.join(dir, "docker-compose.yml"), "services:\n", "utf8");
  fs.mkdirSync(path.join(dir, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(dir, "scripts", "m1-smoke.sh"), "#!/usr/bin/env bash\n", "utf8");
  fs.writeFileSync(path.join(dir, "scripts", "m3-smoke.sh"), "#!/usr/bin/env bash\n", "utf8");
  fs.writeFileSync(path.join(dir, "scripts", "m4-smoke.sh"), "#!/usr/bin/env bash\n", "utf8");
  fs.writeFileSync(path.join(dir, ".env.example"), "API_KEY=change-me\nPORT=3001\n", "utf8");
  return dir;
}

function rmDir(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
}

test("parseArgv resolves command and args", () => {
  assert.deepEqual(parseArgv(["start", "--build"]), { command: "start", args: ["--build"] });
  assert.deepEqual(parseArgv([]), { command: "help", args: [] });
});

test("runCli returns 2 on unknown command", async () => {
  const repo = mkRepo();
  try {
    const code = await runCli(["does-not-exist"], {
      startDir: repo,
      execFn: async () => ({ code: 0, stdout: "", stderr: "" })
    });
    assert.equal(code, 2);
  } finally {
    rmDir(repo);
  }
});

test("mergeEnvPreservingUnknown keeps unknown keys", () => {
  const repo = mkRepo();
  try {
    fs.writeFileSync(path.join(repo, ".env"), "API_KEY=old\nUNKNOWN_X=1\n", "utf8");
    mergeEnvPreservingUnknown(repo, { API_KEY: "new", PORT: "3001" });
    const out = fs.readFileSync(path.join(repo, ".env"), "utf8");
    assert.match(out, /API_KEY=new/);
    assert.match(out, /UNKNOWN_X=1/);
    assert.match(out, /PORT=3001/);
  } finally {
    rmDir(repo);
  }
});

test("logs target mapping works", () => {
  assert.equal(mapService("api"), "rauskuclaw-api");
  assert.equal(mapService("worker"), "rauskuclaw-worker");
  assert.equal(mapService("ui"), "rauskuclaw-ui");
  assert.equal(mapService("nope"), null);
});

test("logs parser supports security flags and validates combos", () => {
  const opts = parseLogsArgs(["api", "--tail", "50", "--since", "10m", "--security", "--json"]);
  assert.equal(opts.target, "api");
  assert.equal(opts.tail, "50");
  assert.equal(opts.since, "10m");
  assert.equal(opts.security, true);
  assert.equal(opts.json, true);
  assert.throws(() => parseLogsArgs(["api", "--follow", "--security"]), /cannot be used/);
  assert.throws(() => parseLogsArgs(["api", "--json"]), /supported only with `--security`/);
});

test("logs --security --json returns structured analysis", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    const code = await runLogs({
      repoRoot: repo,
      exec: async () => ({
        code: 0,
        stdout: "GET /.git/config HTTP/1.1\nGET /health HTTP/1.1\n",
        stderr: ""
      })
    }, ["api", "--security", "--json", "--tail", "20"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "logs");
    assert.equal(parsed.mode, "security");
    assert.equal(parsed.analysis.matched_lines, 1);
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("security log analyzer groups known probe patterns", () => {
  const data = [
    'GET /.git/config HTTP/1.1',
    'GET /@fs/root/.env?raw?? HTTP/1.1',
    'GET /home/ubuntu/.aws/credentials HTTP/1.1',
    'GET /terraform.tfvars HTTP/1.1',
    'GET /health HTTP/1.1'
  ].join("\n");
  const out = analyzeSecurityLines(data);
  assert.equal(out.totalLines, 5);
  assert.equal(out.matchedLines, 4);
  assert.equal(out.counts.dotfiles, 2);
  assert.equal(out.counts.viteFs, 1);
  assert.equal(out.counts.aws, 1);
  assert.equal(out.counts.terraform, 1);
});

test("smoke script path uses repo scripts directory", () => {
  assert.equal(getSmokeScriptPath("/x"), "/x/scripts/m1-smoke.sh");
  assert.equal(getSmokeScriptPathForSuite("/x", "m1"), "/x/scripts/m1-smoke.sh");
  assert.equal(getSmokeScriptPathForSuite("/x", "m3"), "/x/scripts/m3-smoke.sh");
  assert.equal(getSmokeScriptPathForSuite("/x", "m4"), "/x/scripts/m4-smoke.sh");
});

test("start command emits docker compose up -d --build", async () => {
  const repo = mkRepo();
  const calls = [];
  try {
    const code = await runStart({
      repoRoot: repo,
      exec: async (cmd, args) => {
        calls.push([cmd, args]);
        return { code: 0, stdout: "", stderr: "" };
      }
    }, []);
    assert.equal(code, 0);
    assert.deepEqual(calls[0], ["docker", ["compose", "up", "-d", "--build"]]);
  } finally {
    rmDir(repo);
  }
});

test("start parser supports --json", () => {
  assert.deepEqual(parseStartArgs(["--json"]), { build: true, detach: true, json: true, quiet: false });
});

test("stop parser supports --json", () => {
  assert.deepEqual(parseStopArgs(["--json"]), { json: true, quiet: false });
});

test("status parser supports --json", () => {
  assert.deepEqual(parseStatusArgs(["--json"]), { json: true });
  assert.throws(() => parseStatusArgs(["--wat"]), /Unknown option for status/);
});

test("status --json prints structured output", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    const code = await runStatus({
      repoRoot: repo,
      exec: async () => ({
        code: 0,
        stdout: '[{"Name":"rauskuclaw-api","State":"running","Status":"Up 10s"}]\n',
        stderr: ""
      })
    }, ["--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(Array.isArray(parsed.services), true);
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("status --json supports docker compose newline-delimited JSON output", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    const code = await runStatus({
      repoRoot: repo,
      exec: async () => ({
        code: 0,
        stdout: [
          '{"Name":"rauskuclaw-api","State":"running","Status":"Up 10s"}',
          '{"Name":"rauskuclaw-worker","State":"running","Status":"Up 10s"}'
        ].join("\n"),
        stderr: ""
      })
    }, ["--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(Array.isArray(parsed.services), true);
    assert.equal(parsed.services.length, 2);
    assert.equal(parsed.parse_error, null);
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("restart command calls down then up", async () => {
  const repo = mkRepo();
  const calls = [];
  try {
    const code = await runRestart({
      repoRoot: repo,
      exec: async (cmd, args) => {
        calls.push([cmd, args]);
        return { code: 0, stdout: "", stderr: "" };
      }
    }, []);
    assert.equal(code, 0);
    assert.deepEqual(calls[0], ["docker", ["compose", "down"]]);
    assert.deepEqual(calls[1], ["docker", ["compose", "up", "-d", "--build"]]);
  } finally {
    rmDir(repo);
  }
});

test("restart --json returns a single JSON result", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    const code = await runRestart({
      repoRoot: repo,
      exec: async () => ({ code: 0, stdout: "", stderr: "" })
    }, ["--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "restart");
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("setup non-interactive writes .env using --set values", async () => {
  const repo = mkRepo();
  try {
    fs.writeFileSync(path.join(repo, "rauskuclaw.json"), JSON.stringify({
      version: 1,
      service: { name: "rauskuclaw", environment: "test" },
      api: { port: 3001, auth: { header: "x-api-key", required: true, allow_without_key_when: { env: "API_AUTH_DISABLED", equals: "1" } }, sse: { route: "/v1/jobs/:id/stream", query_api_key_param: "api_key" } },
      worker: { poll_interval_ms: 300, worker_id_source: { env: "WORKER_ID", fallback: "hostname" }, job_defaults: { priority: 5, timeout_sec: 120, max_attempts: 1 } },
      database: { engine: "sqlite", path: "/data/rauskuclaw.sqlite", mode: "wal" },
      callbacks: { enabled: true, allowlist_env: "CALLBACK_ALLOWLIST", allowlist_behavior_when_empty: "allow_all" },
      providers: { openai: { enabled: false, api_key_env: "OPENAI_API_KEY", base_url: "https://api.openai.com", model: "gpt-4.1-mini", timeout_ms: 30000 }, codex_oss: { enabled: false, local_provider: "ollama", timeout_ms: 60000, working_directory: "/workspace", cli_path: "codex" } },
      handlers: { deploy: { allowlist_env: "DEPLOY_TARGET_ALLOWLIST", default_allowed_targets: ["staging"] } },
      ui: { mount_path: "/ui/", container_port: 8080, host_port: 3002 },
      runtime: { api_container: "rauskuclaw-api", worker_container: "rauskuclaw-worker", ui_container: "rauskuclaw-ui", compose_file: "docker-compose.yml" },
      env_mapping: {}
    }, null, 2));
    const code = await runSetup({ repoRoot: repo, exec: async () => ({ code: 0 }) }, [
      "--non-interactive",
      "--force",
      "--set", "API_KEY=abc123",
      "--set", "CODEX_OSS_ENABLED=1",
      "--set", "CODEX_OSS_MODEL=qwen2.5-coder:7b",
      "--set", "DB_PATH=/tmp/test.sqlite",
      "--set", "WORKER_POLL_MS=777",
      "--set", "PORT=3010"
    ]);
    assert.equal(code, 0);
    const envOut = fs.readFileSync(path.join(repo, ".env"), "utf8");
    assert.match(envOut, /API_KEY=abc123/);
    assert.match(envOut, /CODEX_OSS_ENABLED=1/);
    assert.match(envOut, /CODEX_OSS_MODEL=qwen2.5-coder:7b/);
    const cfgOut = JSON.parse(fs.readFileSync(path.join(repo, "rauskuclaw.json"), "utf8"));
    assert.equal(cfgOut.providers.codex_oss.enabled, true);
    assert.equal(cfgOut.providers.codex_oss.model, "qwen2.5-coder:7b");
    assert.equal(cfgOut.database.path, "/tmp/test.sqlite");
    assert.equal(cfgOut.worker.poll_interval_ms, 777);
    assert.equal(cfgOut.api.port, 3010);
  } finally {
    rmDir(repo);
  }
});

test("fresh_deploy templates seed only missing files", () => {
  const repo = mkRepo();
  try {
    fs.mkdirSync(path.join(repo, "fresh_deploy", "templates", "workspace"), { recursive: true });
    fs.writeFileSync(path.join(repo, "fresh_deploy", "templates", "workspace", "AGENTS.md"), "# template agents\n", "utf8");
    fs.writeFileSync(path.join(repo, "fresh_deploy", "templates", "workspace", "USER.md"), "# template user\n", "utf8");
    fs.mkdirSync(path.join(repo, "workspace"), { recursive: true });
    fs.writeFileSync(path.join(repo, "workspace", "AGENTS.md"), "# existing agents\n", "utf8");

    const seeded = copyMissingFreshDeployTemplates(repo);
    assert.equal(seeded.includes("workspace/USER.md"), true);
    assert.equal(seeded.includes("workspace/AGENTS.md"), false);
    assert.equal(fs.readFileSync(path.join(repo, "workspace", "AGENTS.md"), "utf8"), "# existing agents\n");
    assert.equal(fs.readFileSync(path.join(repo, "workspace", "USER.md"), "utf8"), "# template user\n");
  } finally {
    rmDir(repo);
  }
});

test("doctor parser supports --json", () => {
  assert.deepEqual(parseDoctorArgs(["--json"]), { json: true, fixHints: false });
  assert.deepEqual(parseDoctorArgs(["--fix-hints"]), { json: false, fixHints: true });
  assert.throws(() => parseDoctorArgs(["--wat"]), /Unknown option for doctor/);
});

test("smoke parser supports --json", () => {
  assert.deepEqual(parseSmokeArgs(["--json"]), { json: true, suite: "m1", success: false });
  assert.deepEqual(parseSmokeArgs(["--suite", "m3", "--json"]), { json: true, suite: "m3", success: false });
  assert.deepEqual(parseSmokeArgs(["--suite", "m4", "--json"]), { json: true, suite: "m4", success: false });
  assert.deepEqual(parseSmokeArgs(["--suite", "m3", "--success"]), { json: false, suite: "m3", success: true });
  assert.throws(() => parseSmokeArgs(["--suite", "bad"]), /Invalid --suite value/);
  assert.throws(() => parseSmokeArgs(["--suite", "m1", "--success"]), /supported only with --suite m3/);
  assert.throws(() => parseSmokeArgs(["--wat"]), /Unknown option for smoke/);
});

test("smoke --suite m3 --success injects M3 success env flag", async () => {
  const repo = mkRepo();
  const envPath = path.join(repo, ".env");
  fs.writeFileSync(envPath, "API_KEY=test-key\n", "utf8");
  let seenEnv = null;
  try {
    const code = await runSmoke({
      repoRoot: repo,
      exec: async (_cmd, _args, opts) => {
        seenEnv = opts?.env || null;
        return { code: 0, stdout: "", stderr: "" };
      }
    }, ["--suite", "m3", "--success"]);
    assert.equal(code, 0);
    assert.deepEqual(seenEnv, { M3_SMOKE_SUCCESS: "1" });
  } finally {
    rmDir(repo);
  }
});

test("smoke --json returns missing env error object", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    fs.rmSync(path.join(repo, ".env"), { force: true });
    const code = await runSmoke({ repoRoot: repo }, ["--json"]);
    assert.equal(code, 1);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, false);
    assert.equal(parsed.suite, "m1");
    assert.equal(parsed.error, "missing_env_file");
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("config parser supports --json", () => {
  assert.deepEqual(parseConfigArgs(["show", "--json"]), { sub: "show", json: true });
  assert.deepEqual(parseConfigArgs(["--json"]), { sub: "show", json: true });
  assert.throws(() => parseConfigArgs(["nope"]), /Usage: rauskuclaw config/);
});

test("codex parser validates subcommands", () => {
  assert.deepEqual(parseCodexArgs(["login"]), { sub: "login", passthrough: [] });
  assert.deepEqual(parseCodexArgs(["login", "--device-auth"]), { sub: "login", passthrough: ["--device-auth"] });
  assert.deepEqual(parseCodexArgs(["logout"]), { sub: "logout", passthrough: [] });
  assert.deepEqual(parseCodexArgs(["exec", "-m", "gpt-5.3-codex", "hi"]), {
    sub: "exec",
    passthrough: ["-m", "gpt-5.3-codex", "hi"]
  });
  assert.throws(() => parseCodexArgs([]), /Missing codex subcommand/);
  assert.throws(() => parseCodexArgs(["bad"]), /Unknown codex subcommand/);
  assert.throws(() => parseCodexArgs(["exec"]), /requires arguments/);
});

test("memory parser validates reset command and required --yes", () => {
  assert.deepEqual(parseMemoryArgs(["reset", "--yes"]), {
    sub: "reset",
    yes: true,
    scope: "",
    apiBase: "",
    json: false
  });
  assert.deepEqual(parseMemoryArgs(["reset", "--yes", "--scope", "agent.chat", "--json"]), {
    sub: "reset",
    yes: true,
    scope: "agent.chat",
    apiBase: "",
    json: true
  });
  assert.throws(() => parseMemoryArgs([]), /Usage: rauskuclaw memory reset/);
  assert.throws(() => parseMemoryArgs(["reset"]), /without --yes/);
  assert.throws(() => parseMemoryArgs(["reset", "--yes", "--scope", "x"]), /Invalid --scope/);
});

test("memory reset command posts to API and prints json", async () => {
  const repo = mkRepo();
  const envPath = path.join(repo, ".env");
  fs.writeFileSync(envPath, "API_KEY=test-key\nPORT=3901\n", "utf8");

  const origFetch = global.fetch;
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  global.fetch = async (url, init) => {
    assert.equal(url, "http://127.0.0.1:3901/v1/memory/reset");
    assert.equal(init?.method, "POST");
    assert.equal(init?.headers?.["x-api-key"], "test-key");
    const body = JSON.parse(String(init?.body || "{}"));
    assert.equal(body.confirm, true);
    assert.equal(body.scope, "agent.chat");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        scope: "agent.chat",
        deleted_memories: 3,
        deleted_vectors: 3,
        remaining_memories: 1,
        remaining_vectors: 1
      })
    };
  };

  try {
    const code = await runMemory({ repoRoot: repo }, ["reset", "--yes", "--scope", "agent.chat", "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "memory.reset");
    assert.equal(parsed.scope, "agent.chat");
    assert.equal(parsed.deleted_memories, 3);
  } finally {
    global.fetch = origFetch;
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("auth parser validates whoami command", () => {
  assert.deepEqual(parseAuthArgs(["whoami"]), {
    sub: "whoami",
    apiBase: "",
    json: false
  });
  assert.deepEqual(parseAuthArgs(["whoami", "--api", "http://127.0.0.1:3009", "--json"]), {
    sub: "whoami",
    apiBase: "http://127.0.0.1:3009",
    json: true
  });
  assert.throws(() => parseAuthArgs([]), /Usage: rauskuclaw auth whoami/);
  assert.throws(() => parseAuthArgs(["bad"]), /Usage: rauskuclaw auth whoami/);
});

test("auth whoami command calls API and prints json", async () => {
  const repo = mkRepo();
  const envPath = path.join(repo, ".env");
  fs.writeFileSync(envPath, "API_KEY=test-key\nPORT=3901\n", "utf8");

  const origFetch = global.fetch;
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  global.fetch = async (url, init) => {
    assert.equal(url, "http://127.0.0.1:3901/v1/auth/whoami");
    assert.equal(init?.method, "GET");
    assert.equal(init?.headers?.["x-api-key"], "test-key");
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({
        ok: true,
        auth: {
          name: "read-only",
          role: "read",
          sse: false,
          can_write: false,
          queue_allowlist: ["alpha", "default"]
        }
      })
    };
  };

  try {
    const code = await runAuth({ repoRoot: repo }, ["whoami", "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.command, "auth.whoami");
    assert.equal(parsed.auth.name, "read-only");
    assert.equal(parsed.auth.role, "read");
    assert.equal(parsed.auth.sse, false);
    assert.equal(parsed.auth.can_write, false);
    assert.deepEqual(parsed.auth.queue_allowlist, ["alpha", "default"]);
  } finally {
    global.fetch = origFetch;
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("codex command maps to codex binary invocations", async () => {
  const repo = mkRepo();
  const calls = [];
  try {
    let code = await runCodex({
      repoRoot: repo,
      exec: async (cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        return { code: 0, stdout: "", stderr: "" };
      }
    }, ["login", "--device-auth"]);
    assert.equal(code, 0);

    code = await runCodex({
      repoRoot: repo,
      exec: async (cmd, args, opts) => {
        calls.push([cmd, args, opts]);
        return { code: 0, stdout: "", stderr: "" };
      }
    }, ["exec", "-m", "gpt-5.3-codex", "hello"]);
    assert.equal(code, 0);

    assert.deepEqual(calls[0][0], "codex");
    assert.deepEqual(calls[0][1], ["login", "--device-auth"]);
    assert.match(String(calls[0][2]?.env?.HOME || ""), /workspace\/\.codex-home/);
    assert.deepEqual(calls[1][0], "codex");
    assert.deepEqual(calls[1][1], ["exec", "-m", "gpt-5.3-codex", "hello"]);
    assert.match(String(calls[1][2]?.env?.HOME || ""), /workspace\/\.codex-home/);
  } finally {
    rmDir(repo);
  }
});

test("config show --json returns structured values", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    fs.writeFileSync(path.join(repo, ".env"), "API_KEY=abc123\nPORT=3001\nDB_PATH=/tmp/x.sqlite\nWORKER_POLL_MS=300\nCODEX_OSS_ENABLED=0\nCODEX_OSS_LOCAL_PROVIDER=ollama\n", "utf8");
    const code = await runConfig({ repoRoot: repo }, ["show", "--json"]);
    assert.equal(code, 0);
    const parsed = JSON.parse(out);
    assert.equal(parsed.ok, true);
    assert.equal(parsed.values.PORT, "3001");
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("doctor returns 0 when mocked dependencies are healthy", async () => {
  const repo = mkRepo();
  const origWrite = process.stdout.write;
  let out = "";
  process.stdout.write = (s) => { out += String(s); return true; };
  try {
    fs.writeFileSync(path.join(repo, ".env"), "CODEX_CLI_PATH=codex\nCODEX_OSS_LOCAL_PROVIDER=ollama\n", "utf8");
    const code = await runDoctor({
      repoRoot: repo,
      exec: async () => ({ code: 0, stdout: "ok\n", stderr: "" })
    }, ["--json"]);
    assert.equal(code, 0);
    assert.match(out, /"ok": true/);
    assert.match(out, /"docker_compose"/);
  } finally {
    process.stdout.write = origWrite;
    rmDir(repo);
  }
});

test("doctor prints fix hints when enabled and checks fail", async () => {
  const repo = mkRepo();
  const origErr = console.error;
  const origWarn = console.warn;
  const origLog = console.log;
  let out = "";
  console.error = (...args) => { out += `${args.join(" ")}\n`; };
  console.warn = (...args) => { out += `${args.join(" ")}\n`; };
  console.log = (...args) => { out += `${args.join(" ")}\n`; };
  try {
    const code = await runDoctor({
      repoRoot: repo,
      exec: async () => ({ code: 1, stdout: "", stderr: "boom\n" })
    }, ["--fix-hints"]);
    assert.equal(code, 1);
    assert.match(out, /Suggested fixes:/);
    assert.match(out, /docker_daemon:/);
  } finally {
    console.error = origErr;
    console.warn = origWarn;
    console.log = origLog;
    rmDir(repo);
  }
});
