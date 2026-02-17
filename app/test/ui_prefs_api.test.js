const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");

const APP_DIR = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mkTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

async function getFreePort() {
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

async function canBindTcp() {
  return await new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.listen(0, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}

async function requestJson(baseUrl, reqPath, { method = "GET", body } = {}) {
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const resp = await fetch(`${baseUrl}${reqPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: resp.status, text, json };
}

async function startApi(extraEnv = {}) {
  const tmpDir = mkTempDir("rauskuclaw-ui-prefs-api-test-");
  const dbPath = path.join(tmpDir, "test.sqlite");
  const configPath = path.join(tmpDir, "rauskuclaw.json");
  fs.writeFileSync(configPath, "{}", "utf8");
  const port = await getFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, ["server.js"], {
    cwd: APP_DIR,
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      API_AUTH_DISABLED: "1",
      API_KEY: "",
      RAUSKUCLAW_CONFIG_PATH: configPath,
      ...extraEnv
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  let logs = "";
  child.stdout.on("data", (buf) => { logs += String(buf); });
  child.stderr.on("data", (buf) => { logs += String(buf); });

  const startedAt = Date.now();
  let ready = false;
  while (Date.now() - startedAt < 10_000) {
    if (child.exitCode != null) break;
    try {
      const h = await requestJson(baseUrl, "/health");
      if (h.status === 200 && h.json && h.json.ok === true) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  if (!ready) {
    child.kill("SIGKILL");
    throw new Error(`API did not become ready. Logs:\n${logs}`);
  }

  async function stop() {
    if (child.exitCode == null) child.kill("SIGTERM");
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (child.exitCode == null) child.kill("SIGKILL");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { baseUrl, stop };
}

test("ui prefs CRUD persists scope payload in DB", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const initial = await requestJson(api.baseUrl, "/v1/ui-prefs?scope=default");
    assert.equal(initial.status, 200, initial.text);
    assert.deepEqual(initial.json?.prefs || {}, {});

    const save = await requestJson(api.baseUrl, "/v1/ui-prefs?scope=default", {
      method: "PUT",
      body: {
        prefs: {
          devMode: true,
          chatMemoryDefaultEnabled: true,
          suggestedApprovalMode: "smart",
          suggestedAutoAllowTypes: "report.generate,memory.write"
        }
      }
    });
    assert.equal(save.status, 200, save.text);
    assert.equal(save.json?.prefs?.devMode, true);

    const loaded = await requestJson(api.baseUrl, "/v1/ui-prefs?scope=default");
    assert.equal(loaded.status, 200, loaded.text);
    assert.equal(loaded.json?.prefs?.devMode, true);
    assert.equal(loaded.json?.prefs?.suggestedApprovalMode, "smart");

    const invalid = await requestJson(api.baseUrl, "/v1/ui-prefs?scope=default", {
      method: "PUT",
      body: { prefs: ["bad"] }
    });
    assert.equal(invalid.status, 400, invalid.text);
    assert.equal(invalid.json?.error?.code, "VALIDATION_ERROR");
  } finally {
    await api.stop();
  }
});
