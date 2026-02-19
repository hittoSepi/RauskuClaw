function clampText(value, maxLen) {
  return String(value || "").trim().slice(0, maxLen);
}

function splitCsv(value) {
  return String(value || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function normalizeAllowlist(raw) {
  const list = Array.isArray(raw) ? raw : splitCsv(raw);
  return Array.from(
    new Set(
      list
        .map((x) => clampText(x, 200).toLowerCase())
        .filter(Boolean)
    )
  );
}

function isHostAllowed(url, allowlist) {
  const host = String(url.hostname || "").toLowerCase();
  return allowlist.some((d) => host === d || host.endsWith(`.${d}`));
}

function normalizeMaxBytes(raw, fallback = 65536) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 512 || n > 1024 * 1024) return fallback;
  return n;
}

function normalizeTimeoutMs(raw, fallback = 8000) {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 200 || n > 120000) return fallback;
  return n;
}

async function runDataFetch(input, options = {}) {
  if (input != null && (typeof input !== "object" || Array.isArray(input))) {
    throw new Error("data.fetch input must be an object");
  }
  const safeInput = input || {};
  const fetchImpl = options.fetchImpl || fetch;
  const allowlist = normalizeAllowlist(options.allowlist || []);
  if (allowlist.length < 1) {
    throw new Error("data.fetch allowlist is empty");
  }

  const rawUrl = clampText(safeInput.url, 4000);
  if (!rawUrl) throw new Error("url is required");
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("url must be valid absolute URL");
  }
  if (url.protocol !== "https:") {
    throw new Error("only https:// URLs are allowed");
  }
  if (!isHostAllowed(url, allowlist)) {
    throw new Error(`domain not allowlisted: ${url.hostname}`);
  }

  const maxBytes = normalizeMaxBytes(
    safeInput.max_bytes,
    normalizeMaxBytes(options.defaultMaxBytes, 65536)
  );
  const timeoutMs = normalizeTimeoutMs(
    safeInput.timeout_ms,
    normalizeTimeoutMs(options.defaultTimeoutMs, 8000)
  );

  const startedAt = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetchImpl(url.toString(), {
      method: "GET",
      headers: { accept: "*/*" },
      signal: ctrl.signal
    });
    const buffer = Buffer.from(await resp.arrayBuffer());
    const clipped = buffer.length > maxBytes ? buffer.subarray(0, maxBytes) : buffer;
    const text = clipped.toString("utf8");
    const contentType = String(resp.headers?.get?.("content-type") || "");

    let bodyJson = null;
    if (contentType.toLowerCase().includes("application/json")) {
      try { bodyJson = JSON.parse(text); } catch {}
    }

    return {
      ok: resp.ok,
      status: resp.status,
      url: url.toString(),
      content_type: contentType || null,
      body_text: text,
      body_json: bodyJson,
      truncated: buffer.length > maxBytes,
      bytes_read: clipped.length,
      duration_ms: Date.now() - startedAt
    };
  } catch (e) {
    if (e?.name === "AbortError") {
      throw new Error(`data.fetch timeout after ${timeoutMs}ms`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  runDataFetch
};
