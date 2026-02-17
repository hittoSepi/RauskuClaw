const { spawn } = require("child_process");
const { printCommand } = require("./output");

function runCommand(cmd, args, { cwd, capture = false, quiet = false, env = null } = {}) {
  if (!quiet) printCommand(cmd, args, cwd);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      env: { ...process.env, ...(env || {}) }
    });

    let stdout = "";
    let stderr = "";
    if (capture && child.stdout) {
      child.stdout.on("data", (c) => { stdout += String(c || ""); });
    }
    if (capture && child.stderr) {
      child.stderr.on("data", (c) => { stderr += String(c || ""); });
    }

    child.on("error", (err) => reject(err));
    child.on("close", (code, signal) => {
      resolve({
        code: Number.isInteger(code) ? code : 1,
        signal: signal || null,
        stdout,
        stderr
      });
    });
  });
}

module.exports = { runCommand };
