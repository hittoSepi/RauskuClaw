<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useLogsStore } from '@/stores/logs.store'
import LogRunList from '../components/LogRunList.vue'

const route = useRoute()
const logsStore = useLogsStore()

const projectId = route.params.projectId as string

// Computed states
const dataSource = computed(() => logsStore.dataSource)
const loading = computed(() => logsStore.loading)
const apiErrorRuns = computed(() => logsStore.apiErrorRuns)
const hasRuns = computed(() => logsStore.hasRuns)
const runs = computed(() => logsStore.runs)

onMounted(() => {
  logsStore.loadProjectRuns(projectId)
})

function handleRetry() {
  logsStore.retryWithApi()
}

// Determine what message to show
const statusMessage = computed(() => {
  if (loading.value) {
    return null
  }

  if (dataSource.value === 'api') {
    if (apiErrorRuns.value) {
      return {
        type: 'error',
        title: 'Failed to load runs',
        message: apiErrorRuns.value,
      }
    }
    if (!hasRuns.value && runs.value.length === 0) {
      return {
        type: 'empty',
        title: 'No runs found',
        message: `No runs found for queue "${projectId}"`,
      }
    }
  }

  return null
})
</script>

<template>
  <div class="logs-page">
    <header class="page-header">
      <h1 class="page-title">Logs</h1>
      <span class="page-project">{{ projectId }}</span>
    </header>
    <div class="page-content">
      <!-- API Error Display -->
      <div
        v-if="statusMessage?.type === 'error'"
        class="status-message status-message--error"
      >
        <div class="status-content">
          <svg class="status-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
          <div class="status-text">
            <div class="status-title">{{ statusMessage.title }}</div>
            <div class="status-description">{{ statusMessage.message }}</div>
          </div>
        </div>
        <button class="retry-button" @click="handleRetry">Retry</button>
      </div>

      <!-- Empty State (API mode, no error, no runs) -->
      <div
        v-else-if="statusMessage?.type === 'empty'"
        class="status-message status-message--empty"
      >
        <div class="status-content">
          <svg class="status-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clip-rule="evenodd" />
          </svg>
          <div class="status-text">
            <div class="status-title">{{ statusMessage.title }}</div>
            <div class="status-description">{{ statusMessage.message }}</div>
          </div>
        </div>
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
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-3);
  border-bottom: 1px solid var(--border-0);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.page-project {
  font-size: var(--text-sm);
  color: var(--text-2);
  padding: 2px 8px;
  background: var(--bg-2);
  border-radius: 999px;
}

.page-content {
  flex: 1;
  min-height: 0;
}

.status-message {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-3);
  margin: var(--s-3);
  border-radius: var(--rounded);
}

.status-message--error {
  background-color: var(--bg-error-soft, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--border-error, rgba(239, 68, 68, 0.2));
}

.status-message--empty {
  background-color: var(--bg-1);
  border: 1px solid var(--border-0);
}

.status-content {
  display: flex;
  align-items: flex-start;
  gap: var(--s-2);
}

.status-icon {
  width: 20px;
  height: 20px;
  flex-shrink: 0;
  margin-top: 2px;
}

.status-message--error .status-icon {
  color: var(--text-error, #ef4444);
}

.status-message--empty .status-icon {
  color: var(--text-2);
}

.status-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.status-title {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-0);
}

.status-description {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.retry-button {
  padding: var(--s-1) var(--s-3);
  border-radius: var(--rounded);
  background-color: var(--bg-0, #ffffff);
  border: 1px solid var(--border-error, rgba(239, 68, 68, 0.3));
  color: var(--text-error, #ef4444);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.15s, border-color 0.15s;
}

.retry-button:hover {
  background-color: var(--bg-1, #f9fafb);
  border-color: var(--border-error, #ef4444);
}

.retry-button:active {
  background-color: var(--bg-2, #f3f4f6);
}
</style>
