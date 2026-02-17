const fs = require("fs");
const { createMemoryError } = require("./errors");

const TABLE = "memory_vectors";
const COLUMN = "embedding_blob";
const initStateByDb = new WeakMap();

function nowIso() {
  return new Date().toISOString();
}

function toFloat32Buffer(values) {
  if (!Array.isArray(values) || values.length < 1) {
    throw createMemoryError("MEMORY_VECTOR_INPUT", "Embedding must be a non-empty number array.");
  }
  const arr = values.map((v) => Number(v));
  if (arr.some((n) => !Number.isFinite(n))) {
    throw createMemoryError("MEMORY_VECTOR_INPUT", "Embedding contains non-numeric values.");
  }
  const f32 = new Float32Array(arr);
  return Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength);
}

function getInitState(db) {
  const existing = initStateByDb.get(db);
  if (existing) return existing;
  const created = { extensionLoaded: false, dimension: null };
  initStateByDb.set(db, created);
  return created;
}

function loadExtension(db, extensionPath) {
  const state = getInitState(db);
  if (state.extensionLoaded) return;

  if (!extensionPath) {
    throw createMemoryError("MEMORY_VECTOR_CONFIG", "SQLITE_VECTOR_EXTENSION_PATH is not configured.");
  }
  if (!fs.existsSync(extensionPath)) {
    throw createMemoryError("MEMORY_VECTOR_EXTENSION", `sqlite-vector extension not found at '${extensionPath}'.`);
  }

  try {
    db.loadExtension(extensionPath);
  } catch (e) {
    throw createMemoryError(
      "MEMORY_VECTOR_EXTENSION",
      `Failed to load sqlite-vector extension from '${extensionPath}': ${String(e?.message || e)}`,
      null,
      e
    );
  }

  try {
    db.prepare("SELECT vector_version() AS version").get();
  } catch (e) {
    throw createMemoryError(
      "MEMORY_VECTOR_EXTENSION",
      `sqlite-vector extension loaded but validation query failed: ${String(e?.message || e)}`,
      null,
      e
    );
  }

  state.extensionLoaded = true;
}

function ensureVectorInit(db, dimension) {
  const d = Number(dimension);
  if (!Number.isInteger(d) || d < 1) {
    throw createMemoryError("MEMORY_VECTOR_INPUT", "Vector dimension must be a positive integer.");
  }

  const existing = db.prepare(`SELECT dimension FROM ${TABLE} LIMIT 1`).get();
  if (existing && Number.isInteger(existing.dimension) && existing.dimension > 0 && existing.dimension !== d) {
    throw createMemoryError(
      "MEMORY_VECTOR_DIMENSION",
      `Embedding dimension mismatch. Existing vectors use ${existing.dimension}, got ${d}.`,
      { existing_dimension: existing.dimension, requested_dimension: d }
    );
  }

  const state = getInitState(db);
  if (state.dimension != null && state.dimension !== d) {
    throw createMemoryError(
      "MEMORY_VECTOR_DIMENSION",
      `sqlite-vector initialized with dimension ${state.dimension}, got ${d}.`,
      { existing_dimension: state.dimension, requested_dimension: d }
    );
  }
  if (state.dimension === d) return;

  const options = `dimension=${d},type=FLOAT32,distance=COSINE`;
  try {
    db.prepare("SELECT vector_init(?, ?, ?)").get(TABLE, COLUMN, options);
  } catch (e) {
    const msg = String(e?.message || "").toLowerCase();
    if (!msg.includes("already") && !msg.includes("initialized")) {
      throw createMemoryError(
        "MEMORY_VECTOR_INIT",
        `Failed to initialize sqlite-vector for ${TABLE}.${COLUMN}: ${String(e?.message || e)}`,
        { dimension: d },
        e
      );
    }
  }

  state.dimension = d;
}

function initVectorStore(db, settings) {
  if (!settings?.enabled) return;

  loadExtension(db, settings.sqliteExtensionPath);

  const first = db.prepare(`SELECT dimension FROM ${TABLE} LIMIT 1`).get();
  if (first && Number.isInteger(first.dimension) && first.dimension > 0) {
    ensureVectorInit(db, first.dimension);
  }
}

function reQuantize(db) {
  try {
    db.prepare("SELECT vector_quantize(?, ?)").get(TABLE, COLUMN);
    db.prepare("SELECT vector_quantize_preload(?, ?)").get(TABLE, COLUMN);
  } catch {
    // Quantization is a performance optimization; full_scan still works.
  }
}

function upsertMemoryVector(db, settings, memoryId, embedding, model) {
  if (!settings?.enabled) {
    throw createMemoryError("MEMORY_VECTOR_DISABLED", "Memory vector search is disabled.");
  }

  const arr = Array.isArray(embedding) ? embedding : [];
  const dimension = arr.length;
  loadExtension(db, settings.sqliteExtensionPath);
  ensureVectorInit(db, dimension);
  const blob = toFloat32Buffer(arr);
  const now = nowIso();

  db.prepare(`
    INSERT INTO memory_vectors (memory_id, embedding_blob, dimension, model, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(memory_id) DO UPDATE SET
      embedding_blob = excluded.embedding_blob,
      dimension = excluded.dimension,
      model = excluded.model,
      updated_at = excluded.updated_at
  `).run(memoryId, blob, dimension, model || null, now);

  reQuantize(db);

  return { dimension, updated_at: now };
}

function searchMemoryVectors(db, settings, params) {
  if (!settings?.enabled) {
    throw createMemoryError("MEMORY_VECTOR_DISABLED", "Memory vector search is disabled.");
  }

  const scope = String(params?.scope || "").trim();
  const includeExpired = Boolean(params?.includeExpired);
  const topK = Math.max(1, Number(params?.topK) || settings.searchTopKDefault || 10);
  const embedding = Array.isArray(params?.queryEmbedding) ? params.queryEmbedding : [];
  const dimension = embedding.length;

  loadExtension(db, settings.sqliteExtensionPath);
  ensureVectorInit(db, dimension);

  const jsonQueryVector = JSON.stringify(embedding.map((x) => Number(x)));

  const sql = `
    SELECT
      m.id,
      m.scope,
      m.key,
      m.value_json,
      m.tags_json,
      m.created_at,
      m.updated_at,
      m.expires_at,
      m.embedding_status,
      m.embedding_error_json,
      m.embedded_at,
      mv.model AS vector_model,
      mv.dimension AS vector_dimension,
      v.distance AS distance
    FROM vector_full_scan('${TABLE}', '${COLUMN}', vector_as_f32(?)) AS v
    JOIN memory_vectors mv ON mv.rowid = v.rowid
    JOIN memories m ON m.id = mv.memory_id
    WHERE m.scope = ?
      ${includeExpired ? "" : "AND (m.expires_at IS NULL OR m.expires_at > ?)"}
    ORDER BY v.distance ASC
    LIMIT ?
  `;

  const bind = [jsonQueryVector, scope];
  if (!includeExpired) bind.push(nowIso());
  bind.push(topK);

  return db.prepare(sql).all(...bind);
}

module.exports = {
  initVectorStore,
  upsertMemoryVector,
  searchMemoryVectors,
  toFloat32Buffer,
  ensureVectorInit
};
