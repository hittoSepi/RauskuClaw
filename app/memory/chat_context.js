const { createMemoryError } = require("./errors");
const { embedText } = require("./ollama_embed");
const { searchMemoryVectors } = require("./vector_store");

const MEMORY_SCOPE_RE = /^[a-z0-9._:-]{2,80}$/i;

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function truncateText(text, maxLen = 400) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)}...`;
}

function deriveQueryFromInput(input) {
  const prompt = String(input?.prompt || "").trim();
  if (prompt) return prompt;

  const messages = Array.isArray(input?.messages) ? input.messages : [];
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    const role = String(m?.role || "").trim().toLowerCase();
    const content = String(m?.content || "").trim();
    if (!content) continue;
    if (role === "user") return content;
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const content = String(messages[i]?.content || "").trim();
    if (content) return content;
  }
  return "";
}

function parseTopK(topKRaw, settings) {
  const max = Math.max(1, Number(settings?.searchTopKMax) || 100);
  const fallbackDefault = Math.max(1, Math.min(max, Number(settings?.searchTopKDefault) || 10));
  if (topKRaw == null || String(topKRaw).trim() === "") {
    return fallbackDefault;
  }
  const topK = Number(topKRaw);
  if (!Number.isInteger(topK) || topK < 1 || topK > max) {
    throw createMemoryError("MEMORY_CONTEXT_INPUT", `'memory.top_k' must be integer 1..${max}.`);
  }
  return topK;
}

function parseRequiredFlag(requiredRaw) {
  if (requiredRaw == null) return false;
  if (typeof requiredRaw === "boolean") return requiredRaw;
  throw createMemoryError("MEMORY_CONTEXT_INPUT", "'memory.required' must be boolean.");
}

function parseChatMemoryRequest(input, settings) {
  const inObj = input && typeof input === "object" ? input : {};
  const raw = inObj.memory;
  if (raw == null) return null;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw createMemoryError("MEMORY_CONTEXT_INPUT", "'memory' must be an object.");
  }

  const scope = String(raw.scope || "").trim();
  if (!scope || !MEMORY_SCOPE_RE.test(scope)) {
    throw createMemoryError("MEMORY_CONTEXT_INPUT", "'memory.scope' must match ^[a-z0-9._:-]{2,80}$");
  }

  const required = parseRequiredFlag(raw.required);
  const query = String(raw.query || "").trim() || deriveQueryFromInput(inObj);
  if (!query) {
    throw createMemoryError(
      "MEMORY_CONTEXT_INPUT",
      "'memory.query' is required when prompt/messages are empty."
    );
  }

  const topKRaw = Object.prototype.hasOwnProperty.call(raw, "top_k") ? raw.top_k : raw.topK;
  const topK = parseTopK(topKRaw, settings);

  return {
    scope,
    query,
    topK,
    required
  };
}

function readScopeAvailability(db, scope) {
  const row = db.prepare(`
    SELECT
      COUNT(*) AS total_count,
      SUM(CASE WHEN m.embedding_status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
      SUM(CASE WHEN m.embedding_status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
      SUM(CASE WHEN mv.memory_id IS NULL THEN 1 ELSE 0 END) AS missing_vector_count
    FROM memories m
    LEFT JOIN memory_vectors mv ON mv.memory_id = m.id
    WHERE m.scope = ?
      AND (m.expires_at IS NULL OR m.expires_at > ?)
  `).get(scope, nowIso());

  return {
    totalCount: Number(row?.total_count || 0),
    pendingCount: Number(row?.pending_count || 0),
    failedCount: Number(row?.failed_count || 0),
    missingVectorCount: Number(row?.missing_vector_count || 0)
  };
}

function readScopeRecentRows(db, { scope, query, limit }) {
  const now = nowIso();
  const q = String(query || "").trim().toLowerCase();
  const words = Array.from(new Set(
    q
      .split(/\s+/)
      .map((w) => w.replace(/[^a-z0-9._:-]/gi, "").trim())
      .filter((w) => w.length >= 3)
      .slice(0, 8)
  ));

  const rows = db.prepare(`
    SELECT
      m.id,
      m.scope,
      m.key,
      m.value_json,
      m.tags_json,
      m.created_at,
      m.updated_at,
      m.embedding_status
    FROM memories m
    WHERE m.scope = ?
      AND (m.expires_at IS NULL OR m.expires_at > ?)
    ORDER BY m.updated_at DESC
    LIMIT ?
  `).all(scope, now, Math.max(1, Number(limit) || 10));

  const scoreRow = (row) => {
    const key = String(row?.key || "").toLowerCase();
    const value = String(row?.value_json || "").toLowerCase();
    if (!words.length) return 0;
    let score = 0;
    for (const w of words) {
      if (key.includes(w)) score += 2;
      if (value.includes(w)) score += 1;
    }
    return score;
  };

  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, score: scoreRow(row) }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return String(b.row?.updated_at || "").localeCompare(String(a.row?.updated_at || ""));
    })
    .map((x) => x.row);
}

function rowToContextMatch(row) {
  const distance = Number(row?.distance);
  const safeDistance = Number.isFinite(distance) ? distance : null;
  const score = safeDistance == null ? null : Number((1 / (1 + safeDistance)).toFixed(6));
  const value = safeJsonParse(row?.value_json);
  const tags = safeJsonParse(row?.tags_json);
  return {
    id: row?.id || null,
    key: row?.key || null,
    scope: row?.scope || null,
    score,
    distance: safeDistance,
    value,
    tags: Array.isArray(tags) ? tags : [],
    updated_at: row?.updated_at || null,
    created_at: row?.created_at || null,
    embedded_at: row?.embedded_at || null,
    embedding_status: row?.embedding_status || null
  };
}

function resolveRowRecencyTs(row) {
  const candidates = [
    row?.updated_at,
    row?.created_at,
    row?.embedded_at
  ];
  for (const c of candidates) {
    const ts = Date.parse(String(c || ""));
    if (Number.isFinite(ts)) return ts;
  }
  return Number.NaN;
}

function compareRowsByRecencyDesc(a, b) {
  const aTs = resolveRowRecencyTs(a);
  const bTs = resolveRowRecencyTs(b);
  const aValid = Number.isFinite(aTs);
  const bValid = Number.isFinite(bTs);
  if (aValid && bValid && aTs !== bTs) return bTs - aTs;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  const aDist = Number(a?.distance);
  const bDist = Number(b?.distance);
  const aDistValid = Number.isFinite(aDist);
  const bDistValid = Number.isFinite(bDist);
  if (aDistValid && bDistValid && aDist !== bDist) return aDist - bDist;
  if (aDistValid && !bDistValid) return -1;
  if (!aDistValid && bDistValid) return 1;
  return String(a?.id || "").localeCompare(String(b?.id || ""));
}

function buildContextInstruction(context) {
  const lines = [
    "Retrieved memory context. Use this only as supporting context.",
    `scope=${context.request.scope}`,
    `query=${context.request.query}`,
    `top_k=${context.request.topK}`,
    `matches=${context.matches.length}`
  ];

  context.matches.forEach((match, idx) => {
    lines.push(
      `[${idx + 1}] key=${match.key || "-"} score=${match.score == null ? "n/a" : match.score} updated_at=${match.updated_at || "n/a"}`
    );
    if (Array.isArray(match.tags) && match.tags.length > 0) {
      lines.push(`    tags=${truncateText(JSON.stringify(match.tags), 220)}`);
    }
    lines.push(`    value=${truncateText(JSON.stringify(match.value), 520)}`);
  });

  return lines.join("\n");
}

async function buildChatMemoryContext({ db, settings, request, embed = embedText, search = searchMemoryVectors }) {
  if (!settings?.enabled) {
    throw createMemoryError(
      "MEMORY_CONTEXT_UNAVAILABLE",
      "Memory context unavailable because vector search is disabled.",
      { reason: "VECTOR_NOT_ENABLED" }
    );
  }

  const availability = readScopeAvailability(db, request.scope);

  let embedded;
  try {
    embedded = await embed(request.query, { settings });
  } catch (e) {
    throw createMemoryError(
      "MEMORY_CONTEXT_UNAVAILABLE",
      "Memory context unavailable because query embedding failed.",
      {
        reason: e?.code || "MEMORY_EMBEDDING_UNAVAILABLE",
        details: e?.details || null
      },
      e
    );
  }

  let rows;
  try {
    rows = search(db, settings, {
      scope: request.scope,
      queryEmbedding: embedded.embedding,
      topK: request.topK,
      includeExpired: false
    });
  } catch (e) {
    throw createMemoryError(
      "MEMORY_CONTEXT_UNAVAILABLE",
      "Memory context unavailable because vector search failed.",
      {
        reason: e?.code || "MEMORY_VECTOR_SEARCH_FAILED",
        details: e?.details || null
      },
      e
    );
  }

  const vectorRows = Array.isArray(rows) ? rows : [];
  const recentRows = readScopeRecentRows(db, {
    scope: request.scope,
    query: request.query,
    limit: Math.max(request.topK * 3, 20)
  });
  const seen = new Set();
  const mergedRows = [];
  for (const row of vectorRows) {
    const id = String(row?.id || "").trim();
    if (id) seen.add(id);
    mergedRows.push(row);
  }
  for (const row of recentRows) {
    if (mergedRows.length >= request.topK) break;
    const id = String(row?.id || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    mergedRows.push(row);
  }
  const prioritizedRows = mergedRows.sort(compareRowsByRecencyDesc);
  const matches = prioritizedRows.slice(0, request.topK).map(rowToContextMatch);
  const context = {
    request,
    embeddingModel: embedded?.model || null,
    matches,
    availability
  };
  context.instruction = buildContextInstruction(context);
  return context;
}

function injectChatMemoryContext(input, context) {
  const source = input && typeof input === "object" ? input : {};
  const out = { ...source };
  delete out.memory;

  const instruction = String(context?.instruction || "").trim();
  if (!instruction) return out;

  if (Array.isArray(source.messages) && source.messages.length > 0) {
    const existing = source.messages.map((m) => ({
      role: String(m?.role || "user"),
      content: String(m?.content || "")
    }));
    out.messages = [{ role: "system", content: instruction }, ...existing];
    return out;
  }

  const system = String(source.system || "").trim();
  out.system = system ? `${system}\n\n${instruction}` : instruction;
  return out;
}

module.exports = {
  MEMORY_SCOPE_RE,
  deriveQueryFromInput,
  parseChatMemoryRequest,
  readScopeAvailability,
  buildContextInstruction,
  buildChatMemoryContext,
  injectChatMemoryContext
};
