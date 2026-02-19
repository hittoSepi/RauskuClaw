<script setup lang="ts">
import { computed } from 'vue'
import { useInspectorStore, type InspectorSelectionType } from '../stores/inspector.store'
import { useUiStore } from '../stores/ui.store'

const inspectorStore = useInspectorStore()
const uiStore = useUiStore()

const selection = computed(() => inspectorStore.selection)
const hasSelection = computed(() => inspectorStore.hasSelection)
const selectionType = computed(() => inspectorStore.selectionType)

const typeLabels: Record<InspectorSelectionType, string> = {
  ChatMessage: 'Chat Message',
  ToolRun: 'Tool Run',
  Task: 'Task',
  MemoryEntry: 'Memory Entry',
  LogRun: 'Log Run',
  RepoOperation: 'Repo Operation',
}

function close() {
  uiStore.setInspectorOpen(false)
}

function clearSelection() {
  inspectorStore.clear()
}

function getTypeLabel(type: InspectorSelectionType | null): string {
  if (!type) return ''
  return typeLabels[type] || type
}

function getIconForType(type: InspectorSelectionType | null): string {
  switch (type) {
    case 'ChatMessage': return '💬'
    case 'ToolRun': return '🔧'
    case 'Task': return '✅'
    case 'MemoryEntry': return '🧠'
    case 'LogRun': return '📋'
    case 'RepoOperation': return '📦'
    default: return '📄'
  }
}
</script>

<template>
  <div class="inspector">
    <!-- Header -->
    <header class="inspector-header">
      <div class="inspector-header-title">
        <span class="inspector-header-icon">{{ getIconForType(selectionType) }}</span>
        <span class="inspector-header-text">
          {{ hasSelection ? getTypeLabel(selectionType) : 'Inspector' }}
        </span>
      </div>
      <div class="inspector-header-actions">
        <button 
          v-if="hasSelection" 
          class="inspector-header-btn"
          @click="clearSelection"
          title="Clear selection"
        >
          ✕
        </button>
        <button class="inspector-header-btn" @click="close" title="Close inspector">
          ✕
        </button>
      </div>
    </header>

    <!-- Content -->
    <div class="inspector-content">
      <!-- Empty state -->
      <div v-if="!hasSelection" class="inspector-empty">
        <div class="inspector-empty-icon">📋</div>
        <div class="inspector-empty-title">No selection</div>
        <div class="inspector-empty-text">
          Select a message, task, or other item to view details here.
        </div>
      </div>

      <!-- Selection details -->
      <div v-else class="inspector-details">
        <!-- Type badge -->
        <div class="inspector-badge">
          {{ selection?.type }}
        </div>

        <!-- ID -->
        <div class="inspector-field">
          <div class="inspector-field-label">ID</div>
          <div class="inspector-field-value inspector-field-value--mono">
            {{ selection?.id }}
          </div>
        </div>

        <!-- Project -->
        <div v-if="selection?.projectId" class="inspector-field">
          <div class="inspector-field-label">Project</div>
          <div class="inspector-field-value">
            {{ selection.projectId }}
          </div>
        </div>

        <!-- Metadata (from data) -->
        <template v-if="selection?.data">
          <div class="inspector-section-title">Metadata</div>
          <div 
            v-for="(value, key) in selection.data" 
            :key="key"
            class="inspector-field"
          >
            <div class="inspector-field-label">{{ key }}</div>
            <div class="inspector-field-value">
              {{ typeof value === 'object' ? JSON.stringify(value) : value }}
            </div>
          </div>
        </template>

        <!-- Actions -->
        <div class="inspector-actions">
          <button class="inspector-action-btn">
            <span class="inspector-action-icon">📌</span>
            Pin to Memory
          </button>
          <button class="inspector-action-btn">
            <span class="inspector-action-icon">✅</span>
            Create Task
          </button>
          <button class="inspector-action-btn">
            <span class="inspector-action-icon">📋</span>
            Open in Logs
          </button>
        </div>
      </div>
    </div>

    <!-- Loading state -->
    <div v-if="inspectorStore.loading" class="inspector-loading">
      <div class="inspector-loading-spinner"></div>
      <span>Loading...</span>
    </div>

    <!-- Error state -->
    <div v-if="inspectorStore.error" class="inspector-error">
      <span class="inspector-error-icon">⚠️</span>
      <span>{{ inspectorStore.error }}</span>
    </div>
  </div>
</template>

<style scoped>
.inspector {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-1);
}

.inspector-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2);
  border-bottom: 1px solid var(--border-0);
}

.inspector-header-title {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}

.inspector-header-icon {
  font-size: 16px;
}

.inspector-header-text {
  font-weight: 600;
  color: var(--text-0);
}

.inspector-header-actions {
  display: flex;
  gap: var(--s-1);
}

.inspector-header-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.inspector-header-btn:hover {
  background-color: var(--bg-2);
  color: var(--text-0);
}

.inspector-content {
  flex: 1;
  overflow: auto;
  padding: var(--s-2);
}

.inspector-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  color: var(--text-2);
}

.inspector-empty-icon {
  font-size: 48px;
  margin-bottom: var(--s-2);
  opacity: 0.5;
}

.inspector-empty-title {
  font-size: var(--text-md);
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: var(--s-1);
}

.inspector-empty-text {
  font-size: var(--text-sm);
  max-width: 200px;
}

.inspector-details {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.inspector-badge {
  display: inline-flex;
  padding: 4px var(--s-2);
  border-radius: 999px;
  background-color: rgba(91, 124, 255, 0.15);
  color: var(--accent);
  font-size: var(--text-sm);
  font-weight: 500;
  width: fit-content;
}

.inspector-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding-top: var(--s-2);
  border-top: 1px solid var(--border-0);
}

.inspector-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.inspector-field-label {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.inspector-field-value {
  font-size: var(--text-sm);
  color: var(--text-0);
  word-break: break-word;
}

.inspector-field-value--mono {
  font-family: var(--font-mono);
  font-size: 12px;
  background-color: var(--bg-2);
  padding: 4px var(--s-1);
  border-radius: 6px;
}

.inspector-actions {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  margin-top: var(--s-2);
  padding-top: var(--s-2);
  border-top: 1px solid var(--border-0);
}

.inspector-action-btn {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  width: 100%;
  padding: var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.inspector-action-btn:hover {
  background-color: var(--bg-2);
  border-color: rgba(255, 255, 255, 0.15);
}

.inspector-action-icon {
  font-size: 14px;
}

.inspector-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  padding: var(--s-2);
  color: var(--text-2);
  font-size: var(--text-sm);
}

.inspector-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--border-0);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.inspector-error {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-2);
  background-color: rgba(255, 77, 109, 0.1);
  color: var(--danger);
  font-size: var(--text-sm);
  margin: var(--s-2);
  border-radius: var(--r-sm);
}

.inspector-error-icon {
  font-size: 14px;
}
</style>