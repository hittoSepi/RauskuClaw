function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function normalizePositiveInt(raw, fallback, { min = 1, max = 50 } = {}) {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`value must be integer ${min}..${max}`);
  }
  return n;
}

function toResultItem(raw) {
  const item = raw && typeof raw === "object" ? raw : {};
  const textFallback = clampText(item.text || item.Text || "", 1200);
  const titleFromText = textFallback ? textFallback.split(" - ")[0] : "";
  const title = clampText(item.title || item.heading || item.Heading || titleFromText, 200);
  const url = clampText(item.url || item.firstURL || item.FirstURL || "", 2000);
  const snippet = clampText(item.snippet || item.text || item.Text || "", 1200);
  if (!title || !url) return null;
  return { title, url, snippet };
}

function flattenRelatedTopics(list, out = []) {
  for (const entry of Array.isArray(list) ? list : []) {
    if (entry && typeof entry === "object" && Array.isArray(entry.Topics)) {
      flattenRelatedTopics(entry.Topics, out);
      continue;
    }
    const item = toResultItem(entry);
    if (item) out.push(item);
  }
  return out;
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html) {
  return decodeHtml(String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

function parseDdgHtmlResults(html, maxResults) {
  const src = String(html || "");
  const out = [];
  const seen = new Set();
  const resultRe = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = resultRe.exec(src)) && out.length < maxResults) {
    const url = decodeHtml(m[1] || "").trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    const title = stripTags(m[2] || "").slice(0, 200);

    let snippet = "";
    const tail = src.slice(m.index, Math.min(src.length, m.index + 2000));
    const snippetMatch = tail.match(/<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || tail.match(/<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (snippetMatch) snippet = stripTags(snippetMatch[1] || "").slice(0, 1200);

    if (!title) continue;
    out.push({ title, url: url.slice(0, 2000), snippet });
  }
  return out;
}

async function runWebSearch(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("tools.web_search input must be an object");
  }
  const safeInput = input || {};
  const query = clampText(safeInput.query || safeInput.q, 500);
  if (!query) throw new Error("tools.web_search requires input.query");

  const defaultTimeoutMs = normalizePositiveInt(options.defaultTimeoutMs, 8000, { min: 200, max: 120000 });
  const timeoutMs = normalizePositiveInt(safeInput.timeout_ms, defaultTimeoutMs, { min: 200, max: 120000 });
  const defaultMaxResults = normalizePositiveInt(options.defaultMaxResults, 5, { min: 1, max: 20 });
  const maxResults = normalizePositiveInt(safeInput.max_results, defaultMaxResults, { min: 1, max: 20 });
  const provider = clampText(safeInput.provider || options.provider, 40).toLowerCase() || "duckduckgo";
  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : fetch;
  const baseUrl = clampText(options.baseUrl, 2000) || "https://api.duckduckgo.com";

  if (provider === "brave") {
    const braveEndpoint = clampText(options.braveEndpoint, 2000) || "https://api.search.brave.com/res/v1/web/search";
    const braveApiKey = clampText(options.braveApiKey, 500);
    if (!braveApiKey) throw new Error("tools.web_search brave requires API key");

    const endpoint = new URL(braveEndpoint);
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("count", String(maxResults));

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetchImpl(endpoint.toString(), {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-subscription-token": braveApiKey
        },
        signal: ctrl.signal
      });
    } catch (e) {
      if (String(e?.name || "") === "AbortError") {
        throw new Error(`tools.web_search request timed out after ${timeoutMs}ms`);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (!resp.ok) {
      throw new Error(`tools.web_search upstream status ${resp.status}`);
    }
    const data = await resp.json();
    const src = Array.isArray(data?.web?.results) ? data.web.results : [];
    const out = [];
    const seen = new Set();
    for (const item of src) {
      const normalized = toResultItem({
        title: item?.title,
        url: item?.url,
        snippet: item?.description
      });
      if (!normalized) continue;
      if (seen.has(normalized.url)) continue;
      seen.add(normalized.url);
      out.push(normalized);
      if (out.length >= maxResults) break;
    }
    return {
      ok: true,
      query,
      provider: "brave",
      result_count: out.length,
      results: out
    };
  }

  const endpoint = new URL("/?format=json&no_html=1&no_redirect=1&skip_disambig=1", baseUrl);
  endpoint.searchParams.set("q", query);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetchImpl(endpoint.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      signal: ctrl.signal
    });
  } catch (e) {
    if (String(e?.name || "") === "AbortError") {
      throw new Error(`tools.web_search request timed out after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }

  if (!resp.ok) {
    throw new Error(`tools.web_search upstream status ${resp.status}`);
  }
  const data = await resp.json();
  const primary = [];
  const heading = clampText(data?.Heading || "", 200);
  const abstractUrl = clampText(data?.AbstractURL || "", 2000);
  const abstractText = clampText(data?.AbstractText || "", 1200);
  if (heading && abstractUrl) {
    primary.push({ title: heading, url: abstractUrl, snippet: abstractText });
  }
  const related = flattenRelatedTopics(data?.RelatedTopics, []);
  const uniq = [];
  const seen = new Set();
  for (const item of [...primary, ...related]) {
    const key = String(item?.url || "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    uniq.push(item);
    if (uniq.length >= maxResults) break;
  }

  let providerName = "duckduckgo";
  let results = uniq;

  if (results.length < 1 && options.enableHtmlFallback !== false) {
    const htmlUrl = new URL("/html/", baseUrl);
    htmlUrl.searchParams.set("q", query);
    const htmlCtrl = new AbortController();
    const htmlTimer = setTimeout(() => htmlCtrl.abort(), timeoutMs);
    try {
      const htmlResp = await fetchImpl(htmlUrl.toString(), {
        method: "GET",
        headers: { accept: "text/html" },
        signal: htmlCtrl.signal
      });
      if (htmlResp.ok && typeof htmlResp.text === "function") {
        const html = await htmlResp.text();
        const parsed = parseDdgHtmlResults(html, maxResults);
        if (parsed.length > 0) {
          providerName = "duckduckgo_html_fallback";
          results = parsed;
        }
      }
    } catch {
      // keep empty result from primary provider
    } finally {
      clearTimeout(htmlTimer);
    }
  }

  return {
    ok: true,
    query,
    provider: providerName,
    result_count: results.length,
    results
  };
}

module.exports = {
  runWebSearch
};
