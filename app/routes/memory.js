const { embedText } = require("../memory/ollama_embed");
const { searchMemoryVectors } = require("../memory/vector_store");
const {
  generateSessionId,
  saveWorkingMemoryState,
  loadWorkingMemoryState,
  clearWorkingMemoryState,
  listRecentWorkingMemorySessions,
  getLatestWorkingMemorySession
} = require("../memory/working_memory");

module.exports = function registerMemoryRoutes(app, deps) {
  const {
    auth,
    db,
    badRequest,
    nowIso,
    rowToMemory,
    parseOptionalInt,
    normalizeMemoryToken,
    escapeSqlLike,
    nowPlusSeconds,
    hasOwn,
    enqueueInternalJob,
    memoryVectorSettings
  } = deps;

  // GET /v1/memory
  app.get("/v1/memory", auth, (req, res) => {
    const scope = req.query.scope ? normalizeMemoryToken(req.query.scope) : "";
    const key = req.query.key ? normalizeMemoryToken(req.query.key) : "";
    const includeExpired = String(req.query.include_expired || "0") === "1";
    const limit = Math.min(parseInt(req.query.limit || "100", 10) || 100, 500);

    const where = [];
    const params = [];
    if (!includeExpired) {
      where.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(nowIso());
    }
    if (scope) {
      where.push("scope = ?");
      params.push(scope);
    }
    if (key) {
      where.push("key = ?");
      params.push(key);
    }

    const sql = `
      SELECT id, scope, key, value_json, tags_json, created_at, updated_at, expires_at, embedding_status, embedding_error_json, embedded_at
      FROM memories
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      ORDER BY updated_at DESC
      LIMIT ?
    `;
    params.push(limit);
    const rows = db.prepare(sql).all(...params);

    res.json({
      ok: true,
      memories: rows.map(rowToMemory),
      count: rows.length
    });
  });

  // POST /v1/memory
  app.post("/v1/memory", auth, (req, res) => {
    const body = req.body ?? {};
    const scope = normalizeMemoryToken(body.scope);
    const key = normalizeMemoryToken(body.key);
    const value = body.value;
    const tagsArr = Array.isArray(body.tags) ? body.tags.slice(0, 50).map(String) : [];
    const ttlSec = parseOptionalInt(body.ttl_sec, { min: 1, max: 31_536_000, field: "ttl_sec" });

    if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
      return badRequest(res, "VALIDATION_ERROR", "'scope' must match ^[a-z0-9._:-]{2,80}$");
    }
    if (!key || !/^[a-z0-9._:-]{2,120}$/i.test(key)) {
      return badRequest(res, "VALIDATION_ERROR", "'key' must match ^[a-z0-9._:-]{2,120}$");
    }
    if (value === undefined) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'value'");
    }

    const now = nowIso();
    const expiresAt = ttlSec ? nowPlusSeconds(ttlSec) : null;
    const memoryId = crypto.randomUUID();

    db.prepare(`
      INSERT INTO memories (
        id, scope, key, value_json, tags_json, created_at, updated_at, expires_at,
        embedding_status, embedding_error_json, embedded_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL)
      ON CONFLICT(scope, key) DO UPDATE SET
        value_json = excluded.value_json,
        tags_json = excluded.tags_json,
        updated_at = excluded.updated_at,
        expires_at = excluded.expires_at,
        embedding_status = 'pending',
        embedding_error_json = NULL,
        embedded_at = NULL
    `).run(
      memoryId,
      scope,
      key,
      JSON.stringify(value),
      JSON.stringify(tagsArr),
      now,
      now,
      expiresAt
    );

    const row = db.prepare(`
      SELECT id, scope, key, value_json, tags_json, created_at, updated_at, expires_at, embedding_status, embedding_error_json, embedded_at
      FROM memories
      WHERE scope = ? AND key = ?
    `).get(scope, key);

    if (memoryVectorSettings.enabled && row?.id) {
      try {
        enqueueInternalJob(
          memoryVectorSettings.embedQueueType,
          { memory_id: row.id },
          { priority: 9, timeoutSec: 60, maxAttempts: 3, tags: ["memory", "embedding"] }
        );
      } catch (e) {
        const ts = nowIso();
        db.prepare(`
          UPDATE memories
          SET embedding_status = 'failed',
              embedding_error_json = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          JSON.stringify({
            code: "MEMORY_EMBED_QUEUE_FAILED",
            message: String(e?.message || e),
            at: ts
          }),
          ts,
          row.id
        );
        return res.status(503).json({
          ok: false,
          error: {
            code: "MEMORY_EMBED_QUEUE_FAILED",
            message: "Memory saved but embedding job enqueue failed.",
            details: { memory_id: row.id, queue_type: memoryVectorSettings.embedQueueType }
          }
        });
      }
    }

    return res.status(201).json({ ok: true, memory: rowToMemory(row) });
  });

  // GET /v1/memory/scopes
  app.get("/v1/memory/scopes", auth, (req, res) => {
    const includeExpired = String(req.query.include_expired || "0") === "1";
    const q = normalizeMemoryToken(req.query.q || "");
    const limit = Math.max(1, Math.min(1000, parseInt(String(req.query.limit || "200"), 10) || 200));
    const now = nowIso();

    const where = [];
    const params = [];
    if (!includeExpired) {
      where.push("(expires_at IS NULL OR expires_at > ?)");
      params.push(now);
    }
    if (q) {
      where.push("scope LIKE ? ESCAPE '\\'");
      params.push(`%${escapeSqlLike(q)}%`);
    }

    const sql = `
      SELECT
        scope,
        COUNT(*) AS total_count,
        SUM(CASE WHEN embedding_status = 'ready' THEN 1 ELSE 0 END) AS ready_count,
        SUM(CASE WHEN embedding_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN embedding_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        MAX(updated_at) AS latest_updated_at
      FROM memories
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY scope
      ORDER BY latest_updated_at DESC, scope ASC
      LIMIT ?
    `;
    const rows = db.prepare(sql).all(...params, limit);
    const scopes = rows.map((r) => ({
      scope: r.scope,
      total_count: Number(r.total_count || 0),
      ready_count: Number(r.ready_count || 0),
      pending_count: Number(r.pending_count || 0),
      failed_count: Number(r.failed_count || 0),
      latest_updated_at: r.latest_updated_at || null
    }));
    return res.json({
      ok: true,
      include_expired: includeExpired,
      query: q || "",
      count: scopes.length,
      scopes
    });
  });

  // GET /v1/memory/:id
  app.get("/v1/memory/:id", auth, (req, res) => {
    const row = db.prepare(`
      SELECT id, scope, key, value_json, tags_json, created_at, updated_at, expires_at, embedding_status, embedding_error_json, embedded_at
      FROM memories
      WHERE id = ?
    `).get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Memory not found" } });
    if (row.expires_at && row.expires_at <= nowIso()) {
      return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Memory expired" } });
    }
    return res.json({ ok: true, memory: rowToMemory(row) });
  });

  // DELETE /v1/memory/:id
  app.delete("/v1/memory/:id", auth, (req, res) => {
    const row = db.prepare(`SELECT id FROM memories WHERE id = ?`).get(req.params.id);
    if (!row) return res.status(404).json({ ok: false, error: { code: "NOT_FOUND", message: "Memory not found" } });
    db.prepare(`DELETE FROM memories WHERE id = ?`).run(req.params.id);
    return res.json({ ok: true, id: req.params.id, deleted: true });
  });

  // POST /v1/memory/reset
  app.post("/v1/memory/reset", auth, (req, res) => {
    const body = req.body ?? {};
    const confirm = body.confirm === true;
    if (!confirm) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'confirm=true' for destructive memory reset.");
    }

    let scope = "";
    if (hasOwn(body, "scope")) {
      scope = normalizeMemoryToken(body.scope);
      if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
        return badRequest(res, "VALIDATION_ERROR", "'scope' must match ^[a-z0-9._:-]{2,80}$");
      }
    }

    const byScope = !!scope;
    const where = byScope ? "WHERE scope = ?" : "";
    const params = byScope ? [scope] : [];

    const resetTx = db.transaction(() => {
      const matchedMemories = Number(db.prepare(`SELECT COUNT(*) AS n FROM memories ${where}`).get(...params)?.n || 0);
      const matchedVectors = Number(db.prepare(`
        SELECT COUNT(*) AS n
        FROM memory_vectors
        WHERE memory_id IN (SELECT id FROM memories ${where})
      `).get(...params)?.n || 0);
      const deletedMemories = Number(db.prepare(`DELETE FROM memories ${where}`).run(...params).changes || 0);
      const remainingMemories = Number(db.prepare(`SELECT COUNT(*) AS n FROM memories`).get()?.n || 0);
      const remainingVectors = Number(db.prepare(`SELECT COUNT(*) AS n FROM memory_vectors`).get()?.n || 0);
      return {
        matchedMemories,
        matchedVectors,
        deletedMemories,
        remainingMemories,
        remainingVectors
      };
    });

    const out = resetTx();
    return res.json({
      ok: true,
      scope: byScope ? scope : null,
      deleted_memories: out.deletedMemories,
      deleted_vectors: out.matchedVectors,
      matched_memories: out.matchedMemories,
      remaining_memories: out.remainingMemories,
      remaining_vectors: out.remainingVectors
    });
  });

  // POST /v1/memory/search
  app.post("/v1/memory/search", auth, async (req, res) => {
    if (!memoryVectorSettings.enabled) {
      return res.status(503).json({
        ok: false,
        error: {
          code: "VECTOR_NOT_ENABLED",
          message: "Memory vector search is disabled. Set MEMORY_VECTOR_ENABLED=1."
        }
      });
    }

    const body = req.body ?? {};
    const scope = normalizeMemoryToken(body.scope);
    const query = String(body.query || "").trim();
    const includeExpired = body.include_expired === true || String(body.include_expired || "") === "1";
    let topK;

    if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
      return badRequest(res, "VALIDATION_ERROR", "'scope' must match ^[a-z0-9._:-]{2,80}$");
    }
    if (!query) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'query'");
    }

    try {
      topK = parseOptionalInt(body.top_k, {
        min: 1,
        max: memoryVectorSettings.searchTopKMax,
        field: "top_k"
      }) ?? memoryVectorSettings.searchTopKDefault;
    } catch (e) {
      return badRequest(res, "VALIDATION_ERROR", e.message);
    }

    const availabilitySql = `
      SELECT
        COUNT(*) AS total_count,
        SUM(CASE WHEN m.embedding_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN m.embedding_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
        SUM(CASE WHEN mv.memory_id IS NULL THEN 1 ELSE 0 END) AS missing_vector_count
      FROM memories m
      LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
      WHERE m.scope = ?
        ${includeExpired ? "" : "AND (m.expires_at IS NULL OR m.expires_at > ?)"}
    `;
    const availabilityParams = [scope];
    if (!includeExpired) availabilityParams.push(nowIso());
    const availability = db.prepare(availabilitySql).get(...availabilityParams);

    const pendingCount = Number(availability?.pending_count || 0);
    const failedCount = Number(availability?.failed_count || 0);
    const missingVectorCount = Number(availability?.missing_vector_count || 0);

    if (pendingCount > 0 || failedCount > 0 || missingVectorCount > 0) {
      return res.status(503).json({
        ok: false,
        error: {
          code: "MEMORY_EMBEDDING_UNAVAILABLE",
          message: "Some memories in scope are not embedded yet.",
          details: {
            scope,
            pending_count: pendingCount,
            failed_count: failedCount,
            missing_vector_count: missingVectorCount
          }
        }
      });
    }

    let embedded;
    try {
      embedded = await embedText(query, { settings: memoryVectorSettings });
    } catch (e) {
      return res.status(503).json({
        ok: false,
        error: {
          code: e?.code || "MEMORY_EMBEDDING_UNAVAILABLE",
          message: String(e?.message || e),
          details: e?.details || null
        }
      });
    }

    let rows;
    try {
      rows = searchMemoryVectors(db, memoryVectorSettings, {
        scope,
        queryEmbedding: embedded.embedding,
        topK,
        includeExpired
      });
    } catch (e) {
      return res.status(503).json({
        ok: false,
        error: {
          code: e?.code || "MEMORY_VECTOR_SEARCH_FAILED",
          message: String(e?.message || e),
          details: e?.details || null
        }
      });
    }

    const matches = rows.map((row) => {
      const distance = Number(row.distance);
      const safeDistance = Number.isFinite(distance) ? distance : null;
      const score = safeDistance == null ? null : Number((1 / (1 + safeDistance)).toFixed(6));
      return {
        memory: rowToMemory(row),
        score,
        distance: safeDistance
      };
    });

    return res.json({
      ok: true,
      matches,
      count: matches.length
    });
  });

  // Working Memory API endpoints

  // GET /v1/working-memory
  app.get("/v1/working-memory", auth, (req, res) => {
    const sessionId = String(req.query.session_id || "").trim();
    const limit = Math.max(1, Math.min(100, parseInt(String(req.query.limit || "10"), 10) || 10));

    if (sessionId) {
      const state = loadWorkingMemoryState(db, sessionId);
      if (!state) {
        return res.status(404).json({
          ok: false,
          error: { code: "NOT_FOUND", message: "Working memory session not found" }
        });
      }
      return res.json({ ok: true, state });
    }

    const sessions = listRecentWorkingMemorySessions(db, limit);
    return res.json({
      ok: true,
      sessions,
      count: sessions.length
    });
  });

  // GET /v1/working-memory/latest
  app.get("/v1/working-memory/latest", auth, (req, res) => {
    const state = getLatestWorkingMemorySession(db);
    if (!state) {
      return res.json({
        ok: true,
        state: null,
        message: "No active working memory session found"
      });
    }
    return res.json({ ok: true, state });
  });

  // POST /v1/working-memory
  app.post("/v1/working-memory", auth, (req, res) => {
    const body = req.body ?? {};
    const sessionId = String(body.session_id || generateSessionId()).trim();
    const state = body.state && typeof body.state === "object" ? body.state : {};
    const ttlSec = parseOptionalInt(body.ttl_sec, { min: 60, max: 7 * 24 * 3600, field: "ttl_sec" });

    if (!sessionId || !/^session\.[a-z0-9._-]+$/i.test(sessionId)) {
      return badRequest(res, "VALIDATION_ERROR", "'session_id' must match pattern session.xxx");
    }

    try {
      const result = saveWorkingMemoryState(db, sessionId, state, ttlSec || undefined);
      const saved = loadWorkingMemoryState(db, sessionId);
      return res.status(201).json({
        ok: true,
        session_id: result.session_id,
        updated_at: result.updated_at,
        state: saved
      });
    } catch (e) {
      return res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: String(e?.message || e) }
      });
    }
  });

  // DELETE /v1/working-memory
  app.delete("/v1/working-memory", auth, (req, res) => {
    const sessionId = String(req.query.session_id || "").trim();
    if (!sessionId) {
      return badRequest(res, "VALIDATION_ERROR", "Missing 'session_id' query parameter");
    }

    const result = clearWorkingMemoryState(db, sessionId);
    return res.json({
      ok: true,
      session_id: sessionId,
      deleted_entries: result.deleted
    });
  });
};
