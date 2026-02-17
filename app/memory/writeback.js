const crypto = require("crypto");
const { createMemoryError } = require("./errors");

const MEMORY_SCOPE_RE = /^[a-z0-9._:-]{2,80}$/i;
const MEMORY_KEY_RE = /^[a-z0-9._:-]{2,120}$/i;

function nowIso() {
  return new Date().toISOString();
}

function parseRequiredFlag(raw) {
  if (raw == null) return false;
  if (typeof raw === "boolean") return raw;
  throw createMemoryError("MEMORY_WRITE_INPUT", "'memory_write.required' must be boolean.");
}

function parseOptionalTtlSec(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 31_536_000) {
    throw createMemoryError("MEMORY_WRITE_INPUT", "'memory_write.ttl_sec' must be integer 1..31536000.");
  }
  return n;
}

function parseTags(raw) {
  if (raw == null) return [];
  if (!Array.isArray(raw)) {
    throw createMemoryError("MEMORY_WRITE_INPUT", "'memory_write.tags' must be an array.");
  }
  return raw.slice(0, 50).map((x) => String(x));
}

function parseChatMemoryWriteRequest(input, jobId) {
  const inObj = input && typeof input === "object" ? input : {};
  const raw = inObj.memory_write;
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw createMemoryError("MEMORY_WRITE_INPUT", "'memory_write' must be an object.");
  }

  const scope = String(raw.scope || "").trim();
  if (!scope || !MEMORY_SCOPE_RE.test(scope)) {
    throw createMemoryError("MEMORY_WRITE_INPUT", "'memory_write.scope' must match ^[a-z0-9._:-]{2,80}$");
  }

  const keyDefault = `chat.reply.${String(jobId || "").trim() || "latest"}`;
  const key = String(raw.key || keyDefault).trim();
  if (!MEMORY_KEY_RE.test(key)) {
    throw createMemoryError("MEMORY_WRITE_INPUT", "'memory_write.key' must match ^[a-z0-9._:-]{2,120}$");
  }

  return {
    scope,
    key,
    required: parseRequiredFlag(raw.required),
    ttlSec: parseOptionalTtlSec(raw.ttl_sec),
    tags: parseTags(raw.tags)
  };
}

function normalizeOutputText(providerOutput) {
  const text = String(providerOutput?.output_text || "").trim();
  if (!text) {
    throw createMemoryError(
      "MEMORY_WRITE_UNAVAILABLE",
      "Memory write-back unavailable because provider output text is empty.",
      { reason: "EMPTY_PROVIDER_OUTPUT" }
    );
  }
  return text;
}

function applyChatMemoryWriteback({ db, settings, request, providerOutput, job, enqueueInternalJob }) {
  if (!request) return null;

  const now = nowIso();
  const expiresAt = request.ttlSec ? new Date(Date.now() + request.ttlSec * 1000).toISOString() : null;
  const memoryId = crypto.randomUUID();
  const outputText = normalizeOutputText(providerOutput);
  const value = {
    text: outputText,
    source: {
      job_id: String(job?.id || ""),
      job_type: String(job?.type || ""),
      provider: String(providerOutput?.provider || ""),
      model: String(providerOutput?.model || ""),
      at: now
    }
  };

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
    request.scope,
    request.key,
    JSON.stringify(value),
    JSON.stringify(request.tags),
    now,
    now,
    expiresAt
  );

  const row = db.prepare(`
    SELECT id, scope, key
    FROM memories
    WHERE scope = ? AND key = ?
  `).get(request.scope, request.key);

  let embeddingQueued = false;
  if (settings?.enabled && row?.id) {
    try {
      enqueueInternalJob(
        settings.embedQueueType,
        { memory_id: row.id },
        { priority: 9, timeoutSec: 60, maxAttempts: 3, tags: ["memory", "embedding"] }
      );
      embeddingQueued = true;
    } catch (e) {
      throw createMemoryError(
        "MEMORY_WRITE_UNAVAILABLE",
        "Memory write-back saved row, but embedding queue failed.",
        {
          reason: "MEMORY_EMBED_QUEUE_FAILED",
          memory_id: row.id,
          queue_type: settings.embedQueueType,
          error: String(e?.message || e)
        },
        e
      );
    }
  }

  return {
    memory_id: row?.id || null,
    scope: request.scope,
    key: request.key,
    embedding_queued: embeddingQueued
  };
}

module.exports = {
  parseChatMemoryWriteRequest,
  applyChatMemoryWriteback
};
