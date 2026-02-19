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

test("jobs API validates handler-specific risky inputs at create time", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const enableToolExec = await requestJson(api.baseUrl, "/v1/job-types/tool.exec", {
      method: "PATCH",
      body: { enabled: true }
    });
    assert.equal(enableToolExec.status, 200, enableToolExec.text);

    const badToolExec = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tool.exec", input: { args: ["status"] } }
    });
    assert.equal(badToolExec.status, 400, badToolExec.text);
    assert.equal(badToolExec.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badToolExec.json?.error?.message || ""), /tool\.exec requires input\.command/);

    const aliasToolExec = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tool.exec", input: { cmd: "echo hi" } }
    });
    assert.equal(aliasToolExec.status, 200, aliasToolExec.text);
    assert.equal(aliasToolExec.json?.ok, true);

    const badFetchProto = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "data.fetch", input: { url: "http://example.com/" } }
    });
    assert.equal(badFetchProto.status, 400, badFetchProto.text);
    assert.equal(badFetchProto.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badFetchProto.json?.error?.message || ""), /must use https/);

    const badFileRead = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "data.file_read", input: {} }
    });
    assert.equal(badFileRead.status, 400, badFileRead.text);
    assert.equal(badFileRead.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badFileRead.json?.error?.message || ""), /data\.file_read requires input\.path/);

    const goodFileRead = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "data.file_read", input: { path: "README.md", max_bytes: 1024 } }
    });
    assert.equal(goodFileRead.status, 201, goodFileRead.text);

    const badDependsOn = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "data.file_read", input: { path: "README.md", depends_on: "abc" } }
    });
    assert.equal(badDependsOn.status, 400, badDependsOn.text);
    assert.equal(badDependsOn.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badDependsOn.json?.error?.message || ""), /depends_on must be an array/i);

    const goodDependsOn = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "data.file_read", input: { path: "README.md", depends_on: ["dep-a", "dep-b"] } }
    });
    assert.equal(goodDependsOn.status, 201, goodDependsOn.text);

    const badFileSearch = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tools.file_search", input: { path: "." } }
    });
    assert.equal(badFileSearch.status, 400, badFileSearch.text);
    assert.equal(badFileSearch.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badFileSearch.json?.error?.message || ""), /tools\.file_search requires input\.query/);

    const goodFileSearch = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tools.file_search", input: { query: "README", path: ".", max_results: 5 } }
    });
    assert.equal(goodFileSearch.status, 201, goodFileSearch.text);

    const badFindInFiles = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tools.find_in_files", input: { path: "." } }
    });
    assert.equal(badFindInFiles.status, 400, badFindInFiles.text);
    assert.equal(badFindInFiles.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badFindInFiles.json?.error?.message || ""), /tools\.find_in_files requires input\.query/);

    const goodFindInFiles = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tools.find_in_files", input: { query: "README", path: ".", max_results: 5 } }
    });
    assert.equal(goodFindInFiles.status, 201, goodFindInFiles.text);

    const badWorkflowRun = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "workflow.run", input: { vars: { query: "README" } } }
    });
    assert.equal(badWorkflowRun.status, 400, badWorkflowRun.text);
    assert.equal(badWorkflowRun.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badWorkflowRun.json?.error?.message || ""), /workflow\.run requires input\.workflow/);

    const goodWorkflowRun = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "workflow.run", input: { workflow: "find_readme", vars: { query: "README" } } }
    });
    assert.equal(goodWorkflowRun.status, 201, goodWorkflowRun.text);

    const enableWebSearch = await requestJson(api.baseUrl, "/v1/job-types/tools.web_search", {
      method: "PATCH",
      body: { enabled: true }
    });
    assert.equal(enableWebSearch.status, 200, enableWebSearch.text);

    const badWebSearch = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tools.web_search", input: { max_results: 3 } }
    });
    assert.equal(badWebSearch.status, 400, badWebSearch.text);
    assert.equal(badWebSearch.json?.error?.code, "VALIDATION_ERROR");
    assert.match(String(badWebSearch.json?.error?.message || ""), /tools\.web_search requires input\.query/);

    const goodWebSearch = await requestJson(api.baseUrl, "/v1/jobs", {
      method: "POST",
      body: { type: "tools.web_search", input: { query: "nodejs", max_results: 3 } }
    });
    assert.equal(goodWebSearch.status, 201, goodWebSearch.text);
  } finally {
    await api.stop();
  }
});

test("job manager submit-intent normalizes and creates chained jobs", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi();
  try {
    const out = await requestJson(api.baseUrl, "/v1/jobs/submit-intent", {
      method: "POST",
      body: {
        user_text: "etsi readme",
        jobs: [
          { type: "tools.file_search", input: { path: "." }, tags: ["chat"] }
        ],
        options: { inject_tool_docs: true, repair: true }
      }
    });
    assert.equal(out.status, 201, out.text);
    assert.equal(out.json?.ok, true);
    assert.ok(Array.isArray(out.json?.created_jobs), out.text);
    assert.ok(out.json.created_jobs.length >= 2, out.text);
    assert.ok(out.json.created_jobs.some((x) => x?.kind === "tool_doc"), out.text);
    assert.ok(out.json.created_jobs.some((x) => x?.kind === "intent"), out.text);

    const intent = out.json.created_jobs.find((x) => x?.kind === "intent")?.job || null;
    assert.equal(intent?.type, "tools.file_search");
    assert.equal(typeof intent?.input?.query, "string");
    assert.ok(String(intent.input.query).length >= 1);
    assert.ok(Array.isArray(intent?.input?.depends_on));
    assert.ok(intent.input.depends_on.length >= 1);
  } finally {
    await api.stop();
  }
});
