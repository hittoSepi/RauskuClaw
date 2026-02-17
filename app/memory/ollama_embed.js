const { getMemoryVectorSettings } = require("./settings");
const { createMemoryError } = require("./errors");

function normalizeEmbeddingResponse(data) {
  if (Array.isArray(data?.embedding)) return data.embedding;
  if (Array.isArray(data?.embeddings) && Array.isArray(data.embeddings[0])) {
    return data.embeddings[0];
  }
  return null;
}

function sanitizeEmbedding(embedding) {
  if (!Array.isArray(embedding) || embedding.length < 1) {
    throw createMemoryError("MEMORY_EMBED_RESPONSE", "Ollama embed response missing embedding array.");
  }
  const out = embedding.map((x) => Number(x));
  if (out.some((n) => !Number.isFinite(n))) {
    throw createMemoryError("MEMORY_EMBED_RESPONSE", "Ollama embed response contained non-numeric values.");
  }
  return out;
}

async function embedText(text, options = {}) {
  const settings = options.settings || getMemoryVectorSettings();
  const fetchImpl = options.fetchImpl || fetch;

  const input = String(text || "").trim();
  if (!input) {
    throw createMemoryError("MEMORY_EMBED_INPUT", "Embedding input text is empty.");
  }

  const ctrl = new AbortController();
  const timeoutMs = Math.max(1, Number(settings.embedTimeoutMs) || 15000);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const resp = await fetchImpl(`${settings.ollamaBaseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: settings.embedModel, input }),
      signal: ctrl.signal
    });

    const textBody = await resp.text();
    let data = null;
    try {
      data = textBody ? JSON.parse(textBody) : null;
    } catch {
      throw createMemoryError("MEMORY_EMBED_RESPONSE", "Ollama embed response was not valid JSON.", {
        status: resp.status
      });
    }

    if (!resp.ok) {
      const message = data?.error || data?.message || textBody || `Ollama HTTP ${resp.status}`;
      throw createMemoryError("MEMORY_EMBED_HTTP", String(message), { status: resp.status });
    }

    const embedding = sanitizeEmbedding(normalizeEmbeddingResponse(data));
    return {
      provider: "ollama",
      model: settings.embedModel,
      embedding,
      dimension: embedding.length
    };
  } catch (e) {
    if (e?.name === "AbortError") {
      throw createMemoryError("MEMORY_EMBED_TIMEOUT", `Ollama embed request timed out after ${timeoutMs}ms.`);
    }
    if (e && typeof e.code === "string" && e.code.startsWith("MEMORY_EMBED_")) {
      throw e;
    }
    throw createMemoryError("MEMORY_EMBED_NETWORK", String(e?.message || e), null, e);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  normalizeEmbeddingResponse,
  sanitizeEmbedding,
  embedText
};
