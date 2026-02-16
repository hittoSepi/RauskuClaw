const fs = require("fs");
const path = require("path");
const Ajv = require("ajv");
const schema = require("./config.schema.json");

function getByPath(obj, p) {
  return String(p || "")
    .split(".")
    .filter(Boolean)
    .reduce((acc, key) => (acc == null ? undefined : acc[key]), obj);
}

const ajv = new Ajv({ allErrors: true, strict: true });
const validate = ajv.compile(schema);

function formatAjvErrors(errors) {
  return (errors || [])
    .map((e) => {
      const p = e.instancePath || "/";
      return `${p} ${e.message}`;
    })
    .join("; ");
}

function loadRawConfig() {
  const configPath = process.env.RAUSKUCLAW_CONFIG_PATH
    || path.resolve(__dirname, "../rauskuclaw.json");

  if (!fs.existsSync(configPath)) return {};

  const raw = fs.readFileSync(configPath, "utf8");
  if (!raw.trim()) return {};

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`[config] invalid JSON at ${configPath}: ${String(e?.message || e)}`);
  }

  const ok = validate(parsed);
  if (!ok) {
    const details = formatAjvErrors(validate.errors);
    throw new Error(`[config] schema validation failed for ${configPath}: ${details}`);
  }

  return parsed;
}

function safeLoadRawConfig() {
  try {
    return loadRawConfig();
  } catch (e) {
    console.error(String(e?.message || e));
    // Fail fast: invalid config must not silently fall back.
    process.exit(1);
    return {};
  }
}

const rawConfig = safeLoadRawConfig();

function getConfig(pathExpr, fallback) {
  const v = getByPath(rawConfig, pathExpr);
  return v == null ? fallback : v;
}

function envOrConfig(envName, configPathExpr, fallback) {
  if (process.env[envName] != null && process.env[envName] !== "") return process.env[envName];
  const v = getConfig(configPathExpr, undefined);
  return v == null ? fallback : v;
}

function envIntOrConfig(envName, configPathExpr, fallback) {
  const raw = envOrConfig(envName, configPathExpr, fallback);
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function envBoolOrConfig(envName, configPathExpr, fallback) {
  if (process.env[envName] != null) return process.env[envName] === "1";
  const v = getConfig(configPathExpr, undefined);
  if (typeof v === "boolean") return v;
  return fallback;
}

function splitCsv(s) {
  return String(s || "")
    .split(",")
    .map(x => x.trim())
    .filter(Boolean);
}

module.exports = {
  rawConfig,
  getConfig,
  envOrConfig,
  envIntOrConfig,
  envBoolOrConfig,
  splitCsv
};
