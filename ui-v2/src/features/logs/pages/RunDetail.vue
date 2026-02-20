<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useLogsStore, type LogLevel, type LogLine } from '@/stores/logs.store'
import { useInspectorStore } from '@/stores/inspector.store'
import LogViewer from '../components/LogViewer.vue'
import ArtifactList from '../components/ArtifactList.vue'

const route = useRoute()
const logsStore = useLogsStore()
const inspectorStore = useInspectorStore()

const runId = computed(() => route.params.runId as string)
const selectedRun = computed(() => logsStore.selectedRun)
const loading = computed(() => logsStore.loading)
const isLoadingLogs = computed(() => logsStore.isLoadingLogs)
const filteredLogs = computed(() => logsStore.filteredLogs)
const hasMoreLogs = computed(() => logsStore.hasMoreLogs)
const totalLogCount = computed(() => logsStore.totalLogCount)
const artifacts = computed(() => logsStore.selectedRunArtifacts)
const selectedLogLineIndex = computed(() => logsStore.selectedLogLineIndex)

// Local filter state (for debounced search)
const searchQuery = ref('')
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null

onMounted(() => {
  // Load run summary
  logsStore.selectRun(runId.value)
  // Reset and load first page of logs
  logsStore.resetLogs(runId.value)
})

// Handle search with debounce
function handleSearchInput(value: string) {
  searchQuery.value = value
  if (searchDebounceTimer) {
    clearTimeout(searchDebounceTimer)
  }
  searchDebounceTimer = setTimeout(() => {
    logsStore.setLogFilters({ query: value || undefined })
  }, 200)
}

// Handle filter changes
function handleLevelChange(level: LogLevel | 'all') {
  logsStore.setLogFilters({ level })
}

function handleStreamChange(stream: 'stdout' | 'stderr' | 'all') {
  logsStore.setLogFilters({ stream })
}

// Handle load more
function handleLoadMore() {
  logsStore.loadMoreLogs(runId.value)
}

// Handle log line selection
function handleSelectLogLine(line: LogLine, index: number) {
  logsStore.selectLogLine(line, index)
  inspectorStore.selectLogLine(
    `${runId.value}-line-${index}`,
    selectedRun.value?.projectId,
    {
      timestamp: line.ts,
      level: line.level,
      message: line.message,
      stream: line.stream,
      index,
    }
  )
}

function formatDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function getStatusColor(status: string): string {
  const colors: Record<string, string> = {
    succeeded: 'var(--success)',
    failed: 'var(--danger)',
    running: 'var(--warn)',
    queued: 'var(--text-2)',
    canceled: 'var(--text-2)',
  }
  return colors[status] ?? 'var(--text-2)'
}
</script>

<template>
  <div class="run-detail">
    <!-- Loading state -->
    <div v-if="loading && !selectedRun" class="run-detail-loading">
      <div class="spinner"></div>
      <span>Loading run details...</span>
    </div>

    <!-- Not found state -->
    <div v-else-if="!selectedRun" class="run-detail-not-found">
      <div class="run-detail-not-found-icon">🔍</div>
      <div class="run-detail-not-found-title">Run not found</div>
      <div class="run-detail-not-found-text">
        The run {{ runId }} could not be found.
      </div>
    </div>

    <!-- Run details -->
    <template v-else>
      <!-- Header -->
      <header class="run-detail-header" :data-testid="`run-header-${runId}`">
        <div class="run-detail-header-main">
          <h1 class="run-detail-title">{{ selectedRun.title }}</h1>
          <div
            class="run-detail-status"
            :style="{ color: getStatusColor(selectedRun.status) }"
          >
            {{ selectedRun.status.toUpperCase() }}
          </div>
        </div>
        <div class="run-detail-meta">
          <div class="run-detail-meta-item">
            <span class="run-detail-meta-label">ID</span>
            <span class="run-detail-meta-value">{{ selectedRun.id }}</span>
          </div>
          <div class="run-detail-meta-item">
            <span class="run-detail-meta-label">Duration</span>
            <span class="run-detail-meta-value">{{ formatDuration(selectedRun.durationMs) }}</span>
          </div>
          <div v-if="selectedRun.projectId" class="run-detail-meta-item">
            <span class="run-detail-meta-label">Project</span>
            <span class="run-detail-meta-value">{{ selectedRun.projectId }}</span>
          </div>
        </div>
      </header>

      <!-- Content sections -->
      <div class="run-detail-content">
        <!-- Logs section -->
        <section class="run-detail-section">
          <div class="run-detail-section-header">
            <h2 class="run-detail-section-title">Logs</h2>
            <span class="run-detail-section-count">
              {{ filteredLogs.length }} shown
              <span v-if="totalLogCount > 0"> / {{ totalLogCount }} total</span>
            </span>
          </div>

          <!-- Log filters toolbar -->
          <div class="log-filters">
            <!-- Level filter -->
            <div class="log-filter-group">
              <label class="log-filter-label">Level</label>
              <select
                class="log-filter-select"
                :value="logsStore.logLevelFilter"
                @change="handleLevelChange(($event.target as HTMLSelectElement).value as LogLevel | 'all')"
              >
                <option value="all">All</option>
                <option value="debug">Debug</option>
                <option value="info">Info</option>
                <option value="warn">Warn</option>
                <option value="error">Error</option>
              </select>
            </div>

            <!-- Stream filter -->
            <div class="log-filter-group">
              <label class="log-filter-label">Stream</label>
              <select
                class="log-filter-select"
                :value="logsStore.logStreamFilter"
                @change="handleStreamChange(($event.target as HTMLSelectElement).value as 'stdout' | 'stderr' | 'all')"
              >
                <option value="all">All</option>
                <option value="stdout">stdout</option>
                <option value="stderr">stderr</option>
              </select>
            </div>

            <!-- Search filter -->
            <div class="log-filter-group log-filter-group--grow">
              <label class="log-filter-label">Search</label>
              <input
                type="text"
                class="log-filter-input"
                placeholder="Filter logs..."
                :value="searchQuery"
                @input="handleSearchInput(($event.target as HTMLInputElement).value)"
              />
            </div>
          </div>

          <div class="run-detail-section-body run-detail-section-body--logs">
            <LogViewer
              :logs="filteredLogs"
              :loading="isLoadingLogs"
              :has-more="hasMoreLogs"
              :selected-index="selectedLogLineIndex"
              @load-more="handleLoadMore"
              @select-line="handleSelectLogLine"
            />
          </div>
        </section>

        <!-- Artifacts section -->
        <section v-if="artifacts.length > 0" class="run-detail-section">
          <div class="run-detail-section-header">
            <h2 class="run-detail-section-title">Artifacts</h2>
            <span class="run-detail-section-count">{{ artifacts.length }}</span>
          </div>
          <div class="run-detail-section-body">
            <ArtifactList :artifacts="artifacts" />
          </div>
        </section>
      </div>
    </template>
  </div>
</template>

<style scoped>
.run-detail {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: auto;
}

.run-detail-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  height: 100%;
  color: var(--text-2);
}

.spinner {
  width: 24px;
  height: 24px;
  border: 2px solid var(--border-0);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.run-detail-not-found {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}

.run-detail-not-found-icon {
  font-size: 64px;
  margin-bottom: var(--s-2);
  opacity: 0.5;
}

.run-detail-not-found-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: var(--s-1);
}

.run-detail-not-found-text {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.run-detail-header {
  padding: var(--s-3);
  border-bottom: 1px solid var(--border-0);
  background-color: var(--bg-1);
}

.run-detail-header-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--s-2);
}

.run-detail-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.run-detail-status {
  font-size: var(--text-sm);
  font-weight: 600;
  padding: 4px var(--s-2);
  border-radius: 999px;
  background-color: rgba(255, 255, 255, 0.05);
}

.run-detail-meta {
  display: flex;
  gap: var(--s-3);
}

.run-detail-meta-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.run-detail-meta-label {
  font-size: 11px;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.run-detail-meta-value {
  font-size: var(--text-sm);
  color: var(--text-0);
  font-family: var(--font-mono);
}

.run-detail-content {
  flex: 1;
  overflow: auto;
}

.run-detail-section {
  border-bottom: 1px solid var(--border-0);
}

.run-detail-section:last-child {
  border-bottom: none;
}

.run-detail-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2) var(--s-3);
  background-color: var(--bg-1);
}

.run-detail-section-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-0);
  margin: 0;
}

.run-detail-section-count {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.log-filters {
  display: flex;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border-bottom: 1px solid var(--border-0);
  background-color: var(--bg-1);
  flex-wrap: wrap;
}

.log-filter-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.log-filter-group--grow {
  flex: 1;
  min-width: 200px;
}

.log-filter-label {
  font-size: 11px;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.log-filter-select,
.log-filter-input {
  padding: 6px var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background-color: var(--bg-0);
  color: var(--text-0);
  font-size: var(--text-sm);
}

.log-filter-select {
  cursor: pointer;
  min-width: 100px;
}

.log-filter-input {
  flex: 1;
  width: 100%;
}

.log-filter-input::placeholder {
  color: var(--text-2);
}

.log-filter-select:hover,
.log-filter-input:hover {
  border-color: rgba(255, 255, 255, 0.15);
}

.log-filter-select:focus,
.log-filter-input:focus {
  outline: none;
  border-color: var(--accent);
}

.run-detail-section-body {
  padding: var(--s-3);
}

.run-detail-section-body--logs {
  padding: 0;
  height: 500px;
}
</style>
