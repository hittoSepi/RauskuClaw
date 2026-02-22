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
  const tmpDir = mkTempDir("rauskuclaw-agent-tools-api-test-");
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

// ==========================================================================
// Unit Tests: GET /v1/agent-tools (registry)
// ==========================================================================

test("GET /v1/agent-tools returns enabled builtin tools", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const resp = await requestJson(api.baseUrl, "/v1/agent-tools");
    assert.equal(resp.status, 200, resp.text);
    assert.equal(resp.json?.ok, true);
    assert.ok(Array.isArray(resp.json?.tools));
    assert.ok(resp.json.tools.length > 0);

    // Verify structure
    const firstTool = resp.json.tools[0];
    assert.equal(firstTool.type, "function");
    assert.ok(firstTool.function);
    assert.equal(typeof firstTool.function.name, "string");
    assert.equal(typeof firstTool.function.description, "string");
    assert.ok(firstTool.function.parameters);

    // Verify count field
    assert.equal(resp.json.count, resp.json.tools.length);
  } finally {
    await api.stop();
  }
});

test("GET /v1/agent-tools includes data_file_read by default", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const resp = await requestJson(api.baseUrl, "/v1/agent-tools");
    assert.equal(resp.status, 200);

    const toolNames = resp.json?.tools?.map(t => t.function.name) || [];
    assert.ok(toolNames.includes("data_file_read"), "data_file_read should be in default tools");
  } finally {
    await api.stop();
  }
});

test("GET /v1/agent-tools excludes disabled job types", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    // Disable data.file_read job type
    const disable = await requestJson(api.baseUrl, "/v1/job-types/data.file_read", {
      method: "PATCH",
      body: { enabled: false }
    });
    assert.equal(disable.status, 200);

    // Verify it's not in registry
    const resp = await requestJson(api.baseUrl, "/v1/agent-tools");
    assert.equal(resp.status, 200);

    const toolNames = resp.json?.tools?.map(t => t.function.name) || [];
    assert.ok(!toolNames.includes("data_file_read"), "data_file_read should be excluded when disabled");
  } finally {
    await api.stop();
  }
});

// ==========================================================================
// Unit Tests: POST /v1/agent-tools/invoke-batch (validation)
// ==========================================================================

test("POST /v1/agent-tools/invoke-batch validates calls array", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    // Missing calls
    const missingCalls = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {}
    });
    assert.equal(missingCalls.status, 400);
    assert.equal(missingCalls.json?.error?.code, "VALIDATION_ERROR");
    assert.ok(missingCalls.json?.error?.message?.includes("calls"));

    // Empty calls array
    const emptyCalls = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: { calls: [] }
    });
    assert.equal(emptyCalls.status, 400);
    assert.ok(emptyCalls.json?.error?.message?.includes("at least 1"));

    // Too many calls
    const tooManyCalls = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: { calls: Array(21).fill({ call_id: "x", name: "data_file_read", arguments: {} }) }
    });
    assert.equal(tooManyCalls.status, 400);
    assert.ok(tooManyCalls.json?.error?.message?.includes("20"));
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch validates call fields", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    // Missing call_id
    const missingCallId = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: { calls: [{ name: "data_file_read", arguments: {} }] }
    });
    assert.equal(missingCallId.status, 400);
    assert.ok(missingCallId.json?.error?.message?.includes("call_id"));

    // Missing name
    const missingName = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: { calls: [{ call_id: "test", arguments: {} }] }
    });
    assert.equal(missingName.status, 400);
    assert.ok(missingName.json?.error?.message?.includes("name"));

    // Invalid arguments (array instead of object)
    const invalidArgs = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: { calls: [{ call_id: "test", name: "data_file_read", arguments: [] }] }
    });
    assert.equal(invalidArgs.status, 400);
    assert.ok(invalidArgs.json?.error?.message?.includes("arguments"));
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch validates mode and wait_ms", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    // Invalid mode
    const invalidMode = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{ call_id: "test", name: "data_file_read", arguments: {} }],
        mode: "invalid"
      }
    });
    assert.equal(invalidMode.status, 400);
    assert.ok(invalidMode.json?.error?.message?.includes("mode"));

    // Invalid wait_ms (too low)
    const invalidWaitLow = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{ call_id: "test", name: "data_file_read", arguments: {} }],
        wait_ms: 50
      }
    });
    assert.equal(invalidWaitLow.status, 400);
    assert.ok(invalidWaitLow.json?.error?.message?.includes("wait_ms"));

    // Invalid wait_ms (too high)
    const invalidWaitHigh = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{ call_id: "test", name: "data_file_read", arguments: {} }],
        wait_ms: 100000
      }
    });
    assert.equal(invalidWaitHigh.status, 400);
    assert.ok(invalidWaitHigh.json?.error?.message?.includes("wait_ms"));
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch validates queue name", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const invalidQueue = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{ call_id: "test", name: "data_file_read", arguments: {} }],
        queue: "invalid queue name with spaces!"
      }
    });
    assert.equal(invalidQueue.status, 400);
    assert.ok(invalidQueue.json?.error?.message?.includes("queue"));
  } finally {
    await api.stop();
  }
});

// ==========================================================================
// Unit Tests: AuthZ
// ==========================================================================

test("POST /v1/agent-tools/invoke-batch enforces admin role", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-only", key: "read-key", role: "read" }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const forbidden = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      headers: { "x-api-key": "read-key" },
      body: { calls: [{ call_id: "x", name: "data_file_read", arguments: {} }] }
    });
    assert.equal(forbidden.status, 403);
    assert.equal(forbidden.json?.error?.code, "FORBIDDEN");
  } finally {
    await api.stop();
  }
});

test("GET /v1/agent-tools works with read key", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const keys = JSON.stringify([
    { name: "read-only", key: "read-key", role: "read" }
  ]);
  const api = await startApi({ API_KEYS_JSON: keys });
  try {
    const resp = await requestJson(api.baseUrl, "/v1/agent-tools", {
      headers: { "x-api-key": "read-key" }
    });
    assert.equal(resp.status, 200);
    assert.equal(resp.json?.ok, true);
  } finally {
    await api.stop();
  }
});

// ==========================================================================
// Integration Tests: invoke-batch
// ==========================================================================

test("POST /v1/agent-tools/invoke-batch file_read happy path with call_id binding", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    // Create a test file in temp workspace
    const tmpDir = mkTempDir("agent-tools-test-");
    const testFile = path.join(tmpDir, "test.txt");
    fs.writeFileSync(testFile, "Hello, Agent Tools!", "utf8");

    // Note: Using /tmp path which may not work without proper workspace setup
    // This test verifies the API contract more than actual execution
    const invoke = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{
          call_id: "call-proof-binding-123",
          name: "data_file_read",
          arguments: { path: testFile }
        }],
        mode: "sync",
        wait_ms: 5000,
        queue: "default"
      }
    });

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true, force: true });

    // Verify response structure (may fail execution but structure is correct)
    assert.equal(invoke.status, 200, invoke.text);
    assert.equal(invoke.json?.ok, true);

    const result = invoke.json?.results?.[0];
    assert.equal(result.call_id, "call-proof-binding-123");
    assert.equal(result.name, "data_file_read");

    const toolMsg = invoke.json?.tool_messages?.[0];
    assert.equal(toolMsg.tool_call_id, "call-proof-binding-123"); // PROOF OF CALL_ID BINDING
    assert.equal(toolMsg.role, "tool");
    assert.equal(toolMsg.name, "data_file_read");
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch async mode returns immediately", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const invoke = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{
          call_id: "call-async-test",
          name: "data_file_read",
          arguments: { path: "README.md" }
        }],
        mode: "async"
      }
    });

    assert.equal(invoke.status, 200);
    assert.equal(invoke.json?.mode, "async");

    const result = invoke.json?.results?.[0];
    assert.equal(result.call_id, "call-async-test");
    assert.ok(result.job_id); // Should have job_id
    assert.equal(invoke.json?.tool_messages?.length, 0); // No tool messages in async mode
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch unknown tool returns error in results", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const invoke = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{
          call_id: "call-unknown-tool",
          name: "nonexistent_tool",
          arguments: {}
        }],
        mode: "sync",
        wait_ms: 1000
      }
    });

    assert.equal(invoke.status, 200);
    const result = invoke.json?.results?.[0];
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "UNKNOWN_TOOL");

    // Verify tool_messages includes the error
    const toolMsg = invoke.json?.tool_messages?.[0];
    assert.equal(toolMsg.tool_call_id, "call-unknown-tool");
    const content = JSON.parse(toolMsg.content);
    assert.equal(content.ok, false);
    assert.equal(content.error?.code, "UNKNOWN_TOOL");
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch disabled job type returns error", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    // Disable data.file_read
    await requestJson(api.baseUrl, "/v1/job-types/data.file_read", {
      method: "PATCH",
      body: { enabled: false }
    });

    const invoke = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [{
          call_id: "call-disabled",
          name: "data_file_read",
          arguments: { path: "test.txt" }
        }],
        mode: "sync",
        wait_ms: 1000
      }
    });

    assert.equal(invoke.status, 200);
    const result = invoke.json?.results?.[0];
    assert.equal(result.ok, false);
    assert.equal(result.error?.code, "JOB_TYPE_DISABLED");

    // Verify tool_messages includes the error
    const toolMsg = invoke.json?.tool_messages?.[0];
    const content = JSON.parse(toolMsg.content);
    assert.equal(content.ok, false);
    assert.equal(content.error?.code, "JOB_TYPE_DISABLED");
  } finally {
    await api.stop();
  }
});

test("POST /v1/agent-tools/invoke-batch handles multiple calls", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const invoke = await requestJson(api.baseUrl, "/v1/agent-tools/invoke-batch", {
      method: "POST",
      body: {
        calls: [
          { call_id: "call-1", name: "data_file_read", arguments: { path: "README.md" } },
          { call_id: "call-2", name: "tools_file_search", arguments: { query: "test" } },
          { call_id: "call-3", name: "unknown_tool", arguments: {} }
        ],
        mode: "sync",
        wait_ms: 5000
      }
    });

    assert.equal(invoke.status, 200);
    assert.equal(invoke.json?.results?.length, 3);
    assert.equal(invoke.json?.tool_messages?.length, 3);

    // Verify call_id binding for all
    assert.equal(invoke.json.results[0].call_id, "call-1");
    assert.equal(invoke.json.results[1].call_id, "call-2");
    assert.equal(invoke.json.results[2].call_id, "call-3");

    assert.equal(invoke.json.tool_messages[0].tool_call_id, "call-1");
    assert.equal(invoke.json.tool_messages[1].tool_call_id, "call-2");
    assert.equal(invoke.json.tool_messages[2].tool_call_id, "call-3");

    // Third call should fail (unknown tool)
    assert.equal(invoke.json.results[2].ok, false);
    assert.equal(invoke.json.results[2].error?.code, "UNKNOWN_TOOL");
  } finally {
    await api.stop();
  }
});
