const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runFileSearch } = require("../handlers/file_search");

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rausku-file-search-"));
}

test("runFileSearch finds files by query under workspace root", async () => {
  const root = makeWorkspace();
  fs.mkdirSync(path.join(root, "docs"), { recursive: true });
  fs.writeFileSync(path.join(root, "README.md"), "hello");
  fs.writeFileSync(path.join(root, "docs", "PLAN.md"), "plan");

  const out = await runFileSearch(
    { query: "readme", path: "." },
    { workspaceRoot: root, defaultMaxResults: 20 }
  );
  assert.equal(out.ok, true);
  assert.equal(out.result_count, 1);
  assert.equal(out.matches[0].path, "README.md");
});

test("runFileSearch blocks path traversal", async () => {
  const root = makeWorkspace();
  await assert.rejects(
    runFileSearch({ query: "x", path: "../" }, { workspaceRoot: root }),
    /path escapes workspace root/
  );
});

test("runFileSearch tries filename variations when exact query has no match", async () => {
  const root = makeWorkspace();
  fs.writeFileSync(path.join(root, "my-file_name.md"), "ok");

  const out = await runFileSearch(
    { query: "my file name", path: "." },
    { workspaceRoot: root, defaultMaxResults: 20 }
  );
  assert.equal(out.ok, true);
  assert.equal(out.result_count, 1);
  assert.equal(out.matches[0].path, "my-file_name.md");
});

test("runFileSearch supports camelCase and Finnish characters in query variants", async () => {
  const root = makeWorkspace();
  fs.writeFileSync(path.join(root, "MikaTamanNimiNytOn.md"), "ok");

  const out = await runFileSearch(
    { query: "MikäTämänNimiNytOn", path: "." },
    { workspaceRoot: root, defaultMaxResults: 20 }
  );
  assert.equal(out.ok, true);
  assert.equal(out.result_count, 1);
  assert.equal(out.matches[0].path, "MikaTamanNimiNytOn.md");
});

test("runFileSearch supports multi-step continuation with cursor_offset", async () => {
  const root = makeWorkspace();
  for (let i = 0; i < 180; i += 1) {
    fs.writeFileSync(path.join(root, `file-${i}.txt`), "x");
  }

  const first = await runFileSearch(
    { query: "file-", path: ".", max_results: 10, max_scanned: 100 },
    { workspaceRoot: root, defaultMaxResults: 10 }
  );
  assert.equal(first.ok, true);
  assert.equal(first.has_more, true);
  assert.equal(first.result_count, 10);
  assert.ok(first.next_cursor_offset > 0);

  const second = await runFileSearch(
    { query: "file-", path: ".", max_results: 10, max_scanned: 100, cursor_offset: first.next_cursor_offset },
    { workspaceRoot: root, defaultMaxResults: 10 }
  );
  assert.equal(second.ok, true);
  assert.ok(second.cursor_offset >= first.next_cursor_offset);
});
