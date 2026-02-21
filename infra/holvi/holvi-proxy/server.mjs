import http from "node:http";
import fs from "node:fs";

const PORT = Number(process.env.PORT || 8099);
const PROXY_SHARED_TOKEN = process.env.PROXY_SHARED_TOKEN || "";
const INFISICAL_BASE_URL = process.env.INFISICAL_BASE_URL || "";
const INFISICAL_SERVICE_TOKEN = process.env.INFISICAL_SERVICE_TOKEN || "";
const INFISICAL_ENV = process.env.INFISICAL_ENV || "prod";
const ALIAS_REGISTRY_PATH = process.env.ALIAS_REGISTRY_PATH || "/app/aliases.json";

if (!PROXY_SHARED_TOKEN) throw new Error("PROXY_SHARED_TOKEN missing");
if (!INFISICAL_BASE_URL) throw new Error("INFISICAL_BASE_URL missing");
if (!INFISICAL_SERVICE_TOKEN) throw new Error("INFISICAL_SERVICE_TOKEN missing");

import path from "node:path";

const stat = fs.statSync(ALIAS_REGISTRY_PATH);
if (!stat.isFile()) {
  throw new Error(`ALIAS_REGISTRY_PATH must be a file: ${ALIAS_REGISTRY_PATH}`);
}

const aliases = JSON.parse(fs.readFileSync(ALIAS_REGISTRY_PATH, "utf8"));

function readJson(req) {
  return new Promise((resolve, reject) => {
    let buf = "";
    req.on("data", (c) => (buf += c));
    req.on("end", () => {
      try {
        resolve(buf ? JSON.parse(buf) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

function send(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(obj));
}

function redactHeaders(headers) {
  const h = { ...headers };
  for (const k of Object.keys(h)) {
    const lk = k.toLowerCase();
    if (lk === "authorization" || lk === "x-api-key" || lk.includes("token") || lk.includes("api_key")) {
      h[k] = "[REDACTED]";
    }
  }
  return h;
}

function validateAllow(aliasCfg, reqSpec) {
  const url = new URL(reqSpec.url);
  const host = url.host;
  const method = String(reqSpec.method || "GET").toUpperCase();

  const allow = aliasCfg.allow || {};
  const hosts = allow.hosts || [];
  const methods = allow.methods || [];

  if (hosts.length && !hosts.includes(host)) throw new Error(`Host not allowed: ${host}`);
  if (methods.length && !methods.includes(method)) throw new Error(`Method not allowed: ${method}`);

  return { url, method };
}

/**
 * NOTE: Infisical API endpoint/payload may vary by version.
 * This is a placeholder implementation that we'll “lock in” after probing
 * the actual Infisical REST endpoint with your service token.
 */
async function getSecretFromInfisical(secretName) {
  const workspaceId = process.env.INFISICAL_PROJECT_ID || "";
  if (!workspaceId) throw new Error("INFISICAL_PROJECT_ID missing (workspaceId)");

  const u = new URL("/api/v3/secrets/raw", INFISICAL_BASE_URL);
  u.searchParams.set("environment", INFISICAL_ENV);
  u.searchParams.set("secretName", secretName);
  u.searchParams.set("workspaceId", workspaceId);

  const r = await fetch(u.toString(), {
    headers: {
      Authorization: `Bearer ${INFISICAL_SERVICE_TOKEN}`,
      "content-type": "application/json",
    },
  });

  const text = await r.text().catch(() => "");
  if (!r.ok) {
    throw new Error(`Infisical secret fetch failed (${r.status}): ${text.slice(0, 200)}`);
  }

  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error("Infisical returned non-JSON response");
  }

  // v3 raw returns { secrets: [...] }
  const first = Array.isArray(data.secrets) ? data.secrets[0] : null;
  const value = first?.value ?? first?.secretValue ?? first?.secret?.value;

  if (typeof value !== "string" || !value) throw new Error("Infisical returned empty secret value");

  return value;
}

async function handleProxyHttp(req, res) {
  // auth: shared token header
  const token = req.headers["x-proxy-token"];
  if (token !== PROXY_SHARED_TOKEN) return send(res, 401, { error: "unauthorized" });

  const body = await readJson(req);
  const { secret_alias, request } = body || {};
  if (!secret_alias || !request?.url) return send(res, 400, { error: "missing secret_alias or request.url" });

  const aliasCfg = aliases[secret_alias];
  if (!aliasCfg) return send(res, 404, { error: "unknown secret_alias" });

  let url, method;
  try {
    ({ url, method } = validateAllow(aliasCfg, request));
  } catch (e) {
    return send(res, 403, { error: e.message || "not allowed" });
  }

  const secretName = aliasCfg.infisical?.secretName;
  if (!secretName) return send(res, 500, { error: "alias missing infisical.secretName" });

  let real;
  try {
    real = await getSecretFromInfisical(secretName);
  } catch {
    return send(res, 502, { error: "secret fetch failed" });
  }

  const headers = { ...(request.headers || {}) };
  const usage = aliasCfg.usage?.type;

  if (usage === "x-api-key") headers["x-api-key"] = real;
  else headers["authorization"] = `Bearer ${real}`;

  const out = await fetch(url.toString(), {
    method,
    headers,
    body: request.body ? JSON.stringify(request.body) : undefined,
  });

  const text = await out.text();

  // audit (no query string, redacted headers)
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    secret_alias,
    method,
    url: `${url.origin}${url.pathname}`,
    req_headers: redactHeaders(headers),
    status: out.status,
  }));

  return send(res, 200, {
    status: out.status,
    headers: Object.fromEntries(out.headers.entries()),
    body: text,
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/health") return send(res, 200, { ok: true });
    if (req.method === "POST" && req.url === "/v1/proxy/http") return await handleProxyHttp(req, res);
    return send(res, 404, { error: "not found" });
  } catch {
    return send(res, 500, { error: "internal error" });
  }
});

server.listen(PORT, () => console.log(`holvi-proxy listening on :${PORT}`));