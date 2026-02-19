const test = require("node:test");
const assert = require("node:assert/strict");
const { runWebSearch } = require("../handlers/web_search");

function fakeResponse({ ok = true, status = 200, json = {} } = {}) {
  return {
    ok,
    status,
    async json() { return json; }
  };
}

test("runWebSearch returns normalized results", async () => {
  const out = await runWebSearch(
    { query: "nodejs" },
    {
      fetchImpl: async () => fakeResponse({
        json: {
          Heading: "Node.js",
          AbstractURL: "https://nodejs.org/",
          AbstractText: "JavaScript runtime.",
          RelatedTopics: [
            { Text: "Express - web framework", FirstURL: "https://expressjs.com/" }
          ]
        }
      })
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.provider, "duckduckgo");
  assert.equal(out.result_count, 2);
  assert.equal(out.results[0].url, "https://nodejs.org/");
});

test("runWebSearch validates query", async () => {
  await assert.rejects(
    runWebSearch({}),
    /requires input\.query/
  );
});

test("runWebSearch falls back to duckduckgo html when instant results are empty", async () => {
  let call = 0;
  const out = await runWebSearch(
    { query: "finland news 2025", max_results: 3 },
    {
      fetchImpl: async () => {
        call += 1;
        if (call === 1) {
          return fakeResponse({ json: { RelatedTopics: [] } });
        }
        return {
          ok: true,
          status: 200,
          async text() {
            return `
              <html><body>
                <a class="result__a" href="https://example.com/news1">News One</a>
                <a class="result__snippet">Top story summary</a>
                <a class="result__a" href="https://example.com/news2">News Two</a>
              </body></html>
            `;
          }
        };
      }
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.provider, "duckduckgo_html_fallback");
  assert.equal(out.result_count, 2);
  assert.equal(out.results[0].url, "https://example.com/news1");
});

test("runWebSearch supports brave provider", async () => {
  const out = await runWebSearch(
    { query: "finland", provider: "brave", max_results: 2 },
    {
      braveApiKey: "test-key",
      fetchImpl: async () => fakeResponse({
        json: {
          web: {
            results: [
              { title: "News One", url: "https://example.com/1", description: "desc1" },
              { title: "News Two", url: "https://example.com/2", description: "desc2" }
            ]
          }
        }
      })
    }
  );
  assert.equal(out.ok, true);
  assert.equal(out.provider, "brave");
  assert.equal(out.result_count, 2);
  assert.equal(out.results[0].url, "https://example.com/1");
});
