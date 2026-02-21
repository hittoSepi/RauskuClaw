// app/lib/holviClient.js
const HOLVI_BASE_URL = process.env.HOLVI_BASE_URL || "http://localhost:8099";
const HOLVI_PROXY_TOKEN = process.env.HOLVI_PROXY_TOKEN || "";

if (!HOLVI_PROXY_TOKEN) {
  // älä kaada startupia jos haluat fallbackin, mutta mieluummin fail-fast prodissa
  console.warn("[holvi] HOLVI_PROXY_TOKEN missing");
}

async function holviHttp({ alias, method, url, headers = {}, body, timeoutMs }) {
  const controller = new AbortController();
  const timeout = timeoutMs ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    const r = await fetch(`${HOLVI_BASE_URL}/v1/proxy/http`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-proxy-token": HOLVI_PROXY_TOKEN,
      },
      body: JSON.stringify({
        secret_alias: alias,
        request: { method, url, headers, body },
      }),
      signal: controller.signal,
    });

    const data = await r.json().catch(() => null);
    if (!r.ok || !data) {
      const msg = data?.error || `holvi proxy error (${r.status})`;
      throw new Error(msg);
    }

    return data; // { status, headers, body }
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

module.exports = { holviHttp };