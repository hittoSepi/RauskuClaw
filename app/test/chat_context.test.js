const test = require("node:test");
const assert = require("node:assert/strict");
const {
  deriveQueryFromInput,
  parseChatMemoryRequest,
  buildChatMemoryContext,
  injectChatMemoryContext
} = require("../memory/chat_context");

const SETTINGS = {
  enabled: true,
  searchTopKDefault: 10,
  searchTopKMax: 100
};

function makeDb(availabilityRow, recentRows = []) {
  return {
    prepare(sql) {
      if (String(sql).includes("COUNT(*) AS total_count")) {
        return {
          get: () => availabilityRow
        };
      }
      if (String(sql).includes("FROM memories m") && String(sql).includes("ORDER BY m.updated_at DESC")) {
        return {
          all: () => recentRows
        };
      }
      throw new Error(`Unexpected SQL in mock db: ${sql}`);
    }
  };
}

test("deriveQueryFromInput prefers prompt and then latest user message", () => {
  assert.equal(deriveQueryFromInput({ prompt: "  hello prompt " }), "hello prompt");

  const fromMessages = deriveQueryFromInput({
    messages: [
      { role: "assistant", content: "old" },
      { role: "user", content: "latest user message" }
    ]
  });
  assert.equal(fromMessages, "latest user message");
});

test("parseChatMemoryRequest returns null when memory is omitted", () => {
  assert.equal(parseChatMemoryRequest({ prompt: "hi" }, SETTINGS), null);
});

test("parseChatMemoryRequest validates fields and applies defaults", () => {
  const req = parseChatMemoryRequest({
    prompt: "hello world",
    memory: {
      scope: "chat.ops",
      required: true
    }
  }, SETTINGS);

  assert.deepEqual(req, {
    scope: "chat.ops",
    query: "hello world",
    topK: 10,
    required: true
  });
});

test("parseChatMemoryRequest rejects invalid input values", () => {
  assert.throws(
    () => parseChatMemoryRequest({ memory: { scope: "x" } }, SETTINGS),
    (e) => e && e.code === "MEMORY_CONTEXT_INPUT"
  );
  assert.throws(
    () => parseChatMemoryRequest({ prompt: "hello", memory: { scope: "chat.ops", top_k: 999 } }, SETTINGS),
    (e) => e && e.code === "MEMORY_CONTEXT_INPUT"
  );
  assert.throws(
    () => parseChatMemoryRequest({ prompt: "hello", memory: { scope: "chat.ops", required: "yes" } }, SETTINGS),
    (e) => e && e.code === "MEMORY_CONTEXT_INPUT"
  );
});

test("buildChatMemoryContext fails with deterministic code when vector mode is disabled", async () => {
  await assert.rejects(
    buildChatMemoryContext({
      db: makeDb({ total_count: 0, pending_count: 0, failed_count: 0, missing_vector_count: 0 }),
      settings: { ...SETTINGS, enabled: false },
      request: { scope: "chat.ops", query: "q", topK: 5, required: false }
    }),
    (e) => e && e.code === "MEMORY_CONTEXT_UNAVAILABLE"
  );
});

test("buildChatMemoryContext falls back to recent scope rows when vectors are sparse", async () => {
  const context = await buildChatMemoryContext({
    db: makeDb(
      { total_count: 3, pending_count: 1, failed_count: 0, missing_vector_count: 1 },
      [
        {
          id: "m-pending",
          scope: "chat.ops",
          key: "chat.line.user.1",
          value_json: JSON.stringify({ text: "latest pending note" }),
          tags_json: JSON.stringify(["chat", "recent"]),
          updated_at: "2026-02-18T00:00:01.000Z",
          embedding_status: "pending"
        }
      ]
    ),
    settings: SETTINGS,
    request: { scope: "chat.ops", query: "pending note", topK: 5, required: false },
    embed: async () => ({ embedding: [0.1, 0.2, 0.3], model: "mock-embed" }),
    search: () => []
  });
  assert.equal(context.matches.length, 1);
  assert.equal(context.matches[0].id, "m-pending");
  assert.equal(context.matches[0].embedding_status, "pending");
});

test("buildChatMemoryContext returns matches and instruction text", async () => {
  const context = await buildChatMemoryContext({
    db: makeDb({ total_count: 2, pending_count: 0, failed_count: 0, missing_vector_count: 0 }),
    settings: SETTINGS,
    request: { scope: "chat.ops", query: "release notes", topK: 3, required: false },
    embed: async () => ({ embedding: [0.1, 0.2, 0.3], model: "mock-embed" }),
    search: () => [
      {
        id: "m-1",
        scope: "chat.ops",
        key: "release.last",
        value_json: JSON.stringify({ text: "v1.2 deployed" }),
        tags_json: JSON.stringify(["release"]),
        updated_at: "2026-02-17T00:00:00.000Z",
        distance: 0.1
      }
    ]
  });

  assert.equal(context.matches.length, 1);
  assert.equal(context.matches[0].key, "release.last");
  assert.equal(context.embeddingModel, "mock-embed");
  assert.match(context.instruction, /scope=chat\.ops/);
  assert.match(context.instruction, /release\.last/);
});

test("buildChatMemoryContext prioritizes newest matches before top_k truncation", async () => {
  const context = await buildChatMemoryContext({
    db: makeDb({ total_count: 3, pending_count: 0, failed_count: 0, missing_vector_count: 0 }),
    settings: SETTINGS,
    request: { scope: "chat.ops", query: "release notes", topK: 2, required: false },
    embed: async () => ({ embedding: [0.1, 0.2, 0.3], model: "mock-embed" }),
    search: () => [
      {
        id: "m-old",
        scope: "chat.ops",
        key: "release.old",
        value_json: JSON.stringify({ text: "old note" }),
        tags_json: JSON.stringify(["release"]),
        updated_at: "2026-02-16T00:00:00.000Z",
        distance: 0.01
      },
      {
        id: "m-newest",
        scope: "chat.ops",
        key: "release.newest",
        value_json: JSON.stringify({ text: "newest note" }),
        tags_json: JSON.stringify(["release"]),
        updated_at: "2026-02-18T00:00:00.000Z",
        distance: 0.2
      },
      {
        id: "m-newer",
        scope: "chat.ops",
        key: "release.newer",
        value_json: JSON.stringify({ text: "newer note" }),
        tags_json: JSON.stringify(["release"]),
        updated_at: "2026-02-17T00:00:00.000Z",
        distance: 0.1
      }
    ]
  });

  assert.equal(context.matches.length, 2);
  assert.equal(context.matches[0].id, "m-newest");
  assert.equal(context.matches[1].id, "m-newer");
});

test("injectChatMemoryContext prepends system message when chat history exists", () => {
  const out = injectChatMemoryContext(
    {
      memory: { scope: "chat.ops" },
      messages: [{ role: "user", content: "hello" }]
    },
    { instruction: "memory-line" }
  );

  assert.equal(out.messages.length, 2);
  assert.equal(out.messages[0].role, "system");
  assert.equal(out.messages[0].content, "memory-line");
  assert.equal(out.messages[1].content, "hello");
  assert.equal(Object.prototype.hasOwnProperty.call(out, "memory"), false);
});

test("injectChatMemoryContext appends to system when prompt-only input is used", () => {
  const out = injectChatMemoryContext(
    {
      memory: { scope: "chat.ops" },
      system: "base system",
      prompt: "hello"
    },
    { instruction: "memory-line" }
  );

  assert.match(out.system, /base system/);
  assert.match(out.system, /memory-line/);
  assert.equal(out.prompt, "hello");
  assert.equal(Object.prototype.hasOwnProperty.call(out, "memory"), false);
});
