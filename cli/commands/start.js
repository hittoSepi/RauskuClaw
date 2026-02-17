const { info, error } = require("../lib/output");

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function parseStartArgs(args) {
  const options = { build: true, detach: true, json: false, quiet: false };
  for (const a of (args || [])) {
    if (a === "--build") options.build = true;
    else if (a === "--detach") options.detach = true;
    else if (a === "--json") options.json = true;
    else if (a === "--quiet") options.quiet = true;
    else {
      const err = new Error(`Unknown option for start: ${a}`);
      err.exitCode = 2;
      throw err;
    }
  }
  return options;
}

async function runStart(ctx, args) {
  const opts = parseStartArgs(args);
  const cmdArgs = ["compose", "up", "-d", "--build"];
  const r = await ctx.exec("docker", cmdArgs, {
    cwd: ctx.repoRoot,
    capture: opts.json || opts.quiet,
    quiet: opts.json || opts.quiet
  });
  if (r.code !== 0) {
    if (opts.json) printJson({ ok: false, command: "start", error: "docker_compose_up_failed" });
    if (!opts.json && !opts.quiet) error("Failed to start stack. Check Docker daemon and compose logs.");
    return 1;
  }
  if (opts.json) {
    printJson({
      ok: true,
      command: "start",
      api_url: "http://127.0.0.1:3001",
      ui_url: "http://127.0.0.1:3002"
    });
    return 0;
  }
  if (opts.quiet) return 0;
  info("Stack started.");
  info("UI: http://127.0.0.1:3002");
  info("API: http://127.0.0.1:3001");
  return 0;
}

module.exports = { runStart, parseStartArgs };
