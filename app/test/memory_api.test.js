const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const http = require("node:http");
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
    srv.once("error", (err) => {
      if (String(err?.code || "") === "EPERM" || String(err?.code || "") === "EACCES") resolve(false);
      else resolve(false);
    });
    srv.listen(0, "127.0.0.1", () => {
      srv.close(() => resolve(true));
    });
  });
}

function resolveVectorExtensionPath() {
  const candidates = [
    path.join(APP_DIR, "node_modules/@sqliteai/sqlite-vector-linux-x86_64/vector.so"),
    path.join(APP_DIR, "node_modules/@sqliteai/sqlite-vector-linux-arm64/vector.so"),
    path.join(APP_DIR, "node_modules/@sqliteai/sqlite-vector-darwin-arm64/vector.dylib"),
    path.join(APP_DIR, "node_modules/@sqliteai/sqlite-vector-darwin-x86_64/vector.dylib")
  ];

  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return "";
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
  const tmpDir = mkTempDir("rauskuclaw-memory-api-test-");
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
    if (child.exitCode != null) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      return;
    }
    child.kill("SIGTERM");
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 2000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
    if (!exited && child.exitCode == null) child.kill("SIGKILL");
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { baseUrl, stop, getLogs: () => logs };
}

async function startMockOllama() {
  const calls = [];
  const port = await getFreePort();

  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/api/embed") {
      let body = "";
      req.on("data", (c) => { body += String(c); });
      req.on("end", () => {
        calls.push(body);
        res.statusCode = 200;
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ embedding: [0.01, 0.02, 0.03] }));
      });
      return;
    }
    res.statusCode = 404;
    res.end("not found");
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    stop: async () => {
      await new Promise((resolve) => server.close(() => resolve()));
    }
  };
}

test("memory CRUD keeps expired rows hidden by default and searchable with include_expired", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }
  const api = await startApi({ MEMORY_VECTOR_ENABLED: "0" });
  try {
    const created = await requestJson(api.baseUrl, "/v1/memory", {
      method: "POST",
      body: {
        scope: "m4.ttl",
        key: "k1",
        value: { text: "hello" },
        tags: ["m4", "ttl"],
        ttl_sec: 1
      }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json?.ok, true);
    assert.equal(created.json?.memory?.embedding_status, "pending");

    const memoryId = created.json?.memory?.id;
    assert.equal(typeof memoryId, "string");
    assert.ok(memoryId.length > 10);

    const immediate = await requestJson(api.baseUrl, `/v1/memory/${memoryId}`);
    assert.equal(immediate.status, 200, immediate.text);

    await sleep(1200);

    const getExpired = await requestJson(api.baseUrl, `/v1/memory/${memoryId}`);
    assert.equal(getExpired.status, 404, getExpired.text);
    assert.equal(getExpired.json?.error?.code, "NOT_FOUND");

    const listDefault = await requestJson(api.baseUrl, "/v1/memory?scope=m4.ttl");
    assert.equal(listDefault.status, 200, listDefault.text);
    assert.equal(listDefault.json?.count, 0);

    const listExpired = await requestJson(api.baseUrl, "/v1/memory?scope=m4.ttl&include_expired=1");
    assert.equal(listExpired.status, 200, listExpired.text);
    assert.equal(listExpired.json?.count, 1);

    const searchDisabled = await requestJson(api.baseUrl, "/v1/memory/search", {
      method: "POST",
      body: { scope: "m4.ttl", query: "hello" }
    });
    assert.equal(searchDisabled.status, 503, searchDisabled.text);
    assert.equal(searchDisabled.json?.error?.code, "VECTOR_NOT_ENABLED");
  } finally {
    await api.stop();
  }
});

test("memory reset endpoint requires confirm and supports scope filter", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }
  const api = await startApi({ MEMORY_VECTOR_ENABLED: "0" });
  try {
    const create = async (scope, key) => {
      const out = await requestJson(api.baseUrl, "/v1/memory", {
        method: "POST",
        body: { scope, key, value: { text: `${scope}:${key}` } }
      });
      assert.equal(out.status, 201, out.text);
    };

    await create("reset.scope.a", "k1");
    await create("reset.scope.a", "k2");
    await create("reset.scope.b", "k1");

    const missingConfirm = await requestJson(api.baseUrl, "/v1/memory/reset", {
      method: "POST",
      body: { scope: "reset.scope.a" }
    });
    assert.equal(missingConfirm.status, 400, missingConfirm.text);
    assert.equal(missingConfirm.json?.error?.code, "VALIDATION_ERROR");

    const scopedReset = await requestJson(api.baseUrl, "/v1/memory/reset", {
      method: "POST",
      body: { confirm: true, scope: "reset.scope.a" }
    });
    assert.equal(scopedReset.status, 200, scopedReset.text);
    assert.equal(scopedReset.json?.ok, true);
    assert.equal(scopedReset.json?.scope, "reset.scope.a");
    assert.equal(scopedReset.json?.deleted_memories, 2);
    assert.equal(scopedReset.json?.remaining_memories, 1);

    const fullReset = await requestJson(api.baseUrl, "/v1/memory/reset", {
      method: "POST",
      body: { confirm: true }
    });
    assert.equal(fullReset.status, 200, fullReset.text);
    assert.equal(fullReset.json?.scope, null);
    assert.equal(fullReset.json?.deleted_memories, 1);
    assert.equal(fullReset.json?.remaining_memories, 0);
  } finally {
    await api.stop();
  }
});

test("memory scopes endpoint aggregates counts by scope", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }
  const api = await startApi({ MEMORY_VECTOR_ENABLED: "0" });
  try {
    const create = async (scope, key, value) => {
      const out = await requestJson(api.baseUrl, "/v1/memory", {
        method: "POST",
        body: { scope, key, value }
      });
      assert.equal(out.status, 201, out.text);
    };

    await create("scope.alpha", "k1", { text: "a1" });
    await create("scope.alpha", "k2", { text: "a2" });
    await create("scope.beta", "k1", { text: "b1" });

    const scopes = await requestJson(api.baseUrl, "/v1/memory/scopes?limit=100");
    assert.equal(scopes.status, 200, scopes.text);
    assert.equal(scopes.json?.ok, true);
    assert.ok(Array.isArray(scopes.json?.scopes));

    const alpha = scopes.json.scopes.find((s) => s.scope === "scope.alpha");
    const beta = scopes.json.scopes.find((s) => s.scope === "scope.beta");
    assert.ok(alpha);
    assert.ok(beta);
    assert.equal(alpha.total_count, 2);
    assert.equal(beta.total_count, 1);
  } finally {
    await api.stop();
  }
});

test("memory search returns unavailable for pending scope and success for empty ready scope when vectors enabled", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }
  const extPath = resolveVectorExtensionPath();
  if (!extPath) {
    t.skip("sqlite-vector native extension not found in node_modules; skipping vector-enabled API test.");
    return;
  }

  const ollama = await startMockOllama();
  const api = await startApi({
    MEMORY_VECTOR_ENABLED: "1",
    SQLITE_VECTOR_EXTENSION_PATH: extPath,
    OLLAMA_BASE_URL: ollama.baseUrl,
    OLLAMA_EMBED_MODEL: "embeddinggemma:300m-qat-q8_0",
    OLLAMA_EMBED_TIMEOUT_MS: "3000"
  });

  try {
    const created = await requestJson(api.baseUrl, "/v1/memory", {
      method: "POST",
      body: {
        scope: "m4.pending",
        key: "doc1",
        value: { text: "pending embed row" },
        tags: ["m4", "pending"]
      }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json?.memory?.embedding_status, "pending");

    const jobs = await requestJson(api.baseUrl, "/v1/jobs?type=system.memory.embed.sync&limit=20");
    assert.equal(jobs.status, 200, jobs.text);
    assert.ok(Number(jobs.json?.count || 0) >= 1);

    const pendingSearch = await requestJson(api.baseUrl, "/v1/memory/search", {
      method: "POST",
      body: { scope: "m4.pending", query: "pending" }
    });
    assert.equal(pendingSearch.status, 503, pendingSearch.text);
    assert.equal(pendingSearch.json?.error?.code, "MEMORY_EMBEDDING_UNAVAILABLE");
    assert.ok(Number(pendingSearch.json?.error?.details?.pending_count || 0) >= 1);

    const emptySearch = await requestJson(api.baseUrl, "/v1/memory/search", {
      method: "POST",
      body: { scope: "m4.empty", query: "anything", top_k: 5 }
    });
    assert.equal(emptySearch.status, 200, emptySearch.text);
    assert.equal(emptySearch.json?.ok, true);
    assert.equal(emptySearch.json?.count, 0);
    assert.deepEqual(emptySearch.json?.matches, []);
    assert.ok(ollama.calls.length >= 1);
  } finally {
    await api.stop();
    await ollama.stop();
  }
});

test("schedule CRUD endpoints support interval and cron cadence", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const api = await startApi({ MEMORY_VECTOR_ENABLED: "0" });
  try {
    const created = await requestJson(api.baseUrl, "/v1/schedules", {
      method: "POST",
      body: {
        name: "test schedule",
        type: "report.generate",
        interval_sec: 60,
        start_in_sec: 0,
        input: { hello: "world" },
        tags: ["m4", "schedule"]
      }
    });
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json?.ok, true);
    assert.equal(created.json?.schedule?.type, "report.generate");
    assert.equal(created.json?.schedule?.enabled, true);
    assert.equal(created.json?.schedule?.interval_sec, 60);
    assert.equal(created.json?.schedule?.cron, null);
    const scheduleId = created.json?.schedule?.id;
    assert.equal(typeof scheduleId, "string");

    const listed = await requestJson(api.baseUrl, "/v1/schedules?enabled=1&limit=50");
    assert.equal(listed.status, 200, listed.text);
    assert.equal(Array.isArray(listed.json?.schedules), true);
    assert.equal(listed.json.schedules.some((s) => s.id === scheduleId), true);

    const patchedCron = await requestJson(api.baseUrl, `/v1/schedules/${scheduleId}`, {
      method: "PATCH",
      body: { enabled: false, cron: "*/5 * * * *" }
    });
    assert.equal(patchedCron.status, 200, patchedCron.text);
    assert.equal(patchedCron.json?.schedule?.enabled, false);
    assert.equal(patchedCron.json?.schedule?.cron, "*/5 * * * *");
    assert.equal(patchedCron.json?.schedule?.interval_sec, null);

    const patchedInterval = await requestJson(api.baseUrl, `/v1/schedules/${scheduleId}`, {
      method: "PATCH",
      body: { interval_sec: 120 }
    });
    assert.equal(patchedInterval.status, 200, patchedInterval.text);
    assert.equal(patchedInterval.json?.schedule?.cron, null);
    assert.equal(patchedInterval.json?.schedule?.interval_sec, 120);

    const single = await requestJson(api.baseUrl, `/v1/schedules/${scheduleId}`);
    assert.equal(single.status, 200, single.text);
    assert.equal(single.json?.schedule?.id, scheduleId);

    const deleted = await requestJson(api.baseUrl, `/v1/schedules/${scheduleId}`, { method: "DELETE" });
    assert.equal(deleted.status, 200, deleted.text);
    assert.equal(deleted.json?.deleted, true);

    const missing = await requestJson(api.baseUrl, `/v1/schedules/${scheduleId}`);
    assert.equal(missing.status, 404, missing.text);
  } finally {
    await api.stop();
  }
});

test("workspace list/upload/view/update/download endpoints work with hidden entries", async (t) => {
  if (!(await canBindTcp())) {
    t.skip("TCP bind not allowed in this test environment.");
    return;
  }

  const wsDir = mkTempDir("rauskuclaw-workspace-test-");
  fs.writeFileSync(path.join(wsDir, ".gitkeep"), "", "utf8");
  fs.mkdirSync(path.join(wsDir, ".codex-home"), { recursive: true });
  fs.writeFileSync(path.join(wsDir, "seed.txt"), "seed", "utf8");

  const api = await startApi({
    MEMORY_VECTOR_ENABLED: "0",
    WORKSPACE_ROOT: wsDir
  });

  try {
    const createDir = await requestJson(api.baseUrl, "/v1/workspace/create", {
      method: "POST",
      body: { path: "notes", kind: "dir" }
    });
    assert.equal(createDir.status, 201, createDir.text);
    assert.equal(createDir.json?.entry?.kind, "dir");

    const createFile = await requestJson(api.baseUrl, "/v1/workspace/create", {
      method: "POST",
      body: { path: "notes/new.txt", kind: "file", content: "new file" }
    });
    assert.equal(createFile.status, 201, createFile.text);
    assert.equal(createFile.json?.entry?.kind, "file");

    const list = await requestJson(api.baseUrl, "/v1/workspace/files?path=.");
    assert.equal(list.status, 200, list.text);
    assert.equal(Array.isArray(list.json?.entries), true);
    assert.equal(list.json.entries.some((e) => e.name === ".gitkeep"), false);
    assert.equal(list.json.entries.some((e) => e.name === ".codex-home"), false);
    assert.equal(list.json.entries.some((e) => e.name === "seed.txt"), true);

    const upload = await requestJson(api.baseUrl, "/v1/workspace/upload", {
      method: "POST",
      body: {
        path: "upload.bin",
        content_base64: Buffer.from("hello upload", "utf8").toString("base64"),
        overwrite: false
      }
    });
    assert.equal(upload.status, 201, upload.text);
    assert.equal(upload.json?.file?.path, "upload.bin");

    const view = await requestJson(api.baseUrl, "/v1/workspace/file?path=upload.bin");
    assert.equal(view.status, 200, view.text);
    assert.equal(view.json?.file?.content, "hello upload");

    const moved = await requestJson(api.baseUrl, "/v1/workspace/move", {
      method: "PATCH",
      body: { from_path: "upload.bin", to_path: "notes/upload-renamed.bin", overwrite: false }
    });
    assert.equal(moved.status, 200, moved.text);
    assert.equal(moved.json?.moved, true);

    const viewMoved = await requestJson(api.baseUrl, "/v1/workspace/file?path=notes/upload-renamed.bin");
    assert.equal(viewMoved.status, 200, viewMoved.text);
    assert.equal(viewMoved.json?.file?.content, "hello upload");

    const update = await requestJson(api.baseUrl, "/v1/workspace/file", {
      method: "PUT",
      body: { path: "notes/upload-renamed.bin", content: "updated content" }
    });
    assert.equal(update.status, 200, update.text);

    const downloadResp = await fetch(`${api.baseUrl}/v1/workspace/download?path=notes/upload-renamed.bin`);
    assert.equal(downloadResp.status, 200);
    const downloaded = Buffer.from(await downloadResp.arrayBuffer()).toString("utf8");
    assert.equal(downloaded, "updated content");

    const del = await requestJson(api.baseUrl, "/v1/workspace/file?path=notes/upload-renamed.bin", {
      method: "DELETE"
    });
    assert.equal(del.status, 200, del.text);
    assert.equal(del.json?.deleted, true);

    const missingAfterDelete = await requestJson(api.baseUrl, "/v1/workspace/file?path=notes/upload-renamed.bin");
    assert.equal(missingAfterDelete.status, 404, missingAfterDelete.text);
  } finally {
    await api.stop();
    fs.rmSync(wsDir, { recursive: true, force: true });
  }
});
