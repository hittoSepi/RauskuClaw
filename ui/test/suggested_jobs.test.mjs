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

test("parseSuggestedJobs parses truncated fence when JSON object is complete", () => {
  const payload = JSON.stringify({
    jobs: [
      { type: "data.file_read", input: { path: "README.md" }, priority: 5, timeout_sec: 30, max_attempts: 1, tags: ["chat"] }
    ]
  });
  const raw = `Etsitään tiedosto.\n\`\`\`rausku_jobs\n${payload}\n`;
  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "data.file_read");
  assert.equal(out[0].input.path, "README.md");
});

test("parseSuggestedJobs parses raw jobs JSON without fence", () => {
  const raw = [
    "Some text before",
    "{\"jobs\":[{\"type\":\"tools.file_search\",\"input\":{\"query\":\"synapse.py\",\"path\":\".\"},\"priority\":5,\"timeout_sec\":30,\"max_attempts\":1,\"tags\":[\"chat\"]}]}",
    "Some text after"
  ].join("\n");
  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "tools.file_search");
  assert.equal(out[0].input.query, "synapse.py");
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

test("parseSuggestedJobs normalizes shell.exec aliases to tool.exec", () => {
  const raw = [
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        { type: "shell.exec", input: { command: "ls -la" } },
        { type: "terminal.exec", input: { command: "pwd" } }
      ]
    }),
    "```"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "tool.exec");
  assert.equal(out[1].type, "tool.exec");
});

test("parseSuggestedJobs normalizes selected tools aliases", () => {
  const raw = [
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        { type: "tools.exec", input: { command: "ls -la" } },
        { type: "tools.fetch", input: { url: "https://example.com" } }
      ]
    }),
    "```"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "tool.exec");
  assert.equal(out[1].type, "tools.fetch");
});

test("parseSuggestedJobs normalizes web search aliases to tools.web_search", () => {
  const raw = [
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        { type: "tool.web_search", input: { query: "nodejs" } },
        { type: "web.search", input: { query: "express" } }
      ]
    }),
    "```"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "tools.web_search");
  assert.equal(out[1].type, "tools.web_search");
});

test("parseSuggestedJobs normalizes file search aliases to tools.file_search", () => {
  const raw = [
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        { type: "file.search", input: { query: "README" } },
        { type: "workspace.file_search", input: { query: "PLAN" } }
      ]
    }),
    "```"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "tools.file_search");
  assert.equal(out[1].type, "tools.file_search");
});

test("parseSuggestedJobs maps tools.file_search pattern to query", () => {
  const raw = [
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        { type: "tools.file_search", input: { pattern: "synapse.py", path: "." } }
      ]
    }),
    "```"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, "tools.file_search");
  assert.equal(out[0].input.query, "synapse.py");
});

test("parseSuggestedJobs normalizes find-in-files aliases to tools.find_in_files", () => {
  const raw = [
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        { type: "find.in_files", input: { query: "TODO" } },
        { type: "tools.find_in_file", input: { query: "FIXME" } }
      ]
    }),
    "```"
  ].join("\n");

  const out = parseSuggestedJobs(raw);
  assert.equal(out.length, 2);
  assert.equal(out[0].type, "tools.find_in_files");
  assert.equal(out[1].type, "tools.find_in_files");
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
