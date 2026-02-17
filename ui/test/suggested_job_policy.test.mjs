import test from "node:test";
import assert from "node:assert/strict";
import { getSuggestedJobDecision, normalizeTypeList } from "../src/suggested_job_policy.js";

test("normalizeTypeList supports csv and arrays", () => {
  assert.deepEqual(normalizeTypeList("report.generate, ai.chat.generate,report.generate"), ["report.generate", "ai.chat.generate"]);
  assert.deepEqual(normalizeTypeList([" report.generate ", "", "ai.chat.generate", "report.generate"]), ["report.generate", "ai.chat.generate"]);
});

test("getSuggestedJobDecision honors mode overrides", () => {
  const job = { type: "report.generate", timeout_sec: 999, max_attempts: 9, priority: 9 };
  assert.deepEqual(getSuggestedJobDecision(job, { mode: "never" }), { auto: true, reasons: [] });
  assert.deepEqual(getSuggestedJobDecision(job, { mode: "always" }), {
    auto: false,
    reasons: ["policy mode: always require approval"]
  });
});

test("getSuggestedJobDecision smart mode returns auto when within thresholds", () => {
  const out = getSuggestedJobDecision(
    { type: "report.generate", timeout_sec: 25, max_attempts: 1, priority: 5 },
    {
      mode: "smart",
      maxTimeoutSec: 30,
      maxAttempts: 1,
      maxPriority: 5,
      allowTypes: ["report.generate"]
    }
  );
  assert.deepEqual(out, { auto: true, reasons: [] });
});

test("getSuggestedJobDecision smart mode emits reasons for threshold and allowlist violations", () => {
  const out = getSuggestedJobDecision(
    { type: "ai.chat.generate", timeout_sec: 90, max_attempts: 3, priority: 9 },
    {
      mode: "smart",
      maxTimeoutSec: 30,
      maxAttempts: 1,
      maxPriority: 5,
      allowTypes: "report.generate,memory.write"
    }
  );
  assert.equal(out.auto, false);
  assert.deepEqual(out.reasons, [
    "timeout 90s > 30s",
    "attempts 3 > 1",
    "priority 9 > 5",
    "type 'ai.chat.generate' not in auto allowlist"
  ]);
});
