const { requireProjectRoot } = require("./lib/paths");
const { runCommand } = require("./lib/exec");
const { error } = require("./lib/output");
const { runHelp } = require("./commands/help");
const { runVersion } = require("./commands/version");
const { runSetup } = require("./commands/setup");
const { runStart } = require("./commands/start");
const { runStop } = require("./commands/stop");
const { runRestart } = require("./commands/restart");
const { runStatus } = require("./commands/status");
const { runLogs } = require("./commands/logs");
const { runSmoke } = require("./commands/smoke");
const { runConfig } = require("./commands/config");
const { runDoctor } = require("./commands/doctor");
const { runCodex } = require("./commands/codex");
const { runMemory } = require("./commands/memory");
const { runAuth } = require("./commands/auth");
const { renderHeader } = require("./lib/ui");

function parseArgv(argv) {
  const args = Array.isArray(argv) ? argv.slice() : [];
  const command = args.shift() || "help";
  return { command, args };
}

function createContext(startDir = process.cwd(), execFn = runCommand) {
  return {
    repoRoot: requireProjectRoot(startDir),
    exec: execFn
  };
}

async function runCli(argv, { startDir = process.cwd(), execFn = runCommand } = {}) {
  const { command, args } = parseArgv(argv);
  const normalizedCommand = (command === "--help" || command === "-h")
    ? "help"
    : (command === "--version" || command === "-v" ? "version" : command);
  await renderHeader(normalizedCommand);
  if (normalizedCommand === "help") return runHelp();
  if (normalizedCommand === "version") return runVersion();

  let ctx;
  try {
    ctx = createContext(startDir, execFn);
  } catch (e) {
    error(e.message || String(e));
    return Number.isInteger(e.exitCode) ? e.exitCode : 2;
  }

  try {
    if (normalizedCommand === "setup") return runSetup(ctx, args);
    if (normalizedCommand === "start") return runStart(ctx, args);
    if (normalizedCommand === "stop") return runStop(ctx, args);
    if (normalizedCommand === "restart") return runRestart(ctx, args);
    if (normalizedCommand === "status") return runStatus(ctx, args);
    if (normalizedCommand === "logs") return runLogs(ctx, args);
    if (normalizedCommand === "smoke") return runSmoke(ctx, args);
    if (normalizedCommand === "config") return runConfig(ctx, args);
    if (normalizedCommand === "doctor") return runDoctor(ctx, args);
    if (normalizedCommand === "codex") return runCodex(ctx, args);
    if (normalizedCommand === "memory") return runMemory(ctx, args);
    if (normalizedCommand === "auth") return runAuth(ctx, args);

    error(`Unknown command: ${normalizedCommand}`);
    runHelp();
    return 2;
  } catch (e) {
    error(e.message || String(e));
    return Number.isInteger(e.exitCode) ? e.exitCode : 1;
  }
}

module.exports = { runCli, parseArgv, createContext };
