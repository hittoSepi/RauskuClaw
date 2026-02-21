const test = require("node:test");
const assert = require("node:assert/strict");
const { holviHttp } = require("../lib/holviClient");

const ENV_KEYS = ["HOLVI_BASE_URL", "HOLVI_PROXY_TOKEN"];

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

test("holviHttp constructs valid proxy request", async () => {
  await withEnv({
    HOLVI_BASE_URL: "http://localhost:8099",
    HOLVI_PROXY_TOKEN: "test-token"
  }, async () => {
    let seenUrl = "";
    let seenBody = null;
    const mockFetch = async (url, init) => {
      seenUrl = String(url);
      seenBody = JSON.parse(String(init?.body || "{}"));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          status: 200,
          headers: { "content-type": "application/json" },
          body: '{"result":"ok"}'
        })
      };
    };

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await holviHttp({
        alias: "sec://test",
        method: "POST",
        url: "https://api.example.com/v1/test",
        headers: { "content-type": "application/json" },
        body: { foo: "bar" }
      });

      assert.equal(seenUrl, "http://localhost:8099/v1/proxy/http");
      assert.equal(seenBody.secret_alias, "sec://test");
      assert.equal(seenBody.request.method, "POST");
      assert.equal(seenBody.request.url, "https://api.example.com/v1/test");
      assert.equal(result.status, 200);
      assert.equal(result.body, '{"result":"ok"}');
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("holviHttp propagates timeout", async () => {
  await withEnv({
    HOLVI_BASE_URL: "http://localhost:8099",
    HOLVI_PROXY_TOKEN: "test-token"
  }, async () => {
    let aborted = false;
    const mockFetch = async (_url, { signal }) => {
      return new Promise((_, reject) => {
        signal.addEventListener("abort", () => {
          aborted = true;
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    };

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      await assert.rejects(
        holviHttp({
          alias: "sec://test",
          method: "GET",
          url: "https://example.com",
          timeoutMs: 100
        }),
        (e) => e.name === "AbortError" || e.message.includes("aborted") || e.message.includes("The operation was aborted")
      );

      assert.equal(aborted, true);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("holviHttp handles proxy errors", async () => {
  await withEnv({
    HOLVI_BASE_URL: "http://localhost:8099",
    HOLVI_PROXY_TOKEN: "test-token"
  }, async () => {
    const mockFetch = async () => ({
      ok: false,
      status: 502,
      json: async () => ({ error: "upstream failed" })
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      await assert.rejects(
        holviHttp({
          alias: "sec://test",
          method: "GET",
          url: "https://example.com"
        }),
        { message: "upstream failed" }
      );
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("holviHttp handles missing response body", async () => {
  await withEnv({
    HOLVI_BASE_URL: "http://localhost:8099",
    HOLVI_PROXY_TOKEN: "test-token"
  }, async () => {
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ status: 200, headers: {}, body: null }) // Valid response with null body
    });

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await holviHttp({
        alias: "sec://test",
        method: "GET",
        url: "https://example.com"
      });

      // Should return the data as-is
      assert.equal(result.status, 200);
      assert.equal(result.body, null);
    } finally {
      global.fetch = originalFetch;
    }
  });
});

test("holviHttp works without timeout", async () => {
  await withEnv({
    HOLVI_BASE_URL: "http://localhost:8099",
    HOLVI_PROXY_TOKEN: "test-token"
  }, async () => {
    let signalAttached = false;
    const mockFetch = async (_url, { signal }) => {
      signalAttached = !!signal;
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: 200, headers: {}, body: '{"ok":true}' })
      };
    };

    const originalFetch = global.fetch;
    global.fetch = mockFetch;

    try {
      const result = await holviHttp({
        alias: "sec://test",
        method: "GET",
        url: "https://example.com"
      });

      assert.equal(signalAttached, true);
      assert.equal(result.status, 200);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
