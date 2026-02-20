import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ============================================
// Type definitions
// ============================================

export type RunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'canceled'
export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

// Artifact kind types for better type safety and UI handling
export type ArtifactKind = 'report' | 'trace' | 'video' | 'screenshot' | 'log' | 'json' | 'archive' | 'other'

export interface RunSummary {
  id: string
  projectId?: string
  title: string
  status: RunStatus
  createdAt: string
  startedAt?: string
  finishedAt?: string
  durationMs?: number
}

export interface LogLine {
  ts: string
  level: LogLevel
  message: string
  stream?: string
}

export interface Artifact {
  id: string
  name: string
  kind: ArtifactKind
  sizeBytes: number
  contentType: string
  createdAt: string
  href?: string
}

export interface RunDetail extends RunSummary {
  artifacts: Artifact[]
}

export interface LogFilters {
  level?: LogLevel | 'all'
  stream?: 'stdout' | 'stderr' | 'all'
  query?: string
}

// ============================================
// Deterministic mock data generators
// ============================================

function generateMockRuns(projectId?: string): RunSummary[] {
  const statuses: RunStatus[] = ['succeeded', 'failed', 'running', 'queued', 'canceled']
  const baseTime = new Date('2025-02-20T10:00:00Z').getTime()

  const runs: RunSummary[] = Array.from({ length: 12 }, (_unused, i: number) => {
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
  return runs
}

// Store all mock logs for pagination (in-memory "database")
const mockLogsCache = new Map<string, LogLine[]>()

function getMockLogCache(runId: string): LogLine[] {
  if (!mockLogsCache.has(runId)) {
    const levels: LogLevel[] = ['info', 'debug', 'warn', 'error']
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

// Paginated log fetch (simulates API call)
function fetchMockLogsPage(runId: string, cursor: string | null, pageSize: number): {
  logs: LogLine[]
  nextCursor: string | null
  total: number
} {
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

function generateMockArtifacts(runId: string): Artifact[] {
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

// ============================================
// Store definition
// ============================================

export const useLogsStore = defineStore('logs', () => {
  // State: runs list
  const runs = ref<RunSummary[]>([])
  const selectedRunId = ref<string | null>(null)
  const selectedRun = ref<RunDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const filterStatus = ref<RunStatus | 'all'>('all')

  // State: pagination and logs
  const pageSize = ref(200)
  const loadedLogs = ref<LogLine[]>([])
  const logCursor = ref<string | null>(null)
  const nextCursor = ref<string | null>(null)
  const totalLogCount = ref(0)
  const isLoadingLogs = ref(false)

  // State: log filters (client-side filtering on loaded logs)
  const logLevelFilter = ref<LogLevel | 'all'>('all')
  const logStreamFilter = ref<'stdout' | 'stderr' | 'all'>('all')
  const logQuery = ref('')

  // State: selected log line (for inspector panel)
  const selectedLogLine = ref<LogLine | null>(null)
  const selectedLogLineIndex = ref<number | null>(null)

  // Computed: runs list filtering
  const filteredRuns = computed(() => {
    if (filterStatus.value === 'all') return runs.value
    return runs.value.filter(r => r.status === filterStatus.value)
  })

  const hasRuns = computed(() => runs.value.length > 0)

  const selectedRunArtifacts = computed(() => selectedRun.value?.artifacts ?? [])

  // Computed: client-side filtered logs (only filters currently loaded logs)
  // NOTE: This is client-side filtering for UX. When API is integrated,
  // filtering should move to server-side for efficiency.
  const filteredLogs = computed(() => {
    let logs = loadedLogs.value

    // Level filter
    if (logLevelFilter.value !== 'all') {
      logs = logs.filter((l: LogLine) => l.level === logLevelFilter.value)
    }

    // Stream filter
    if (logStreamFilter.value !== 'all') {
      logs = logs.filter((l: LogLine) => l.stream === logStreamFilter.value)
    }

    // Query filter (case-insensitive substring match)
    if (logQuery.value) {
      const query = logQuery.value.toLowerCase()
      logs = logs.filter((l: LogLine) =>
        l.message.toLowerCase().indexOf(query) >= 0 ||
        l.level.toLowerCase().indexOf(query) >= 0
      )
    }

    return logs
  })

  const hasMoreLogs = computed(() => nextCursor.value !== null)
  const displayedLogCount = computed(() => filteredLogs.value.length)
  const totalLoadedCount = computed(() => loadedLogs.value.length)

  // Actions: runs list
  function loadGlobalRuns() {
    loading.value = true
    error.value = null

    setTimeout(() => {
      runs.value = generateMockRuns()
      loading.value = false
    }, 100)
  }

  function loadProjectRuns(projectId: string) {
    loading.value = true
    error.value = null

    setTimeout(() => {
      runs.value = generateMockRuns(projectId)
      loading.value = false
    }, 100)
  }

  function selectRun(runId: string) {
    loading.value = true
    error.value = null
    selectedRunId.value = runId

    setTimeout(() => {
      const run = runs.value.find((r: RunSummary) => r.id === runId)
      if (run) {
        selectedRun.value = {
          ...run,
          artifacts: generateMockArtifacts(runId),
        }
      }
      loading.value = false
    }, 50)
  }

  function clearSelection() {
    selectedRunId.value = null
    selectedRun.value = null
    // Clear log state
    loadedLogs.value = []
    logCursor.value = null
    nextCursor.value = null
    totalLogCount.value = 0
  }

  function setFilter(status: RunStatus | 'all') {
    filterStatus.value = status
  }

  // Actions: log pagination
  function resetLogs(runId: string) {
    loadedLogs.value = []
    logCursor.value = null
    nextCursor.value = null
    totalLogCount.value = 0
    loadMoreLogs(runId)
  }

  function loadMoreLogs(runId: string) {
    if (isLoadingLogs.value || !hasMoreLogs.value && loadedLogs.value.length > 0) {
      return
    }

    isLoadingLogs.value = true

    setTimeout(() => {
      const result = fetchMockLogsPage(runId, logCursor.value, pageSize.value)
      loadedLogs.value.push(...result.logs)
      logCursor.value = result.nextCursor
      nextCursor.value = result.nextCursor
      totalLogCount.value = result.total
      isLoadingLogs.value = false
    }, 100) // Simulate network delay
  }

  // Actions: log filters
  function setLogFilters(filters: LogFilters) {
    if (filters.level !== undefined) {
      logLevelFilter.value = filters.level
    }
    if (filters.stream !== undefined) {
      logStreamFilter.value = filters.stream
    }
    if (filters.query !== undefined) {
      logQuery.value = filters.query
    }
  }

  // Actions: log line selection (for inspector)
  function selectLogLine(line: LogLine, index: number) {
    selectedLogLine.value = line
    selectedLogLineIndex.value = index
  }

  function clearSelectedLogLine() {
    selectedLogLine.value = null
    selectedLogLineIndex.value = null
  }

  return {
    // State: runs list
    runs,
    selectedRunId,
    selectedRun,
    loading,
    error,
    filterStatus,

    // State: pagination and logs
    pageSize,
    loadedLogs,
    logCursor,
    nextCursor,
    totalLogCount,
    isLoadingLogs,
    logLevelFilter,
    logStreamFilter,
    logQuery,
    selectedLogLine,
    selectedLogLineIndex,

    // Computed: runs list
    filteredRuns,
    hasRuns,
    selectedRunArtifacts,

    // Computed: logs
    filteredLogs,
    hasMoreLogs,
    displayedLogCount,
    totalLoadedCount,

    // Actions: runs list
    loadGlobalRuns,
    loadProjectRuns,
    selectRun,
    clearSelection,
    setFilter,

    // Actions: logs
    resetLogs,
    loadMoreLogs,
    setLogFilters,
    selectLogLine,
    clearSelectedLogLine,
  }
})
