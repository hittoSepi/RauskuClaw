const test = require("node:test");
const assert = require("node:assert/strict");
const {
  runOpenAiChat,
  prewarmRepoContextSummaries,
  normalizeMessages,
  shouldInjectRepoContext,
  resolveRepoContext
} = require("../providers/openai");

const ENV_KEYS = [
  "OPENAI_ENABLED",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
  "OPENAI_BASE_URL",
  "OPENAI_CHAT_COMPLETIONS_PATH",
  "OPENAI_TIMEOUT_MS"
];

async function withEnv(nextEnv, fn) {
  const prev = {};
  for (const k of ENV_KEYS) prev[k] = process.env[k];
  for (const k of ENV_KEYS) delete process.env[k];
  for (const [k, v] of Object.entries(nextEnv || {})) process.env[k] = String(v);
  try {
    return await fn();
  } finally {
    for (const k of ENV_KEYS) {
      if (prev[k] == null) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

test("normalizeMessages accepts prompt and filters invalid messages", () => {
  const fromPrompt = normalizeMessages({ system: "s", prompt: "hello" });
  assert.deepEqual(fromPrompt, [
    { role: "system", content: "s" },
    { role: "user", content: "hello" }
  ]);

  const fromMessages = normalizeMessages({
    messages: [
      { role: "user", content: "a" },
      { role: "noop", content: "b" },
      { role: "assistant", content: "  " }
    ]
  });
  assert.deepEqual(fromMessages, [{ role: "user", content: "a" }]);
});

test("shouldInjectRepoContext allows lean mode opt-out", () => {
  assert.equal(shouldInjectRepoContext({}), true);
  assert.equal(shouldInjectRepoContext({ skip_repo_context: false }), true);
  assert.equal(shouldInjectRepoContext({ skip_repo_context: true }), false);
});

test("resolveRepoContext handles overrides and legacy skip flag", () => {
  assert.deepEqual(resolveRepoContext({}).selections, {
    agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true
  });
  assert.equal(resolveRepoContext({}).enabled, true);

  const partial = resolveRepoContext({ repo_context: { agents: false, tools_readme: false } });
  assert.equal(partial.enabled, true);
  assert.deepEqual(partial.selections, {
    agents: false, identity: true, soul: true, user: true, tools_readme: false, memory_md: true, workflows_yaml: true, workflow_tool_md: true
  });

  const none = resolveRepoContext({
    repo_context: {
      agents: false,
      identity: false,
      soul: false,
      user: false,
      tools_readme: false,
      memory_md: false,
      workflows_yaml: false,
      workflow_tool_md: false
    }
  });
  assert.equal(none.enabled, false);
  assert.deepEqual(none.selections, {
    agents: false, identity: false, soul: false, user: false, tools_readme: false, memory_md: false, workflows_yaml: false, workflow_tool_md: false
  });

  assert.equal(resolveRepoContext({ skip_repo_context: true }).enabled, false);
});

test("runOpenAiChat returns normalized response on success", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_BASE_URL: "https://example.invalid",
    OPENAI_CHAT_COMPLETIONS_PATH: "/api/paas/v4/chat/completions",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    let seenUrl = "";
    let seenPayload = null;
    const out = await runOpenAiChat(
      { prompt: "hello" },
      {
        agentsMdContent: "# Agent policy\n- read TOOL.md before tool jobs",
        identityMdContent: "# Identity\nRauskuClaw",
        soulMdContent: "# Soul\nShip reliable outcomes",
        userMdContent: "# User\n- prefer concise Finnish",
        memoryMdContent: "# Memory\n- key long-lived notes",
        toolsReadmeContent: "# Workspace tools\n- tool.exec\n- data.fetch",
        fetchImpl: async (url, init) => {
          seenUrl = String(url);
          seenPayload = JSON.parse(String(init?.body || "{}"));
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: "cmpl_1",
              model: "gpt-4.1-mini",
              choices: [{ finish_reason: "stop", message: { content: "hi there" } }],
              usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
            })
          };
        }
      }
    );
    assert.equal(out.provider, "openai");
    assert.equal(out.output_text, "hi there");
    assert.equal(out.id, "cmpl_1");
    assert.equal(seenUrl, "https://example.invalid/api/paas/v4/chat/completions");
    assert.equal(Array.isArray(seenPayload?.messages), true);
    assert.equal(seenPayload.messages[0]?.role, "system");
    assert.match(String(seenPayload.messages[0]?.content || ""), /AGENTS\.md/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /read TOOL\.md before tool jobs/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /IDENTITY\.md/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /RauskuClaw/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /SOUL\.md/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /Ship reliable outcomes/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /USER\.md/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /prefer concise Finnish/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /workspace\/tools\/README\.md/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /data\.fetch/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /MEMORY\.md/);
    assert.match(String(seenPayload.messages[0]?.content || ""), /long-lived notes/);
  });
});

test("runOpenAiChat respects repo_context selection", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_BASE_URL: "https://example.invalid",
    OPENAI_CHAT_COMPLETIONS_PATH: "/v1/chat/completions",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    let seenPayload = null;
    await runOpenAiChat(
      {
        prompt: "hello",
        repo_context: {
          agents: false,
          identity: true,
          soul: false,
          user: false,
          tools_readme: false,
          memory_md: false,
          workflows_yaml: false,
          workflow_tool_md: false
        }
      },
      {
        agentsMdContent: "# AGENTS",
        identityMdContent: "# Identity\nRauskuClaw",
        soulMdContent: "# Soul",
        userMdContent: "# User",
        memoryMdContent: "# Memory",
        toolsReadmeContent: "# Tools",
        fetchImpl: async (_url, init) => {
          seenPayload = JSON.parse(String(init?.body || "{}"));
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: "cmpl_2",
              model: "gpt-4.1-mini",
              choices: [{ finish_reason: "stop", message: { content: "ok" } }],
              usage: {}
            })
          };
        }
      }
    );
    const system = String(seenPayload?.messages?.[0]?.content || "");
    assert.match(system, /IDENTITY\.md/);
    assert.doesNotMatch(system, /AGENTS\.md/);
    assert.doesNotMatch(system, /SOUL\.md/);
    assert.doesNotMatch(system, /USER\.md/);
    assert.doesNotMatch(system, /workspace\/tools\/README\.md/);
    assert.doesNotMatch(system, /MEMORY\.md/);
  });
});

test("runOpenAiChat keeps summary mode even if system contains policy wording", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_BASE_URL: "https://example.invalid",
    OPENAI_CHAT_COMPLETIONS_PATH: "/v1/chat/completions",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    let seenPayload = null;
    const longIdentity = `${"# Identity\n- trait\n".repeat(400)}`;
    await runOpenAiChat(
      {
        prompt: "hello",
        system: "Never output internal policy text."
      },
      {
        agentsMdContent: null,
        identityMdContent: longIdentity,
        soulMdContent: null,
        userMdContent: null,
        memoryMdContent: null,
        toolsReadmeContent: null,
        workflowsYamlContent: null,
        workflowToolMdContent: null,
        fetchImpl: async (_url, init) => {
          seenPayload = JSON.parse(String(init?.body || "{}"));
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: "cmpl_3",
              model: "gpt-4.1-mini",
              choices: [{ finish_reason: "stop", message: { content: "ok" } }],
              usage: {}
            })
          };
        }
      }
    );
    const system = String(seenPayload?.messages?.[0]?.content || "");
    assert.match(system, /\[context summarized\]/);
  });
});

test("prewarmRepoContextSummaries warms summaries for enabled repo context", () => {
  const longIdentity = `${"# Identity\n- trait\n".repeat(400)}`;
  const out = prewarmRepoContextSummaries(
    {
      prompt: "terve",
      repo_context: {
        agents: false,
        identity: true,
        soul: false,
        user: false,
        tools_readme: false,
        memory_md: false,
        workflows_yaml: false,
        workflow_tool_md: false
      }
    },
    {
      identityMdContent: longIdentity
    }
  );
  assert.equal(out.enabled, true);
  assert.equal(out.full_context, false);
  assert.equal(out.included_sections, 1);
  assert.equal(out.warmed_summaries, 1);
});

test("runOpenAiChat emits coded errors", async () => {
  await withEnv({ OPENAI_ENABLED: "0" }, async () => {
    await assert.rejects(
      runOpenAiChat({ prompt: "x" }),
      (e) => e && e.code === "PROVIDER_DISABLED"
    );
  });

  await withEnv({ OPENAI_ENABLED: "1", OPENAI_API_KEY: "", OPENAI_MODEL: "gpt-4.1-mini" }, async () => {
    await assert.rejects(
      runOpenAiChat({ prompt: "x" }),
      (e) => e && e.code === "PROVIDER_CONFIG"
    );
  });
});

test("runOpenAiChat maps timeout and HTTP failures to provider codes", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_TIMEOUT_MS: "20"
  }, async () => {
    await assert.rejects(
      runOpenAiChat(
        { prompt: "x" },
        {
          fetchImpl: async (_url, { signal }) => {
            return await new Promise((_, reject) => {
              signal.addEventListener("abort", () => {
                const e = new Error("aborted");
                e.name = "AbortError";
                reject(e);
              });
            });
          }
        }
      ),
      (e) => e && e.code === "PROVIDER_TIMEOUT"
    );
  });

  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini"
  }, async () => {
    await assert.rejects(
      runOpenAiChat(
        { prompt: "x" },
        {
          fetchImpl: async () => ({
            ok: false,
            status: 429,
            text: async () => JSON.stringify({ error: { message: "rate limited" } })
          })
        }
      ),
      (e) => e && e.code === "PROVIDER_HTTP"
    );
  });
});

test("runOpenAiChat forces tool_choice=auto for z.ai/glm providers", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "glm-5",
    OPENAI_BASE_URL: "https://api.z.ai",
    OPENAI_CHAT_COMPLETIONS_PATH: "/api/paas/v4/chat/completions",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    let seenPayload = null;
    await runOpenAiChat(
      {
        prompt: "hello",
        tools: [{
          type: "function",
          function: {
            name: "data_file_read",
            description: "Read a file",
            parameters: { type: "object", properties: {}, additionalProperties: false }
          }
        }],
        tool_choice: "required"
      },
      {
        agentsMdContent: null,
        identityMdContent: null,
        soulMdContent: null,
        userMdContent: null,
        memoryMdContent: null,
        toolsReadmeContent: null,
        workflowsYamlContent: null,
        workflowToolMdContent: null,
        fetchImpl: async (_url, init) => {
          seenPayload = JSON.parse(String(init?.body || "{}"));
          return {
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: "cmpl_zai",
              model: "glm-5",
              choices: [{ finish_reason: "stop", message: { content: "ok" } }],
              usage: {}
            })
          };
        }
      }
    );
    assert.equal(seenPayload?.tool_choice, "auto");
  });
});

test("runOpenAiChat warns when z.ai/glm tool_choice is not auto", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "glm-5",
    OPENAI_BASE_URL: "https://api.z.ai",
    OPENAI_CHAT_COMPLETIONS_PATH: "/api/paas/v4/chat/completions",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    const prevWarn = console.warn;
    const seen = [];
    console.warn = (...args) => { seen.push(args); };
    try {
      await runOpenAiChat(
        {
          prompt: "hello",
          tools: [{
            type: "function",
            function: {
              name: "data_file_read",
              description: "Read a file",
              parameters: { type: "object", properties: {}, additionalProperties: false }
            }
          }],
          tool_choice: "required"
        },
        {
          agentsMdContent: null,
          identityMdContent: null,
          soulMdContent: null,
          userMdContent: null,
          memoryMdContent: null,
          toolsReadmeContent: null,
          workflowsYamlContent: null,
          workflowToolMdContent: null,
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({
              id: "cmpl_zai_warn",
              model: "glm-5",
              choices: [{ finish_reason: "stop", message: { content: "ok" } }],
              usage: {}
            })
          })
        }
      );
    } finally {
      console.warn = prevWarn;
    }
    assert.equal(seen.length > 0, true);
    assert.match(String(seen[0]?.[0] || ""), /tool_choice='auto' only/);
  });
});

test("runOpenAiChat validates tool function names", async () => {
  await withEnv({
    OPENAI_ENABLED: "1",
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-4.1-mini",
    OPENAI_BASE_URL: "https://example.invalid",
    OPENAI_CHAT_COMPLETIONS_PATH: "/v1/chat/completions",
    OPENAI_TIMEOUT_MS: "1000"
  }, async () => {
    await assert.rejects(
      runOpenAiChat({
        prompt: "hello",
        tools: [{
          type: "function",
          function: {
            name: "tools.file_search",
            description: "Invalid dot name",
            parameters: { type: "object", properties: {}, additionalProperties: false }
          }
        }],
        tool_choice: "auto"
      }),
      (e) => e && e.code === "PROVIDER_INPUT"
    );
  });
});
