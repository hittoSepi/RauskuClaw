const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { runDataFileRead } = require("../handlers/data_file_read");

function makeTempWorkspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rauskuclaw-file-read-"));
  return dir;
}

test("runDataFileRead reads file from workspace root", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "notes.txt");
  fs.writeFileSync(file, "hello world", "utf8");

  const out = await runDataFileRead({ path: "notes.txt" }, { workspaceRoot: ws, defaultMaxBytes: 65536 });
  assert.equal(out.ok, true);
  assert.equal(out.path, "notes.txt");
  assert.equal(out.truncated, false);
  assert.equal(out.content_text, "hello world");
});

test("runDataFileRead blocks path escape", async () => {
  const ws = makeTempWorkspace();
  await assert.rejects(
    runDataFileRead({ path: "../etc/passwd" }, { workspaceRoot: ws }),
    /escapes workspace root/
  );
});

test("runDataFileRead clips output with max_bytes", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "big.txt");
  fs.writeFileSync(file, "a".repeat(2048), "utf8");

  const out = await runDataFileRead({ path: "big.txt", max_bytes: 512 }, { workspaceRoot: ws });
  assert.equal(out.truncated, true);
  assert.equal(out.bytes_read, 512);
  assert.equal(out.content_text.length, 512);
});

test("runDataFileRead accepts leading workspace/ prefix for convenience", async () => {
  const ws = makeTempWorkspace();
  fs.mkdirSync(path.join(ws, "tools"), { recursive: true });
  const file = path.join(ws, "tools", "TOOL.md");
  fs.writeFileSync(file, "tool guide", "utf8");

  const out = await runDataFileRead({ path: "workspace/tools/TOOL.md" }, { workspaceRoot: ws, defaultMaxBytes: 65536 });
  assert.equal(out.ok, true);
  assert.equal(out.path, "tools/TOOL.md");
  assert.equal(out.content_text, "tool guide");
});
