import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Selection types that can be shown in inspector
export type InspectorSelectionType = 
  | 'ChatMessage'
  | 'ToolRun'
  | 'Task'
  | 'MemoryEntry'
  | 'LogRun'
  | 'LogLine'
  | 'RepoOperation'

export interface InspectorSelection {
  type: InspectorSelectionType
  id: string
  projectId?: string
  data?: Record<string, unknown>
}

export const useInspectorStore = defineStore('inspector', () => {
  // State
  const open = ref(false)
  const selection = ref<InspectorSelection | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const hasSelection = computed(() => selection.value !== null)
  const selectionType = computed(() => selection.value?.type ?? null)

  // Actions
  function select(newSelection: InspectorSelection) {
    selection.value = newSelection
    open.value = true
    loading.value = false
    error.value = null
  }

  function selectChatMessage(messageId: string, projectId?: string, data?: Record<string, unknown>) {
    select({
      type: 'ChatMessage',
      id: messageId,
      projectId,
      data,
    })
  }

  function selectToolRun(runId: string, projectId?: string, data?: Record<string, unknown>) {
    select({
      type: 'ToolRun',
      id: runId,
      projectId,
      data,
    })
  }

  function selectTask(taskId: string, projectId?: string, data?: Record<string, unknown>) {
    select({
      type: 'Task',
      id: taskId,
      projectId,
      data,
    })
  }

  function selectMemoryEntry(entryId: string, projectId?: string, data?: Record<string, unknown>) {
    select({
      type: 'MemoryEntry',
      id: entryId,
      projectId,
      data,
    })
  }

  function selectLogRun(runId: string, projectId?: string, data?: Record<string, unknown>) {
    select({
      type: 'LogRun',
      id: runId,
      projectId,
      data,
    })
  }

  function selectLogLine(lineId: string, projectId?: string, data?: Record<string, unknown>) {
    select({
      type: 'LogLine',
      id: lineId,
      projectId,
      data,
    })
  }

  function clear() {
    selection.value = null
    loading.value = false
    error.value = null
  }

  function close() {
    open.value = false
  }

  function openDrawer() {
    open.value = true
  }

  function setLoading(isLoading: boolean) {
    loading.value = isLoading
  }

  function setError(errorMsg: string | null) {
    error.value = errorMsg
    loading.value = false
  }

  function updateData(newData: Record<string, unknown>) {
    if (selection.value) {
      selection.value = {
        ...selection.value,
        data: {
          ...selection.value.data,
          ...newData,
        },
      }
    }
  }

  return {
    // State
    open,
    selection,
    loading,
    error,
    
    // Computed
    hasSelection,
    selectionType,
    
    // Actions
    select,
    selectChatMessage,
    selectToolRun,
    selectTask,
    selectMemoryEntry,
    selectLogRun,
    selectLogLine,
    clear,
    close,
    openDrawer,
    setLoading,
    setError,
    updateData,
  }
})