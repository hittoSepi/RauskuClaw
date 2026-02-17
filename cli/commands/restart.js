const { parseStartArgs, runStart } = require("./start");
const { runStop } = require("./stop");

function printJson(obj) {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`);
}

function withoutJson(args) {
  return (args || []).filter((a) => a !== "--json");
}

async function runRestart(ctx, args) {
  const opts = parseStartArgs(args);
  const childArgs = opts.json ? [...withoutJson(args), "--quiet"] : withoutJson(args);
  const stopCode = await runStop(ctx, childArgs);
  if (stopCode !== 0) {
    if (opts.json) printJson({ ok: false, command: "restart", phase: "stop" });
    return stopCode;
  }
  const startCode = await runStart(ctx, childArgs);
  if (opts.json && startCode === 0) {
    printJson({
      ok: true,
      command: "restart",
      api_url: "http://127.0.0.1:3001",
      ui_url: "http://127.0.0.1:3002"
    });
  }
  return startCode;
}

module.exports = { runRestart };
