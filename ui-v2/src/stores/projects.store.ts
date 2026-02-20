import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export interface Project {
  id: string
  name: string
  description?: string
  repoUrl?: string
  branch?: string
  tags: string[]
  createdAt: string
  updatedAt: string
  isDefault?: boolean
  isArchived?: boolean
}

const DEFAULT_PROJECT: Project = {
  id: 'yleischat',
  name: 'Yleischat',
  description: 'Oletusprojekti yleiskeskustelulle ja testeille',
  tags: ['default', 'chat'],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  isDefault: true,
}

const STORAGE_KEY = 'rauskuclaw-projects-v2'

export const useProjectsStore = defineStore('projects', () => {
  // State
  const projects = ref<Project[]>([])
  const currentProjectId = ref<string>('yleischat')
  const loading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const currentProject = computed(() => 
    projects.value.find(p => p.id === currentProjectId.value) ?? null
  )
  
  const hasProjects = computed(() => projects.value.length > 0)
  
  const defaultProject = computed(() => 
    projects.value.find(p => p.isDefault) ?? null
  )

  // Actions
  function initialize() {
    loadFromLocalStorage()
    
    // Ensure default project exists
    if (!projects.value.find(p => p.id === 'yleischat')) {
      projects.value.push(DEFAULT_PROJECT)
      persistToLocalStorage()
    }
  }

  function setCurrentProject(projectId: string) {
    const project = projects.value.find(p => p.id === projectId)
    if (project) {
      currentProjectId.value = projectId
      persistCurrentProject()
    }
  }

  function addProject(project: Omit<Project, 'createdAt' | 'updatedAt'>) {
    const now = new Date().toISOString()
    const newProject: Project = {
      ...project,
      createdAt: now,
      updatedAt: now,
    }
    projects.value.push(newProject)
    persistToLocalStorage()
    return newProject
  }

  function updateProject(projectId: string, updates: Partial<Omit<Project, 'id' | 'createdAt'>>) {
    const index = projects.value.findIndex(p => p.id === projectId)
    if (index === -1) return null
    
    const existing = projects.value[index]!
    const updated: Project = {
      id: existing.id,
      name: updates.name ?? existing.name,
      description: updates.description ?? existing.description,
      repoUrl: updates.repoUrl ?? existing.repoUrl,
      branch: updates.branch ?? existing.branch,
      tags: updates.tags ?? existing.tags,
      createdAt: existing.createdAt,
      updatedAt: new Date().toISOString(),
      isDefault: updates.isDefault ?? existing.isDefault,
    }
    projects.value[index] = updated
    persistToLocalStorage()
    return updated
  }

  function removeProject(projectId: string) {
    // Cannot remove default project
    if (projectId === 'yleischat') {
      return false
    }
    
    const index = projects.value.findIndex(p => p.id === projectId)
    if (index !== -1) {
      projects.value.splice(index, 1)
      
      // If removed project was current, switch to default
      if (currentProjectId.value === projectId) {
        currentProjectId.value = 'yleischat'
        persistCurrentProject()
      }
      
      persistToLocalStorage()
      return true
    }
    return false
  }

  function getProjectById(projectId: string) {
    return projects.value.find(p => p.id === projectId) ?? null
  }

  // Persistence
  function persistToLocalStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects.value))
    } catch {
      // Ignore localStorage errors
    }
  }

  function persistCurrentProject() {
    try {
      localStorage.setItem(`${STORAGE_KEY}-current`, currentProjectId.value)
    } catch {
      // Ignore localStorage errors
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (Array.isArray(parsed)) {
          projects.value = parsed
        }
      }
      
      const currentRaw = localStorage.getItem(`${STORAGE_KEY}-current`)
      if (currentRaw) {
        currentProjectId.value = currentRaw
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  // Initialize on store creation
  initialize()

  return {
    // State
    projects,
    currentProjectId,
    loading,
    error,
    
    // Computed
    currentProject,
    hasProjects,
    defaultProject,
    
    // Actions
    initialize,
    setCurrentProject,
    addProject,
    updateProject,
    removeProject,
    getProjectById,
    persistToLocalStorage,
    loadFromLocalStorage,
  }
})