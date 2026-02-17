const test = require("node:test");
const assert = require("node:assert/strict");
const {
  resolveWorkingDirectory,
  isTransientExecFailure,
  readCodexAuthMode,
  stripKnownCodexNoise,
  backoffDelayMs,
  extractCodexFailureDetail,
  buildCommandPreview,
  normalizeCodexInput,
  buildCodexCommand,
  parseCodexEvents,
  runCodexOssChat
} = require("../providers/codex_oss");

const ENV_KEYS = [
  "CODEX_OSS_ENABLED",
  "CODEX_OSS_MODEL",
  "CODEX_EXEC_MODE",
  "CODEX_OSS_LOCAL_PROVIDER",
  "CODEX_OSS_TIMEOUT_MS",
  "CODEX_OSS_WORKDIR",
  "CODEX_CLI_PATH"
];

async function withEnv(nextEnv, fn) {
  const prev = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(nextEnv || {})) {
    process.env[k] = String(v);
  }
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("normalizeCodexInput supports prompt-only and messages", () => {
  const p1 = normalizeCodexInput({ prompt: "hello" });
  assert.match(p1, /user:\nhello/);

  const p2 = normalizeCodexInput({
    system: "be concise",
    messages: [
      { role: "user", content: "first" },
      { role: "assistant", content: "second" }
    ]
  });
  assert.match(p2, /System:\nbe concise/);
  assert.match(p2, /user:\nfirst/);
  assert.match(p2, /assistant:\nsecond/);
});

test("normalizeCodexInput rejects empty input", () => {
  assert.throws(
    () => normalizeCodexInput({ messages: [{ role: "user", content: "   " }] }),
    /requires 'prompt' or non-empty 'messages'/i
  );
});

test("resolveWorkingDirectory falls back to /app when configured path is missing", () => {
  const wd = resolveWorkingDirectory("/definitely/missing/workdir");
  assert.equal(wd, "/app");
});

test("readCodexAuthMode returns null when auth file is missing", () => {
  assert.equal(readCodexAuthMode("/definitely/missing/codex-home"), null);
});

test("isTransientExecFailure detects stream/network transport errors", () => {
  assert.equal(isTransientExecFailure("stream disconnected before completion"), true);
  assert.equal(isTransientExecFailure("error sending request for url (https://api.openai.com/responses)"), true);
  assert.equal(isTransientExecFailure("No running Ollama server detected"), false);
});

test("backoffDelayMs grows exponentially with caps from caller", () => {
  assert.equal(backoffDelayMs(0, 0), 0);
  assert.equal(backoffDelayMs(100, 0), 100);
  assert.equal(backoffDelayMs(100, 1), 200);
  assert.equal(backoffDelayMs(100, 2), 400);
});

test("extractCodexFailureDetail prefers JSON turn/error message over stderr noise", () => {
  const detail = extractCodexFailureDetail({
    stderrText: "ERROR rollout path missing",
    stdoutLines: [
      '{"type":"turn.started"}',
      '{"type":"error","message":"stream disconnected before completion: error sending request for url (https://api.openai.com/responses)"}',
      '{"type":"turn.failed","error":{"message":"stream disconnected before completion: error sending request for url (https://api.openai.com/responses)"}}'
    ]
  });
  assert.match(detail, /stream disconnected before completion/);
  assert.doesNotMatch(detail, /rollout path missing/);
});

test("stripKnownCodexNoise removes rollout/state db noise lines", () => {
  const cleaned = stripKnownCodexNoise([
    "2026-02-17T00:00:00Z ERROR codex_core::rollout::list: state db missing rollout path for thread abc",
    "2026-02-17T00:00:01Z WARN codex_core::state_db: state db record_discrepancy: find_thread_path_by_id_str_in_subdir, falling_back",
    "stream disconnected before completion: error sending request for url (https://api.openai.com/responses)"
  ].join("\n"));
  assert.equal(cleaned, "stream disconnected before completion: error sending request for url (https://api.openai.com/responses)");
});

test("buildCodexCommand contains required deterministic flags for online mode", () => {
  const cmd = buildCodexCommand("hello world", {
    codexPath: "/usr/bin/codex",
    execMode: "online",
    localProvider: "ollama",
    workingDirectory: "/app",
    model: "qwen2.5-coder:7b"
  });
  assert.equal(cmd.cmd, "/usr/bin/codex");
  assert.equal(cmd.args[0], "exec");
  assert.ok(cmd.args.includes("--json"));
  assert.ok(cmd.args.includes("--sandbox"));
  assert.ok(cmd.args.includes("workspace-write"));
  assert.ok(cmd.args.includes("--config"));
  assert.ok(cmd.args.includes('approval_policy="never"'));
  assert.ok(cmd.args.includes("--skip-git-repo-check"));
  assert.ok(cmd.args.includes("--cd"));
  assert.ok(cmd.args.includes("-m"));
  assert.equal(cmd.args[cmd.args.length - 1], "hello world");
});

test("buildCodexCommand adds oss flags when exec mode is oss", () => {
  const cmd = buildCodexCommand("hello world", {
    codexPath: "/usr/bin/codex",
    execMode: "oss",
    localProvider: "ollama",
    workingDirectory: "/app",
    model: "qwen2.5-coder:7b"
  });
  assert.deepEqual(cmd.args.slice(0, 5), [
    "exec",
    "--oss",
    "--local-provider", "ollama",
    "--json"
  ]);
});

test("buildCommandPreview redacts prompt content but keeps command shape", () => {
  const command = buildCodexCommand("secret prompt text", {
    codexPath: "/app/node_modules/.bin/codex",
    execMode: "online",
    localProvider: "ollama",
    workingDirectory: "/workspace",
    model: "gpt-5.3-codex"
  });
  const preview = buildCommandPreview(command, "secret prompt text");
  assert.match(preview, /codex/);
  assert.match(preview, /exec/);
  assert.match(preview, /--cd/);
  assert.match(preview, /<prompt:18 chars>/);
  assert.doesNotMatch(preview, /secret prompt text/);
});

test("parseCodexEvents extracts output text and usage", () => {
  const lines = [
    '{"type":"turn.started"}',
    '{"type":"item.completed","item":{"type":"agent_message","text":"hello from codex"}}',
    '{"type":"turn.completed","usage":{"input_tokens":10,"cached_input_tokens":0,"output_tokens":5}}'
  ];
  const parsed = parseCodexEvents(lines);
  assert.equal(parsed.outputText, "hello from codex");
  assert.deepEqual(parsed.usage, { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 });
  assert.equal(parsed.parsedEvents, 3);
});

test("runCodexOssChat fails when provider disabled", async () => {
  await withEnv({ CODEX_OSS_ENABLED: "0", CODEX_OSS_MODEL: "qwen2.5-coder:7b" }, async () => {
    await assert.rejects(
      runCodexOssChat({ prompt: "hello" }),
      (e) => e && e.code === "PROVIDER_DISABLED"
    );
  });
});

test("runCodexOssChat fails when model missing", async () => {
  await withEnv({ CODEX_OSS_ENABLED: "1", CODEX_OSS_MODEL: "" }, async () => {
    await assert.rejects(
      runCodexOssChat({ prompt: "hello" }),
      (e) => e && e.code === "PROVIDER_CONFIG"
    );
  });
});

test("runCodexOssChat propagates non-zero command exit", async () => {
  await withEnv({ CODEX_OSS_ENABLED: "1", CODEX_OSS_MODEL: "qwen2.5-coder:7b" }, async () => {
    await assert.rejects(
      runCodexOssChat(
        { prompt: "hello" },
        {
          runCommand: async () => ({
            code: 1,
            timedOut: false,
            stderrText: "No running Ollama server detected",
            stdoutLines: []
          })
        }
      ),
      (e) => e && e.code === "PROVIDER_EXEC" && /No running Ollama server detected/.test(String(e.message || ""))
    );
  });
});

test("runCodexOssChat fails on timeout", async () => {
  await withEnv({ CODEX_OSS_ENABLED: "1", CODEX_OSS_MODEL: "qwen2.5-coder:7b" }, async () => {
    await assert.rejects(
      runCodexOssChat(
        { prompt: "hello" },
        {
          runCommand: async () => ({
            code: 1,
            timedOut: true,
            stderrText: "",
            stdoutLines: []
          })
        }
      ),
      (e) => e && e.code === "PROVIDER_TIMEOUT"
    );
  });
});

test("runCodexOssChat fails with actionable message when codex binary is missing", async () => {
  await withEnv({ CODEX_OSS_ENABLED: "1", CODEX_OSS_MODEL: "qwen2.5-coder:7b" }, async () => {
    await assert.rejects(
      runCodexOssChat(
        { prompt: "hello" },
        {
          runCommand: async () => {
            const e = new Error("spawn ENOENT");
            e.code = "ENOENT";
            throw e;
          }
        }
      ),
      (e) => e && e.code === "PROVIDER_NOT_FOUND"
    );
  });
});

test("runCodexOssChat retries with fallback command when configured codex path is missing", async () => {
  await withEnv(
    {
      CODEX_OSS_ENABLED: "1",
      CODEX_OSS_MODEL: "qwen2.5-coder:7b",
      CODEX_CLI_PATH: "/usr/bin/codex-missing"
    },
    async () => {
      const seen = [];
      const out = await runCodexOssChat(
        { prompt: "hello" },
        {
          runCommand: async (command) => {
            seen.push(command.cmd);
            if (seen.length === 1) {
              const e = new Error("spawn ENOENT");
              e.code = "ENOENT";
              throw e;
            }
            return {
              code: 0,
              timedOut: false,
              stderrText: "",
              stdoutLines: [
                '{"type":"item.completed","item":{"type":"agent_message","text":"fallback ok"}}',
                '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":1}}'
              ]
            };
          }
        }
      );
      assert.ok(seen.length >= 2);
      assert.equal(seen[0], "/usr/bin/codex-missing");
      assert.equal(out.output_text, "fallback ok");
    }
  );
});

test("runCodexOssChat returns normalized output on success", async () => {
  await withEnv(
    {
      CODEX_OSS_ENABLED: "1",
      CODEX_OSS_MODEL: "qwen2.5-coder:7b",
      CODEX_EXEC_MODE: "online",
      CODEX_OSS_LOCAL_PROVIDER: "ollama"
    },
    async () => {
      const out = await runCodexOssChat(
        { prompt: "hello" },
        {
          runCommand: async (command) => {
            assert.equal(command.cmd.includes("codex"), true);
            return {
              code: 0,
              timedOut: false,
              stderrText: "",
              stdoutLines: [
                '{"type":"item.completed","item":{"type":"agent_message","text":"Hi there"}}',
                '{"type":"turn.completed","usage":{"input_tokens":1,"cached_input_tokens":0,"output_tokens":2}}'
              ]
            };
          }
        }
      );
      assert.deepEqual(out, {
        provider: "codex-cli",
        local_provider: null,
        model: "qwen2.5-coder:7b",
        command_preview: out.command_preview,
        codex_home: out.codex_home,
        transient_retries: 0,
        auth_mode: out.auth_mode,
        output_text: "Hi there",
        usage: { input_tokens: 1, cached_input_tokens: 0, output_tokens: 2 },
        raw_events_count: 2
      });
      assert.match(out.command_preview, /exec/);
      assert.match(out.command_preview, /<prompt:/);
      assert.match(out.codex_home, /codex-home/);
      assert.ok(out.auth_mode === "chatgpt" || out.auth_mode == null);
    }
  );
});

test("runCodexOssChat retries once on transient stream disconnect and succeeds", async () => {
  await withEnv(
    {
      CODEX_OSS_ENABLED: "1",
      CODEX_OSS_MODEL: "gpt-5.3-codex",
      CODEX_EXEC_MODE: "online"
    },
    async () => {
      let runs = 0;
      const out = await runCodexOssChat(
        { prompt: "hello" },
        {
          sleep: async () => {},
          runCommand: async () => {
            runs += 1;
            if (runs === 1) {
              return {
                code: 1,
                timedOut: false,
                stderrText: "",
                stdoutLines: [
                  '{"type":"error","message":"stream disconnected before completion: error sending request for url (https://api.openai.com/responses)"}',
                  '{"type":"turn.failed","error":{"message":"stream disconnected before completion: error sending request for url (https://api.openai.com/responses)"}}'
                ]
              };
            }
            return {
              code: 0,
              timedOut: false,
              stderrText: "",
              stdoutLines: [
                '{"type":"item.completed","item":{"type":"agent_message","text":"retry ok"}}',
                '{"type":"turn.completed","usage":{"input_tokens":3,"cached_input_tokens":0,"output_tokens":2}}'
              ]
            };
          }
        }
      );
      assert.equal(runs, 2);
      assert.equal(out.output_text, "retry ok");
      assert.equal(out.transient_retries, 1);
    }
  );
});
