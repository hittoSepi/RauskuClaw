const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runWorkflow } = require("../handlers/workflow_run");

test("runWorkflow parses yaml and enqueues dependent jobs", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-run-"));
  const workflowsDir = path.join(tmp, "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, "workflows.yaml"), [
    "workflows:",
    "  demo:",
    "    name: Demo",
    "    params:",
    "      - name: query",
    "        type: string",
    "        required: true",
    "    steps:",
    "      - id: first",
    "        type: tools.file_search",
    "        input:",
    "          query: \"${query}\"",
    "          path: \".\"",
    "      - id: second",
    "        type: data.file_read",
    "        depends_on: [first]",
    "        input:",
    "          path: \"${first.matches.0.path}\""
  ].join("\n"), "utf8");

  const created = [];
  const out = await runWorkflow(
    { workflow: "demo", params: { query: "README" } },
    {
      workspaceRoot: tmp,
      createJob: (type, input, opts) => {
        const id = `job-${created.length + 1}`;
        created.push({ id, type, input, opts });
        return id;
      },
      waitJob: async (jobId) => {
        if (jobId === "job-1") return { status: "succeeded", result: { matches: [{ path: "README.md" }] }, error: null };
        return { status: "succeeded", result: { path: "README.md" }, error: null };
      }
    }
  );

  assert.equal(out.ok, true);
  assert.equal(out.created_count, 2);
  assert.equal(created[0].type, "tools.file_search");
  assert.equal(created[0].input.query, "README");
  assert.equal(created[1].type, "data.file_read");
  assert.equal(created[1].input.path, "README.md");
  assert.deepEqual(created[1].input.depends_on, ["job-1"]);
});

test("runWorkflow defaults create_if_missing=true for data.write_file non-targeted modes", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wf-run-write-"));
  const workflowsDir = path.join(tmp, "workflows");
  fs.mkdirSync(workflowsDir, { recursive: true });
  fs.writeFileSync(path.join(workflowsDir, "workflows.yaml"), [
    "workflows:",
    "  writer:",
    "    steps:",
    "      - id: write",
    "        type: data.write_file",
    "        input:",
    "          path: out.txt",
    "          mode: replace",
    "          content: hello"
  ].join("\n"), "utf8");

  const created = [];
  await runWorkflow(
    { workflow: "writer" },
    {
      workspaceRoot: tmp,
      createJob: (type, input, opts) => {
        const id = `job-${created.length + 1}`;
        created.push({ id, type, input, opts });
        return id;
      },
      waitJob: async () => ({ status: "succeeded", result: {}, error: null })
    }
  );

  assert.equal(created.length, 1);
  assert.equal(created[0].type, "data.write_file");
  assert.equal(created[0].input.create_if_missing, true);
});
