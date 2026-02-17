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

async function requestJson(baseUrl, reqPath, { method = "GET", body, headers = {} } = {}) {
  const reqHeaders = { accept: "application/json", ...headers };
  if (body !== undefined) reqHeaders["content-type"] = "application/json";
  const resp = await fetch(`${baseUrl}${reqPath}`, {
    method,
    headers: reqHeaders,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await resp.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch {}
  return { status: resp.status, text, json };
}

async function startApi(extraEnv = {}) {
  const tmpDir = mkTempDir("rauskuclaw-auth-api-test-");
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
      API_AUTH_DISABLED: "0",
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

  return { baseUrl, stop, getLogs: () => logs };
}

test("legacy API_KEY still authenticates requests", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi({ API_KEY: "legacy-admin-key" });
  try {
    const noKey = await requestJson(api.baseUrl, "/v1/ping");
    assert.equal(noKey.status, 401, noKey.text);
    assert.equal(noKey.json?.error?.code, "UNAUTHORIZED");

    const withKey = await requestJson(api.baseUrl, "/v1/ping", {
      headers: { "x-api-key": "legacy-admin-key" }
    });
    assert.equal(withKey.status, 200, withKey.text);
    assert.equal(withKey.json?.ok, true);
  } finally {
    await api.stop();
  }
});

test("API_KEYS_JSON enforces read vs admin permissions", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-only", key: "read-key", role: "read" },
    { name: "admin", key: "admin-key", role: "admin" }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const listWithRead = await requestJson(api.baseUrl, "/v1/jobs", {
      headers: { "x-api-key": "read-key" }
    });
    assert.equal(listWithRead.status, 200, listWithRead.text);
    assert.equal(listWithRead.json?.ok, true);

    const writeWithRead = await requestJson(api.baseUrl, "/v1/memory", {
      method: "POST",
      headers: { "x-api-key": "read-key" },
      body: {
        scope: "auth.test",
        key: "blocked-write",
        value: { ok: false }
      }
    });
    assert.equal(writeWithRead.status, 403, writeWithRead.text);
    assert.equal(writeWithRead.json?.error?.code, "FORBIDDEN");

    const writeWithAdmin = await requestJson(api.baseUrl, "/v1/memory", {
      method: "POST",
      headers: { "x-api-key": "admin-key" },
      body: {
        scope: "auth.test",
        key: "allowed-write",
        value: { ok: true }
      }
    });
    assert.equal(writeWithAdmin.status, 201, writeWithAdmin.text);
    assert.equal(writeWithAdmin.json?.ok, true);
  } finally {
    await api.stop();
  }
});
