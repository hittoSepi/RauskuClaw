const test = require("node:test");
const assert = require("node:assert/strict");
const { runToolExec } = require("../handlers/tool_exec");

test("runToolExec executes allowlisted command without shell", async () => {
  const out = await runToolExec(
    {
      command: process.execPath,
      args: ["-e", "process.exit(0)"]
    },
    {
      allowlist: [process.execPath],
      defaultTimeoutMs: 1000
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.code, 0);
});

test("runToolExec rejects command outside allowlist", async () => {
  await assert.rejects(
    runToolExec({ command: "bash", args: ["-lc", "echo nope"] }, { allowlist: ["node"] }),
    /command not allowed/
  );
});

test("runToolExec falls back to sh -lc when command is not allowlisted but sh is allowlisted", async () => {
  const out = await runToolExec(
    {
      command: "echo",
      args: ["hello from fallback"]
    },
    {
      allowlist: ["sh"],
      defaultTimeoutMs: 1000
    }
  );
  assert.equal(out.ok, true);
  assert.match(String(out.stdout || ""), /hello from fallback/);
});

test("runToolExec returns timeout result", async () => {
  const out = await runToolExec(
    {
      command: process.execPath,
      args: ["-e", "setTimeout(()=>{}, 5000)"],
      timeout_ms: 120
    },
    {
      allowlist: [process.execPath],
      defaultTimeoutMs: 5000
    }
  );
  assert.equal(out.ok, false);
  assert.equal(out.timed_out, true);
});

test("runToolExec accepts inline command line when executable is allowlisted", async () => {
  const out = await runToolExec(
    {
      command: `${process.execPath} -e "process.exit(0)"`
    },
    {
      allowlist: [process.execPath],
      defaultTimeoutMs: 1000
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.code, 0);
});

test("runToolExec rejects inline command line when executable is not allowlisted", async () => {
  await assert.rejects(
    runToolExec(
      { command: "sh -c ls" },
      { allowlist: ["node"] }
    ),
    /command not allowed/
  );
});

test("runToolExec auto-wraps shell operators under sh -lc when sh is allowlisted", async () => {
  const out = await runToolExec(
    {
      command: "echo hello && echo world"
    },
    {
      allowlist: ["sh"],
      defaultTimeoutMs: 1000
    }
  );
  assert.equal(out.ok, true);
  assert.match(String(out.stdout || ""), /hello/);
  assert.match(String(out.stdout || ""), /world/);
});

test("runToolExec rejects shell operators when sh is not allowlisted", async () => {
  await assert.rejects(
    runToolExec(
      { command: "echo hello && echo world" },
      { allowlist: ["echo"] }
    ),
    /sh.*not allowlisted/i
  );
});

test("runToolExec accepts command aliases cmd/script", async () => {
  const outFromCmd = await runToolExec(
    { cmd: `${process.execPath} -e "process.exit(0)"` },
    { allowlist: [process.execPath], defaultTimeoutMs: 1000 }
  );
  assert.equal(outFromCmd.ok, true);

  const outFromScript = await runToolExec(
    { script: `${process.execPath} -e "process.exit(0)"` },
    { allowlist: [process.execPath], defaultTimeoutMs: 1000 }
  );
  assert.equal(outFromScript.ok, true);
});
