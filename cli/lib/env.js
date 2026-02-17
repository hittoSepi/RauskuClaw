const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseEnvContent(content) {
  const map = {};
  const lines = String(content || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1);
    if (key) map[key] = value;
  }
  return map;
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, "utf8");
  return parseEnvContent(content);
}

function readEnvTemplate(repoRoot) {
  const templatePath = path.join(repoRoot, ".env.example");
  if (!fs.existsSync(templatePath)) return { lines: [], keys: [] };
  const lines = fs.readFileSync(templatePath, "utf8").split(/\r?\n/);
  const keys = [];
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) keys.push(m[1]);
  }
  return { lines, keys };
}

function mergeEnvPreservingUnknown(repoRoot, nextValues) {
  const envPath = path.join(repoRoot, ".env");
  const existingLines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  const output = [];

  for (const rawLine of existingLines) {
    const m = rawLine.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) {
      output.push(rawLine);
      continue;
    }
    const key = m[1];
    if (Object.prototype.hasOwnProperty.call(nextValues, key)) {
      output.push(`${key}=${nextValues[key]}`);
      seen.add(key);
    } else {
      output.push(rawLine);
      seen.add(key);
    }
  }

  const { keys } = readEnvTemplate(repoRoot);
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(nextValues, key) && !seen.has(key)) {
      output.push(`${key}=${nextValues[key]}`);
      seen.add(key);
    }
  }

  for (const [key, value] of Object.entries(nextValues)) {
    if (!seen.has(key)) {
      output.push(`${key}=${value}`);
      seen.add(key);
    }
  }

  const content = output.join("\n").replace(/\n+$/, "") + "\n";
  fs.writeFileSync(envPath, content, "utf8");
  return envPath;
}

function maskSecret(value) {
  const v = String(value || "");
  if (v.length <= 8) return "*".repeat(v.length);
  return `${v.slice(0, 4)}...${v.slice(-4)}`;
}

function generateApiKey() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  parseEnvContent,
  readEnvFile,
  readEnvTemplate,
  mergeEnvPreservingUnknown,
  maskSecret,
  generateApiKey
};
