import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCreateJobPayload,
  parseFilterAndDecideSuggestedJobs,
  selectSuggestedJobsForCreation
} from "../src/suggested_jobs_flow.js";

test("suggested jobs flow parses, dedupes, decides, selects, and builds payload", () => {
  const assistantText = [
    "Plan ready.",
    "```rausku_jobs",
    JSON.stringify({
      jobs: [
        {
          type: "ai.chat.generate",
          input: { prompt: "Explain API auth flow" },
          priority: 5,
          timeout_sec: 30,
          max_attempts: 1,
          tags: ["chat"]
        },
        {
          type: "report.generate",
          queue: "alpha",
          input: { source: "daily" },
          priority: 3,
          timeout_sec: 20,
          max_attempts: 1,
          tags: ["ops"]
        },
        {
          type: "unknown.type",
          input: { foo: "bar" },
          priority: 9,
          timeout_sec: 90,
          max_attempts: 3,
          tags: ["x"]
        }
      ]
    }),
    "```"
  ].join("\n");

  const flow = parseFilterAndDecideSuggestedJobs({
    text: assistantText,
    currentType: "ai.chat.generate",
    userText: "Explain API auth flow",
    policy: {
      mode: "smart",
      maxTimeoutSec: 30,
      maxAttempts: 1,
      maxPriority: 5,
      allowTypes: ["report.generate"]
    }
  });

  assert.equal(flow.filtered.dropped, 1);
  assert.equal(flow.filtered.kept.length, 2);
  assert.equal(flow.autoCount, 1);
  assert.equal(flow.approvalCount, 1);
  assert.equal(flow.decisions[0]?.auto, true);
  assert.equal(flow.decisions[1]?.auto, false);

  const selected = selectSuggestedJobsForCreation({
    jobs: flow.filtered.kept,
    decisions: flow.decisions,
    mode: "auto",
    enabledTypes: ["report.generate", "ai.chat.generate"]
  });

  assert.equal(selected.normalizedMode, "auto");
  assert.equal(selected.selected.length, 1);
  assert.equal(selected.valid.length, 1);
  assert.deepEqual(selected.invalidTypes, []);

  assert.deepEqual(buildCreateJobPayload(selected.valid[0].job), {
    type: "report.generate",
    queue: "alpha",
    input: { source: "daily" },
    priority: 3,
    timeout_sec: 20,
    max_attempts: 1,
    tags: ["ops"]
  });
});

test("selectSuggestedJobsForCreation reports invalid disabled types in approval mode", () => {
  const selected = selectSuggestedJobsForCreation({
    jobs: [
      { type: "unknown.type", input: {}, priority: 5, timeout_sec: 10, max_attempts: 1, tags: [] }
    ],
    decisions: [{ auto: false, reasons: ["type 'unknown.type' not in auto allowlist"] }],
    mode: "approval",
    enabledTypes: ["report.generate"]
  });

  assert.equal(selected.selected.length, 1);
  assert.equal(selected.valid.length, 0);
  assert.deepEqual(selected.invalidTypes, ["unknown.type"]);
});
