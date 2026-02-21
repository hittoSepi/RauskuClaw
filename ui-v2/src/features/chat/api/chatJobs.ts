/**
 * Chat Jobs API Module
 *
 * Provides API for creating and polling chat jobs using backend providers.
 * Uses the shared api client for backend communication.
 *
 * Backend job types:
 * - "codex.chat.generate" - Codex OSS/Cli provider
 * - "ai.chat.generate" - OpenAI provider
 */

import { api, isApiError } from '@/shared/api'

// ============================================
// Backend Type Definitions
// ============================================

/**
 * Backend job shape from /v1/jobs and /v1/jobs/:id
 *
 * Note: Backend response shape varies - may be wrapped in {job: {...}} or returned directly.
 * Use unwrapJob() helper to handle both cases.
 */
export interface BackendJob {
  id: string
  type: string
  queue: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  priority: number
  timeout_sec: number
  attempts: number
  max_attempts: number
  callback_url: string | null
  tags: string[]
  input: unknown
  result: unknown
  error: unknown
  created_at: string
  updated_at: string
}

/**
 * Backend chat result shape (provider-agnostic)
 *
 * Both Codex and OpenAI providers output 'output_text' as the primary field.
 */
export interface BackendChatResult {
  provider?: 'openai' | 'codex-oss' | 'codex-cli'
  model?: string
  output_text?: string           // ← Primary response field (both providers)
  finish_reason?: string         // OpenAI only
  tool_calls?: unknown[]         // OpenAI only
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
  memory_context?: unknown       // If memory was used
  memory_write?: unknown         // If memory write was requested
  id?: string                    // OpenAI response ID
  command_preview?: string       // Codex CLI
  local_provider?: string        // Codex OSS
  codex_home?: string            // Codex OSS
  transient_retries?: number     // Codex OSS
  auth_mode?: string             // Codex OSS
  raw_events_count?: number      // Codex OSS
  // Plus other provider-specific fields
}

// ============================================
// UI-Facing Types
// ============================================

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp?: string
}

export interface MemoryContext {
  scope?: string
  query?: string
  top_k?: number
  required?: boolean
}

export interface MemoryWriteConfig {
  scope: string
  key: string
  ttl_sec?: number
  tags?: string[]
  required?: boolean
}

export interface CreateChatJobOptions {
  /** User prompt or message */
  prompt: string
  /** Optional message history for context */
  messages?: ChatMessage[]
  /** Optional system prompt */
  system?: string
  /** Optional memory context injection (pass-through) */
  memory?: MemoryContext
  /** Optional memory write-back (pass-through) */
  memoryWrite?: MemoryWriteConfig
  /** Optional temperature (0-2 for OpenAI) */
  temperature?: number
  /** Optional max tokens */
  maxTokens?: number
  /** Job type: defaults to 'ai.chat.generate' */
  jobType?: 'codex.chat.generate' | 'ai.chat.generate'
  /** Optional queue name (do NOT assume 'chat' exists) */
  queue?: string
  /** Optional job priority (0-10) */
  priority?: number
}

export interface PollOptions {
  /** Poll interval in milliseconds (default: 1000ms) */
  interval?: number
  /** Max poll attempts (default: 60 = 1 minute) */
  maxAttempts?: number
  /** Per-request timeout in milliseconds (default: 10000ms) */
  requestTimeout?: number
}

// ============================================
// Response Unwrap Helpers
// ============================================

/**
 * Unwrap job ID from backend response
 *
 * Backend may return:
 * - { id: "job_1" }
 * - { job: { id: "job_1" } }
 *
 * @throws Error if job ID cannot be extracted
 */
function unwrapJobId(response: unknown): string {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid response: not an object')
  }

  const resp = response as Record<string, unknown>

  // Try direct id field
  if (typeof resp.id === 'string') {
    return resp.id
  }

  // Try nested job.id
  if (resp.job && typeof resp.job === 'object') {
    const job = resp.job as Record<string, unknown>
    if (typeof job.id === 'string') {
      return job.id
    }
  }

  throw new Error('Cannot extract job ID from response')
}

/**
 * Unwrap job from backend response
 *
 * Backend may return:
 * - { job: { id: "job_1", ... } }
 * - { id: "job_1", ... } (direct job fields)
 *
 * @throws Error if job cannot be extracted
 */
function unwrapJob(response: unknown): BackendJob {
  if (!response || typeof response !== 'object') {
    throw new Error('Invalid response: not an object')
  }

  const resp = response as Record<string, unknown>

  // Try nested job object
  if (resp.job && typeof resp.job === 'object') {
    const job = resp.job as BackendJob
    if (typeof job.id === 'string') {
      return job
    }
  }

  // Treat response as direct job object (must have id)
  if (typeof resp.id === 'string') {
    return resp as unknown as BackendJob
  }

  throw new Error('Cannot extract job from response')
}

// ============================================
// API Functions
// ============================================

/**
 * Create a new chat job
 *
 * @param options - Chat job creation options
 * @returns Job ID string
 *
 * @example
 * ```ts
 * const jobId = await createChatJob({
 *   prompt: 'Hello, can you help me?',
 *   jobType: 'ai.chat.generate'
 * })
 * ```
 */
export async function createChatJob(options: CreateChatJobOptions): Promise<string> {
  const {
    prompt,
    messages,
    system,
    memory,
    memoryWrite,
    temperature,
    maxTokens,
    jobType = 'ai.chat.generate',
    queue,
    priority = 5
  } = options

  // Build job input payload
  const input: Record<string, unknown> = { prompt }

  if (system) input.system = system
  if (messages && messages.length > 0) {
    input.messages = messages.map(m => ({
      role: m.role,
      content: m.content
    }))
  }
  if (memory) input.memory = memory
  if (memoryWrite) input.memory_write = memoryWrite
  if (temperature !== undefined) input.temperature = temperature
  if (maxTokens !== undefined) input.max_tokens = maxTokens

  // Build job payload (no queue assumption - only if provided)
  const jobPayload: Record<string, unknown> = {
    type: jobType,
    input,
    priority,
    tags: ['chat']
  }

  if (queue) jobPayload.queue = queue

  try {
    const response = await api<unknown>('/v1/jobs', {
      method: 'POST',
      body: jobPayload
    })
    return unwrapJobId(response)
  } catch (error) {
    if (isApiError(error)) {
      throw error
    }
    throw new Error(`Failed to create chat job: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Fetch a single job by ID
 *
 * @param jobId - Job UUID
 * @param timeout - Request timeout in milliseconds (default: 10000ms)
 * @returns Backend job object
 */
export async function getJob(jobId: string, timeout: number = 10000): Promise<BackendJob> {
  try {
    const response = await api<unknown>(
      `/v1/jobs/${encodeURIComponent(jobId)}`,
      { timeout }
    )
    return unwrapJob(response)
  } catch (error) {
    if (isApiError(error)) {
      throw error
    }
    throw new Error(`Failed to fetch job: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Poll a job until it reaches a terminal status
 *
 * Terminal statuses: succeeded | failed | cancelled
 *
 * @param jobId - Job UUID
 * @param options - Polling options (interval: default 1000ms, maxAttempts: default 60, requestTimeout: default 10000ms)
 * @returns Completed backend job object
 *
 * @throws Error if polling times out
 */
export async function pollJobUntilComplete(
  jobId: string,
  options: PollOptions = {}
): Promise<BackendJob> {
  const { interval = 1000, maxAttempts = 60, requestTimeout = 10000 } = options

  for (let i = 0; i < maxAttempts; i++) {
    const job = await getJob(jobId, requestTimeout)

    if (job.status === 'succeeded' || job.status === 'failed' || job.status === 'cancelled') {
      return job
    }

    await new Promise(resolve => setTimeout(resolve, interval))
  }

  throw new Error(`Job ${jobId} polling timeout after ${maxAttempts * interval}ms`)
}

/**
 * Parse assistant text from chat job result
 *
 * Tolerant parser that handles multiple provider formats.
 *
 * Primary field: result.output_text (string) for both Codex and OpenAI.
 *
 * Fallbacks (in order):
 * - result.text
 * - result.content
 * - result.message.content (OpenAI format)
 * - result.choices[0].message.content (OpenAI format)
 * - result.choices[0].text (OpenAI legacy format)
 *
 * @param result - Backend chat result object
 * @returns Assistant response text, or empty string if not found
 */
export function parseAssistantText(result: unknown): string {
  if (!result || typeof result !== 'object') {
    return ''
  }

  const r = result as Record<string, unknown>

  // Primary field: output_text (both Codex and OpenAI)
  if (typeof r.output_text === 'string') {
    return r.output_text
  }

  // Fallback: direct text field
  if (typeof r.text === 'string') {
    return r.text
  }

  // Fallback: direct content field
  if (typeof r.content === 'string') {
    return r.content
  }

  // Fallback: OpenAI format result.message.content
  if (r.message && typeof r.message === 'object') {
    const msg = r.message as Record<string, unknown>
    if (typeof msg.content === 'string') {
      return msg.content
    }
  }

  // Fallback: OpenAI format result.choices[0].message.content
  if (r.choices && Array.isArray(r.choices) && r.choices.length > 0) {
    const choice = r.choices[0] as Record<string, unknown>
    if (choice.message && typeof choice.message === 'object') {
      const msg = choice.message as Record<string, unknown>
      if (typeof msg.content === 'string') {
        return msg.content
      }
    }
    // Legacy: choices[0].text
    if (typeof choice.text === 'string') {
      return choice.text
    }
  }

  // Nothing found: return empty string (keep UI clean, no JSON.stringify fallback)
  return ''
}
