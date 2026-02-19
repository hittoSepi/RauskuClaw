const fs = require("fs");
const path = require("path");
const YAML = require("yaml");

function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function isPathInside(parent, candidate) {
  const rel = path.relative(parent, candidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function parseWorkflowSpec(rawText) {
  const text = String(rawText || "").trim();
  if (!text) throw new Error("workflow file is empty");
  try {
    return YAML.parse(text);
  } catch (e) {
    throw new Error(`workflow YAML parse failed: ${String(e?.message || e)}`);
  }
}

function normalizeWorkflowPath(workspaceRoot, workflowFileRaw) {
  const workflowFile = clampText(workflowFileRaw, 240) || "workflows.yaml";
  const baseDir = path.resolve(workspaceRoot, "workflows");
  const normalized = workflowFile.replace(/\\/g, "/");
  const withExt = /\.[a-z0-9]{2,8}$/i.test(normalized) ? normalized : `${normalized}.yaml`;
  const abs = path.resolve(baseDir, withExt);
  if (!isPathInside(baseDir, abs)) throw new Error("workflow path escapes workspace/workflows");
  return { baseDir, abs, normalized: withExt };
}

function normalizeStepId(raw, idx) {
  const fallback = `step_${idx + 1}`;
  const id = String(raw || "").trim();
  if (!id) return fallback;
  if (!/^[a-zA-Z0-9._:-]{1,80}$/.test(id)) throw new Error(`invalid workflow step id '${id}'`);
  return id;
}

function getByPath(obj, pathExpr) {
  const parts = String(pathExpr || "").split(".").map((x) => x.trim()).filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveTemplateExpr(expr, { params, stepResults }) {
  const key = String(expr || "").trim();
  if (!key) return "";

  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)) {
    return Object.prototype.hasOwnProperty.call(params, key) ? params[key] : "";
  }

  const dotIdx = key.indexOf(".");
  if (dotIdx < 1) return "";
  const stepId = key.slice(0, dotIdx);
  const pathExpr = key.slice(dotIdx + 1);
  if (!Object.prototype.hasOwnProperty.call(stepResults, stepId)) return "";
  const stepResult = stepResults[stepId];
  return getByPath(stepResult, pathExpr);
}

function renderTemplateString(raw, ctx) {
  const src = String(raw || "");
  const exact = src.match(/^\$\{([^}]+)\}$/);
  if (exact) {
    const value = resolveTemplateExpr(exact[1], ctx);
    return value == null ? "" : value;
  }
  return src.replace(/\$\{([^}]+)\}/g, (_m, expr) => {
    const value = resolveTemplateExpr(expr, ctx);
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    return JSON.stringify(value);
  });
}

function renderTemplateDeep(value, ctx) {
  if (typeof value === "string") return renderTemplateString(value, ctx);
  if (Array.isArray(value)) return value.map((item) => renderTemplateDeep(item, ctx));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) out[k] = renderTemplateDeep(v, ctx);
  return out;
}

function applyStepInputDefaults(type, inputObj) {
  const t = String(type || "").trim();
  const input = inputObj && typeof inputObj === "object" && !Array.isArray(inputObj) ? { ...inputObj } : {};
  if (t === "data.write_file" && !Object.prototype.hasOwnProperty.call(input, "create_if_missing")) {
    const mode = String(input.mode || "replace").trim().toLowerCase();
    if (mode === "replace" || mode === "append" || mode === "prepend") {
      input.create_if_missing = true;
    }
  }
  return input;
}

function pickWorkflowDefinition(spec, workflowId) {
  const root = spec && typeof spec === "object" && !Array.isArray(spec) ? spec : null;
  if (!root) throw new Error("workflow spec must be an object");

  if (root.workflows && typeof root.workflows === "object" && !Array.isArray(root.workflows)) {
    const id = clampText(workflowId, 120);
    if (!id) throw new Error("workflow.run requires input.workflow when using workflows map");
    const def = root.workflows[id];
    if (!def || typeof def !== "object" || Array.isArray(def)) {
      throw new Error(`workflow '${id}' not found in workflows map`);
    }
    return { workflowId: id, def };
  }

  return { workflowId: clampText(workflowId, 120) || clampText(root.name, 120) || "workflow", def: root };
}

function buildParams(def, input) {
  const paramsSpec = Array.isArray(def.params) ? def.params : [];
  const provided = input && typeof input === "object"
    ? (input.params && typeof input.params === "object" && !Array.isArray(input.params) ? input.params
      : (input.vars && typeof input.vars === "object" && !Array.isArray(input.vars) ? input.vars : {}))
    : {};

  const out = { ...provided };
  for (const p of paramsSpec) {
    if (!p || typeof p !== "object" || Array.isArray(p)) continue;
    const name = String(p.name || "").trim();
    if (!name) continue;
    if (!Object.prototype.hasOwnProperty.call(out, name) && Object.prototype.hasOwnProperty.call(p, "default")) {
      out[name] = p.default;
    }
    if (p.required === true && (out[name] == null || String(out[name]) === "")) {
      throw new Error(`workflow param '${name}' is required`);
    }
  }
  return out;
}

function normalizeSteps(def) {
  const steps = Array.isArray(def.steps) ? def.steps : (Array.isArray(def.jobs) ? def.jobs : []);
  if (!steps.length) throw new Error("workflow must contain non-empty steps/jobs array");
  if (steps.length > 100) throw new Error("workflow supports at most 100 steps");

  const byStepId = new Map();
  const out = [];
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    if (!step || typeof step !== "object" || Array.isArray(step)) {
      throw new Error(`workflow step ${i + 1} must be an object`);
    }
    const id = normalizeStepId(step.id, i);
    if (byStepId.has(id)) throw new Error(`duplicate workflow step id '${id}'`);
    const type = clampText(step.type, 120);
    if (!type) throw new Error(`workflow step '${id}' requires type`);
    if (type === "workflow.run") throw new Error("workflow.run recursion is not allowed");
    const dependsOn = Array.isArray(step.depends_on)
      ? step.depends_on.map((x) => String(x || "").trim()).filter(Boolean)
      : [];
    out.push({ id, type, dependsOn, step });
    byStepId.set(id, true);
  }

  for (const s of out) {
    for (const dep of s.dependsOn) {
      if (!byStepId.has(dep)) throw new Error(`workflow step '${s.id}' depends on unknown step '${dep}'`);
    }
  }
  return out;
}

async function runWorkflow(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("workflow.run input must be an object");
  }
  const safeInput = input || {};
  const workspaceRoot = path.resolve(String(options.workspaceRoot || "/workspace").trim() || "/workspace");
  const createJob = typeof options.createJob === "function" ? options.createJob : null;
  const waitJob = typeof options.waitJob === "function" ? options.waitJob : null;
  if (!createJob) throw new Error("workflow runner missing createJob callback");
  if (!waitJob) throw new Error("workflow runner missing waitJob callback");

  const { abs: workflowAbs, normalized: workflowRel } = normalizeWorkflowPath(
    workspaceRoot,
    safeInput.workflow_file || safeInput.file || "workflows.yaml"
  );
  const workflowId = clampText(safeInput.workflow || safeInput.name, 120);

  let rawText;
  try {
    rawText = fs.readFileSync(workflowAbs, "utf8");
  } catch (e) {
    if (e && e.code === "ENOENT") throw new Error(`workflow file not found: ${workflowRel}`);
    throw e;
  }

  const spec = parseWorkflowSpec(rawText);
  const picked = pickWorkflowDefinition(spec, workflowId);
  const def = picked.def;
  const params = buildParams(def, safeInput);
  const steps = normalizeSteps(def);

  const createdJobs = [];
  const stepJobIdById = {};
  const stepResultById = {};

  const done = new Set();
  while (done.size < steps.length) {
    const ready = steps.filter((s) => !done.has(s.id) && s.dependsOn.every((dep) => done.has(dep)));
    if (ready.length < 1) {
      throw new Error("workflow dependency deadlock");
    }

    for (const s of ready) {
      const templCtx = { params, stepResults: stepResultById };
      const renderedInput = renderTemplateDeep(
        s.step.input && typeof s.step.input === "object" ? s.step.input : {},
        templCtx
      );
      const depIds = s.dependsOn.map((dep) => stepJobIdById[dep]).filter(Boolean);
      const withDefaults = applyStepInputDefaults(s.type, renderedInput);
      const finalInput = depIds.length > 0 ? { ...withDefaults, depends_on: depIds } : withDefaults;

      const queue = clampText(s.step.queue || safeInput.queue || "default", 80) || "default";
      const prio = Number(s.step.priority);
      const timeout = Number(s.step.timeout_sec);
      const attempts = Number(s.step.max_attempts);
      const tags = Array.isArray(s.step.tags)
        ? s.step.tags.map((t) => clampText(t, 40)).filter(Boolean).slice(0, 20)
        : ["workflow", picked.workflowId.slice(0, 32)];

      const jobId = createJob(s.type, finalInput, {
        queue,
        priority: Number.isInteger(prio) ? prio : 5,
        timeoutSec: Number.isInteger(timeout) ? timeout : 120,
        maxAttempts: Number.isInteger(attempts) ? attempts : 1,
        tags
      });

      const doneJob = await waitJob(jobId, {
        timeoutMs: Math.max(1000, (Number.isInteger(timeout) ? timeout : 120) * 1000)
      });
      if (!doneJob || doneJob.status !== "succeeded") {
        const msg = String(doneJob?.error?.message || `workflow step '${s.id}' failed`);
        throw new Error(msg);
      }

      stepJobIdById[s.id] = jobId;
      stepResultById[s.id] = doneJob.result && typeof doneJob.result === "object" ? doneJob.result : {};
      createdJobs.push({
        step_id: s.id,
        job_id: jobId,
        type: s.type,
        depends_on: s.dependsOn
      });
      done.add(s.id);
    }
  }

  const summaryLines = [
    `Workflow '${picked.workflowId}' succeeded.`,
    `Workflow name: ${clampText(def.name || picked.workflowId, 200) || picked.workflowId}`,
    `Workflow file: workflows/${workflowRel}`,
    `Created jobs: ${createdJobs.length}`
  ];
  for (const x of createdJobs) {
    summaryLines.push(`- ${x.step_id}: ${x.type} (job ${x.job_id})`);
  }
  const outputText = summaryLines.join("\n");

  return {
    ok: true,
    workflow: picked.workflowId,
    workflow_name: clampText(def.name || picked.workflowId, 200) || picked.workflowId,
    workflow_file: `workflows/${workflowRel}`,
    created_count: createdJobs.length,
    created_jobs: createdJobs,
    output_text: outputText,
    stdout: outputText
  };
}

module.exports = {
  runWorkflow
};
