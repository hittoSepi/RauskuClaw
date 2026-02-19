import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { apiClient, isNetworkError, isAuthError, isApiError } from '../shared/api'

const SESSION_STORAGE_KEY = 'rauskuclaw_api_key'

export type AuthStatus = 'unknown' | 'valid' | 'invalid'

export const useAuthStore = defineStore('auth', () => {
  // State
  const apiKey = ref<string>('')
  const authStatus = ref<AuthStatus>('unknown')
  const isBootstrapping = ref<boolean>(true)
  const authError = ref<string>('')
  const bootstrapError = ref<string>('')
  const userInfo = ref<{ role?: string; queue_allowlist?: string[] } | null>(null)

  // Computed - single source of truth derived from authStatus
  const requiresAuth = computed(() => authStatus.value !== 'valid')
  const hasApiKey = computed(() => Boolean(apiKey.value?.trim()))
  const isAuthenticated = computed(() => authStatus.value === 'valid')

  // Track if bootstrap has run to ensure idempotency
  let bootstrapPromise: Promise<void> | null = null

  // Bootstrap - validate stored key on app startup
  async function bootstrap(): Promise<void> {
    // Idempotent: return existing promise if already running/complete
    if (bootstrapPromise) {
      return bootstrapPromise
    }

    bootstrapPromise = (async () => {
      isBootstrapping.value = true
      bootstrapError.value = ''

      try {
        // Read key from sessionStorage
        let storedKey: string | null = null
        try {
          storedKey = sessionStorage.getItem(SESSION_STORAGE_KEY)
        } catch {
          // sessionStorage not available
        }

        // No key -> show gate
        if (!storedKey?.trim()) {
          authStatus.value = 'invalid'
          apiKey.value = ''
          return
        }

        // Key present -> validate with server
        try {
          const response = await apiClient.authWhoami({ apiKey: storedKey })
          
          // Success - key is valid
          apiKey.value = storedKey
          authStatus.value = 'valid'
          authError.value = ''
          
          // Store user info if available
          if (response.auth) {
            userInfo.value = {
              role: response.auth.role,
              queue_allowlist: response.auth.queue_allowlist,
            }
          }
        } catch (err) {
          // Use normalized error codes for consistent handling
          if (isAuthError(err)) {
            // 401/403 - Invalid key, clear it
            apiKey.value = ''
            authStatus.value = 'invalid'
            try {
              sessionStorage.removeItem(SESSION_STORAGE_KEY)
            } catch {
              // Ignore
            }
          } else if (isNetworkError(err)) {
            // Network error - don't clear key, it might be valid
            // Key might be valid, server just unreachable
            authStatus.value = 'invalid'
            bootstrapError.value = 'Unable to verify API key - server unreachable'
          } else {
            // Other error - treat as invalid but preserve key in session
            authStatus.value = 'invalid'
            bootstrapError.value = isApiError(err) ? err.message : 'Unable to verify API key'
          }
        }
      } finally {
        isBootstrapping.value = false
      }
    })()

    return bootstrapPromise
  }

  // Set API key (after validation)
  function setApiKey(key: string) {
    const trimmedKey = key.trim()
    apiKey.value = trimmedKey
    authError.value = ''
    
    try {
      if (trimmedKey) {
        sessionStorage.setItem(SESSION_STORAGE_KEY, trimmedKey)
      } else {
        sessionStorage.removeItem(SESSION_STORAGE_KEY)
      }
    } catch {
      // Ignore sessionStorage errors
    }
  }

  // Mark key as valid (after successful validation)
  function markValid(user?: { role?: string; queue_allowlist?: string[] }) {
    authStatus.value = 'valid'
    authError.value = ''
    bootstrapError.value = ''
    if (user) {
      userInfo.value = user
    }
  }

  // Clear API key
  function clearApiKey() {
    apiKey.value = ''
    authError.value = ''
    authStatus.value = 'invalid'
    userInfo.value = null
    
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // Ignore sessionStorage errors
    }
  }

  // Logout - clear everything and show gate
  function logout() {
    clearApiKey()
    bootstrapError.value = ''
  }

  // Show auth required (e.g., after 401/403)
  function showAuthRequired(error?: string) {
    authError.value = error || ''
    authStatus.value = 'invalid'
  }

  // Get key for API calls
  function getApiKey(): string {
    return apiKey.value?.trim() || ''
  }

  return {
    // State
    apiKey,
    authStatus,
    isBootstrapping,
    authError,
    bootstrapError,
    userInfo,
    
    // Computed
    requiresAuth,
    hasApiKey,
    isAuthenticated,
    
    // Actions
    bootstrap,
    setApiKey,
    markValid,
    clearApiKey,
    logout,
    showAuthRequired,
    getApiKey,
  }
})
