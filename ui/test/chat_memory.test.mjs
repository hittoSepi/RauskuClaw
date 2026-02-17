import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMemoryInput,
  buildMemoryWriteInput,
  formatMemoryWriteStatusLabel,
  parseMemoryWriteStatus,
  validateMemoryInput,
  validateMemoryWriteInput
} from "../src/chat_memory.js";

test("validateMemoryInput validates scope and top_k", () => {
  assert.equal(validateMemoryInput({ enabled: false }), "");
  assert.match(validateMemoryInput({ enabled: true, scope: "x", top_k: 5 }), /Memory scope/);
  assert.match(validateMemoryInput({ enabled: true, scope: "agent.chat", top_k: 101 }), /top_k/);
  assert.equal(validateMemoryInput({ enabled: true, scope: "agent.chat", top_k: 5 }), "");
});

test("validateMemoryWriteInput validates scope/key/ttl", () => {
  assert.equal(validateMemoryWriteInput({ enabled: false }), "");
  assert.match(validateMemoryWriteInput({ enabled: true, scope: "x", key: "", ttl_sec: null }), /scope/);
  assert.match(validateMemoryWriteInput({ enabled: true, scope: "agent.chat", key: "x", ttl_sec: null }), /key/);
  assert.match(validateMemoryWriteInput({ enabled: true, scope: "agent.chat", key: "reply.last", ttl_sec: 0 }), /ttl_sec/);
  assert.equal(validateMemoryWriteInput({ enabled: true, scope: "agent.chat", key: "reply.last", ttl_sec: 60 }), "");
});

test("buildMemoryInput builds normalized payload", () => {
  assert.equal(buildMemoryInput({ enabled: false }), null);
  assert.deepEqual(
    buildMemoryInput({ enabled: true, scope: " agent.chat ", query: "  release notes ", top_k: "7", required: true }),
    { scope: "agent.chat", query: "release notes", top_k: 7, required: true }
  );
  assert.deepEqual(
    buildMemoryInput({ enabled: true, scope: "agent.chat", query: "", top_k: "bad", required: false }),
    { scope: "agent.chat", top_k: 5, required: false }
  );
});

test("buildMemoryWriteInput builds normalized payload", () => {
  assert.equal(buildMemoryWriteInput({ enabled: false }), null);
  assert.deepEqual(
    buildMemoryWriteInput({ enabled: true, scope: " agent.chat ", key: " reply.last ", ttl_sec: "120", required: true }),
    { scope: "agent.chat", key: "reply.last", ttl_sec: 120, required: true }
  );
  assert.deepEqual(
    buildMemoryWriteInput({ enabled: true, scope: "agent.chat", key: "", ttl_sec: "abc", required: false }),
    { scope: "agent.chat", required: false }
  );
});

test("parseMemoryWriteStatus returns ok/fail/unknown branches", () => {
  assert.equal(parseMemoryWriteStatus({ done: { status: "succeeded" }, memoryWriteInput: null }), null);

  assert.deepEqual(
    parseMemoryWriteStatus({
      done: { status: "succeeded", result: { memory_write: { scope: "agent.chat", key: "reply.last" } } },
      memoryWriteInput: { scope: "agent.chat", key: "" }
    }),
    {
      status: "ok",
      code: "MEMORY_WRITE_OK",
      message: "Saved to agent.chat/reply.last."
    }
  );

  assert.deepEqual(
    parseMemoryWriteStatus({
      done: { status: "failed", error: { code: "MEMORY_CONTEXT_UNAVAILABLE", message: "memory missing" } },
      memoryWriteInput: { scope: "agent.chat" }
    }),
    {
      status: "fail",
      code: "MEMORY_CONTEXT_UNAVAILABLE",
      message: "memory missing"
    }
  );

  assert.deepEqual(
    parseMemoryWriteStatus({
      done: { status: "succeeded", result: {} },
      memoryWriteInput: { scope: "agent.chat", key: "reply.last" }
    }),
    {
      status: "unknown",
      code: "MEMORY_WRITE_NOT_CONFIRMED",
      message: "Memory write-back enabled, but result was not confirmed in provider output."
    }
  );
});

test("formatMemoryWriteStatusLabel formats by status", () => {
  assert.equal(formatMemoryWriteStatusLabel(null), "");
  assert.equal(formatMemoryWriteStatusLabel({ status: "ok" }), "memory write ok");
  assert.equal(formatMemoryWriteStatusLabel({ status: "fail", code: "X" }), "memory write failed (X)");
  assert.equal(formatMemoryWriteStatusLabel({ status: "unknown" }), "memory write unknown");
});
