const { error } = require("../lib/output");
const fs = require("fs");
const path = require("path");

function parseCodexArgs(args) {
  const argv = Array.isArray(args) ? args.slice() : [];
  const sub = String(argv.shift() || "").trim().toLowerCase();
  if (!sub) {
    const err = new Error("Missing codex subcommand. Allowed: login, logout, exec");
    err.exitCode = 2;
    throw err;
  }
  if (sub !== "login" && sub !== "logout" && sub !== "exec") {
    const err = new Error(`Unknown codex subcommand: ${sub}. Allowed: login, logout, exec`);
    err.exitCode = 2;
    throw err;
  }
  if (sub === "exec" && argv.length === 0) {
    const err = new Error("codex exec requires arguments. Example: rauskuclaw codex exec -m gpt-5.3-codex \"hello\"");
    err.exitCode = 2;
    throw err;
  }
  return { sub, passthrough: argv };
}

async function runCodex(ctx, args) {
  const parsed = parseCodexArgs(args);

  const sharedHome = path.join(ctx.repoRoot, "workspace", ".codex-home");
  const xdgConfig = path.join(sharedHome, ".config");
  const xdgState = path.join(sharedHome, ".local", "state");
  const xdgData = path.join(sharedHome, ".local", "share");
  fs.mkdirSync(xdgConfig, { recursive: true });
  fs.mkdirSync(xdgState, { recursive: true });
  fs.mkdirSync(xdgData, { recursive: true });

  let cmdArgs;
  if (parsed.sub === "login") cmdArgs = ["login", ...parsed.passthrough];
  else if (parsed.sub === "logout") cmdArgs = ["logout", ...parsed.passthrough];
  else cmdArgs = ["exec", ...parsed.passthrough];

  const r = await ctx.exec("codex", cmdArgs, {
    cwd: ctx.repoRoot,
    env: {
      HOME: sharedHome,
      XDG_CONFIG_HOME: xdgConfig,
      XDG_STATE_HOME: xdgState,
      XDG_DATA_HOME: xdgData
    }
  });
  if (r.code !== 0) {
    error(`codex ${parsed.sub} failed`);
    return 1;
  }
  return 0;
}

module.exports = { runCodex, parseCodexArgs };
