const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");
const { envOrConfig, envIntOrConfig, envBoolOrConfig } = require("../config");
const { createProviderError, toProviderError } = require("./errors");

const LOCAL_PROVIDER_VALUES = new Set(["ollama", "lmstudio"]);
const EXEC_MODE_VALUES = new Set(["online", "oss"]);

function normalizeCodexInput(input) {
  const i = input || {};
  const out = [];

  const system = String(i.system || "").trim();
  if (system) out.push(`System:\n${system}`);

  if (Array.isArray(i.messages) && i.messages.length > 0) {
    for (const m of i.messages) {
      const role = String(m?.role || "user").trim().toLowerCase();
      const content = String(m?.content || "").trim();
      if (!content) continue;
      if (role !== "system" && role !== "user" && role !== "assistant") continue;
      out.push(`${role}:\n${content}`);
    }
  }

  const prompt = String(i.prompt || "").trim();
  if (prompt) out.push(`user:\n${prompt}`);

  const combined = out.join("\n\n").trim();
  if (!combined) {
    throw createProviderError("PROVIDER_INPUT", "Codex OSS input requires 'prompt' or non-empty 'messages'.");
  }
  return combined;
}

function defaultCodexCliPath() {
  const localPath = path.resolve(__dirname, "../node_modules/.bin/codex");
  if (fs.existsSync(localPath)) return localPath;
  return "codex";
}

function resolveWorkingDirectory(configuredPath) {
  const configured = String(configuredPath || "").trim();
  if (configured && fs.existsSync(configured)) return configured;
  return "/app";
}

function codexOssSettings() {
  const enabled = envBoolOrConfig("CODEX_OSS_ENABLED", "providers.codex_oss.enabled", false);
  const model = String(process.env.CODEX_OSS_MODEL || "").trim();
  const execMode = String(envOrConfig("CODEX_EXEC_MODE", "providers.codex_oss.exec_mode", "online"))
    .trim()
    .toLowerCase();
  const localProvider = String(envOrConfig("CODEX_OSS_LOCAL_PROVIDER", "providers.codex_oss.local_provider", "ollama"))
    .trim()
    .toLowerCase();
  const timeoutMs = envIntOrConfig("CODEX_OSS_TIMEOUT_MS", "providers.codex_oss.timeout_ms", 60000);
  const transientRetries = Math.max(
    0,
    Number(envOrConfig("CODEX_OSS_TRANSIENT_RETRIES", "providers.codex_oss.transient_retries", 4)) || 4
  );
  const transientBackoffMs = Math.max(
    0,
    Number(envOrConfig("CODEX_OSS_TRANSIENT_BACKOFF_MS", "providers.codex_oss.transient_backoff_ms", 750)) || 750
  );
  const configuredWorkdir = String(envOrConfig("CODEX_OSS_WORKDIR", "providers.codex_oss.working_directory", "/workspace")).trim();
  const workingDirectory = resolveWorkingDirectory(configuredWorkdir);
  const codexPath = String(envOrConfig("CODEX_CLI_PATH", "providers.codex_oss.cli_path", defaultCodexCliPath())).trim();
  const codexHome = String(process.env.CODEX_HOME || path.join(workingDirectory || "/workspace", ".codex-home")).trim();

  if (!EXEC_MODE_VALUES.has(execMode)) {
    throw createProviderError("PROVIDER_CONFIG", "Invalid CODEX_EXEC_MODE. Allowed: online, oss.");
  }
  if (execMode === "oss" && !LOCAL_PROVIDER_VALUES.has(localProvider)) {
    throw createProviderError("PROVIDER_CONFIG", "Invalid CODEX_OSS_LOCAL_PROVIDER. Allowed: ollama, lmstudio.");
  }

  return {
    enabled,
    model,
    execMode,
    localProvider,
    timeoutMs: Math.max(1, Number(timeoutMs) || 60000),
    transientRetries,
    transientBackoffMs,
    workingDirectory: workingDirectory || "/app",
    codexPath: codexPath || defaultCodexCliPath(),
    codexHome: codexHome || path.join(workingDirectory || "/workspace", ".codex-home")
  };
}

function buildCodexCommand(prompt, settings) {
  const args = [
    "exec",
    "--json",
    "--sandbox", "workspace-write",
    "--config", 'approval_policy="never"',
    "--skip-git-repo-check",
    "--cd", settings.workingDirectory,
    "-m", settings.model,
    prompt
  ];
  if (settings.execMode === "oss") {
    args.splice(1, 0, "--oss", "--local-provider", settings.localProvider);
  }
  return {
    cmd: settings.codexPath,
    args
  };
}

function shellQuote(value) {
  const s = String(value == null ? "" : value);
  if (!s) return "''";
  if (/^[A-Za-z0-9_./:@-]+$/.test(s)) return s;
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function buildCommandPreview(command, prompt) {
  const args = Array.isArray(command?.args) ? command.args.slice() : [];
  if (args.length > 0) {
    const chars = String(prompt || "").length;
    args[args.length - 1] = `<prompt:${chars} chars>`;
  }
  return [String(command?.cmd || ""), ...args].map(shellQuote).join(" ").trim();
}

function codexCommandCandidates(settings) {
  const candidates = [];
  const push = (value) => {
    const v = String(value || "").trim();
    if (!v) return;
    if (!candidates.includes(v)) candidates.push(v);
  };
  push(settings.codexPath);
  push(defaultCodexCliPath());
  push("codex");
  return candidates;
}

function parseCodexEvents(lines) {
  let outputText = "";
  let usage = null;
  let parsedEvents = 0;

  for (const line of lines || []) {
    const raw = String(line || "").trim();
    if (!raw) continue;
    let ev;
    try {
      ev = JSON.parse(raw);
    } catch {
      continue;
    }
    if (!ev || typeof ev !== "object" || typeof ev.type !== "string") continue;
    parsedEvents += 1;

    if (ev.type === "item.completed" && ev.item?.type === "agent_message" && typeof ev.item?.text === "string") {
      outputText = ev.item.text;
      continue;
    }
    if (ev.type === "turn.completed" && ev.usage && typeof ev.usage === "object") {
      usage = ev.usage;
      continue;
    }
    if (ev.type === "turn.failed") {
      const msg = ev.error?.message || "Codex turn failed";
      throw createProviderError("PROVIDER_EXEC", `Codex turn failed: ${String(msg)}`);
    }
    if (ev.type === "error") {
      const msg = ev.message || "Codex stream error";
      throw createProviderError("PROVIDER_EXEC", `Codex stream error: ${String(msg)}`);
    }
  }

  return { outputText: String(outputText || ""), usage, parsedEvents };
}

const CODEX_NOISE_PATTERNS = [
  /codex_core::rollout::list: state db missing rollout path/i,
  /codex_core::state_db: state db record_discrepancy/i
];

function isKnownCodexNoiseLine(line) {
  const s = String(line || "").trim();
  if (!s) return false;
  return CODEX_NOISE_PATTERNS.some((p) => p.test(s));
}

function stripKnownCodexNoise(text) {
  const raw = String(text || "");
  if (!raw) return "";
  const kept = raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !isKnownCodexNoiseLine(l));
  return kept.join("\n").trim();
}

function extractCodexFailureDetail(proc) {
  const lines = Array.isArray(proc?.stdoutLines) ? proc.stdoutLines : [];
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const raw = String(lines[i] || "").trim();
    if (!raw) continue;
    try {
      const ev = JSON.parse(raw);
      if (ev?.type === "turn.failed" && ev?.error?.message) return String(ev.error.message);
      if (ev?.type === "error" && ev?.message) return String(ev.message);
    } catch {
      // not JSONL event, ignore
    }
  }
  const stderr = stripKnownCodexNoise(proc?.stderrText || "");
  if (stderr) return stderr;
  const stdoutTail = stripKnownCodexNoise(lines.slice(-6).join("\n"));
  return stdoutTail || "no error output";
}

function isTransientExecFailure(detail) {
  const d = String(detail || "").toLowerCase();
  if (!d) return false;
  return (
    d.includes("stream disconnected before completion") ||
    d.includes("error sending request for url") ||
    d.includes("connection reset by peer") ||
    d.includes("timed out")
  );
}

function readCodexAuthMode(codexHome) {
  const home = String(codexHome || "").trim();
  if (!home) return null;
  const authPath = path.join(home, ".codex", "auth.json");
  try {
    const raw = fs.readFileSync(authPath, "utf8");
    const parsed = JSON.parse(raw);
    const mode = String(parsed?.auth_mode || "").trim().toLowerCase();
    return mode || null;
  } catch {
    return null;
  }
}

function backoffDelayMs(baseMs, attemptIndex) {
  const n = Math.max(0, Number(baseMs) || 0);
  if (n <= 0) return 0;
  const pow = Math.min(6, Math.max(0, Number(attemptIndex) || 0));
  return n * (2 ** pow);
}

async function sleep(ms) {
  const waitMs = Math.max(0, Number(ms) || 0);
  if (!waitMs) return;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
}

async function runCommand(command, timeoutMs) {
  const codexHome = String(command?.codexHome || "").trim();
  const xdgConfig = codexHome ? path.join(codexHome, ".config") : "";
  const xdgState = codexHome ? path.join(codexHome, ".local", "state") : "";
  const xdgData = codexHome ? path.join(codexHome, ".local", "share") : "";
  if (codexHome) {
    fs.mkdirSync(codexHome, { recursive: true });
    fs.mkdirSync(xdgConfig, { recursive: true });
    fs.mkdirSync(xdgState, { recursive: true });
    fs.mkdirSync(xdgData, { recursive: true });
  }

  const authMode = readCodexAuthMode(codexHome);
  const cmdEnv = {
    ...process.env,
    ...(codexHome ? { HOME: codexHome } : {}),
    ...(xdgConfig ? { XDG_CONFIG_HOME: xdgConfig } : {}),
    ...(xdgState ? { XDG_STATE_HOME: xdgState } : {}),
    ...(xdgData ? { XDG_DATA_HOME: xdgData } : {})
  };
  if (authMode === "chatgpt") {
    delete cmdEnv.OPENAI_BASE_URL;
    delete cmdEnv.OPENAI_API_KEY;
  }

  const spawnOpts = {
    env: cmdEnv
  };
  if (process.platform !== "win32" && typeof process.getuid === "function" && process.getuid() === 0) {
    const runUid = Number(process.env.CODEX_RUN_UID || 1000);
    const runGid = Number(process.env.CODEX_RUN_GID || 1000);
    if (Number.isInteger(runUid) && runUid >= 0) spawnOpts.uid = runUid;
    if (Number.isInteger(runGid) && runGid >= 0) spawnOpts.gid = runGid;
  }

  return await new Promise((resolve, reject) => {
    let stdoutRl = null;
    let timeout = null;
    const stdoutLines = [];
    let stderrText = "";
    let timedOut = false;

    let child;
    try {
      child = spawn(command.cmd, command.args, {
        ...spawnOpts
      });
    } catch (e) {
      reject(e);
      return;
    }

    child.on("error", (e) => {
      if (timeout) clearTimeout(timeout);
      reject(e);
    });

    if (child.stdout) {
      stdoutRl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
      stdoutRl.on("line", (line) => {
        stdoutLines.push(line);
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderrText += String(chunk || "");
      });
    }

    timeout = setTimeout(() => {
      timedOut = true;
      try { child.kill("SIGKILL"); } catch {}
    }, timeoutMs);

    child.on("close", (code, signal) => {
      if (timeout) clearTimeout(timeout);
      if (stdoutRl) stdoutRl.close();
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        stdoutLines,
        stderrText,
        timedOut,
        authMode
      });
    });
  });
}

async function runCodexOssChat(input, options = {}) {
  const settings = options.settings || codexOssSettings();
  if (!settings.enabled) {
    throw createProviderError("PROVIDER_DISABLED", "Codex provider disabled. Set CODEX_OSS_ENABLED=1.");
  }
  if (!settings.model) {
    throw createProviderError("PROVIDER_CONFIG", "Codex model missing. Set CODEX_OSS_MODEL.");
  }

  const prompt = normalizeCodexInput(input || {});
  const run = options.runCommand || runCommand;
  const sleepFn = options.sleep || sleep;

  let proc = null;
  let command = null;
  let commandPreview = null;
  let lastErr = null;
  const attempted = [];
  const candidates = codexCommandCandidates(settings);
  for (const cmd of candidates) {
    command = buildCodexCommand(prompt, { ...settings, codexPath: cmd });
    command.codexHome = settings.codexHome;
    commandPreview = buildCommandPreview(command, prompt);
    attempted.push(command.cmd);
    try {
      proc = await run(command, settings.timeoutMs);
      break;
    } catch (e) {
      if (e && e.code === "ENOENT") {
        lastErr = e;
        continue;
      }
      throw toProviderError(e, "PROVIDER_EXEC", "Codex command failed");
    }
  }

  if (!proc) {
    if (lastErr && lastErr.code === "ENOENT") {
      throw createProviderError(
        "PROVIDER_NOT_FOUND",
        `Codex CLI not found (tried: ${attempted.join(", ")}). Install @openai/codex or set CODEX_CLI_PATH.`,
        { attempted_commands: attempted }
      );
    }
    throw createProviderError("PROVIDER_EXEC", "Codex command failed before execution.");
  }

  if (proc.timedOut) {
    throw createProviderError("PROVIDER_TIMEOUT", `Codex command timed out after ${settings.timeoutMs}ms.`);
  }
  let transientRetryCount = 0;
  if (proc.code !== 0) {
    let detail = extractCodexFailureDetail(proc);
    while (proc.code !== 0 && isTransientExecFailure(detail) && transientRetryCount < settings.transientRetries) {
      transientRetryCount += 1;
      await sleepFn(backoffDelayMs(settings.transientBackoffMs, transientRetryCount - 1));
      let retryProc;
      try {
        retryProc = await run(command, settings.timeoutMs);
      } catch (e) {
        throw toProviderError(e, "PROVIDER_EXEC", "Codex command retry failed");
      }
      if (retryProc.timedOut) {
        throw createProviderError("PROVIDER_TIMEOUT", `Codex command timed out after ${settings.timeoutMs}ms.`);
      }
      proc = retryProc;
      detail = extractCodexFailureDetail(proc);
    }
  }

  if (proc.code !== 0) {
    const detail = extractCodexFailureDetail(proc);
    throw createProviderError("PROVIDER_EXEC", `Codex command failed (exit ${proc.code}): ${detail}`, {
      exit_code: proc.code,
      command_preview: commandPreview,
      codex_home: settings.codexHome,
      transient_retries: transientRetryCount,
      auth_mode: proc.authMode || readCodexAuthMode(settings.codexHome)
    });
  }

  const parsed = parseCodexEvents(proc.stdoutLines || []);
  if (!parsed.outputText.trim()) {
    throw createProviderError("PROVIDER_RESPONSE", "Codex returned no final agent message.");
  }

  return {
    provider: settings.execMode === "oss" ? "codex-oss" : "codex-cli",
    local_provider: settings.execMode === "oss" ? settings.localProvider : null,
    model: settings.model,
    command_preview: commandPreview,
    codex_home: settings.codexHome,
    transient_retries: transientRetryCount,
    auth_mode: proc.authMode || readCodexAuthMode(settings.codexHome),
    output_text: parsed.outputText,
    usage: parsed.usage,
    raw_events_count: (proc.stdoutLines || []).length
  };
}

module.exports = {
  LOCAL_PROVIDER_VALUES,
  resolveWorkingDirectory,
  isTransientExecFailure,
  readCodexAuthMode,
  stripKnownCodexNoise,
  backoffDelayMs,
  extractCodexFailureDetail,
  buildCommandPreview,
  normalizeCodexInput,
  codexOssSettings,
  buildCodexCommand,
  parseCodexEvents,
  runCommand,
  runCodexOssChat
};
