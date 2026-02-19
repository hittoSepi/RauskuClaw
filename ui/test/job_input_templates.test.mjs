import test from "node:test";
import assert from "node:assert/strict";
import { getInputTemplateForType, validateTypeSpecificInput } from "../src/job_input_templates.js";

test("getInputTemplateForType returns known templates", () => {
  assert.deepEqual(getInputTemplateForType("tool.exec"), {
    command: "git",
    args: ["status", "--short"]
  });
  assert.deepEqual(getInputTemplateForType("data.fetch"), {
    url: "https://api.github.com/",
    timeout_ms: 8000,
    max_bytes: 4096
  });
  assert.deepEqual(getInputTemplateForType("data.file_read"), {
    path: "README.md",
    max_bytes: 262144
  });
  assert.deepEqual(getInputTemplateForType("tools.web_search"), {
    query: "latest node.js release notes",
    provider: "duckduckgo",
    max_results: 5,
    timeout_ms: 8000
  });
  assert.deepEqual(getInputTemplateForType("tools.file_search"), {
    query: "README",
    path: ".",
    max_results: 30
  });
  assert.deepEqual(getInputTemplateForType("tools.find_in_files"), {
    query: "TODO",
    path: ".",
    max_results: 50
  });
  assert.deepEqual(getInputTemplateForType("workflow.run"), {
    workflow: "find_readme",
    params: {
      query: "README"
    }
  });
  assert.equal(getInputTemplateForType("report.generate"), null);
});

test("validateTypeSpecificInput validates tool.exec payload", () => {
  assert.match(
    validateTypeSpecificInput("tool.exec", {}).join("\n"),
    /requires input.command/
  );
  assert.equal(
    validateTypeSpecificInput("tool.exec", { command: "git", args: ["status"] }).length,
    0
  );
  assert.equal(
    validateTypeSpecificInput("tool.exec", { cmd: "git", args: ["status"] }).length,
    0
  );
  assert.equal(
    validateTypeSpecificInput("tool.exec", { script: "git status" }).length,
    0
  );
});

test("validateTypeSpecificInput validates data.fetch payload", () => {
  assert.match(
    validateTypeSpecificInput("data.fetch", { url: "http://example.com" }).join("\n"),
    /must use https/
  );
  assert.equal(
    validateTypeSpecificInput("data.fetch", { url: "https://example.com", timeout_ms: 1000, max_bytes: 1024 }).length,
    0
  );
});

test("validateTypeSpecificInput validates data.file_read payload", () => {
  assert.match(
    validateTypeSpecificInput("data.file_read", {}).join("\n"),
    /requires input\.path/
  );
  assert.equal(
    validateTypeSpecificInput("data.file_read", { path: "README.md", max_bytes: 2048 }).length,
    0
  );
});

test("validateTypeSpecificInput validates tools.web_search payload", () => {
  assert.match(
    validateTypeSpecificInput("tools.web_search", { max_results: 3 }).join("\n"),
    /requires input\.query/
  );
  assert.equal(
    validateTypeSpecificInput("tools.web_search", { query: "nodejs", max_results: 3, timeout_ms: 3000 }).length,
    0
  );
  assert.equal(
    validateTypeSpecificInput("tools.web_search", { query: "nodejs", provider: "brave" }).length,
    0
  );
});

test("validateTypeSpecificInput validates tools.file_search payload", () => {
  assert.match(
    validateTypeSpecificInput("tools.file_search", { path: "." }).join("\n"),
    /requires input\.query/
  );
  assert.equal(
    validateTypeSpecificInput("tools.file_search", { query: "README", path: ".", max_results: 20 }).length,
    0
  );
});

test("validateTypeSpecificInput validates tools.find_in_files payload", () => {
  assert.match(
    validateTypeSpecificInput("tools.find_in_files", { path: "." }).join("\n"),
    /requires input\.query/
  );
  assert.equal(
    validateTypeSpecificInput("tools.find_in_files", { query: "TODO", path: ".", max_results: 20 }).length,
    0
  );
  assert.equal(
    validateTypeSpecificInput("tools.find_in_files", { query: "TODO", files: ["README.md"], regex: false }).length,
    0
  );
});

test("validateTypeSpecificInput validates workflow.run payload", () => {
  assert.match(
    validateTypeSpecificInput("workflow.run", { params: { query: "README" } }).join("\n"),
    /requires input\.workflow/
  );
  assert.equal(
    validateTypeSpecificInput("workflow.run", { workflow: "find_readme", params: { query: "README" } }).length,
    0
  );
});
