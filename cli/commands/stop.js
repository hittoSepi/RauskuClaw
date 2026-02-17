const { error, info } = require("../lib/output");

function parseStopArgs(args) {
  const opts = { json: false, quiet: false };
  for (const a of (args || [])) {
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    if (a === "--quiet") {
      opts.quiet = true;
      continue;
    }
    const err = new Error(`Unknown option for stop: ${a}`);
    err.exitCode = 2;
    throw err;
  }
  return opts;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

async function runStop(ctx, args) {
  const opts = parseStopArgs(args);
  const r = await ctx.exec("docker", ["compose", "down"], {
    cwd: ctx.repoRoot,
    capture: opts.json || opts.quiet,
    quiet: opts.json || opts.quiet
  });
  if (r.code !== 0) {
    if (opts.json) printJson({ ok: false, command: "stop", error: "docker_compose_down_failed" });
    if (!opts.json && !opts.quiet) error("Failed to stop stack.");
    return 1;
  }
  if (opts.json) {
    printJson({ ok: true, command: "stop" });
    return 0;
  }
  if (opts.quiet) return 0;
  info("Stack stopped.");
  return 0;
}

module.exports = { runStop, parseStopArgs };
