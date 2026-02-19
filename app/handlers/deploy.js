const crypto = require("crypto");

const DEFAULT_SERVICES = ["api", "worker", "ui"];
const ALLOWED_STRATEGIES = new Set(["rolling", "blue-green", "canary"]);
const SERVICE_NAME_PATTERN = /^[a-z0-9][a-z0-9._:-]{0,79}$/i;

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizeServices(input) {
  const raw = Array.isArray(input?.services)
    ? input.services
    : (input?.service ? [input.service] : DEFAULT_SERVICES);
  const out = [];
  for (const item of raw) {
    const name = clampText(item, 80);
    if (!name) continue;
    if (!SERVICE_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid service name: ${name}`);
    }
    if (!out.includes(name)) out.push(name);
  }
  return out.length > 0 ? out : DEFAULT_SERVICES.slice();
}

function buildDeployPlan(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("deploy.run input must be an object");
  }
  const safeInput = input || {};
  const allowedTargets = Array.isArray(options.allowedTargets) && options.allowedTargets.length > 0
    ? options.allowedTargets.map((x) => String(x || "").trim()).filter(Boolean)
    : ["staging"];
  const idFactory = typeof options.idFactory === "function" ? options.idFactory : () => crypto.randomUUID();
  const nowIso = typeof options.nowIso === "function" ? options.nowIso : () => new Date().toISOString();

  const target = clampText(safeInput.target, 80) || "staging";
  if (!allowedTargets.includes(target)) {
    throw new Error(`target not allowed: ${target}`);
  }

  const dryRun = safeInput.dry_run !== false;
  if (!dryRun) {
    throw new Error("deploy.run supports dry_run only in current MVP");
  }

  const strategy = clampText(safeInput.strategy, 40).toLowerCase() || "rolling";
  if (!ALLOWED_STRATEGIES.has(strategy)) {
    throw new Error(`Invalid deploy strategy: ${strategy}`);
  }

  const services = normalizeServices(safeInput);
  const version = clampText(safeInput.version, 120) || null;

  const steps = [
    `Validate release input for target '${target}'.`,
    `Prepare rollback checkpoint for ${services.join(", ")}.`,
    `Execute ${strategy} deployment (dry-run) for ${services.join(", ")}.`,
    "Run post-deploy health checks (dry-run).",
    "Publish deployment summary."
  ];

  return {
    deployment_id: idFactory(),
    requested_at: nowIso(),
    target,
    dry_run: true,
    strategy,
    version,
    services,
    summary: `Dry-run deploy plan ready for ${target} (${services.length} service(s), strategy=${strategy}).`,
    plan_steps: steps,
    checks: [
      "artifact_present",
      "rollback_checkpoint",
      "health_check_route",
      "callback_delivery"
    ]
  };
}

module.exports = {
  buildDeployPlan
};
