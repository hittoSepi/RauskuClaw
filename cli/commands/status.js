const { info, warn, error } = require("../lib/output");

function parseStatusArgs(args) {
  const opts = { json: false };
  for (const a of args || []) {
    if (a === "--json") {
      opts.json = true;
      continue;
    }
    const err = new Error(`Unknown option for status: ${a}`);
    err.exitCode = 2;
    throw err;
  }
  return opts;
}

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function parseComposePsJson(rawText) {
  const raw = String(rawText || "").trim();
  if (!raw) return { services: [], parseError: null };

  try {
    const parsed = JSON.parse(raw);
    const services = Array.isArray(parsed) ? parsed : [parsed];
    return { services, parseError: null };
  } catch {}

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { services: [], parseError: null };

  const services = [];
  for (let i = 0; i < lines.length; i += 1) {
    try {
      services.push(JSON.parse(lines[i]));
    } catch (e) {
      return {
        services: null,
        parseError: `Invalid JSON on line ${i + 1}: ${e.message || String(e)}`
      };
    }
  }
  return { services, parseError: null };
}

async function runStatus(ctx, args) {
  const opts = parseStatusArgs(args);
  const cmdArgs = ["compose", "ps"];
  if (opts.json) cmdArgs.push("--format", "json");
  const r = await ctx.exec("docker", cmdArgs, {
    cwd: ctx.repoRoot,
    capture: true,
    quiet: opts.json
  });
  if (r.code !== 0) {
    if (opts.json) printJson({ ok: false, error: "docker compose ps failed" });
    if (!opts.json) error("Failed to read docker compose status.");
    return 1;
  }

  if (opts.json) {
    const { services, parseError } = parseComposePsJson(r.stdout);
    const raw = String(r.stdout || "");
    const unhealthyByText = /exited|dead|unhealthy/i.test(raw);
    const unhealthyByJson = Array.isArray(services) && services.some((s) =>
      /exited|dead|unhealthy/i.test(String(s?.State || s?.Status || ""))
    );
    const hasIssues = unhealthyByText || unhealthyByJson;
    printJson({
      ok: !hasIssues && !parseError,
      has_issues: hasIssues,
      parse_error: parseError,
      services,
      raw: parseError ? raw : undefined
    });
    return hasIssues ? 1 : (parseError ? 1 : 0);
  }

  process.stdout.write(r.stdout);
  if (/exited|dead|unhealthy/i.test(String(r.stdout || ""))) {
    warn("Some services are not healthy/running. Try `rauskuclaw logs api` or `rauskuclaw restart`.");
    return 1;
  }
  info("All visible services look up.");
  return 0;
}

module.exports = { runStatus, parseStatusArgs, parseComposePsJson };
