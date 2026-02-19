<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUiStore } from '../stores/ui.store'
import { useProjectsStore } from '../stores/projects.store'
import { useAuthStore } from '../stores/auth.store'

const router = useRouter()
const route = useRoute()
const uiStore = useUiStore()
const projectsStore = useProjectsStore()
const authStore = useAuthStore()

const currentProject = computed(() => projectsStore.currentProject)
const pageTitle = computed(() => {
  const meta = route.meta?.title as string | undefined
  return meta || 'RauskuClaw'
})

function toggleInspector() {
  uiStore.toggleInspector()
}

function toggleDevMode() {
  uiStore.toggleDevMode()
}

function openCommandPalette() {
  uiStore.openCommandPalette()
}

function openSettings() {
  router.push('/settings')
}

function handleLogout() {
  authStore.logout()
}
</script>

<template>
  <div class="topbar">
    <!-- Left: Menu toggle + Title -->
    <div class="topbar-left">
      <button class="topbar-menu-btn" @click="uiStore.toggleSidebar()">
        <span class="topbar-menu-icon">☰</span>
      </button>
      
      <div class="topbar-title">
        <span class="topbar-title-text">{{ pageTitle }}</span>
        <span v-if="currentProject" class="topbar-title-project">
          / {{ currentProject.name }}
        </span>
      </div>
    </div>
    
    <!-- Center: Context chips -->
    <div class="topbar-center">
      <div v-if="currentProject?.repoUrl" class="topbar-chip">
        <span class="topbar-chip-icon">📦</span>
        <span class="topbar-chip-label">{{ currentProject.branch || 'main' }}</span>
      </div>
    </div>
    
    <!-- Right: Actions -->
    <div class="topbar-right">
      <!-- Command palette trigger -->
      <button class="topbar-action" @click="openCommandPalette" title="Command palette (⌘K)">
        <span class="topbar-action-icon">🔍</span>
        <span class="topbar-action-label">⌘K</span>
      </button>
      
      <!-- Inspector toggle -->
      <button 
        class="topbar-action" 
        :class="{ 'topbar-action--active': uiStore.inspectorOpen }"
        @click="toggleInspector"
        title="Toggle inspector"
      >
        <span class="topbar-action-icon">📋</span>
      </button>
      
      <!-- Dev mode toggle -->
      <button 
        class="topbar-action" 
        :class="{ 'topbar-action--active': uiStore.devMode }"
        @click="toggleDevMode"
        title="Toggle dev mode"
      >
        <span class="topbar-action-icon">🔧</span>
      </button>
      
      <!-- Settings -->
      <button class="topbar-action" @click="openSettings" title="Settings">
        <span class="topbar-action-icon">⚙️</span>
      </button>
      
      <!-- Logout (only show when authenticated) -->
      <button 
        v-if="authStore.isAuthenticated" 
        class="topbar-action topbar-action--logout" 
        @click="handleLogout" 
        title="Logout"
      >
        <span class="topbar-action-icon">🚪</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.topbar {
  display: flex;
  align-items: center;
  height: 100%;
  padding: 0 var(--s-2);
  gap: var(--s-2);
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.topbar-menu-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.topbar-menu-btn:hover {
  background-color: var(--bg-2);
}

.topbar-menu-icon {
  font-size: 18px;
}

.topbar-title {
  display: flex;
  align-items: baseline;
  gap: var(--s-1);
}

.topbar-title-text {
  font-weight: 600;
  color: var(--text-0);
}

.topbar-title-project {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.topbar-center {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
}

.topbar-chip {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px var(--s-2);
  border-radius: 999px;
  background-color: var(--bg-2);
  font-size: var(--text-sm);
  color: var(--text-1);
}

.topbar-chip-icon {
  font-size: 12px;
}

.topbar-chip-label {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: var(--s-1);
}

.topbar-action {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: var(--s-1) var(--s-2);
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.topbar-action:hover {
  background-color: var(--bg-2);
  color: var(--text-0);
}

.topbar-action--active {
  background-color: rgba(91, 124, 255, 0.15);
  color: var(--accent);
}

.topbar-action-icon {
  font-size: 16px;
}

.topbar-action-label {
  font-size: 11px;
  opacity: 0.7;
}

@media (max-width: 768px) {
  .topbar-action-label {
    display: none;
  }
  
  .topbar-center {
    display: none;
  }
}
</style>