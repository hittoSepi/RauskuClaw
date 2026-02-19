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
  const tmpDir = mkTempDir("rauskuclaw-metrics-api-test-");
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

test("runtime metrics endpoint returns counters and queued alert", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi({
    METRICS_ENABLED: "1",
    ALERT_QUEUE_STALLED_SEC: "1",
    ALERT_WINDOW_SEC: "3600"
  });

  try {
    const created = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: {
        type: "report.generate",
        input: { source: "metrics-test" }
      }
    });
    assert.equal(created.status, 201, created.text);

    await sleep(1200);

    const metrics = await requestJson(api.baseUrl, "/v1/runtime/metrics?window_sec=3600");
    assert.equal(metrics.status, 200, metrics.text);
    assert.equal(metrics.json?.ok, true);
    assert.equal(metrics.json?.metrics?.enabled, true);
    assert.ok((metrics.json?.metrics?.counters?.["job.created"] || 0) >= 1);

    const alerts = Array.isArray(metrics.json?.alerts) ? metrics.json.alerts : [];
    const queueAlert = alerts.find((a) => a && a.code === "QUEUE_STALLED");
    assert.ok(queueAlert, metrics.text);
    assert.equal(queueAlert?.severity, "warn");
  } finally {
    await api.stop();
  }
});

test("runtime metrics endpoint is queue-scoped for allowlisted API keys", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi({
    METRICS_ENABLED: "1",
    ALERT_QUEUE_STALLED_SEC: "1",
    ALERT_WINDOW_SEC: "3600",
    API_AUTH_DISABLED: "0",
    API_KEYS_JSON: JSON.stringify([
      { name: "admin", key: "admin-key", role: "admin", sse: true },
      { name: "alpha-reader", key: "alpha-read-key", role: "read", sse: true, queue_allowlist: ["alpha"] }
    ])
  });

  try {
    const createAlpha = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: { "x-api-key": "admin-key" },
      body: { type: "report.generate", queue: "alpha", input: { source: "a" } }
    });
    assert.equal(createAlpha.status, 201, createAlpha.text);

    const createBeta = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: { "x-api-key": "admin-key" },
      body: { type: "report.generate", queue: "beta", input: { source: "b" } }
    });
    assert.equal(createBeta.status, 201, createBeta.text);

    await sleep(1200);

    const scoped = await requestJson(api.baseUrl, "/v1/runtime/metrics?window_sec=3600", {
      headers: { "x-api-key": "alpha-read-key" }
    });
    assert.equal(scoped.status, 200, scoped.text);
    assert.equal(scoped.json?.metrics?.job_status?.queued, 1);
    assert.equal(scoped.json?.metrics?.counters?.["job.created"], 1);
    const scopedAlert = (scoped.json?.alerts || []).find((a) => a?.code === "QUEUE_STALLED");
    assert.ok(scopedAlert, scoped.text);
    assert.equal(scopedAlert?.details?.job_id, createAlpha.json?.job?.id);

    const forbidden = await requestJson(api.baseUrl, "/v1/runtime/metrics?queue=beta", {
      headers: { "x-api-key": "alpha-read-key" }
    });
    assert.equal(forbidden.status, 403, forbidden.text);
    assert.equal(forbidden.json?.error?.code, "FORBIDDEN");
    assert.deepEqual(forbidden.json?.error?.details?.allowed_queues, ["alpha"]);
  } finally {
    await api.stop();
  }
});
