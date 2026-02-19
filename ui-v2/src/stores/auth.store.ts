import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

const SESSION_STORAGE_KEY = 'rauskuclaw_api_key'

export const useAuthStore = defineStore('auth', () => {
  // State
  const apiKey = ref<string>('')
  const requiresAuth = ref<boolean>(false)
  const authError = ref<string>('')

  // Computed
  const hasApiKey = computed(() => Boolean(apiKey.value?.trim()))
  const isInitialized = computed(() => apiKey.value !== null)

  // Initialize from sessionStorage
  function init() {
    try {
      const storedKey = sessionStorage.getItem(SESSION_STORAGE_KEY)
      apiKey.value = storedKey || ''
      requiresAuth.value = !apiKey.value.trim()
    } catch {
      apiKey.value = ''
      requiresAuth.value = true
    }
  }

  // Set API key
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
    
    requiresAuth.value = !trimmedKey
  }

  // Clear API key
  function clearApiKey() {
    apiKey.value = ''
    authError.value = ''
    
    try {
      sessionStorage.removeItem(SESSION_STORAGE_KEY)
    } catch {
      // Ignore sessionStorage errors
    }
    
    requiresAuth.value = true
  }

  // Show auth required (e.g., after 401/403)
  function showAuthRequired(error?: string) {
    authError.value = error || ''
    requiresAuth.value = true
  }

  // Get key for API calls
  function getApiKey(): string {
    return apiKey.value?.trim() || ''
  }

  // Initialize on store creation
  init()

  return {
    // State
    apiKey,
    requiresAuth,
    authError,
    
    // Computed
    hasApiKey,
    isInitialized,
    
    // Actions
    init,
    setApiKey,
    clearApiKey,
    showAuthRequired,
    getApiKey,
  }
})