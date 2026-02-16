function getKey() {
  return sessionStorage.getItem("openclaw_api_key") || "";
}

export function setKey(k) {
  sessionStorage.setItem("openclaw_api_key", k || "");
}

export function getApiBase() {
  // Same origin. API is at /v1/*, UI under /ui/
  return "";
}

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const key = getKey();
  const h = {
    ...headers,
    "accept": "application/json"
  };
  if (key) h["x-api-key"] = key;
  if (body != null) h["content-type"] = "application/json";

  const resp = await fetch(getApiBase() + path, {
    method,
    headers: h,
    body: body != null ? JSON.stringify(body) : undefined
  });

  const text = await resp.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!resp.ok) {
    const msg = data?.error?.message || data?.error || resp.statusText || "Request failed";
    const err = new Error(msg);
    err.status = resp.status;
    err.data = data;
    throw err;
  }
  return data;
}

export const api = {
  ping: () => request("/v1/ping"),
  jobTypes: () => request("/v1/job-types"),
  jobs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/jobs" + (qs ? `?${qs}` : ""));
  },
  job: (id) => request(`/v1/jobs/${encodeURIComponent(id)}`),
  jobLogs: (id, tail = 200) => request(`/v1/jobs/${encodeURIComponent(id)}/logs?tail=${tail}`),
  cancelJob: (id) => request(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  createJob: (payload, { idempotencyKey } = {}) => request("/v1/jobs", {
    method: "POST",
    body: payload,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}
  })
};
