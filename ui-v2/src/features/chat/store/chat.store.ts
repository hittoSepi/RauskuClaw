/**
 * Chat Store
 *
 * Project-scoped chat state management with localStorage persistence.
 * Handles message history, job creation, and polling for chat responses.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as chatJobs from '../api/chatJobs'
import { useAuthStore } from '@/stores/auth.store'

// ============================================
// Type Definitions
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageStatus = 'pending' | 'streaming' | 'success' | 'error'

export interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  createdAt: string
  status?: MessageStatus
  jobId?: string
  error?: string
}

export interface ProjectChatState {
  messages: ChatMessage[]
}

export interface ChatState {
  projects: Record<string, ProjectChatState>
}

export interface SendOptions {
  /** Poll interval in milliseconds (default: 1000ms) */
  pollInterval?: number
  /** Max poll attempts (default: 60 = 1 minute) */
  maxPollAttempts?: number
  /** Overall poll timeout in milliseconds (default: 65000ms) */
  pollTimeoutMs?: number
  /** Optional job type override */
  jobType?: 'codex.chat.generate' | 'ai.chat.generate'
  /** Stream first-event timeout in milliseconds (default: 3000ms) */
  streamFirstEventTimeout?: number
}

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'oc_chat_v1'

// ============================================
// Stream Tracking (outside store, not reactive)
// ============================================

// Track active streams per project for cleanup
// Use plain Map instead of ref to avoid unexpected Vue reactivity
const activeStreams = new Map<string, chatJobs.StreamJobHandle>()

// ============================================
// Helper Functions
// ============================================

function generateMessageId(): string {
  return `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
}

function tolerantJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

/**
 * Wrap a promise with a timeout. Rejects with Error if timeout elapses.
 */
function withTimeout<T>(promise: Promise<T>, ms: number, message: string = `Operation timed out after ${ms}ms`): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(message)), ms)
    ),
  ])
}

/**
 * Create a throttled localStorage persist function
 * Prevents excessive writes during rapid streaming updates
 */
function createThrottledPersist(persistFn: () => void) {
  let timer: ReturnType<typeof setTimeout> | null = null

  return function throttledPersist(immediate = false) {
    if (timer) clearTimeout(timer)

    if (immediate) {
      persistFn()
      timer = null // Clear timer ref after immediate persist
      return
    }

    timer = setTimeout(() => {
      persistFn()
      timer = null // Clear timer ref after persist
    }, 250)
  }
}

// ============================================
// Store Definition
// ============================================

export const useChatStore = defineStore('chat', () => {
  // State
  const projects = ref<Record<string, ProjectChatState>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const hasMessages = computed(() => (projectId: string) => {
    const state = projects.value[projectId]
    return state ? state.messages.length > 0 : false
  })

  const messages = computed(() => (projectId: string) => {
    const state = projects.value[projectId]
    return state ? state.messages : []
  })

  const hasPendingMessage = computed(() => (projectId: string) => {
    const state = projects.value[projectId]
    if (!state) return false
    return state.messages.some(
      (m) => m.role === 'assistant' && m.status === 'pending'
    )
  })

  // ============================================
  // Persistence Actions
  // ============================================

  function hydrate(): void {
    const raw = localStorage.getItem(STORAGE_KEY)
    const data = tolerantJsonParse<ChatState>(raw, { projects: {} })
    projects.value = data.projects
  }

  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: projects.value }))
    } catch {
      // Ignore localStorage errors (e.g., quota exceeded, disabled)
    }
  }

  // ============================================
  // Project Actions
  // ============================================

  function ensureProject(projectId: string): void {
    if (!projects.value[projectId]) {
      projects.value[projectId] = { messages: [] }
    }
  }

  // ============================================
  // Message Actions
  // ============================================

  async function sendUserMessage(
    projectId: string,
    text: string,
    options: SendOptions = {}
  ): Promise<void> {
    if (!text.trim()) {
      return
    }

    // Early offline guard
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      ensureProject(projectId)
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: text,
        createdAt: new Date().toISOString(),
      }
      const assistantMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'assistant',
        content: 'No network connection.',
        createdAt: new Date().toISOString(),
        status: 'error',
        error: 'offline',
      }
      projects.value[projectId]!.messages.push(userMessage, assistantMessage)
      persist()
      return
    }

    // Ensure project state exists
    ensureProject(projectId)

    // Create user message
    const userMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    }

    // Create pending assistant message
    const assistantMessage: ChatMessage = {
      id: generateMessageId(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
      status: 'pending',
    }

    // Add messages to state
    projects.value[projectId]!.messages.push(userMessage, assistantMessage)
    persist()

    // Set loading state
    loading.value = true
    error.value = null

    try {
      // Build prior message history (exclude system messages and pending assistant)
      const priorHistory = projects.value[projectId]!.messages
        .filter((m) => m.role !== 'system' && m.id !== assistantMessage.id)
        .map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        }))

      // Create chat job
      const jobId = await chatJobs.createChatJob({
        prompt: text,
        messages: priorHistory,
        jobType: options.jobType,
      })

      // Update assistant message with job ID
      assistantMessage.jobId = jobId
      persist()

      // Track message index for updates
      const msgIndex = projects.value[projectId]!.messages.findIndex(
        (m) => m.id === assistantMessage.id
      )

      // Throttled persist for streaming updates
      const throttledPersist = createThrottledPersist(() => {
        // Inline persist to access projects ref
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: projects.value }))
        } catch {
          // Ignore localStorage errors
        }
      })

      // Cancel any existing stream for this project
      const existingHandle = activeStreams.get(projectId)
      if (existingHandle) {
        existingHandle.close()
        activeStreams.delete(projectId)
      }

      // Try streaming first, fall back to polling on error
      // Use a flag to track if we should poll instead
      let shouldPollInstead = false
      const authStore = useAuthStore()
      const apiKey = authStore.getApiKey()

      try {
        const streamHandle = chatJobs.streamJob(
          jobId,
          {
            onJobUpdate: (job) => {
            if (msgIndex === -1) return

            const currentMsg = projects.value[projectId]!.messages[msgIndex]
            if (!currentMsg) return

            // Extract text from result
            const assistantText = chatJobs.parseAssistantText(job.result)

            // Update message with streaming status and new content
            projects.value[projectId]!.messages[msgIndex] = {
              ...currentMsg,
              content: assistantText,
              status: job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled'
                ? (job.status === 'succeeded' ? 'success' : 'error')
                : 'streaming',
            }

            // Throttle persistence during streaming
            throttledPersist(false)
          },

          onError: (streamError) => {
            console.warn('[chatStore] Stream failed, falling back to polling:', streamError.message)
            shouldPollInstead = true

            // Close stream
            const handle = activeStreams.get(projectId)
            if (handle) {
              handle.close()
              activeStreams.delete(projectId)
            }

            // Update status to pending
            if (msgIndex !== -1) {
              const currentMsg = projects.value[projectId]!.messages[msgIndex]
              if (currentMsg) {
                projects.value[projectId]!.messages[msgIndex] = {
                  ...currentMsg,
                  status: 'pending',
                }
                throttledPersist(true)
              }
            }
          },
        },
        {
          apiKey,
          firstEventTimeout: options.streamFirstEventTimeout ?? 3000,
        })

        // Store stream handle for cleanup
        activeStreams.set(projectId, streamHandle)

        // Don't set streaming status yet - wait for first onJobUpdate event
        // If stream fails immediately (onError), status stays 'pending' for polling fallback

        // Wait a bit to see if stream starts successfully
        // If shouldPollInstead is set, stream failed immediately
        await new Promise(resolve => setTimeout(resolve, 100))

        if (shouldPollInstead) {
          // Stream failed, fall back to polling
          throw new Error('Stream failed, falling back to polling')
        }
      } catch (streamError) {
        // Either streamJob() threw or stream failed immediately
        // Fall back to regular polling
        console.warn('[chatStore] Using polling fallback:', streamError)

        // Cancel any active stream
        const handle = activeStreams.get(projectId)
        if (handle) {
          handle.close()
          activeStreams.delete(projectId)
        }

        // Fall back to polling
        const pollTimeoutMs = options.pollTimeoutMs ?? 65000
        const job = await withTimeout(
          chatJobs.pollJobUntilComplete(jobId, {
            interval: options.pollInterval ?? 1000,
            maxAttempts: options.maxPollAttempts ?? 60,
          }),
          pollTimeoutMs,
          `Chat request timed out after ${pollTimeoutMs}ms`
        )

        // Handle terminal states
        const finalMsgIndex = projects.value[projectId]!.messages.findIndex(
          (m) => m.id === assistantMessage.id
        )
        if (finalMsgIndex !== -1) {
          const currentMsg = projects.value[projectId]!.messages[finalMsgIndex]
          if (!currentMsg) return

          if (job.status === 'succeeded') {
            const assistantText = chatJobs.parseAssistantText(job.result)
            projects.value[projectId]!.messages[finalMsgIndex] = {
              ...currentMsg,
              content: assistantText,
              status: 'success',
            }
          } else if (job.status === 'failed') {
            projects.value[projectId]!.messages[finalMsgIndex] = {
              ...currentMsg,
              content: 'The request failed. Please try again.',
              status: 'error',
              error: typeof job.error === 'string' ? job.error : 'Unknown error',
            }
          } else if (job.status === 'cancelled') {
            projects.value[projectId]!.messages[finalMsgIndex] = {
              ...currentMsg,
              content: 'The request was cancelled.',
              status: 'error',
              error: 'Job cancelled',
            }
          }
        }
      }

      // Clean up stream handle if polling fallback completed
      // If stream failed, we already closed it in the onError handler
      // If stream succeeded, it closed itself via auto-close on terminal state
      // Just ensure cleanup for any edge cases
      const handle = activeStreams.get(projectId)
      if (handle) {
        handle.close()
        activeStreams.delete(projectId)
      }
    } catch (err) {
      // Handle API errors (job creation, etc.)
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred'

      const msgIndex = projects.value[projectId]!.messages.findIndex(
        (m) => m.id === assistantMessage.id
      )
      if (msgIndex !== -1) {
        projects.value[projectId]!.messages[msgIndex] = {
          ...assistantMessage,
          content: errorMessage.includes('timeout') || errorMessage.includes('Timed out')
            ? 'Request timed out. Please try again.'
            : 'Failed to send message. Please try again.',
          status: 'error',
          error: errorMessage,
        }
      }

      error.value = errorMessage
    } finally {
      // Always clear loading state
      loading.value = false
      // Final persist to ensure state is saved
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ projects: projects.value }))
      } catch {
        // Ignore localStorage errors
      }
    }
  }

  function clearMessages(projectId: string): void {
    ensureProject(projectId)
    projects.value[projectId]!.messages = []
    persist()
  }

  function deleteMessage(projectId: string, messageId: string): void {
    const state = projects.value[projectId]
    if (!state) return

    const index = state.messages.findIndex((m) => m.id === messageId)
    if (index !== -1) {
      state.messages.splice(index, 1)
      persist()
    }
  }

  function cancelActiveStream(projectId: string): void {
    const handle = activeStreams.get(projectId)
    if (handle) {
      handle.close()
      activeStreams.delete(projectId)
    }
  }

  function cancelAllStreams(): void {
    activeStreams.forEach(handle => handle.close())
    activeStreams.clear()
  }

  // Hydrate from localStorage on store creation
  hydrate()

  return {
    // State
    projects,
    loading,
    error,

    // Computed
    hasMessages,
    messages,
    hasPendingMessage,

    // Actions
    hydrate,
    persist,
    ensureProject,
    sendUserMessage,
    clearMessages,
    deleteMessage,
    cancelActiveStream,
    cancelAllStreams,
  }
})
