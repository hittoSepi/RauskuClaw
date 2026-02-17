const test = require("node:test");
const assert = require("node:assert/strict");
const { parseChatMemoryWriteRequest, applyChatMemoryWriteback } = require("../memory/writeback");

function makeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      if (String(sql).includes("INSERT INTO memories")) {
        return {
          run: (id, scope, key, valueJson, tagsJson) => {
            rows.set(`${scope}:${key}`, {
              id,
              scope,
              key,
              value: JSON.parse(valueJson),
              tags: JSON.parse(tagsJson)
            });
            return { changes: 1 };
          }
        };
      }
      if (String(sql).includes("SELECT id, scope, key")) {
        return {
          get: (scope, key) => {
            const row = rows.get(`${scope}:${key}`);
            return row ? { id: row.id, scope: row.scope, key: row.key } : null;
          }
        };
      }
      throw new Error(`Unexpected SQL in mock db: ${sql}`);
    }
  };
}

test("parseChatMemoryWriteRequest returns null when memory_write is omitted", () => {
  assert.equal(parseChatMemoryWriteRequest({ prompt: "hello" }, "job-1"), null);
});

test("parseChatMemoryWriteRequest applies defaults", () => {
  const out = parseChatMemoryWriteRequest(
    {
      memory_write: { scope: "chat.ops" }
    },
    "job-123"
  );
  assert.equal(out.scope, "chat.ops");
  assert.equal(out.key, "chat.reply.job-123");
  assert.equal(out.required, false);
  assert.equal(out.ttlSec, null);
  assert.deepEqual(out.tags, []);
});

test("parseChatMemoryWriteRequest validates input", () => {
  assert.throws(
    () => parseChatMemoryWriteRequest({ memory_write: { scope: "x" } }, "job-1"),
    (e) => e && e.code === "MEMORY_WRITE_INPUT"
  );
  assert.throws(
    () => parseChatMemoryWriteRequest({ memory_write: { scope: "chat.ops", ttl_sec: 0 } }, "job-1"),
    (e) => e && e.code === "MEMORY_WRITE_INPUT"
  );
  assert.throws(
    () => parseChatMemoryWriteRequest({ memory_write: { scope: "chat.ops", required: "yes" } }, "job-1"),
    (e) => e && e.code === "MEMORY_WRITE_INPUT"
  );
});

test("applyChatMemoryWriteback saves memory and queues embedding", () => {
  const db = makeDb();
  const request = parseChatMemoryWriteRequest(
    { memory_write: { scope: "chat.ops", key: "reply.last", tags: ["chat", "answer"] } },
    "job-1"
  );
  const queued = [];
  const out = applyChatMemoryWriteback({
    db,
    settings: { enabled: true, embedQueueType: "system.memory.embed.sync" },
    request,
    providerOutput: { output_text: "Assistant response", provider: "openai", model: "gpt-x" },
    job: { id: "job-1", type: "ai.chat.generate" },
    enqueueInternalJob: (type, input) => queued.push({ type, input })
  });

  assert.equal(out.scope, "chat.ops");
  assert.equal(out.key, "reply.last");
  assert.equal(out.embedding_queued, true);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].type, "system.memory.embed.sync");
  assert.equal(typeof queued[0].input.memory_id, "string");
});

test("applyChatMemoryWriteback fails with deterministic code on empty provider output", () => {
  const db = makeDb();
  const request = parseChatMemoryWriteRequest({ memory_write: { scope: "chat.ops" } }, "job-1");
  assert.throws(
    () =>
      applyChatMemoryWriteback({
        db,
        settings: { enabled: true, embedQueueType: "system.memory.embed.sync" },
        request,
        providerOutput: { output_text: "" },
        job: { id: "job-1", type: "ai.chat.generate" },
        enqueueInternalJob: () => {}
      }),
    (e) => e && e.code === "MEMORY_WRITE_UNAVAILABLE"
  );
});
