<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useAuthStore } from '../stores/auth.store'
import { apiClient } from '../shared/api'

const authStore = useAuthStore()

// Local state
const inputKey = ref('')
const showKey = ref(false)
const isValidating = ref(false)
const validationError = ref('')

// Computed
const hasInput = computed(() => inputKey.value.trim().length > 0)
const showError = computed(() => validationError.value || authStore.authError || authStore.bootstrapError)

// Focus input on mount or when gate becomes visible
const inputRef = ref<HTMLInputElement | null>(null)

// Watch for gate becoming visible to focus input
watch(() => authStore.requiresAuth, (requiresAuth) => {
  if (requiresAuth) {
    setTimeout(() => {
      inputRef.value?.focus()
    }, 100)
  }
})

onMounted(() => {
  // Pre-fill with current key if any
  inputKey.value = authStore.apiKey || ''
  
  // Focus input if gate is visible
  if (authStore.requiresAuth) {
    setTimeout(() => {
      inputRef.value?.focus()
    }, 100)
  }
})

// Handle form submit - validate before saving
async function handleSubmit() {
  if (!hasInput.value || isValidating.value) return
  
  const trimmedKey = inputKey.value.trim()
  validationError.value = ''
  isValidating.value = true
  
  try {
    // Validate the key by calling whoami with the override key
    const response = await apiClient.authWhoami({ apiKey: trimmedKey })
    // Success - store the validated key and mark as valid
    authStore.setApiKey(trimmedKey)
    authStore.markValid(response.auth)
  } catch (err) {
    const apiErr = err as { status?: number }
    if (apiErr.status === 401 || apiErr.status === 403) {
      validationError.value = 'Invalid API key'
    } else {
      validationError.value = 'Unable to connect to server'
    }
  } finally {
    isValidating.value = false
  }
}

// Handle clear
function handleClear() {
  inputKey.value = ''
  validationError.value = ''
  authStore.clearApiKey()
}

// Handle keydown
function handleKeydown(event: KeyboardEvent) {
  // Enter submits
  if (event.key === 'Enter' && hasInput.value) {
    event.preventDefault()
    handleSubmit()
  }
  // Escape is blocked when auth is required
  if (event.key === 'Escape' && authStore.requiresAuth) {
    event.preventDefault()
    event.stopPropagation()
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="authStore.requiresAuth"
        class="api-key-gate-overlay"
        @keydown="handleKeydown"
      >
        <div class="api-key-gate-modal" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
          <h2 id="api-key-title" class="api-key-gate-title">
            Enter API Key
          </h2>
          
          <p v-if="showError" class="api-key-gate-error">
            {{ showError }}
          </p>
          
          <div class="api-key-gate-input-group">
            <div class="api-key-gate-input-wrapper">
              <input
                ref="inputRef"
                v-model="inputKey"
                :type="showKey ? 'text' : 'password'"
                class="api-key-gate-input"
                placeholder="Enter your API key"
                autocomplete="off"
                @keydown="handleKeydown"
              />
              <button
                type="button"
                class="api-key-gate-toggle"
                :title="showKey ? 'Hide key' : 'Show key'"
                @click="showKey = !showKey"
              >
                <svg v-if="showKey" xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>
          
          <p class="api-key-gate-helper">
            Stored in session only.
          </p>
          
          <div class="api-key-gate-actions">
            <button
              type="button"
              class="api-key-gate-btn api-key-gate-btn--secondary"
              @click="handleClear"
            >
              Clear
            </button>
            <button
              type="button"
              class="api-key-gate-btn api-key-gate-btn--primary"
              :disabled="!hasInput || isValidating"
              @click="handleSubmit"
            >
              {{ isValidating ? 'Validating...' : 'Save' }}
            </button>
          </div>
          
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.api-key-gate-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background-color: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
}

.api-key-gate-modal {
  width: 100%;
  max-width: 400px;
  margin: 1rem;
  padding: 1.5rem;
  background-color: var(--bg-1, #1a1a1a);
  border: 1px solid var(--border-0, #333);
  border-radius: 8px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
}

.api-key-gate-title {
  margin: 0 0 1rem;
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--text-0, #fff);
  text-align: center;
}

.api-key-gate-error {
  margin: 0 0 1rem;
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: #ff6b6b;
  background-color: rgba(255, 107, 107, 0.1);
  border-radius: 4px;
}

.api-key-gate-input-group {
  margin-bottom: 0.5rem;
}

.api-key-gate-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.api-key-gate-input {
  width: 100%;
  padding: 0.75rem 2.5rem 0.75rem 0.75rem;
  font-size: 0.9375rem;
  color: var(--text-0, #fff);
  background-color: var(--bg-0, #0a0a0a);
  border: 1px solid var(--border-0, #333);
  border-radius: 6px;
  outline: none;
  transition: border-color 150ms ease;
}

.api-key-gate-input::placeholder {
  color: var(--text-muted, #666);
}

.api-key-gate-input:focus {
  border-color: var(--accent-0, #3b82f6);
}

.api-key-gate-toggle {
  position: absolute;
  right: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  color: var(--text-muted, #666);
  background: none;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: color 150ms ease;
}

.api-key-gate-toggle:hover {
  color: var(--text-0, #fff);
}

.api-key-gate-helper {
  margin: 0 0 1rem;
  font-size: 0.8125rem;
  color: var(--text-muted, #666);
  text-align: center;
}

.api-key-gate-actions {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1rem;
}

.api-key-gate-btn {
  flex: 1;
  padding: 0.75rem 1rem;
  font-size: 0.9375rem;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  transition: all 150ms ease;
}

.api-key-gate-btn--primary {
  color: #fff;
  background-color: var(--accent-0, #3b82f6);
}

.api-key-gate-btn--primary:hover:not(:disabled) {
  background-color: var(--accent-1, #2563eb);
}

.api-key-gate-btn--primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.api-key-gate-btn--secondary {
  color: var(--text-0, #fff);
  background-color: var(--bg-2, #2a2a2a);
  border: 1px solid var(--border-0, #333);
}

.api-key-gate-btn--secondary:hover {
  background-color: var(--bg-3, #3a3a3a);
}

/* Transition */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 200ms ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>