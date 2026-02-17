const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function withTempConfig(content, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rauskuclaw-config-test-"));
  const file = path.join(dir, "config.json");
  fs.writeFileSync(file, content, "utf8");
  try {
    return fn(file);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

function runNodeEval(js, extraEnv = {}) {
  return spawnSync(process.execPath, ["-e", js], {
    cwd: path.resolve(__dirname, ".."),
    env: { ...process.env, ...extraEnv },
    encoding: "utf8"
  });
}

function readOutputFile(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

test("loads valid config file and exposes config values", () => {
  withTempConfig(
    JSON.stringify({ service: { name: "rauskuclaw-test" }, api: { port: 3010 } }),
    (configPath) => {
      const outputPath = path.join(path.dirname(configPath), "out.txt");
      const r = runNodeEval(
        "const fs=require('node:fs'); const c=require('./config'); fs.writeFileSync(process.env.OUTPUT_FILE, String(c.getConfig('service.name','missing')));",
        { RAUSKUCLAW_CONFIG_PATH: configPath, OUTPUT_FILE: outputPath }
      );
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.equal(readOutputFile(outputPath), "rauskuclaw-test");
    }
  );
});

test("env value overrides rauskuclaw.json value", () => {
  withTempConfig(
    JSON.stringify({ api: { port: 3010 } }),
    (configPath) => {
      const outputPath = path.join(path.dirname(configPath), "out.txt");
      const r = runNodeEval(
        "const fs=require('node:fs'); const c=require('./config'); fs.writeFileSync(process.env.OUTPUT_FILE, String(c.envOrConfig('PORT','api.port','fallback')));",
        { RAUSKUCLAW_CONFIG_PATH: configPath, PORT: "3999", OUTPUT_FILE: outputPath }
      );
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.equal(readOutputFile(outputPath), "3999");
    }
  );
});

test("uses config value when env is not set", () => {
  withTempConfig(
    JSON.stringify({ api: { port: 3010 } }),
    (configPath) => {
      const outputPath = path.join(path.dirname(configPath), "out.txt");
      const r = runNodeEval(
        "const fs=require('node:fs'); const c=require('./config'); fs.writeFileSync(process.env.OUTPUT_FILE, String(c.envOrConfig('PORT','api.port','fallback')));",
        { RAUSKUCLAW_CONFIG_PATH: configPath, PORT: "", OUTPUT_FILE: outputPath }
      );
      assert.equal(r.status, 0, r.stderr || r.stdout);
      assert.equal(readOutputFile(outputPath), "3010");
    }
  );
});

test("fails fast on invalid schema", () => {
  withTempConfig(
    JSON.stringify({ api: { port: 70000 } }),
    (configPath) => {
      const outputPath = path.join(path.dirname(configPath), "out.txt");
      const r = runNodeEval(
        "const fs=require('node:fs'); require('./config'); fs.writeFileSync(process.env.OUTPUT_FILE, 'should-not-print');",
        { RAUSKUCLAW_CONFIG_PATH: configPath, OUTPUT_FILE: outputPath }
      );
      assert.notEqual(r.status, 0);
      assert.equal(readOutputFile(outputPath), "");
    }
  );
});
