function getKey() {
  return sessionStorage.getItem("rauskuclaw_api_key") || "";
}

export function setKey(k) {
  sessionStorage.setItem("rauskuclaw_api_key", k || "");
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
  authWhoami: () => request("/v1/auth/whoami"),
  runtimeProviders: () => request("/v1/runtime/providers"),
  runtimeHandlers: () => request("/v1/runtime/handlers"),
  prewarmRepoContext: (payload = {}) => request("/v1/runtime/repo-context/prewarm", {
    method: "POST",
    body: payload
  }),
  uiPrefs: (scope = "default") => request(`/v1/ui-prefs?scope=${encodeURIComponent(String(scope || "default"))}`),
  saveUiPrefs: (scope = "default", prefs = {}) => request(`/v1/ui-prefs?scope=${encodeURIComponent(String(scope || "default"))}`, {
    method: "PUT",
    body: { prefs }
  }),
  workspaceFiles: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/workspace/files" + (qs ? `?${qs}` : ""));
  },
  workspaceFile: (filePath) => request(`/v1/workspace/file?path=${encodeURIComponent(String(filePath || ""))}`),
  createWorkspaceEntry: (payload) => request("/v1/workspace/create", {
    method: "POST",
    body: payload
  }),
  moveWorkspaceEntry: (payload) => request("/v1/workspace/move", {
    method: "PATCH",
    body: payload
  }),
  uploadWorkspaceFile: (payload) => request("/v1/workspace/upload", {
    method: "POST",
    body: payload
  }),
  updateWorkspaceFile: (filePath, content) => request("/v1/workspace/file", {
    method: "PUT",
    body: { path: String(filePath || ""), content: String(content ?? "") }
  }),
  deleteWorkspaceFile: (filePath) => request(`/v1/workspace/file?path=${encodeURIComponent(String(filePath || ""))}`, {
    method: "DELETE"
  }),
  downloadWorkspaceFile: async (filePath) => {
    const key = getKey();
    const headers = key ? { "x-api-key": key } : {};
    const resp = await fetch(
      getApiBase() + `/v1/workspace/download?path=${encodeURIComponent(String(filePath || ""))}`,
      { method: "GET", headers }
    );
    if (!resp.ok) {
      const text = await resp.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = null; }
      const msg = data?.error?.message || resp.statusText || "Download failed";
      const err = new Error(msg);
      err.status = resp.status;
      err.data = data;
      throw err;
    }
    const blob = await resp.blob();
    const cd = String(resp.headers.get("content-disposition") || "");
    const match = cd.match(/filename=\"?([^\";]+)\"?/i);
    return { blob, filename: match?.[1] || "download.bin" };
  },
  jobTypes: () => request("/v1/job-types"),
  updateJobType: (name, payload) => request(`/v1/job-types/${encodeURIComponent(name)}`, {
    method: "PATCH",
    body: payload
  }),
  createJobType: (payload) => request("/v1/job-types", {
    method: "POST",
    body: payload
  }),
  jobs: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/jobs" + (qs ? `?${qs}` : ""));
  },
  job: (id) => request(`/v1/jobs/${encodeURIComponent(id)}`),
  jobLogs: (id, tail = 200) => request(`/v1/jobs/${encodeURIComponent(id)}/logs?tail=${tail}`),
  cancelJob: (id) => request(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  schedules: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/schedules" + (qs ? `?${qs}` : ""));
  },
  schedule: (id) => request(`/v1/schedules/${encodeURIComponent(id)}`),
  createSchedule: (payload) => request("/v1/schedules", {
    method: "POST",
    body: payload
  }),
  updateSchedule: (id, payload) => request(`/v1/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: payload
  }),
  deleteSchedule: (id) => request(`/v1/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE"
  }),
  memoryScopes: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/memory/scopes" + (qs ? `?${qs}` : ""));
  },
  memories: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/memory" + (qs ? `?${qs}` : ""));
  },
  createMemory: (payload) => request("/v1/memory", {
    method: "POST",
    body: payload
  }),
  memoryReset: ({ scope } = {}) => request("/v1/memory/reset", {
    method: "POST",
    body: {
      confirm: true,
      ...(scope ? { scope: String(scope) } : {})
    }
  }),
  createJob: (payload, { idempotencyKey } = {}) => request("/v1/jobs", {
    method: "POST",
    body: payload,
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}
  }),
  submitJobIntent: (payload) => request("/v1/jobs/submit-intent", {
    method: "POST",
    body: payload
  }),
  // Working Memory API
  workingMemory: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request("/v1/working-memory" + (qs ? `?${qs}` : ""));
  },
  workingMemoryLatest: () => request("/v1/working-memory/latest"),
  saveWorkingMemory: (payload) => request("/v1/working-memory", {
    method: "POST",
    body: payload
  }),
  clearWorkingMemory: (sessionId) => request(
    `/v1/working-memory?session_id=${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  )
};
