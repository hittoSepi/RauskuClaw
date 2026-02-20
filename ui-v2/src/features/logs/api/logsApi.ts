/**
 * Logs API Module
 *
 * Provides API and mock data sources for the logs feature.
 * Uses the shared api client for backend communication.
 */

import { api } from '@/shared/api'
import { isApiError } from '@/shared/api'
import type { RunSummary, LogLine, Artifact, RunStatus } from '@/stores/logs.store'

// ============================================
// Backend Type Definitions
// ============================================

/**
 * Backend job shape from /v1/jobs and /v1/jobs/:id
 */
interface BackendJob {
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
 * Backend log line shape from /v1/jobs/:id/logs
 */
interface BackendLogLine {
  id: number
  ts: string
  level: string
  message: string
  meta: unknown
}

// ============================================
// Request/Response Types
// ============================================

export interface FetchRunsOptions {
  status?: RunStatus | 'all'
  queue?: string
  type?: string
  limit?: number
}

export interface FetchRunsResult {
  runs: RunSummary[]
  totalCount: number
}

export interface FetchLogsTailOptions {
  runId: string
  tail: number
}

export interface FetchLogsTailResult {
  logs: LogLine[]
  count: number  // Number of logs returned (not total)
}

export interface FetchMockLogsOptions {
  runId: string
  cursor?: string | null
  pageSize?: number
}

export interface FetchMockLogsResult {
  logs: LogLine[]
  nextCursor: string | null
  total: number
}

// ============================================
// Response Transformers
// ============================================

/**
 * Check if a backend status is terminal (finished)
 */
function isTerminalBackendStatus(status: BackendJob['status']): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'cancelled'
}

/**
 * Check if a UI status is terminal (finished)
 */
export function isTerminalStatus(status: RunStatus): boolean {
  return status === 'succeeded' || status === 'failed' || status === 'canceled'
}

/**
 * Map backend status to UI status
 */
function mapBackendStatus(status: BackendJob['status']): RunStatus {
  const statusMap: Record<string, RunStatus> = {
    queued: 'queued',
    running: 'running',
    succeeded: 'succeeded',
    failed: 'failed',
    cancelled: 'canceled',
  }
  return statusMap[status] || 'queued'
}

/**
 * Map UI status to backend status for queries
 */
export function mapUiStatusToBackend(status: RunStatus | 'all'): string | null {
  if (status === 'all') return null
  if (status === 'canceled') return 'cancelled'
  return status
}

/**
 * Transform backend job to UI RunSummary
 * - Derive title from type and queue
 * - Calculate startedAt/finishedAt from timestamps
 * - Map status values
 */
function transformJobToRunSummary(job: BackendJob): RunSummary {
  // Derive title from job type and queue
  const title = `${job.type || 'unknown'}: ${job.queue}`

  const createdAt = job.created_at

  // Derive startedAt: jobs that aren't queued have started
  const startedAt = job.status !== 'queued' ? job.created_at : undefined

  // Derive finishedAt: terminal statuses have finished
  const finishedAt = isTerminalBackendStatus(job.status) ? job.updated_at : undefined

  // Calculate duration if we have both timestamps
  const durationMs = startedAt && finishedAt
    ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
    : undefined

  return {
    id: job.id,
    title,
    status: mapBackendStatus(job.status),
    createdAt,
    startedAt,
    finishedAt,
    durationMs,
  }
}

/**
 * Transform backend log line to UI LogLine
 * - Extract stream from meta if available
 * - Normalize level names
 */
function transformLogLine(log: BackendLogLine): LogLine {
  // Extract stream from meta if present
  const meta = log.meta as { stream?: string } | null
  const stream = meta?.stream || undefined

  // Normalize level to lowercase
  const level = log.level.toLowerCase() as LogLine['level']

  return {
    ts: log.ts,
    level,
    message: log.message,
    stream,
  }
}

// ============================================
// API Functions
// ============================================

/**
 * Fetch runs (jobs) from the backend API
 */
export async function fetchRuns(options: FetchRunsOptions = {}): Promise<FetchRunsResult> {
  const params: Record<string, string> = {}

  if (options.status && options.status !== 'all') {
    const backendStatus = mapUiStatusToBackend(options.status)
    if (backendStatus) params.status = backendStatus
  }
  if (options.queue) params.queue = options.queue
  if (options.type) params.type = options.type
  if (options.limit) params.limit = String(options.limit)

  const qs = Object.keys(params).length > 0
    ? '?' + new URLSearchParams(params).toString()
    : ''

  try {
    const response = await api<{ jobs: BackendJob[]; count: number }>(
      `/v1/jobs${qs}`
    )

    return {
      runs: response.jobs.map(transformJobToRunSummary),
      totalCount: response.count,
    }
  } catch (error) {
    if (isApiError(error)) {
      throw error // Re-throw normalized errors
    }
    throw new Error(`Failed to fetch runs: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Fetch a single run (job) from the backend API
 */
export async function fetchRun(id: string): Promise<RunSummary> {
  try {
    const response = await api<{ job: BackendJob }>(`/v1/jobs/${encodeURIComponent(id)}`)
    return transformJobToRunSummary(response.job)
  } catch (error) {
    if (isApiError(error)) {
      throw error
    }
    throw new Error(`Failed to fetch run: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Fetch log lines using tail parameter from backend
 * Returns the N most recent log lines
 */
export async function fetchLogsTail(options: FetchLogsTailOptions): Promise<FetchLogsTailResult> {
  const { runId, tail } = options
  const limit = Math.min(tail, 2000) // Backend max is 2000

  try {
    const response = await api<{ logs: BackendLogLine[]; count: number }>(
      `/v1/jobs/${encodeURIComponent(runId)}/logs?tail=${limit}`
    )

    return {
      logs: response.logs.map(transformLogLine),
      count: response.count,
    }
  } catch (error) {
    if (isApiError(error)) {
      throw error
    }
    throw new Error(`Failed to fetch logs: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

/**
 * Fetch artifacts for a run
 * Backend does not support artifacts, so return empty array
 */
export async function fetchArtifacts(_runId: string): Promise<Artifact[]> {
  // No backend support for artifacts yet
  return []
}

/**
 * Create a dev job for testing
 * POST /v1/dev/jobs
 */
export async function createDevJob(queue: string, type = 'test'): Promise<{ id: string }> {
  try {
    const response = await api<{ job: { id: string } }>('/v1/dev/jobs', {
      method: 'POST',
      body: { queue, type },
    })
    return { id: response.job.id }
  } catch (error) {
    if (isApiError(error)) {
      throw error
    }
    throw new Error(`Failed to create dev job: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// ============================================
// Mock Functions
// ============================================

/**
 * Generate mock runs for testing/development
 */
export function generateMockRuns(projectId?: string): RunSummary[] {
  const statuses: RunStatus[] = ['succeeded', 'failed', 'running', 'queued', 'canceled']
  const baseTime = new Date('2025-02-20T10:00:00Z').getTime()

  return Array.from({ length: 12 }, (_unused, i: number) => {
    const status = statuses[i % statuses.length] ?? 'queued'
    const createdAt = new Date(baseTime + i * 3600000).toISOString()
    const startedAt = status !== 'queued' ? new Date(baseTime + i * 3600000 + 5000).toISOString() : undefined
    const finishedAt = ['succeeded', 'failed', 'canceled'].includes(status)
      ? new Date(baseTime + i * 3600000 + (30000 + i * 5000)).toISOString()
      : undefined
    const durationMs = startedAt && finishedAt
      ? new Date(finishedAt).getTime() - new Date(startedAt).getTime()
      : undefined

    return {
      id: `run-${String(i + 1).padStart(3, '0')}`,
      projectId,
      title: `Test Job ${i + 1}: ${status === 'succeeded' ? 'Deploy' : status === 'failed' ? 'Build' : 'Test'} run`,
      status,
      createdAt,
      startedAt,
      finishedAt,
      durationMs,
    }
  })
}

// Store mock logs in memory cache
const mockLogsCache = new Map<string, LogLine[]>()

function getMockLogCache(runId: string): LogLine[] {
  if (!mockLogsCache.has(runId)) {
    const levels: LogLine['level'][] = ['info', 'debug', 'warn', 'error']
    const baseTime = new Date('2025-02-20T10:00:05Z').getTime()
    const runNum = parseInt(runId.split('-')[1] ?? '1', 10)

    // Generate 2000 lines for runs 001-003, 20 lines for others
    const lineCount = runNum <= 3 ? 2000 : 20

    const logs: LogLine[] = []
    for (let i = 0; i < lineCount; i++) {
      const level = levels[(runNum + i) % levels.length] ?? 'info'
      logs.push({
        ts: new Date(baseTime + i * 1000).toISOString(),
        level,
        message: `[${runId}] Log line ${i + 1}: ${level === 'error' ? 'Error occurred' : level === 'warn' ? 'Warning issued' : 'Processing...'}`,
        stream: i % 2 === 0 ? 'stdout' : 'stderr',
      })
    }
    mockLogsCache.set(runId, logs)
  }
  return mockLogsCache.get(runId)!
}

/**
 * Fetch mock logs with cursor-based pagination
 */
export function fetchMockLogs(options: FetchMockLogsOptions): FetchMockLogsResult {
  const { runId, cursor = null, pageSize = 200 } = options
  const allLogs = getMockLogCache(runId)
  const offset = cursor ? parseInt(cursor, 10) : 0
  const page = allLogs.slice(offset, offset + pageSize)
  const nextCursor = offset + pageSize < allLogs.length ? String(offset + pageSize) : null

  return {
    logs: page,
    nextCursor,
    total: allLogs.length,
  }
}

/**
 * Generate mock artifacts for a run
 */
export function generateMockArtifacts(runId: string): Artifact[] {
  const runNum = parseInt(runId.split('-')[1] ?? '1', 10)
  const baseTime = new Date('2025-02-20T10:00:30Z').toISOString()

  // Only some runs have artifacts
  if (runNum % 3 !== 0) return []

  return [
    {
      id: `${runId}-artifact-1`,
      name: `output-${runNum}.log`,
      kind: 'log',
      sizeBytes: 1024 * (runNum % 5 + 1),
      contentType: 'text/plain',
      createdAt: baseTime,
      href: `/api/runs/${runId}/artifacts/output-${runNum}.log`,
    },
    {
      id: `${runId}-artifact-2`,
      name: `results-${runNum}.json`,
      kind: 'json',
      sizeBytes: 2048 * (runNum % 3 + 1),
      contentType: 'application/json',
      createdAt: baseTime,
      href: `/api/runs/${runId}/artifacts/results-${runNum}.json`,
    },
    {
      id: `${runId}-artifact-3`,
      name: `test-report-${runNum}.html`,
      kind: 'report',
      sizeBytes: 512 * (runNum % 4 + 1),
      contentType: 'text/html',
      createdAt: baseTime,
      href: `/api/runs/${runId}/artifacts/test-report-${runNum}.html`,
    },
    {
      id: `${runId}-artifact-4`,
      name: `trace-${runNum}.json`,
      kind: 'trace',
      sizeBytes: 4096 * (runNum % 2 + 1),
      contentType: 'application/json',
      createdAt: baseTime,
      href: `/api/runs/${runId}/artifacts/trace-${runNum}.json`,
    },
  ]
}
