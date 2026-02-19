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

test("SSE auth enforces sse flag and supports api_key query parameter", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-no-sse", key: "read-nosse-key", role: "read", sse: false },
    { name: "read-sse", key: "read-sse-key", role: "read", sse: true }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    // authSse runs before job lookup; forbidden key must fail with 403 immediately.
    const noSse = await requestJson(api.baseUrl, "/v1/jobs/missing-job/stream", {
      headers: { "x-api-key": "read-nosse-key" }
    });
    assert.equal(noSse.status, 403, noSse.text);
    assert.equal(noSse.json?.error?.code, "FORBIDDEN");

    // query-based API key is allowed for SSE auth.
    const querySse = await requestJson(api.baseUrl, "/v1/jobs/missing-job/stream?api_key=read-sse-key");
    assert.equal(querySse.status, 404, querySse.text);
    assert.equal(querySse.json?.error?.code, "NOT_FOUND");
  } finally {
    await api.stop();
  }
});

test("runtime providers endpoint returns redacted shape for read keys", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-only", key: "read-key", role: "read" },
    { name: "admin", key: "admin-key", role: "admin" }
  ]);
  const api = await startApi({
    API_KEYS_JSON: keys,
    CODEX_OSS_ENABLED: "1",
    CODEX_EXEC_MODE: "oss",
    CODEX_OSS_LOCAL_PROVIDER: "ollama",
    CODEX_OSS_MODEL: "dummy-codex-model",
    CODEX_CLI_PATH: "/usr/local/bin/codex",
    CODEX_OSS_TIMEOUT_MS: "54321",
    OPENAI_ENABLED: "1",
    OPENAI_MODEL: "gpt-test-model",
    OPENAI_BASE_URL: "https://example.invalid/openai",
    OPENAI_CHAT_COMPLETIONS_PATH: "/api/paas/v4/chat/completions",
    OPENAI_TIMEOUT_MS: "12345"
  });
  try {
    const readView = await requestJson(api.baseUrl, "/v1/runtime/providers", {
      headers: { "x-api-key": "read-key" }
    });
    assert.equal(readView.status, 200, readView.text);
    assert.equal(readView.json?.providers?.codex?.enabled, true);
    assert.equal(readView.json?.providers?.openai?.enabled, true);
    assert.equal(Object.prototype.hasOwnProperty.call(readView.json?.providers?.codex || {}, "model"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readView.json?.providers?.openai || {}, "base_url"), false);

    const adminView = await requestJson(api.baseUrl, "/v1/runtime/providers", {
      headers: { "x-api-key": "admin-key" }
    });
    assert.equal(adminView.status, 200, adminView.text);
    assert.equal(adminView.json?.providers?.codex?.model, "dummy-codex-model");
    assert.equal(adminView.json?.providers?.openai?.base_url, "https://example.invalid/openai");
    assert.equal(adminView.json?.providers?.openai?.chat_completions_path, "/api/paas/v4/chat/completions");
  } finally {
    await api.stop();
  }
});

test("runtime handlers endpoint returns redacted shape for read keys", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-only", key: "read-key", role: "read" },
    { name: "admin", key: "admin-key", role: "admin" }
  ]);
  const api = await startApi({
    API_KEYS_JSON: keys,
    TOOL_EXEC_ENABLED: "1",
    TOOL_EXEC_ALLOWLIST: "git,node",
    TOOL_EXEC_TIMEOUT_MS: "4321",
    DATA_FETCH_ENABLED: "1",
    DATA_FETCH_ALLOWLIST: "api.github.com,example.com",
    DATA_FETCH_TIMEOUT_MS: "2222",
    DATA_FETCH_MAX_BYTES: "12345",
    DEPLOY_TARGET_ALLOWLIST: "staging,prod"
  });
  try {
    const readView = await requestJson(api.baseUrl, "/v1/runtime/handlers", {
      headers: { "x-api-key": "read-key" }
    });
    assert.equal(readView.status, 200, readView.text);
    assert.equal(readView.json?.handlers?.tool_exec?.enabled, true);
    assert.equal(readView.json?.handlers?.data_fetch?.enabled, true);
    assert.equal(Object.prototype.hasOwnProperty.call(readView.json?.handlers?.tool_exec || {}, "allowlist"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(readView.json?.handlers?.data_fetch || {}, "allowlist"), false);

    const adminView = await requestJson(api.baseUrl, "/v1/runtime/handlers", {
      headers: { "x-api-key": "admin-key" }
    });
    assert.equal(adminView.status, 200, adminView.text);
    assert.deepEqual(adminView.json?.handlers?.deploy?.allowed_targets, ["staging", "prod"]);
    assert.deepEqual(adminView.json?.handlers?.tool_exec?.allowlist, ["git", "node"]);
    assert.equal(adminView.json?.handlers?.tool_exec?.timeout_ms, 4321);
    assert.deepEqual(adminView.json?.handlers?.data_fetch?.allowlist, ["api.github.com", "example.com"]);
    assert.equal(adminView.json?.handlers?.data_fetch?.timeout_ms, 2222);
    assert.equal(adminView.json?.handlers?.data_fetch?.max_bytes, 12345);
  } finally {
    await api.stop();
  }
});

test("auth whoami returns effective principal details", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-no-sse", key: "read-key", role: "read", sse: false },
    { name: "admin", key: "admin-key", role: "admin", sse: true, queue_allowlist: ["default", "alpha"] }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const readWho = await requestJson(api.baseUrl, "/v1/auth/whoami", {
      headers: { "x-api-key": "read-key" }
    });
    assert.equal(readWho.status, 200, readWho.text);
    assert.equal(readWho.json?.auth?.name, "read-no-sse");
    assert.equal(readWho.json?.auth?.role, "read");
    assert.equal(readWho.json?.auth?.sse, false);
    assert.equal(readWho.json?.auth?.can_write, false);
    assert.equal(readWho.json?.auth?.queue_allowlist, null);

    const adminWho = await requestJson(api.baseUrl, "/v1/auth/whoami", {
      headers: { "x-api-key": "admin-key" }
    });
    assert.equal(adminWho.status, 200, adminWho.text);
    assert.equal(adminWho.json?.auth?.name, "admin");
    assert.equal(adminWho.json?.auth?.role, "admin");
    assert.equal(adminWho.json?.auth?.sse, true);
    assert.equal(adminWho.json?.auth?.can_write, true);
    assert.deepEqual(adminWho.json?.auth?.queue_allowlist, ["default", "alpha"]);
  } finally {
    await api.stop();
  }
});

test("admin queue_allowlist restricts job creation queue", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "admin-limited", key: "admin-key", role: "admin", queue_allowlist: ["alpha"] }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const allowed = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: { "x-api-key": "admin-key" },
      body: { type: "report.generate", queue: "alpha", input: { source: "queue-ok" } }
    });
    assert.equal(allowed.status, 201, allowed.text);
    assert.equal(allowed.json?.job?.queue, "alpha");

    const blocked = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: { "x-api-key": "admin-key" },
      body: { type: "report.generate", queue: "beta", input: { source: "queue-blocked" } }
    });
    assert.equal(blocked.status, 403, blocked.text);
    assert.equal(blocked.json?.error?.code, "FORBIDDEN");
    assert.deepEqual(blocked.json?.error?.details?.allowed_queues, ["alpha"]);
  } finally {
    await api.stop();
  }
});

test("queue_allowlist scopes job visibility and actions", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "admin-alpha", key: "alpha-key", role: "admin", queue_allowlist: ["alpha"] },
    { name: "admin-full", key: "full-key", role: "admin" }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const alphaJob = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: { "x-api-key": "alpha-key" },
      body: { type: "report.generate", queue: "alpha", input: { source: "alpha" } }
    });
    assert.equal(alphaJob.status, 201, alphaJob.text);
    const alphaId = String(alphaJob.json?.job?.id || "");
    assert.ok(alphaId);

    const betaJob = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      headers: { "x-api-key": "full-key" },
      body: { type: "report.generate", queue: "beta", input: { source: "beta" } }
    });
    assert.equal(betaJob.status, 201, betaJob.text);
    const betaId = String(betaJob.json?.job?.id || "");
    assert.ok(betaId);

    const list = await requestJson(api.baseUrl, "/v1/jobs?limit=20", {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(list.status, 200, list.text);
    const listedIds = (list.json?.jobs || []).map((j) => j.id);
    assert.ok(listedIds.includes(alphaId));
    assert.ok(!listedIds.includes(betaId));

    const ownDetail = await requestJson(api.baseUrl, `/v1/jobs/${alphaId}`, {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(ownDetail.status, 200, ownDetail.text);

    const blockedDetail = await requestJson(api.baseUrl, `/v1/jobs/${betaId}`, {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedDetail.status, 404, blockedDetail.text);

    const blockedLogs = await requestJson(api.baseUrl, `/v1/jobs/${betaId}/logs`, {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedLogs.status, 404, blockedLogs.text);

    const blockedCancel = await requestJson(api.baseUrl, `/v1/jobs/${betaId}/cancel`, {
      method: "POST",
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedCancel.status, 404, blockedCancel.text);

    const blockedQueueFilter = await requestJson(api.baseUrl, "/v1/jobs?queue=beta&limit=20", {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedQueueFilter.status, 403, blockedQueueFilter.text);
    assert.equal(blockedQueueFilter.json?.error?.code, "FORBIDDEN");
    assert.deepEqual(blockedQueueFilter.json?.error?.details?.allowed_queues, ["alpha"]);
  } finally {
    await api.stop();
  }
});

test("queue_allowlist scopes schedule create and visibility", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "admin-alpha", key: "alpha-key", role: "admin", queue_allowlist: ["alpha"] },
    { name: "admin-full", key: "full-key", role: "admin" }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const alphaSchedule = await requestJson(api.baseUrl, "/v1/schedules", {
      method: "POST",
      headers: { "x-api-key": "alpha-key" },
      body: { type: "report.generate", queue: "alpha", interval_sec: 60, input: { source: "alpha" } }
    });
    assert.equal(alphaSchedule.status, 201, alphaSchedule.text);
    const alphaId = String(alphaSchedule.json?.schedule?.id || "");
    assert.ok(alphaId);

    const blockedCreate = await requestJson(api.baseUrl, "/v1/schedules", {
      method: "POST",
      headers: { "x-api-key": "alpha-key" },
      body: { type: "report.generate", queue: "beta", interval_sec: 60, input: { source: "beta" } }
    });
    assert.equal(blockedCreate.status, 403, blockedCreate.text);
    assert.deepEqual(blockedCreate.json?.error?.details?.allowed_queues, ["alpha"]);

    const blockedQueuePatch = await requestJson(api.baseUrl, `/v1/schedules/${alphaId}`, {
      method: "PATCH",
      headers: { "x-api-key": "alpha-key" },
      body: { queue: "beta" }
    });
    assert.equal(blockedQueuePatch.status, 403, blockedQueuePatch.text);
    assert.deepEqual(blockedQueuePatch.json?.error?.details?.allowed_queues, ["alpha"]);

    const betaSchedule = await requestJson(api.baseUrl, "/v1/schedules", {
      method: "POST",
      headers: { "x-api-key": "full-key" },
      body: { type: "report.generate", queue: "beta", interval_sec: 60, input: { source: "beta" } }
    });
    assert.equal(betaSchedule.status, 201, betaSchedule.text);
    const betaId = String(betaSchedule.json?.schedule?.id || "");
    assert.ok(betaId);

    const list = await requestJson(api.baseUrl, "/v1/schedules?limit=50", {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(list.status, 200, list.text);
    const listedIds = (list.json?.schedules || []).map((s) => s.id);
    assert.ok(listedIds.includes(alphaId));
    assert.ok(!listedIds.includes(betaId));

    const blockedFilter = await requestJson(api.baseUrl, "/v1/schedules?queue=beta&limit=50", {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedFilter.status, 403, blockedFilter.text);

    const blockedGet = await requestJson(api.baseUrl, `/v1/schedules/${betaId}`, {
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedGet.status, 404, blockedGet.text);

    const blockedPatch = await requestJson(api.baseUrl, `/v1/schedules/${betaId}`, {
      method: "PATCH",
      headers: { "x-api-key": "alpha-key" },
      body: { enabled: false }
    });
    assert.equal(blockedPatch.status, 404, blockedPatch.text);

    const blockedDelete = await requestJson(api.baseUrl, `/v1/schedules/${betaId}`, {
      method: "DELETE",
      headers: { "x-api-key": "alpha-key" }
    });
    assert.equal(blockedDelete.status, 404, blockedDelete.text);
  } finally {
    await api.stop();
  }
});
