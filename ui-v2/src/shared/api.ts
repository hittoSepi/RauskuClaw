import { useAuthStore } from '../stores/auth.store'
import { useUiStore } from '../stores/ui.store'

const API_BASE = '' // Same origin

/**
 * Normalized API Error Codes
 * These provide a deterministic way to identify error types across the app
 */
export type ApiErrorCode = 
  | 'HTTP_400' | 'HTTP_401' | 'HTTP_403' | 'HTTP_404' | 'HTTP_429' | 'HTTP_500' | 'HTTP_502' | 'HTTP_503'
  | `HTTP_${number}`  // Catch-all for other HTTP status codes
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'UNKNOWN'

/**
 * Normalized API Error Shape
 * All API calls produce errors with this consistent shape
 */
export interface NormalizedApiError extends Error {
  /** Deterministic error code for programmatic handling */
  code: ApiErrorCode
  /** Human-readable error message */
  message: string
  /** HTTP status code if available */
  status?: number
  /** Server response payload if available */
  details?: unknown
  /** Request URL if available */
  url?: string
}

/**
 * Create a normalized API error
 */
function createApiError(
  code: ApiErrorCode,
  message: string,
  options: {
    status?: number
    details?: unknown
    url?: string
    cause?: Error
  } = {}
): NormalizedApiError {
  const error = new Error(message) as NormalizedApiError
  // Set cause manually for broader compatibility
  if (options.cause) {
    ;(error as Error & { cause?: Error }).cause = options.cause
  }
  error.code = code
  error.status = options.status
  error.details = options.details
  error.url = options.url
  error.name = 'ApiError'
  return error
}

/**
 * Map HTTP status to error code
 */
function getHttpErrorCode(status: number): ApiErrorCode {
  switch (status) {
    case 400: return 'HTTP_400'
    case 401: return 'HTTP_401'
    case 403: return 'HTTP_403'
    case 404: return 'HTTP_404'
    case 429: return 'HTTP_429'
    case 500: return 'HTTP_500'
    case 502: return 'HTTP_502'
    case 503: return 'HTTP_503'
    default: return `HTTP_${status}` as ApiErrorCode
  }
}

/**
 * Check if an error is a normalized API error
 */
export function isApiError(error: unknown): error is NormalizedApiError {
  return error instanceof Error && 'code' in error && typeof (error as NormalizedApiError).code === 'string'
}

/**
 * Check if error is a network error (server unreachable)
 */
export function isNetworkError(error: unknown): boolean {
  return isApiError(error) && error.code === 'NETWORK_ERROR'
}

/**
 * Check if error is an auth error (401/403)
 */
export function isAuthError(error: unknown): boolean {
  return isApiError(error) && (error.code === 'HTTP_401' || error.code === 'HTTP_403')
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
  /** Override API key for this request (e.g., for validation before storing) */
  apiKey?: string
  /** Request timeout in milliseconds */
  timeout?: number
}

/** @deprecated Use NormalizedApiError instead */
export interface ApiError extends Error {
  status: number
  data: unknown
}

/**
 * Core fetch wrapper with x-api-key header injection and normalized error handling
 */
export async function api<T = unknown>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = 'GET', body, headers = {}, signal, apiKey: apiKeyOverride, timeout } = options
  
  const authStore = useAuthStore()
  // Use override key if provided, otherwise get from store
  const apiKey = apiKeyOverride !== undefined ? apiKeyOverride : authStore.getApiKey()
  const url = `${API_BASE}${endpoint}`
  
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
  
  // Setup timeout controller if requested
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let abortController: AbortController | undefined
  
  if (timeout && timeout > 0) {
    abortController = new AbortController()
    timeoutId = setTimeout(() => abortController!.abort(), timeout)
  }
  
  // Combine signals if both provided
  const combinedSignal = abortController 
    ? (signal ? AbortSignal.any([signal, abortController.signal]) : abortController.signal)
    : signal
  
  try {
    const response = await fetch(url, {
      method,
      headers: requestHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combinedSignal,
    })
    
    // Handle response
    const responseText = await response.text()
    let responseData: unknown = null
    
    try {
      responseData = responseText ? JSON.parse(responseText) : null
    } catch (parseError) {
      // JSON parse failed but response was OK - could be non-JSON response
      if (response.ok) {
        throw createApiError('PARSE_ERROR', 'Failed to parse response as JSON', {
          details: { raw: responseText },
          url,
          cause: parseError instanceof Error ? parseError : undefined,
        })
      }
      // For non-OK responses, keep raw data for error details
      responseData = { raw: responseText }
    }
    
    if (!response.ok) {
      const errorData = responseData as { error?: { message?: string } } | undefined
      const errorMessage = 
        errorData?.error?.message || 
        (errorData as { error?: string })?.error ||
        response.statusText ||
        'Request failed'
      
      const errorCode = getHttpErrorCode(response.status)
      const error = createApiError(errorCode, errorMessage, {
        status: response.status,
        details: responseData,
        url,
      })
      
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
  } catch (err) {
    // Already normalized - rethrow
    if (isApiError(err)) {
      throw err
    }
    
    // Timeout error
    if (err instanceof Error && err.name === 'AbortError') {
      if (timeoutId && abortController?.signal.aborted) {
        throw createApiError('TIMEOUT', 'Request timed out', { url, cause: err })
      }
      // External abort (not our timeout) - rethrow as-is or wrap
      throw createApiError('UNKNOWN', err.message || 'Request aborted', { url, cause: err })
    }
    
    // Network error (TypeError from fetch)
    if (err instanceof TypeError) {
      throw createApiError('NETWORK_ERROR', 'Unable to connect to server', {
        url,
        cause: err,
      })
    }
    
    // Unknown error - wrap it
    throw createApiError('UNKNOWN', err instanceof Error ? err.message : 'Unknown error', {
      url,
      cause: err instanceof Error ? err : undefined,
    })
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

/**
 * API client with typed endpoints
 */
export const apiClient = {
  // Health
  ping: (options?: { apiKey?: string }) => api<{ ok: boolean }>('/v1/ping', options),
  
  // Auth
  authWhoami: (options?: { apiKey?: string }) => 
    api<{ auth?: { role?: string; queue_allowlist?: string[] } }>('/v1/auth/whoami', options),
  
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