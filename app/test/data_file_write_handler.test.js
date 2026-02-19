const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { runDataFileWrite } = require("../handlers/data_file_write");

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "rauskuclaw-file-write-"));
}

function sha256(text) {
  return crypto.createHash("sha256").update(String(text || ""), "utf8").digest("hex");
}

test("runDataFileWrite replace writes file content", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "notes.txt");
  fs.writeFileSync(file, "old", "utf8");

  const out = await runDataFileWrite(
    { path: "notes.txt", mode: "replace", content: "new" },
    { workspaceRoot: ws }
  );
  assert.equal(out.ok, true);
  assert.equal(out.changed, true);
  assert.equal(fs.readFileSync(file, "utf8"), "new");
});

test("runDataFileWrite supports append and insert_at", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "a.txt");
  fs.writeFileSync(file, "abcd", "utf8");

  await runDataFileWrite({ path: "a.txt", mode: "append", content: "ef" }, { workspaceRoot: ws });
  assert.equal(fs.readFileSync(file, "utf8"), "abcdef");

  await runDataFileWrite({ path: "a.txt", mode: "insert_at", offset: 3, content: "-" }, { workspaceRoot: ws });
  assert.equal(fs.readFileSync(file, "utf8"), "abc-def");
});

test("runDataFileWrite supports replace_range", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "b.txt");
  fs.writeFileSync(file, "0123456789", "utf8");

  await runDataFileWrite(
    { path: "b.txt", mode: "replace_range", start: 2, end: 7, content: "XX" },
    { workspaceRoot: ws }
  );
  assert.equal(fs.readFileSync(file, "utf8"), "01XX789");
});

test("runDataFileWrite targeted modes require existing file", async () => {
  const ws = makeTempWorkspace();
  await assert.rejects(
    runDataFileWrite(
      { path: "missing.txt", mode: "insert_at", offset: 0, content: "x", create_if_missing: true },
      { workspaceRoot: ws }
    ),
    /requires an existing file/
  );
});

test("runDataFileWrite dry_run returns preview without writing", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "dry.txt");
  fs.writeFileSync(file, "before", "utf8");

  const out = await runDataFileWrite(
    { path: "dry.txt", mode: "replace", content: "after", dry_run: true },
    { workspaceRoot: ws }
  );
  assert.equal(out.ok, true);
  assert.equal(out.dry_run, true);
  assert.equal(fs.readFileSync(file, "utf8"), "before");
});

test("runDataFileWrite enforces expected_sha256", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "lock.txt");
  fs.writeFileSync(file, "alpha", "utf8");

  await assert.rejects(
    runDataFileWrite(
      { path: "lock.txt", mode: "replace", content: "beta", expected_sha256: "0".repeat(64) },
      { workspaceRoot: ws }
    ),
    /sha256 mismatch/
  );

  const out = await runDataFileWrite(
    { path: "lock.txt", mode: "replace", content: "beta", expected_sha256: sha256("alpha") },
    { workspaceRoot: ws }
  );
  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), "beta");
});

test("runDataFileWrite blocks path escape", async () => {
  const ws = makeTempWorkspace();
  await assert.rejects(
    runDataFileWrite({ path: "../etc/passwd", mode: "replace", content: "x" }, { workspaceRoot: ws }),
    /escapes workspace root/
  );
});

test("runDataFileWrite accepts content_base64", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "b64.txt");
  const content = "Hei maailma\nline2";
  const contentBase64 = Buffer.from(content, "utf8").toString("base64");
  const out = await runDataFileWrite(
    { path: "b64.txt", mode: "replace", content_base64: contentBase64, create_if_missing: true },
    { workspaceRoot: ws }
  );
  assert.equal(out.ok, true);
  assert.equal(fs.readFileSync(file, "utf8"), content);
});

test("runDataFileWrite rejects content and content_base64 together", async () => {
  const ws = makeTempWorkspace();
  const file = path.join(ws, "mix.txt");
  fs.writeFileSync(file, "x", "utf8");
  await assert.rejects(
    runDataFileWrite(
      { path: "mix.txt", mode: "replace", content: "a", content_base64: "Yg==" },
      { workspaceRoot: ws }
    ),
    /mutually exclusive/
  );
});
