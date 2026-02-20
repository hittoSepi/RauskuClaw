<script setup lang="ts">
import { onMounted } from 'vue'
import { useLogsStore } from '@/stores/logs.store'
import LogRunList from '../components/LogRunList.vue'

const logsStore = useLogsStore()

onMounted(() => {
  logsStore.loadGlobalRuns()
})
</script>

<template>
  <div class="logs-page">
    <header class="page-header">
      <h1 class="page-title">Global Logs</h1>
    </header>
    <div class="page-content">
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
</style>
