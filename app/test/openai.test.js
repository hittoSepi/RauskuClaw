const test = require("node:test");
const assert = require("node:assert/strict");
const { runOpenAiChat, normalizeMessages } = require("../providers/openai");

const ENV_KEYS = [
  "OPENAI_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_TIMEOUT_MS"
];

async function withEnv(nextEnv, fn) {
  const prev = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(nextEnv || {})) process.env[k] = String(v);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("normalizeMessages accepts prompt and filters invalid messages", () => {
  const fromPrompt = normalizeMessages({ system: "s", prompt: "hello" });
  assert.deepEqual(fromPrompt, [
    { role: "system", content: "s" },
    { role: "user", content: "hello" }
  ]);

  const fromMessages = normalizeMessages({
    messages: [
      { role: "user", content: "a" },
      { role: "noop", content: "b" },
      { role: "assistant", content: "  " }
    ]
  });
  assert.deepEqual(fromMessages, [{ role: "user", content: "a" }]);
});

test("runOpenAiChat returns normalized response on success", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_BASE_URL: "https://api.openai.com",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    const out = await runOpenAiChat(
      { prompt: "hello" },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          text: async () => JSON.stringify({
            id: "cmpl_1",
            model: "gpt-4.1-mini",
            choices: [{ finish_reason: "stop", message: { content: "hi there" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
          })
        })
      }
    );
    assert.equal(out.provider, "openai");
    assert.equal(out.output_text, "hi there");
    assert.equal(out.id, "cmpl_1");
  });
});

test("runOpenAiChat emits coded errors", async () => {
  await withEnv({ OPENAI_ENABLED: "0" }, async () => {
    await assert.rejects(
      runOpenAiChat({ prompt: "x" }),
      (e) => e && e.code === "PROVIDER_DISABLED"
    );
  });

  await withEnv({ OPENAI_ENABLED: "1", OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-4.1-mini" }, async () => {
    await assert.rejects(
      runOpenAiChat({ prompt: "x" }),
      (e) => e && e.code === "PROVIDER_CONFIG"
    );
  });
});

test("runOpenAiChat maps timeout and HTTP failures to provider codes", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_TIMEOUT_MS: "20"
  }, async () => {
    await assert.rejects(
      runOpenAiChat(
        { prompt: "x" },
        {
          fetchImpl: async (_url, { signal }) => {
            return await new Promise((_, reject) => {
              signal.addEventListener("abort", () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                reject(e);
              });
            });
          }
        }
      ),
      (e) => e && e.code === "PROVIDER_TIMEOUT"
    );
  });

  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini"
  }, async () => {
    await assert.rejects(
      runOpenAiChat(
        { prompt: "x" },
        {
          fetchImpl: async () => ({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({ error: { message: "rate limited" } })
          })
        }
      ),
      (e) => e && e.code === "PROVIDER_HTTP"
    );
  });
});
