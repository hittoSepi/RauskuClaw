import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export const useUiStore = defineStore('ui', () => {
  // Dev mode
  const devMode = ref(false)
  
  // Inspector state
  const inspectorOpen = ref(true)
  const inspectorWidth = ref(360)
  
  // Command palette
  const commandPaletteOpen = ref(false)
  
  // Settings modal
  const settingsModalOpen = ref(false)
  const settingsModalTab = ref<string | null>(null)
  
  // Sidebar
  const sidebarCollapsed = ref(false)
  
  // Toast notifications
  const toasts = ref<Array<{
    id: string
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
    duration: number
  }>>([])

  // Computed
  const hasToasts = computed(() => toasts.value.length > 0)

  // Actions
  function toggleDevMode() {
    devMode.value = !devMode.value
    persistToLocalStorage()
  }

  function toggleInspector() {
    inspectorOpen.value = !inspectorOpen.value
  }

  function setInspectorOpen(open: boolean) {
    inspectorOpen.value = open
  }

  function openCommandPalette() {
    commandPaletteOpen.value = true
  }

  function closeCommandPalette() {
    commandPaletteOpen.value = false
  }

  function openSettingsModal(tab?: string) {
    settingsModalTab.value = tab || null
    settingsModalOpen.value = true
  }

  function closeSettingsModal() {
    settingsModalOpen.value = false
    settingsModalTab.value = null
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function showToast(toast: {
    type: 'success' | 'error' | 'warning' | 'info'
    message: string
    duration?: number
  }) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    const newToast = {
      id,
      type: toast.type,
      message: toast.message,
      duration: toast.duration ?? 5000,
    }
    toasts.value.push(newToast)
    
    if (newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, newToast.duration)
    }
    
    return id
  }

  function removeToast(id: string) {
    const index = toasts.value.findIndex(t => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  function clearToasts() {
    toasts.value = []
  }

  // Persistence
  function persistToLocalStorage() {
    try {
      localStorage.setItem('rauskuclaw-ui-v2', JSON.stringify({
        devMode: devMode.value,
        sidebarCollapsed: sidebarCollapsed.value,
        inspectorOpen: inspectorOpen.value,
      }))
    } catch {
      // Ignore localStorage errors
    }
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem('rauskuclaw-ui-v2')
      if (raw) {
        const data = JSON.parse(raw)
        if (typeof data.devMode === 'boolean') devMode.value = data.devMode
        if (typeof data.sidebarCollapsed === 'boolean') sidebarCollapsed.value = data.sidebarCollapsed
        if (typeof data.inspectorOpen === 'boolean') inspectorOpen.value = data.inspectorOpen
      }
    } catch {
      // Ignore localStorage errors
    }
  }

  // Keybinds
  function handleKeydown(event: KeyboardEvent) {
    // Cmd/Ctrl + K: Command palette
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault()
      if (commandPaletteOpen.value) {
        closeCommandPalette()
      } else {
        openCommandPalette()
      }
      return
    }

    // Escape: Close modals
    if (event.key === 'Escape') {
      if (commandPaletteOpen.value) {
        closeCommandPalette()
      }
      if (settingsModalOpen.value) {
        closeSettingsModal()
      }
    }
  }

  // Initialize
  loadFromLocalStorage()

  // Setup global keybinds
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', handleKeydown)
  }

  return {
    // State
    devMode,
    inspectorOpen,
    inspectorWidth,
    commandPaletteOpen,
    settingsModalOpen,
    settingsModalTab,
    sidebarCollapsed,
    toasts,
    hasToasts,
    
    // Actions
    toggleDevMode,
    toggleInspector,
    setInspectorOpen,
    openCommandPalette,
    closeCommandPalette,
    openSettingsModal,
    closeSettingsModal,
    toggleSidebar,
    showToast,
    removeToast,
    clearToasts,
    persistToLocalStorage,
    loadFromLocalStorage,
  }
})