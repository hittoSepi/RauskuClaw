import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

const API_BASE = '' // Same origin

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

export interface ApiError extends Error {
  status: number
  data: unknown
}

/**
 * Core fetch wrapper with x-api-key header injection
 */
export async function api<T = unknown>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, signal } = options
  
  const authStore = useAuthStore()
  const apiKey = authStore.getApiKey()
  
  const requestHeaders: Record<string, string> = {
    accept: 'application/json',
    ...headers,
  }
  
  // Add x-api-key header if available
  if (apiKey) {
    requestHeaders['x-api-key'] = apiKey
  }
  
  // Add content-type for JSON bodies
  if (body !== undefined && body !== null) {
    requestHeaders['content-type'] = 'application/json'
  }
  
  const response = await fetch(`${API_BASE}${endpoint}`, {
    method,
    headers: requestHeaders,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal,
  })
  
  // Handle response
  const responseText = await response.text()
  let responseData: unknown = null
  
  try {
    responseData = responseText ? JSON.parse(responseText) : null
  } catch {
    responseData = { raw: responseText }
  }
  
  if (!response.ok) {
    const errorData = responseData as { error?: { message?: string } } | undefined
    const errorMessage = 
      errorData?.error?.message || 
      (errorData as { error?: string })?.error ||
      response.statusText ||
      'Request failed'
    
    const error = new Error(errorMessage) as ApiError
    error.status = response.status
    error.data = responseData
    
    // Handle 401/403 - trigger auth gate
    if (response.status === 401 || response.status === 403) {
      const uiStore = useUiStore()
      uiStore.showToast({
        type: 'error',
        message: response.status === 401 
          ? 'Unauthorized: Please check your API key' 
          : 'Forbidden: Access denied',
        duration: 5000,
      })
      
      // Show auth gate
      authStore.showAuthRequired(errorMessage)
    }
    
    throw error
  }
  
  return responseData as T
}

/**
 * API client with typed endpoints
 */
export const apiClient = {
  // Health
  ping: () => api<{ ok: boolean }>('/v1/ping'),
  
  // Auth
  authWhoami: () => api<{ auth?: { role?: string; queue_allowlist?: string[] } }>('/v1/auth/whoami'),
  
  // Runtime
  runtimeProviders: () => api<{ providers: Record<string, unknown> }>('/v1/runtime/providers'),
  runtimeHandlers: () => api<{ handlers: Record<string, unknown> }>('/v1/runtime/handlers'),
  
  // Jobs
  jobs: (params?: Record<string, string | number | boolean>) => {
    const qs = params ? new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString() : ''
    return api<{ jobs: unknown[] }>(`/v1/jobs${qs ? `?${qs}` : ''}`)
  },
  
  job: (id: string) => api<{ job: unknown }>(`/v1/jobs/${encodeURIComponent(id)}`),
  
  jobLogs: (id: string, tail = 200) => 
    api<{ logs: unknown[] }>(`/v1/jobs/${encodeURIComponent(id)}/logs?tail=${tail}`),
  
  createJob: (job: unknown, options?: { idempotencyKey?: string }) => 
    api<{ job: unknown }>('/v1/jobs', {
      method: 'POST',
      body: job,
      headers: options?.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {},
    }),
  
  cancelJob: (id: string) => 
    api<{ ok: boolean }>(`/v1/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  
  // Job types
  jobTypes: () => api<{ types: unknown[] }>('/v1/job-types'),
  
  // Memory
  memories: (params?: Record<string, string | number | boolean>) => {
    const qs = params ? new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString() : ''
    return api<{ memories: unknown[] }>(`/v1/memory${qs ? `?${qs}` : ''}`)
  },
  
  createMemory: (memory: unknown) => 
    api<{ memory: unknown }>('/v1/memory', { method: 'POST', body: memory }),
  
  // Workspace
  workspaceFiles: (params?: { path?: string; limit?: number }) => {
    const qs = params ? new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)])
    ).toString() : ''
    return api<{ path: string; entries: unknown[] }>(`/v1/workspace/files${qs ? `?${qs}` : ''}`)
  },
  
  workspaceFile: (path: string) => 
    api<{ file: { path: string; content: string } }>(`/v1/workspace/file?path=${encodeURIComponent(path)}`),
  
  // UI Prefs
  uiPrefs: (scope = 'default') => 
    api<{ prefs: Record<string, unknown> }>(`/v1/ui-prefs?scope=${encodeURIComponent(scope)}`),
  
  saveUiPrefs: (scope: string, prefs: Record<string, unknown>) => 
    api<{ ok: boolean }>(`/v1/ui-prefs?scope=${encodeURIComponent(scope)}`, {
      method: 'PUT',
      body: { prefs },
    }),
  
  // Schedules
  schedules: (params?: Record<string, string | number | boolean>) => {
    const qs = params ? new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, String(v)])
    ).toString() : ''
    return api<{ schedules: unknown[] }>(`/v1/schedules${qs ? `?${qs}` : ''}`)
  },
}

export default apiClient