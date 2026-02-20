import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api } from '@/shared/api'
import { isApiError } from '@/shared/api'

export interface ProjectMeta {
  displayName?: string
  notes?: string
  tags?: string[]
  isArchived?: boolean
  defaultTab?: string
}

// Backend API response shape
interface BackendProjectMeta {
  projectId: string
  displayName: string | null
  notes: string | null
  tags: string[] | null
  isArchived: boolean
  updatedAt: string | null
}

const STORAGE_KEY = 'rauskuclaw.projectMeta.v1'
const API_MODE_KEY = 'rauskuclaw.projectMeta.apiMode'

type ApiMode = 'api' | 'local'

export const useProjectMetaStore = defineStore('projectMeta', () => {
  // State
  const metaMap = ref<Record<string, ProjectMeta>>({})
  const loading = ref(false)
  const error = ref<string | null>(null)
  const apiMode = ref<ApiMode>('local')

  // Computed
  const hasMeta = computed(() => (projectId: string) => !!metaMap.value[projectId])

  // Actions
  function initialize() {
    // Load API mode preference
    try {
      const savedMode = localStorage.getItem(API_MODE_KEY)
      if (savedMode === 'api' || savedMode === 'local') {
        apiMode.value = savedMode
      }
    } catch {
      // Ignore localStorage errors
    }

    loadFromLocalStorage()
  }

  function getMeta(projectId: string): ProjectMeta {
    if (!metaMap.value[projectId]) {
      metaMap.value[projectId] = {}
    }
    return metaMap.value[projectId] || {}
  }

  async function updateMeta(projectId: string, updates: Partial<ProjectMeta>): Promise<void> {
    const current = getMeta(projectId)
    const newMeta: ProjectMeta = {
      ...current,
      ...updates,
    }

    // Always update local state immediately for responsiveness
    metaMap.value[projectId] = newMeta
    persistToLocalStorage()

    // Try API if enabled
    if (apiMode.value === 'api') {
      try {
        await patchProjectMetaApi(projectId, updates)
      } catch (err) {
        // If API fails, fall back to local-only mode silently
        if (isApiError(err) && err.status === 404) {
          // 404 is OK - means no server meta yet, will be created on patch
        } else {
          console.warn('Failed to update project meta on server:', err)
        }
      }
    }
  }

  async function loadMeta(projectId: string): Promise<ProjectMeta> {
    if (apiMode.value === 'api') {
      try {
        const serverMeta = await getProjectMetaApi(projectId)
        // Merge with local data (local takes precedence for fields like defaultTab)
        const localMeta = getMeta(projectId)
        const merged: ProjectMeta = {
          displayName: serverMeta.displayName ?? localMeta.displayName,
          notes: serverMeta.notes ?? localMeta.notes,
          tags: serverMeta.tags ?? localMeta.tags,
          isArchived: serverMeta.isArchived ?? localMeta.isArchived ?? false,
          defaultTab: localMeta.defaultTab,
        }
        metaMap.value[projectId] = merged
        persistToLocalStorage()
        return merged
      } catch (err) {
        if (isApiError(err) && err.status === 404) {
          // Project doesn't exist on server yet, use local
          return getMeta(projectId)
        }
        throw err
      }
    }
    return getMeta(projectId)
  }

  async function loadBatchMeta(projectIds: string[]): Promise<void> {
    if (apiMode.value === 'api' && projectIds.length > 0) {
      try {
        const serverMetaMap = await getBatchProjectMetaApi(projectIds)
        for (const [projectId, serverMeta] of Object.entries(serverMetaMap)) {
          const localMeta = getMeta(projectId)
          metaMap.value[projectId] = {
            displayName: serverMeta.displayName ?? localMeta.displayName,
            notes: serverMeta.notes ?? localMeta.notes,
            tags: serverMeta.tags ?? localMeta.tags,
            isArchived: serverMeta.isArchived ?? localMeta.isArchived ?? false,
            defaultTab: localMeta.defaultTab,
          }
        }
        persistToLocalStorage()
      } catch (err) {
        console.warn('Failed to load batch project meta:', err)
      }
    }
  }

  function setArchived(projectId: string, isArchived: boolean): void {
    updateMeta(projectId, { isArchived })
  }

  function clearMeta(projectId: string): void {
    delete metaMap.value[projectId]
    persistToLocalStorage()
  }

  // API functions
  async function getProjectMetaApi(projectId: string): Promise<ProjectMeta> {
    const response = await api<{ ok: boolean; meta: BackendProjectMeta }>(
      `/v1/projects/${encodeURIComponent(projectId)}/meta`
    )

    return {
      displayName: response.meta.displayName ?? undefined,
      notes: response.meta.notes ?? undefined,
      tags: response.meta.tags ?? undefined,
      isArchived: response.meta.isArchived,
    }
  }

  async function getBatchProjectMetaApi(projectIds: string[]): Promise<Record<string, ProjectMeta>> {
    const idsParam = projectIds.join(',')
    const response = await api<{ ok: boolean; meta: Record<string, BackendProjectMeta> }>(
      `/v1/projects/meta?ids=${encodeURIComponent(idsParam)}`
    )

    const result: Record<string, ProjectMeta> = {}
    for (const [id, serverMeta] of Object.entries(response.meta)) {
      result[id] = {
        displayName: serverMeta.displayName ?? undefined,
        notes: serverMeta.notes ?? undefined,
        tags: serverMeta.tags ?? undefined,
        isArchived: serverMeta.isArchived,
      }
    }
    return result
  }

  async function patchProjectMetaApi(projectId: string, updates: Partial<ProjectMeta>): Promise<void> {
    const body: Record<string, unknown> = {}
    if (updates.displayName !== undefined) body.displayName = updates.displayName
    if (updates.notes !== undefined) body.notes = updates.notes
    if (updates.tags !== undefined) body.tags = updates.tags
    if (updates.isArchived !== undefined) body.isArchived = updates.isArchived

    await api(`/v1/projects/${encodeURIComponent(projectId)}/meta`, {
      method: 'PATCH',
      body,
    })
  }

  // Persistence
  function persistToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(metaMap.value))
    } catch {
      // Ignore localStorage errors
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          metaMap.value = parsed
        }
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  function setApiMode(mode: ApiMode) {
    apiMode.value = mode
    try {
      localStorage.setItem(API_MODE_KEY, mode)
    } catch {
      // Ignore localStorage errors
    }
  }

  // Initialize on store creation
  initialize()

  return {
    // State
    metaMap,
    loading,
    error,
    apiMode,

    // Actions
    initialize,
    getMeta,
    updateMeta,
    loadMeta,
    loadBatchMeta,
    setArchived,
    clearMeta,
    setApiMode,
    hasMeta,
    persistToLocalStorage,
    loadFromLocalStorage,
  }
})
