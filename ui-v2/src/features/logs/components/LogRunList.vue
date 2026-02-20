<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useLogsStore, type RunStatus } from '@/stores/logs.store'
import LogRunRow from './LogRunRow.vue'

const logsStore = useLogsStore()
const router = useRouter()

const filteredRuns = computed(() => logsStore.filteredRuns)
const loading = computed(() => logsStore.loading)
const hasRuns = computed(() => logsStore.hasRuns)
const filterStatus = computed(() => logsStore.filterStatus)

const statusOptions: Array<{ value: RunStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'succeeded', label: 'Succeeded' },
  { value: 'failed', label: 'Failed' },
  { value: 'canceled', label: 'Canceled' },
]

function setFilter(status: RunStatus | 'all') {
  logsStore.setFilter(status)
}

function handleRowClick(runId: string) {
  logsStore.selectRun(runId)
  router.push(`/runs/${runId}`)
}
</script>

<template>
  <div class="run-list">
    <!-- Filter controls -->
    <div class="run-list-header">
      <div class="run-list-filters">
        <button
          v-for="option in statusOptions"
          :key="option.value"
          class="filter-btn"
          :class="{ 'filter-btn--active': filterStatus === option.value }"
          :data-testid="`filter-${option.value}`"
          @click="setFilter(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="run-list-count">
        {{ filteredRuns.length }} run{{ filteredRuns.length !== 1 ? 's' : '' }}
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="loading && !hasRuns" class="run-list-loading">
      <div class="spinner"></div>
      <span>Loading runs...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="!hasRuns" class="run-list-empty">
      <div class="run-list-empty-icon">📋</div>
      <div class="run-list-empty-title">No runs yet</div>
      <div class="run-list-empty-text">Run jobs to see logs here.</div>
    </div>

    <!-- Runs list -->
    <div v-else class="run-list-items">
      <LogRunRow
        v-for="run in filteredRuns"
        :key="run.id"
        :run="run"
        @click="handleRowClick"
      />
    </div>
  </div>
</template>

<style scoped>
.run-list {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.run-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2);
  border-bottom: 1px solid var(--border-0);
}

.run-list-filters {
  display: flex;
  gap: var(--s-1);
}

.filter-btn {
  padding: 4px var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.filter-btn:hover {
  background-color: var(--bg-2);
  color: var(--text-1);
}

.filter-btn--active {
  background-color: var(--accent);
  border-color: var(--accent);
  color: white;
}

.run-list-count {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.run-list-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-4);
  color: var(--text-2);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-0);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.run-list-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 50%;
  text-align: center;
}

.run-list-empty-icon {
  font-size: 64px;
  margin-bottom: var(--s-2);
  opacity: 0.5;
}

.run-list-empty-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: var(--s-1);
}

.run-list-empty-text {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.run-list-items {
  flex: 1;
  overflow: auto;
  padding: var(--s-2);
}
</style>
