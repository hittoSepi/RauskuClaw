const test = require("node:test");
const assert = require("node:assert/strict");
const { generateReport } = require("../handlers/report");

test("generateReport builds structured report from metrics map", () => {
  const out = generateReport(
    {
      title: "Ops Daily",
      source: "scheduler",
      metrics: {
        jobs_succeeded: 42,
        jobs_failed: 3,
        ignored: "n/a"
      },
      highlights: ["Queue latency stable", "Failure rate down"],
      notes: "All good."
    },
    {
      idFactory: () => "rpt-1",
      nowIso: () => "2026-02-17T00:00:00.000Z"
    }
  );

  assert.equal(out.report_id, "rpt-1");
  assert.equal(out.generated_at, "2026-02-17T00:00:00.000Z");
  assert.equal(out.title, "Ops Daily");
  assert.equal(out.source, "scheduler");
  assert.equal(out.metrics.length, 2);
  assert.equal(out.metrics[0].name, "jobs_failed");
  assert.equal(out.metrics[0].value, 3);
  assert.equal(out.highlights.length, 2);
  assert.match(out.summary, /Top metric jobs_succeeded=42\./);
});

test("generateReport derives stats from values when metrics map missing", () => {
  const out = generateReport(
    { values: [10, 20, 30, "bad"], source: "values-test" },
    { idFactory: () => "rpt-2", nowIso: () => "2026-02-17T00:00:00.000Z" }
  );

  assert.equal(out.report_id, "rpt-2");
  assert.equal(out.metrics.length, 5);
  assert.deepEqual(out.metrics.find((m) => m.name === "count"), { name: "count", value: 3 });
  assert.deepEqual(out.metrics.find((m) => m.name === "sum"), { name: "sum", value: 60 });
  assert.equal(out.title, "Runtime Report");
});

test("generateReport rejects non-object input", () => {
  assert.throws(
    () => generateReport("oops"),
    /input must be an object/
  );
});
