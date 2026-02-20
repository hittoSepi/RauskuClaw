<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useLogsStore } from '@/stores/logs.store'
import * as logsApi from '@/features/logs/api/logsApi'
import LogRunList from '../components/LogRunList.vue'

const logsStore = useLogsStore()

// Computed states
const dataSource = computed(() => logsStore.dataSource)
const loading = computed(() => logsStore.loading)
const apiErrorRuns = computed(() => logsStore.apiErrorRuns)
const hasRuns = computed(() => logsStore.hasRuns)
const runs = computed(() => logsStore.runs)

// Dev job creation state
const isCreatingJob = ref(false)
const createJobError = ref<string | null>(null)

onMounted(() => {
  logsStore.loadGlobalRuns()
})

function handleRetry() {
  logsStore.retryWithApi()
}

async function handleCreateDevJob() {
  if (isCreatingJob.value) return

  isCreatingJob.value = true
  createJobError.value = null

  try {
    await logsApi.createDevJob('default', 'test')
    // Reload the runs list
    await logsStore.loadGlobalRuns()
  } catch (err) {
    createJobError.value = err instanceof Error ? err.message : 'Failed to create dev job'
  } finally {
    isCreatingJob.value = false
  }
}

// Show create button when in API mode, no errors, and no runs
const showCreateButton = computed(() => {
  return dataSource.value === 'api'
    && !loading.value
    && !apiErrorRuns.value
    && !hasRuns.value
    && runs.value.length === 0
})
</script>

<template>
  <div class="logs-page">
    <header class="page-header">
      <h1 class="page-title">Global Logs</h1>
    </header>
    <div class="page-content">
      <!-- API Error Display -->
      <div v-if="dataSource === 'api' && apiErrorRuns" class="api-error-banner">
        <div class="error-content">
          <svg class="error-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
          <span class="error-message">{{ apiErrorRuns }}</span>
        </div>
        <button class="retry-button" @click="handleRetry">Retry</button>
      </div>

      <!-- Create Job Error -->
      <div v-if="createJobError" class="api-error-banner api-error-banner--create">
        <div class="error-content">
          <svg class="error-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
          <span class="error-message">{{ createJobError }}</span>
        </div>
        <button class="retry-button" @click="createJobError = null">Dismiss</button>
      </div>

      <!-- Empty State with Create Button (API mode only) -->
      <div v-if="showCreateButton" class="empty-state">
        <div class="empty-content">
          <svg class="empty-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd" />
          </svg>
          <div class="empty-text">
            <div class="empty-title">No runs found</div>
            <div class="empty-description">Create a test job to see runs appear here</div>
          </div>
        </div>
        <button
          class="create-job-button"
          :disabled="isCreatingJob"
          @click="handleCreateDevJob"
          data-testid="create-dev-job-global"
        >
          {{ isCreatingJob ? 'Creating...' : 'Run test job' }}
        </button>
      </div>

      <LogRunList />
    </div>
  </div>
</template>

<style scoped>
.logs-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.page-header {
  padding: var(--s-3);
  border-bottom: 1px solid var(--border-0);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.page-content {
  flex: 1;
  min-height: 0;
}

.api-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2) var(--s-3);
  margin: var(--s-3);
  border-radius: var(--rounded);
  background-color: var(--bg-error-soft, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--border-error, rgba(239, 68, 68, 0.2));
}

.error-content {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.error-icon {
  width: 20px;
  height: 20px;
  color: var(--text-error, #ef4444);
  flex-shrink: 0;
}

.error-message {
  color: var(--text-error, #ef4444);
  font-size: var(--text-sm);
}

.retry-button,
.create-job-button {
  padding: var(--s-1) var(--s-3);
  border-radius: var(--rounded);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.retry-button {
  background-color: var(--bg-0, #ffffff);
  border: 1px solid var(--border-error, rgba(239, 68, 68, 0.3));
  color: var(--text-error, #ef4444);
}

.retry-button:hover {
  background-color: var(--bg-1, #f9fafb);
  border-color: var(--border-error, #ef4444);
}

.retry-button:active {
  background-color: var(--bg-2, #f3f4f6);
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-3);
  margin: var(--s-3);
  border-radius: var(--rounded);
  background-color: var(--bg-1);
  border: 1px solid var(--border-0);
}

.empty-content {
  display: flex;
  align-items: flex-start;
  gap: var(--s-2);
}

.empty-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
  color: var(--text-2);
}

.empty-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.empty-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-0);
}

.empty-description {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.create-job-button {
  background-color: var(--accent, #3b82f6);
  border: 1px solid var(--accent, #3b82f6);
  color: var(--text-0, #ffffff);
}

.create-job-button:hover:not(:disabled) {
  background-color: var(--accent-hover, #2563eb);
  border-color: var(--accent-hover, #2563eb);
}

.create-job-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
