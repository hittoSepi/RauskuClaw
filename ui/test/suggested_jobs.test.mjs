import test from "node:test";
import assert from "node:assert/strict";
import { filterDuplicateSuggestions, isDuplicateChatSuggestion, parseSuggestedJobs } from "../src/suggested_jobs.js";

test("parseSuggestedJobs returns empty when fenced block is missing", () => {
  assert.deepEqual(parseSuggestedJobs("hello"), []);
});

test("parseSuggestedJobs returns empty on invalid JSON", () => {
  const raw = "```rausku_jobs\n{invalid}\n```";
  assert.deepEqual(parseSuggestedJobs(raw), []);
});

test("parseSuggestedJobs normalizes and validates jobs", () => {
  const raw = [
    "prefix",
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        {
          type: "report.generate",
          queue: "alpha",
          input: { source: "daily" },
          priority: 15,
          timeout_sec: 999999,
          max_attempts: 0,
          tags: ["ops", "", "nightly"]
        },
        {
          type: "ai.chat.generate",
          queue: "bad queue name",
          input: "not-object",
          priority: -9,
          timeout_sec: -1,
          max_attempts: -2,
          tags: "bad"
        },
        { type: "" }
      ]
    }),
    "```",
    "suffix"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 2);

  assert.deepEqual(out[0], {
    type: "report.generate",
    queue: "alpha",
    input: { source: "daily" },
    priority: 10,
    timeout_sec: 3600,
    max_attempts: 1,
    tags: ["ops", "nightly"]
  });

  assert.deepEqual(out[1], {
    type: "ai.chat.generate",
    input: {},
    priority: 0,
    timeout_sec: 1,
    max_attempts: 1,
    tags: []
  });
});

test("isDuplicateChatSuggestion matches same chat type and same prompt", () => {
  const dup = isDuplicateChatSuggestion(
    { type: "ai.chat.generate", input: { prompt: "Summarize latest deploy incidents." } },
    { currentType: "ai.chat.generate", userText: "Summarize latest deploy incidents." }
  );
  assert.equal(dup, true);
});

test("isDuplicateChatSuggestion ignores non-chat types and type mismatch", () => {
  assert.equal(
    isDuplicateChatSuggestion(
      { type: "report.generate", input: { prompt: "x" } },
      { currentType: "report.generate", userText: "x" }
    ),
    false
  );
  assert.equal(
    isDuplicateChatSuggestion(
      { type: "ai.chat.generate", input: { prompt: "x" } },
      { currentType: "codex.chat.generate", userText: "x" }
    ),
    false
  );
});

test("isDuplicateChatSuggestion uses last user message fallback", () => {
  const dup = isDuplicateChatSuggestion(
    {
      type: "ai.chat.generate",
      input: { messages: [{ role: "system", content: "s" }, { role: "user", content: "Create release notes draft" }] }
    },
    { currentType: "ai.chat.generate", userText: "Create release notes draft" }
  );
  assert.equal(dup, true);
});

test("filterDuplicateSuggestions drops duplicate chat suggestions only", () => {
  const suggestions = [
    { type: "ai.chat.generate", input: { prompt: "Explain API auth flow" } },
    { type: "report.generate", input: { source: "ops" } },
    { type: "ai.chat.generate", input: { prompt: "Different prompt here" } }
  ];
  const out = filterDuplicateSuggestions(suggestions, {
    currentType: "ai.chat.generate",
    userText: "Explain API auth flow"
  });
  assert.equal(out.dropped, 1);
  assert.equal(out.kept.length, 2);
  assert.equal(out.kept[0].type, "report.generate");
  assert.equal(out.kept[1].type, "ai.chat.generate");
});
