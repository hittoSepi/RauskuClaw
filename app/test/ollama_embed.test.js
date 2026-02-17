const test = require("node:test");
const assert = require("node:assert/strict");
const { embedText, normalizeEmbeddingResponse, sanitizeEmbedding } = require("../memory/ollama_embed");

const settings = {
  ollamaBaseUrl: "http://127.0.0.1:11434",
  embedModel: "embeddinggemma:300m-qat-q8_0",
  embedTimeoutMs: 30
};

test("normalizeEmbeddingResponse supports embedding and embeddings[]", () => {
  assert.deepEqual(normalizeEmbeddingResponse({ embedding: [1, 2] }), [1, 2]);
  assert.deepEqual(normalizeEmbeddingResponse({ embeddings: [[3, 4]] }), [3, 4]);
  assert.equal(normalizeEmbeddingResponse({}), null);
});

test("sanitizeEmbedding validates array values", () => {
  assert.deepEqual(sanitizeEmbedding([1, "2", 3.5]), [1, 2, 3.5]);
  assert.throws(() => sanitizeEmbedding([]), /missing embedding array/i);
  assert.throws(() => sanitizeEmbedding([1, "x"]), /non-numeric/i);
});

test("embedText returns normalized embedding on success", async () => {
  const out = await embedText("hello", {
    settings,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ embedding: [0.1, 0.2, 0.3] })
    })
  });

  assert.equal(out.provider, "ollama");
  assert.equal(out.model, settings.embedModel);
  assert.equal(out.dimension, 3);
  assert.deepEqual(out.embedding, [0.1, 0.2, 0.3]);
});

test("embedText maps timeout to MEMORY_EMBED_TIMEOUT", async () => {
  await assert.rejects(
    embedText("hello", {
      settings,
      fetchImpl: async (_url, { signal }) => {
        return await new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
          });
        });
      }
    }),
    (e) => e && e.code === "MEMORY_EMBED_TIMEOUT"
  );
});

test("embedText maps HTTP and malformed JSON failures", async () => {
  await assert.rejects(
    embedText("hello", {
      settings,
      fetchImpl: async () => ({
        ok: false,
        status: 500,
        text: async () => JSON.stringify({ error: "boom" })
      })
    }),
    (e) => e && e.code === "MEMORY_EMBED_HTTP"
  );

  await assert.rejects(
    embedText("hello", {
      settings,
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => "not-json"
      })
    }),
    (e) => e && e.code === "MEMORY_EMBED_RESPONSE"
  );
});
