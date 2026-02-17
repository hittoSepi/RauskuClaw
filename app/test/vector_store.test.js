const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  initVectorStore,
  upsertMemoryVector,
  searchMemoryVectors,
  toFloat32Buffer
} = require("../memory/vector_store");

function mkTempExtensionFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-vector-test-"));
  const file = path.join(dir, "vector0.so");
  fs.writeFileSync(file, "stub", "utf8");
  return { dir, file };
}

function makeMockDb(handlers = {}) {
  const calls = [];
  const db = {
    loadExtension(extPath) {
      calls.push({ type: "loadExtension", extPath });
      if (handlers.loadExtension) handlers.loadExtension(extPath);
    },
    prepare(sql) {
      calls.push({ type: "prepare", sql });
      if (handlers.prepare) {
        const custom = handlers.prepare(sql, calls);
        if (custom) return custom;
      }
      return {
        get: () => ({}),
        run: () => ({ changes: 1 }),
        all: () => []
      };
    }
  };
  return { db, calls };
}

test("toFloat32Buffer converts vectors to binary blob", () => {
  const buf = toFloat32Buffer([1, 2, 3]);
  assert.equal(Buffer.isBuffer(buf), true);
  assert.equal(buf.length, 12);
});

test("initVectorStore fails when extension file is missing", () => {
  const { db } = makeMockDb();
  assert.throws(
    () => initVectorStore(db, { enabled: true, sqliteExtensionPath: "/no/such/vector0.so" }),
    (e) => e && e.code === "MEMORY_VECTOR_EXTENSION"
  );
});

test("initVectorStore fails when extension validation query fails", () => {
  const temp = mkTempExtensionFile();
  try {
    const { db } = makeMockDb({
      prepare: (sql) => {
        if (sql.includes("vector_version")) {
          return { get: () => { throw new Error("bad extension"); } };
        }
        if (sql.includes("SELECT dimension")) {
          return { get: () => null };
        }
        return null;
      }
    });

    assert.throws(
      () => initVectorStore(db, { enabled: true, sqliteExtensionPath: temp.file }),
      (e) => e && e.code === "MEMORY_VECTOR_EXTENSION"
    );
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("upsertMemoryVector executes vector init and quantize path", () => {
  const temp = mkTempExtensionFile();
  try {
    const { db, calls } = makeMockDb({
      prepare: (sql) => {
        if (sql.includes("vector_version")) return { get: () => ({ version: "v1" }) };
        if (sql.includes("vector_init")) return { get: () => ({ ok: 1 }) };
        if (sql.includes("INSERT INTO memory_vectors")) return { run: () => ({ changes: 1 }) };
        if (sql.includes("vector_quantize(")) return { get: () => ({ ok: 1 }) };
        if (sql.includes("vector_quantize_preload(")) return { get: () => ({ ok: 1 }) };
        return null;
      }
    });

    const settings = { enabled: true, sqliteExtensionPath: temp.file, searchTopKDefault: 10 };
    initVectorStore(db, settings);
    const out = upsertMemoryVector(db, settings, "mem-1", [0.1, 0.2, 0.3], "embed-model");

    assert.equal(out.dimension, 3);
    assert.equal(calls.some((c) => c.type === "loadExtension"), true);
    assert.equal(calls.some((c) => c.type === "prepare" && c.sql.includes("vector_init")), true);
    assert.equal(calls.some((c) => c.type === "prepare" && c.sql.includes("vector_quantize(")), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});

test("searchMemoryVectors runs vector_full_scan SQL", () => {
  const temp = mkTempExtensionFile();
  try {
    const rows = [{ id: "m1", key: "k", scope: "s", value_json: "{}", tags_json: "[]", created_at: "", updated_at: "", expires_at: null, embedding_status: "ready", embedding_error_json: null, embedded_at: null, vector_model: "embed", vector_dimension: 3, distance: 0.2 }];
    const { db, calls } = makeMockDb({
      prepare: (sql) => {
        if (sql.includes("vector_version")) return { get: () => ({ version: "v1" }) };
        if (sql.includes("vector_init")) return { get: () => ({ ok: 1 }) };
        if (sql.includes("FROM memory_vectors LIMIT 1")) return { get: () => ({ dimension: 3 }) };
        if (sql.includes("FROM vector_full_scan")) return { all: () => rows };
        return null;
      }
    });

    const settings = { enabled: true, sqliteExtensionPath: temp.file, searchTopKDefault: 10 };
    initVectorStore(db, settings);
    const out = searchMemoryVectors(db, settings, {
      scope: "scope-1",
      queryEmbedding: [0.3, 0.4, 0.5],
      topK: 5,
      includeExpired: false
    });

    assert.equal(Array.isArray(out), true);
    assert.equal(out.length, 1);
    assert.equal(calls.some((c) => c.type === "prepare" && c.sql.includes("vector_full_scan")), true);
  } finally {
    fs.rmSync(temp.dir, { recursive: true, force: true });
  }
});
