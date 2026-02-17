const fs = require("fs");
const path = require("path");

function isRepoRoot(dir) {
  return fs.existsSync(path.join(dir, "docker-compose.yml"));
}

function findProjectRoot(startDir = process.cwd()) {
  let cur = path.resolve(startDir);
  for (;;) {
    if (isRepoRoot(cur)) return cur;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

function requireProjectRoot(startDir = process.cwd()) {
  const root = findProjectRoot(startDir);
  if (!root) {
    const err = new Error("Could not find project root (missing docker-compose.yml in parent path).");
    err.exitCode = 2;
    throw err;
  }
  return root;
}

module.exports = { findProjectRoot, requireProjectRoot };
