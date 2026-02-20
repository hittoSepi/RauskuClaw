<script setup lang="ts">
import { onMounted } from 'vue'
import { useLogsStore } from '@/stores/logs.store'
import LogRunList from '../components/LogRunList.vue'

const logsStore = useLogsStore()

onMounted(() => {
  logsStore.loadGlobalRuns()
})

function handleRetry() {
  logsStore.retryWithApi()
}
</script>

<template>
  <div class="logs-page">
    <header class="page-header">
      <h1 class="page-title">Global Logs</h1>
    </header>
    <div class="page-content">
      <!-- API Error Display -->
      <div v-if="logsStore.dataSource === 'api' && logsStore.apiErrorRuns" class="api-error-banner">
        <div class="error-content">
          <svg class="error-icon" viewBox="0 0 20 20" fill="currentColor">
            <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clip-rule="evenodd" />
          </svg>
          <span class="error-message">{{ logsStore.apiErrorRuns }}</span>
        </div>
        <button class="retry-button" @click="handleRetry">Retry</button>
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
