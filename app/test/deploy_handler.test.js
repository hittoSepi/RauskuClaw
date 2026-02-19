const test = require("node:test");
const assert = require("node:assert/strict");
const { buildDeployPlan } = require("../handlers/deploy");

test("buildDeployPlan returns structured dry-run plan", () => {
  const out = buildDeployPlan(
    {
      target: "staging",
      strategy: "canary",
      services: ["api", "worker", "api"],
      version: "v2026.02.17",
      dry_run: true
    },
    {
      allowedTargets: ["staging", "prod"],
      idFactory: () => "dep-1",
      nowIso: () => "2026-02-17T00:00:00.000Z"
    }
  );

  assert.equal(out.deployment_id, "dep-1");
  assert.equal(out.target, "staging");
  assert.equal(out.strategy, "canary");
  assert.equal(out.dry_run, true);
  assert.equal(out.version, "v2026.02.17");
  assert.deepEqual(out.services, ["api", "worker"]);
  assert.equal(Array.isArray(out.plan_steps), true);
  assert.equal(out.plan_steps.length >= 5, true);
});

test("buildDeployPlan rejects forbidden targets and non-dry-run", () => {
  assert.throws(
    () => buildDeployPlan({ target: "prod" }, { allowedTargets: ["staging"] }),
    /target not allowed/
  );
  assert.throws(
    () => buildDeployPlan({ target: "staging", dry_run: false }, { allowedTargets: ["staging"] }),
    /dry_run only/
  );
});

test("buildDeployPlan rejects invalid strategy and service names", () => {
  assert.throws(
    () => buildDeployPlan({ target: "staging", strategy: "random" }, { allowedTargets: ["staging"] }),
    /Invalid deploy strategy/
  );
  assert.throws(
    () => buildDeployPlan({ target: "staging", services: ["ok", "bad service"] }, { allowedTargets: ["staging"] }),
    /Invalid service name/
  );
});
