const { envBoolOrConfig, envOrConfig, envIntOrConfig } = require("../config");
const { createMemoryError } = require("./errors");

function parsePositiveInt(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.floor(n);
}

function getMemoryVectorSettings() {
  const enabled = envBoolOrConfig("MEMORY_VECTOR_ENABLED", "memory.vector.enabled", false);
  const ollamaBaseUrl = String(envOrConfig(
    "OLLAMA_BASE_URL",
    "memory.embedding.ollama.base_url",
    "http://rauskuclaw-ollama:11434"
  )).replace(/\/+$/, "");
  const embedModel = String(envOrConfig(
    "OLLAMA_EMBED_MODEL",
    "memory.embedding.ollama.model",
    "embeddinggemma:300m-qat-q8_0"
  )).trim();
  const embedTimeoutMs = parsePositiveInt(
    envIntOrConfig("OLLAMA_EMBED_TIMEOUT_MS", "memory.embedding.ollama.timeout_ms", 15000),
    15000
  );
  const sqliteExtensionPath = String(envOrConfig(
    "SQLITE_VECTOR_EXTENSION_PATH",
    "memory.vector.sqlite.extension_path",
    ""
  )).trim();
  const searchTopKDefault = parsePositiveInt(
    envIntOrConfig("MEMORY_SEARCH_TOP_K_DEFAULT", "memory.search.top_k_default", 10),
    10
  );
  const searchTopKMax = parsePositiveInt(
    envIntOrConfig("MEMORY_SEARCH_TOP_K_MAX", "memory.search.top_k_max", 100),
    100
  );
  const embedQueueType = String(envOrConfig(
    "MEMORY_EMBED_QUEUE_TYPE",
    "memory.embedding.queue_type",
    "system.memory.embed.sync"
  )).trim() || "system.memory.embed.sync";

  if (enabled && !sqliteExtensionPath) {
    throw createMemoryError(
      "MEMORY_VECTOR_CONFIG",
      "MEMORY_VECTOR_ENABLED=1 requires SQLITE_VECTOR_EXTENSION_PATH."
    );
  }
  if (enabled && !embedModel) {
    throw createMemoryError(
      "MEMORY_VECTOR_CONFIG",
      "MEMORY_VECTOR_ENABLED=1 requires OLLAMA_EMBED_MODEL."
    );
  }

  return {
    enabled,
    ollamaBaseUrl,
    embedModel,
    embedTimeoutMs,
    sqliteExtensionPath,
    searchTopKDefault,
    searchTopKMax: Math.max(searchTopKDefault, searchTopKMax),
    embedQueueType
  };
}

module.exports = {
  getMemoryVectorSettings
};
