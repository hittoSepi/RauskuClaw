/**
 * HTTP client for RauskuClaw API
 */

const API_URL = process.env.RAUSKUCLAW_API_URL || 'http://localhost:3001';
const API_KEY = process.env.RAUSKUCLAW_API_KEY || '';

if (!API_KEY) {
  console.error('[rauskuclaw-mcp] Warning: RAUSKUCLAW_API_KEY not set');
}

/**
 * Make an authenticated request to the RauskuClaw API
 * @param {string} method - HTTP method
 * @param {string} path - API path (e.g., '/v1/jobs')
 * @param {object} options - Request options
 * @param {object} [options.body] - Request body
 * @param {object} [options.query] - Query parameters
 * @param {string} [options.contentType] - Content-Type header
 * @returns {Promise<{ok: boolean, data?: any, error?: {code: string, message: string, details?: any}, status: number}>}
 */
async function apiRequest(method, path, options = {}) {
  const { body, query, contentType = 'application/json' } = options;
  
  let url = `${API_URL}${path}`;
  if (query && Object.keys(query).length > 0) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }
    url += `?${params.toString()}`;
  }

  const headers = {
    'x-api-key': API_KEY,
  };
  if (contentType) {
    headers['content-type'] = contentType;
  }

  const fetchOptions = {
    method,
    headers,
  };

  if (body && method !== 'GET' && method !== 'HEAD') {
    fetchOptions.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, fetchOptions);
    const responseText = await response.text();
    
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      data = { raw: responseText };
    }

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: data.error || {
          code: 'API_ERROR',
          message: `HTTP ${response.status}: ${responseText.slice(0, 200)}`,
        },
      };
    }

    return {
      ok: true,
      status: response.status,
      data,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      error: {
        code: 'NETWORK_ERROR',
        message: String(e?.message || e),
      },
    };
  }
}

// Convenience methods
const api = {
  get: (path, query) => apiRequest('GET', path, { query }),
  post: (path, body) => apiRequest('POST', path, { body }),
  put: (path, body) => apiRequest('PUT', path, { body }),
  patch: (path, body) => apiRequest('PATCH', path, { body }),
  delete: (path, query) => apiRequest('DELETE', path, { query }),
};

// Jobs
async function createJob(params) {
  return api.post('/v1/jobs', params);
}

async function listJobs(query = {}) {
  return api.get('/v1/jobs', query);
}

async function getJob(jobId) {
  return api.get(`/v1/jobs/${jobId}`);
}

async function cancelJob(jobId) {
  return api.post(`/v1/jobs/${jobId}/cancel`);
}

async function getJobLogs(jobId, tail = 200) {
  return api.get(`/v1/jobs/${jobId}/logs`, { tail });
}

// Job Types
async function listJobTypes() {
  return api.get('/v1/job-types');
}

async function createJobType(params) {
  return api.post('/v1/job-types', params);
}

async function updateJobType(name, params) {
  return api.patch(`/v1/job-types/${name}`, params);
}

// Memory
async function listMemory(query = {}) {
  return api.get('/v1/memory', query);
}

async function getMemoryScopes(query = {}) {
  return api.get('/v1/memory/scopes', query);
}

async function getMemory(memoryId) {
  return api.get(`/v1/memory/${memoryId}`);
}

async function writeMemory(params) {
  return api.post('/v1/memory', params);
}

async function deleteMemory(memoryId) {
  return api.delete(`/v1/memory/${memoryId}`);
}

async function resetMemory(params = {}) {
  return api.post('/v1/memory/reset', params);
}

async function searchMemory(params) {
  return api.post('/v1/memory/search', params);
}

// Working Memory
async function listWorkingMemory(query = {}) {
  return api.get('/v1/working-memory', query);
}

async function getLatestWorkingMemory() {
  return api.get('/v1/working-memory/latest');
}

async function saveWorkingMemory(params) {
  return api.post('/v1/working-memory', params);
}

async function clearWorkingMemory(sessionId) {
  return api.delete('/v1/working-memory', { session_id: sessionId });
}

// Schedules
async function listSchedules(query = {}) {
  return api.get('/v1/schedules', query);
}

async function getSchedule(scheduleId) {
  return api.get(`/v1/schedules/${scheduleId}`);
}

async function createSchedule(params) {
  return api.post('/v1/schedules', params);
}

async function updateSchedule(scheduleId, params) {
  return api.patch(`/v1/schedules/${scheduleId}`, params);
}

async function deleteSchedule(scheduleId) {
  return api.delete(`/v1/schedules/${scheduleId}`);
}

// Workspace
async function listWorkspace(path = '.', limit = 200) {
  return api.get('/v1/workspace/files', { path, limit });
}

async function readFile(path) {
  return api.get('/v1/workspace/file', { path });
}

async function writeFile(path, content) {
  return api.put('/v1/workspace/file', { path, content });
}

async function deleteFile(path) {
  return api.delete('/v1/workspace/file', { path });
}

async function downloadFile(path) {
  return api.get('/v1/workspace/download', { path });
}

async function uploadFile(path, contentBase64, overwrite = false) {
  return api.post('/v1/workspace/upload', { path, content_base64: contentBase64, overwrite });
}

async function createEntry(path, kind = 'file', content = '', overwrite = false) {
  return api.post('/v1/workspace/create', { path, kind, content, overwrite });
}

async function moveEntry(fromPath, toPath, overwrite = false) {
  return api.patch('/v1/workspace/move', { from_path: fromPath, to_path: toPath, overwrite });
}

// Runtime
async function getProviders() {
  return api.get('/v1/runtime/providers');
}

async function getHandlers() {
  return api.get('/v1/runtime/handlers');
}

async function getMetrics(query = {}) {
  return api.get('/v1/runtime/metrics', query);
}

async function getWhoami() {
  return api.get('/v1/auth/whoami');
}

// UI Prefs
async function getUiPrefs(scope = 'default') {
  return api.get('/v1/ui-prefs', { scope });
}

async function setUiPrefs(scope, prefs) {
  return api.put('/v1/ui-prefs', { prefs }, { query: { scope } });
}

module.exports = {
  api,
  apiRequest,
  // Jobs
  createJob,
  listJobs,
  getJob,
  cancelJob,
  getJobLogs,
  // Job Types
  listJobTypes,
  createJobType,
  updateJobType,
  // Memory
  listMemory,
  getMemoryScopes,
  getMemory,
  writeMemory,
  deleteMemory,
  resetMemory,
  searchMemory,
  // Working Memory
  listWorkingMemory,
  getLatestWorkingMemory,
  saveWorkingMemory,
  clearWorkingMemory,
  // Schedules
  listSchedules,
  getSchedule,
  createSchedule,
  updateSchedule,
  deleteSchedule,
  // Workspace
  listWorkspace,
  readFile,
  writeFile,
  deleteFile,
  downloadFile,
  uploadFile,
  createEntry,
  moveEntry,
  // Runtime
  getProviders,
  getHandlers,
  getMetrics,
  getWhoami,
  // UI Prefs
  getUiPrefs,
  setUiPrefs,
};