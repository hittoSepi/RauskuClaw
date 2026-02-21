/**
 * Chat Store
 *
 * Project-scoped chat state management with localStorage persistence.
 * Handles message history, job creation, and polling for chat responses.
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as chatJobs from '../api/chatJobs'

// ============================================
// Type Definitions
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system'
export type MessageStatus = 'pending' | 'success' | 'error'

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
}

// ============================================
// Constants
// ============================================

const STORAGE_KEY = 'oc_chat_v1'

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
        content: 'Offline: unable to connect.',
        createdAt: new Date().toISOString(),
        status: 'error',
        error: 'Network offline',
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

      // Poll job until complete with timeout guarantee
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
      if (job.status === 'succeeded') {
        // Parse assistant text from result
        const assistantText = chatJobs.parseAssistantText(job.result)
        // Update the message in the array to ensure Vue reactivity
        const msgIndex = projects.value[projectId]!.messages.findIndex(
          (m) => m.id === assistantMessage.id
        )
        if (msgIndex !== -1) {
          projects.value[projectId]!.messages[msgIndex] = {
            ...assistantMessage,
            content: assistantText,
            status: 'success',
          }
        }
      } else if (job.status === 'failed') {
        const msgIndex = projects.value[projectId]!.messages.findIndex(
          (m) => m.id === assistantMessage.id
        )
        if (msgIndex !== -1) {
          projects.value[projectId]!.messages[msgIndex] = {
            ...assistantMessage,
            content: 'The request failed. Please try again.',
            status: 'error',
            error: typeof job.error === 'string' ? job.error : 'Unknown error',
          }
        }
      } else if (job.status === 'cancelled') {
        const msgIndex = projects.value[projectId]!.messages.findIndex(
          (m) => m.id === assistantMessage.id
        )
        if (msgIndex !== -1) {
          projects.value[projectId]!.messages[msgIndex] = {
            ...assistantMessage,
            content: 'The request was cancelled.',
            status: 'error',
            error: 'Job cancelled',
          }
        }
      }
    } catch (err) {
      // Handle API or polling errors (including timeout)
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'

      // Update the message in the array
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
      loading.value = false
      persist()
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
  }
})
