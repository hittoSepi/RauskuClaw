<script setup lang="ts">
import { onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useLogsStore } from '@/stores/logs.store'
import LogRunList from '../components/LogRunList.vue'

const route = useRoute()
const logsStore = useLogsStore()

const projectId = route.params.projectId as string

onMounted(() => {
  logsStore.loadProjectRuns(projectId)
})
</script>

<template>
  <div class="logs-page">
    <header class="page-header">
      <h1 class="page-title">Logs</h1>
      <span class="page-project">{{ projectId }}</span>
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
</style>
