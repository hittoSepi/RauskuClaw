import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import * as logsApi from '@/features/logs/api/logsApi'

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

export type DataSource = 'mock' | 'api'

// Tail progression sequence for API mode
const TAIL_PROGRESSION = [200, 400, 800, 2000] as const
const MAX_TAIL = 2000

// ============================================
// Store definition
// ============================================

export const useLogsStore = defineStore('logs', () => {
  // ============================================
  // State: data source configuration
  // ============================================
  const dataSource = ref<DataSource>(
    (import.meta.env.VITE_LOGS_SOURCE === 'api' ? 'api' : 'mock')
  )
  const apiErrorRuns = ref<string | null>(null)
  const apiErrorLogs = ref<string | null>(null)
  const currentTailSize = ref<number>(TAIL_PROGRESSION[0])

  // Track last loaded run ID for retry
  const lastLoadedRunId = ref<string | null>(null)
  const lastLoadedProjectId = ref<string | null>(null)

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
  const totalLogCount = ref<number | null>(null) // null for API mode (unknown)
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

  const hasMoreLogs = computed(() => {
    // API mode: more logs if we haven't reached max tail
    if (dataSource.value === 'api') {
      return currentTailSize.value < MAX_TAIL
    }
    // Mock mode: more logs if there's a next cursor
    return nextCursor.value !== null
  })
  const displayedLogCount = computed(() => filteredLogs.value.length)
  const totalLoadedCount = computed(() => loadedLogs.value.length)

  // ============================================
  // Actions: runs list
  // ============================================

  async function loadGlobalRuns() {
    loading.value = true
    error.value = null
    apiErrorRuns.value = null
    lastLoadedProjectId.value = null

    try {
      if (dataSource.value === 'api') {
        const result = await logsApi.fetchRuns({ limit: 50 })
        runs.value = result.runs
      } else {
        // Mock mode: use setTimeout to simulate network
        await new Promise(resolve => setTimeout(resolve, 100))
        runs.value = logsApi.generateMockRuns()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load runs'
      error.value = message
      if (dataSource.value === 'api') {
        apiErrorRuns.value = message
      }
    } finally {
      loading.value = false
    }
  }

  async function loadProjectRuns(projectId: string) {
    loading.value = true
    error.value = null
    apiErrorRuns.value = null
    lastLoadedProjectId.value = projectId

    try {
      if (dataSource.value === 'api') {
        // Attempt to filter by queue (projectId as queue name)
        const result = await logsApi.fetchRuns({ queue: projectId, limit: 50 })
        runs.value = result.runs
      } else {
        await new Promise(resolve => setTimeout(resolve, 100))
        runs.value = logsApi.generateMockRuns(projectId)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load runs'
      error.value = message
      if (dataSource.value === 'api') {
        apiErrorRuns.value = message
      }
    } finally {
      loading.value = false
    }
  }

  async function selectRun(runId: string) {
    loading.value = true
    error.value = null
    selectedRunId.value = runId

    try {
      // Find in current runs list
      const run = runs.value.find((r: RunSummary) => r.id === runId)

      if (run) {
        if (dataSource.value === 'api') {
          // API mode: no artifacts support
          selectedRun.value = {
            ...run,
            artifacts: await logsApi.fetchArtifacts(runId),
          }
        } else {
          // Mock mode: use setTimeout to simulate network
          await new Promise(resolve => setTimeout(resolve, 50))
          selectedRun.value = {
            ...run,
            artifacts: logsApi.generateMockArtifacts(runId),
          }
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load run details'
      error.value = message
    } finally {
      loading.value = false
    }
  }

  function clearSelection() {
    selectedRunId.value = null
    selectedRun.value = null
    // Clear log state
    loadedLogs.value = []
    logCursor.value = null
    nextCursor.value = null
    totalLogCount.value = null
    currentTailSize.value = TAIL_PROGRESSION[0]
    lastLoadedRunId.value = null
  }

  function setFilter(status: RunStatus | 'all') {
    filterStatus.value = status
  }

  // ============================================
  // Actions: log pagination
  // ============================================

  function resetLogs(runId: string) {
    loadedLogs.value = []
    logCursor.value = null
    nextCursor.value = null
    totalLogCount.value = dataSource.value === 'api' ? null : 0
    currentTailSize.value = TAIL_PROGRESSION[0]
    lastLoadedRunId.value = runId
    clearSelectedLogLine()
    loadMoreLogs(runId)
  }

  async function loadMoreLogs(runId: string) {
    if (isLoadingLogs.value || !hasMoreLogs.value) {
      return
    }

    isLoadingLogs.value = true
    apiErrorLogs.value = null

    try {
      if (dataSource.value === 'api') {
        // API mode: fetch with tail, REPLACE loadedLogs
        const tail = currentTailSize.value
        const result = await logsApi.fetchLogsTail({ runId, tail })
        loadedLogs.value = result.logs
        // totalLogCount stays null (unknown)
        // Move to next tail size
        const currentIndex = TAIL_PROGRESSION.indexOf(tail as 200 | 400 | 800 | 2000)
        const nextTail = TAIL_PROGRESSION[currentIndex + 1]
        if (nextTail) {
          currentTailSize.value = nextTail
        } else {
          currentTailSize.value = MAX_TAIL
        }
      } else {
        // Mock mode: cursor-based pagination, APPEND logs
        await new Promise(resolve => setTimeout(resolve, 100))
        const result = logsApi.fetchMockLogs({
          runId,
          cursor: logCursor.value,
          pageSize: pageSize.value,
        })
        loadedLogs.value.push(...result.logs)
        logCursor.value = result.nextCursor
        nextCursor.value = result.nextCursor
        totalLogCount.value = result.total
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load logs'
      error.value = message
      if (dataSource.value === 'api') {
        apiErrorLogs.value = message
      }
    } finally {
      isLoadingLogs.value = false
    }
  }

  /**
   * Retry the last failed API request without switching datasource
   */
  async function retryWithApi() {
    if (dataSource.value !== 'api') {
      return // Only applicable in API mode
    }

    // Clear errors and retry
    if (apiErrorRuns.value) {
      apiErrorRuns.value = null
      if (lastLoadedProjectId.value) {
        await loadProjectRuns(lastLoadedProjectId.value)
      } else {
        await loadGlobalRuns()
      }
    }

    if (apiErrorLogs.value && lastLoadedRunId.value) {
      apiErrorLogs.value = null
      await loadMoreLogs(lastLoadedRunId.value)
    }
  }

  // ============================================
  // Actions: log filters
  // ============================================

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

  function selectLogLine(line: LogLine, index: number) {
    selectedLogLine.value = line
    selectedLogLineIndex.value = index
  }

  function clearSelectedLogLine() {
    selectedLogLine.value = null
    selectedLogLineIndex.value = null
  }

  return {
    // State: data source
    dataSource,
    apiErrorRuns,
    apiErrorLogs,
    currentTailSize,

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
    retryWithApi,
    setLogFilters,
    selectLogLine,
    clearSelectedLogLine,
  }
})
