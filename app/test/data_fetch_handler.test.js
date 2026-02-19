const test = require("node:test");
const assert = require("node:assert/strict");
const { runDataFetch } = require("../handlers/data_fetch");

function fakeResponse({ ok = true, status = 200, body = "", contentType = "text/plain" } = {}) {
  return {
    ok,
    status,
    headers: {
      get(name) {
        if (String(name).toLowerCase() === "content-type") return contentType;
        return null;
      }
    },
    async arrayBuffer() {
      return Buffer.from(body, "utf8");
    }
  };
}

test("runDataFetch returns parsed response for allowlisted https url", async () => {
  const out = await runDataFetch(
    { url: "https://api.example.com/v1/ping" },
    {
      allowlist: ["example.com"],
      fetchImpl: async () => fakeResponse({ status: 200, body: "{\"ok\":true}", contentType: "application/json" })
    }
  );

  assert.equal(out.ok, true);
  assert.equal(out.status, 200);
  assert.equal(out.truncated, false);
  assert.deepEqual(out.body_json, { ok: true });
});

test("runDataFetch blocks non-https and non-allowlisted domains", async () => {
  await assert.rejects(
    runDataFetch({ url: "http://example.com" }, { allowlist: ["example.com"] }),
    /only https/
  );
  await assert.rejects(
    runDataFetch({ url: "https://evil.invalid" }, { allowlist: ["example.com"] }),
    /not allowlisted/
  );
});

test("runDataFetch clips output by max_bytes", async () => {
  const payload = "a".repeat(1024);
  const out = await runDataFetch(
    { url: "https://api.example.com/data", max_bytes: 512 },
    {
      allowlist: ["example.com"],
      fetchImpl: async () => fakeResponse({ body: payload })
    }
  );
  assert.equal(out.truncated, true);
  assert.equal(out.bytes_read, 512);
  assert.equal(out.body_text, payload.slice(0, 512));
});
