<script setup lang="ts">
import type { RunSummary } from '@/stores/logs.store'

interface Props {
  run: RunSummary
}

const props = defineProps<Props>()

const emit = defineEmits<{
  click: [runId: string]
}>()

function formatDuration(ms?: number): string {
  if (!ms) return '-'
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${(ms / 60000).toFixed(1)}m`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
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

function getStatusIcon(status: string): string {
  const icons: Record<string, string> = {
    succeeded: '✓',
    failed: '✕',
    running: '●',
    queued: '○',
    canceled: '⊘',
  }
  return icons[status] ?? '?'
}
</script>

<template>
  <div
    class="run-row"
    :data-testid="`run-row-${run.id}`"
    @click="emit('click', run.id)"
  >
    <!-- Status indicator -->
    <div
      class="run-status"
      :style="{ color: getStatusColor(run.status) }"
    >
      <span class="run-status-icon">{{ getStatusIcon(run.status) }}</span>
    </div>

    <!-- Title -->
    <div class="run-title">
      {{ run.title }}
    </div>

    <!-- Time -->
    <div class="run-time">
      {{ formatTime(run.createdAt) }}
    </div>

    <!-- Duration -->
    <div class="run-duration">
      {{ formatDuration(run.durationMs) }}
    </div>
  </div>
</template>

<style scoped>
.run-row {
  display: grid;
  grid-template-columns: 24px 1fr 60px 60px;
  gap: var(--s-2);
  align-items: center;
  padding: var(--s-2);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.run-row:hover {
  background-color: var(--bg-2);
}

.run-status {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.run-status-icon {
  font-size: 14px;
  font-weight: 600;
}

.run-title {
  font-size: var(--text-sm);
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-time,
.run-duration {
  font-size: var(--text-sm);
  color: var(--text-2);
  font-family: var(--font-mono);
  text-align: right;
}
</style>
