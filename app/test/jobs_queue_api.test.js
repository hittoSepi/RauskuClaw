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
  const tmpDir = mkTempDir("rauskuclaw-jobs-queue-api-test-");
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

test("jobs API stores queue and supports queue filter", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const a = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "report.generate", queue: "alpha", input: { source: "q-test-a" } }
    });
    assert.equal(a.status, 201, a.text);
    assert.equal(a.json?.job?.queue, "alpha");

    const b = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "report.generate", queue: "beta", input: { source: "q-test-b" } }
    });
    assert.equal(b.status, 201, b.text);
    assert.equal(b.json?.job?.queue, "beta");

    const filtered = await requestJson(api.baseUrl, "/v1/jobs?queue=alpha&limit=20");
    assert.equal(filtered.status, 200, filtered.text);
    assert.equal(filtered.json?.count, 1);
    assert.equal(filtered.json?.jobs?.[0]?.id, a.json?.job?.id);
    assert.equal(filtered.json?.jobs?.[0]?.queue, "alpha");
  } finally {
    await api.stop();
  }
});

test("idempotency key conflicts when queue differs", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const idem = { "Idempotency-Key": "queue-idem-test" };
    const baseBody = {
      type: "report.generate",
      input: { source: "queue-idem" },
      priority: 5,
      timeout_sec: 30,
      max_attempts: 1
    };

    const first = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: idem,
      body: { ...baseBody, queue: "alpha" }
    });
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json?.job?.queue, "alpha");

    const same = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: idem,
      body: { ...baseBody, queue: "alpha" }
    });
    assert.equal(same.status, 200, same.text);
    assert.equal(same.json?.job?.id, first.json?.job?.id);

    const changedQueue = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: idem,
      body: { ...baseBody, queue: "beta" }
    });
    assert.equal(changedQueue.status, 409, changedQueue.text);
    assert.equal(changedQueue.json?.error?.code, "IDEMPOTENCY_KEY_REUSE_MISMATCH");
  } finally {
    await api.stop();
  }
});
