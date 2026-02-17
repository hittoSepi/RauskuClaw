const { error, info, warn } = require("../lib/output");

const SERVICE_MAP = {
  api: "rauskuclaw-api",
  worker: "rauskuclaw-worker",
  ui: "rauskuclaw-ui"
};

function mapService(name) {
  return SERVICE_MAP[String(name || "").toLowerCase()] || null;
}

function parseLogsArgs(args) {
  const opts = { target: null, tail: "200", follow: false, security: false, since: null, json: false };
  if (!args.length) {
    const err = new Error("Usage: rauskuclaw logs <api|worker|ui> [--tail N] [--follow] [--since 10m] [--security]");
    err.exitCode = 2;
    throw err;
  }
  opts.target = args[0];
  for (let i = 1; i < args.length; i += 1) {
    const a = args[i];
    if (a === "--follow" || a === "-f") {
      opts.follow = true;
      continue;
    }
    if (a === "--tail") {
      const n = args[i + 1];
      if (!n || !/^\d+$/.test(n)) {
        const err = new Error("Invalid --tail value");
        err.exitCode = 2;
        throw err;
      }
      opts.tail = n;
      i += 1;
      continue;
    }
    if (a === "--since") {
      const v = args[i + 1];
      if (!v || !/^[0-9]+[smhd]?$/.test(v)) {
        const err = new Error("Invalid --since value (examples: 10m, 2h, 1d, 300)");
        err.exitCode = 2;
        throw err;
      }
      opts.since = v;
      i += 1;
      continue;
    }
    if (a === "--security") {
      opts.security = true;
      continue;
    }
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    const err = new Error(`Unknown option for logs: ${a}`);
    err.exitCode = 2;
    throw err;
  }
  if (opts.follow && opts.security) {
    const err = new Error("`--follow` cannot be used with `--security`.");
    err.exitCode = 2;
    throw err;
  }
  if (opts.json && !opts.security) {
    const err = new Error("`--json` is supported only with `--security` for logs.");
    err.exitCode = 2;
    throw err;
  }
  return opts;
}

function analyzeSecurityLines(text) {
  const lines = String(text || "").split(/\r?\n/).filter(Boolean);
  const categories = {
    dotfiles: /\/\.env|\/\.git|\/\.secrets|\/\.env\.vault/i,
    aws: /\.aws\/credentials/i,
    terraform: /terraform\.tfvars|terraform\.tfstate/i,
    viteFs: /\/@fs\//i,
    procEnv: /proc\/self\/environ/i
  };

  const counts = {};
  const matched = [];
  for (const line of lines) {
    let hit = false;
    for (const [name, pattern] of Object.entries(categories)) {
      if (pattern.test(line)) {
        counts[name] = (counts[name] || 0) + 1;
        hit = true;
      }
    }
    if (hit) matched.push(line);
  }
  return { totalLines: lines.length, matchedLines: matched.length, counts, matched };
}

async function runLogs(ctx, args) {
  const opts = parseLogsArgs(args);
  const container = mapService(opts.target);
  if (!container) {
    const err = new Error("Unknown logs target. Use one of: api, worker, ui.");
    err.exitCode = 2;
    throw err;
  }
  const cmdArgs = ["logs", "--tail", opts.tail];
  if (opts.since) cmdArgs.push("--since", opts.since);
  cmdArgs.push(container);
  if (opts.follow) cmdArgs.splice(1, 0, "-f");
  const r = await ctx.exec("docker", cmdArgs, {
    cwd: ctx.repoRoot,
    capture: opts.security,
    quiet: opts.json
  });
  if (r.code !== 0) {
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        command: "logs",
        target: opts.target,
        error: "docker_logs_failed"
      }, null, 2)}\n`);
      return 1;
    }
    error(`Failed to read logs for ${opts.target}.`);
    return 1;
  }
  if (opts.security) {
    const analysis = analyzeSecurityLines(r.stdout || "");
    if (opts.json) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        command: "logs",
        target: opts.target,
        mode: "security",
        since: opts.since,
        tail: Number(opts.tail),
        analysis: {
          total_lines: analysis.totalLines,
          matched_lines: analysis.matchedLines,
          counts: analysis.counts,
          samples: analysis.matched.slice(0, 20)
        }
      }, null, 2)}\n`);
      return 0;
    }
    info(`Security scan for ${opts.target}: ${analysis.matchedLines} suspicious lines (from ${analysis.totalLines} log lines)`);
    if (analysis.matchedLines === 0) {
      info("No suspicious probe patterns found in current log window.");
      return 0;
    }
    for (const [k, v] of Object.entries(analysis.counts)) {
      warn(`  ${k}: ${v}`);
    }
    info("Sample hits:");
    for (const line of analysis.matched.slice(0, 20)) {
      process.stdout.write(`${line}\n`);
    }
    if (analysis.matched.length > 20) {
      warn(`  ... ${analysis.matched.length - 20} additional matching lines omitted`);
    }
  }
  return 0;
}

module.exports = { runLogs, mapService, parseLogsArgs, analyzeSecurityLines };
