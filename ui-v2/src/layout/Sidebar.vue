<script setup lang="ts">
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useUiStore } from '@/stores/ui.store'
import { useProjectsStore } from '@/stores/projects.store'
import { useProjectMetaStore } from '@/stores/projectMeta.store'

const router = useRouter()
const route = useRoute()
const uiStore = useUiStore()
const projectsStore = useProjectsStore()
const projectMetaStore = useProjectMetaStore()

const navItems = computed(() => [
  {
    icon: '💬',
    label: 'New chat',
    action: () => router.push(`/projects/${projectsStore.currentProjectId || 'yleischat'}/chat`)
  },
  {
    icon: '📂',
    label: 'Projects',
    path: '/projects',
    active: route.path === '/projects'
  },
  {
    icon: '📋',
    label: 'Logs',
    path: '/logs',
    active: route.path === '/logs'
  },
  {
    icon: '⚙️',
    label: 'Settings',
    path: '/settings',
    active: route.path === '/settings'
  },
])

const currentProject = computed(() => projectsStore.currentProject)

const currentProjectDisplayName = computed(() => {
  if (!currentProject.value) return 'Yleischat'
  const meta = projectMetaStore.getMeta(currentProject.value.id)
  return meta.displayName || currentProject.value.name
})

function navigate(path: string) {
  router.push(path)
}
</script>

<template>
  <div class="sidebar">
    <!-- Project selector -->
    <div class="sidebar-section">
      <div class="sidebar-project" @click="navigate('/projects')">
        <span class="sidebar-project-icon">📁</span>
        <span class="sidebar-project-name">
          {{ currentProjectDisplayName }}
        </span>
        <span class="sidebar-project-chevron">▼</span>
      </div>
    </div>

    <!-- Navigation -->
    <nav class="sidebar-nav">
      <ul class="sidebar-nav-list">
        <li 
          v-for="item in navItems" 
          :key="item.label"
          class="sidebar-nav-item"
          :class="{ 'sidebar-nav-item--active': item.active }"
        >
          <button 
            v-if="item.action"
            class="sidebar-nav-button"
            @click="item.action"
          >
            <span class="sidebar-nav-icon">{{ item.icon }}</span>
            <span class="sidebar-nav-label">{{ item.label }}</span>
          </button>
          <a 
            v-else-if="item.path"
            class="sidebar-nav-link"
            :class="{ 'sidebar-nav-link--active': item.active }"
            @click.prevent="navigate(item.path)"
          >
            <span class="sidebar-nav-icon">{{ item.icon }}</span>
            <span class="sidebar-nav-label">{{ item.label }}</span>
          </a>
        </li>
      </ul>
    </nav>

    <!-- Project sub-nav (if in project context) -->
    <div v-if="route.params.projectId" class="sidebar-section">
      <div class="sidebar-section-title">Project</div>
      <ul class="sidebar-subnav">
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/overview') }"
          @click="navigate(`/projects/${route.params.projectId}/overview`)"
        >
          <span class="sidebar-nav-icon">🏠</span>
          <span>Overview</span>
        </li>
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/chat') }"
          @click="navigate(`/projects/${route.params.projectId}/chat`)"
        >
          <span class="sidebar-nav-icon">💬</span>
          <span>Chat</span>
        </li>
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/tasks') }"
          @click="navigate(`/projects/${route.params.projectId}/tasks`)"
        >
          <span class="sidebar-nav-icon">✅</span>
          <span>Tasks</span>
        </li>
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/memory') }"
          @click="navigate(`/projects/${route.params.projectId}/memory`)"
        >
          <span class="sidebar-nav-icon">🧠</span>
          <span>Memory</span>
        </li>
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/repo') }"
          @click="navigate(`/projects/${route.params.projectId}/repo`)"
        >
          <span class="sidebar-nav-icon">📦</span>
          <span>Repo</span>
        </li>
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/workdir') }"
          @click="navigate(`/projects/${route.params.projectId}/workdir`)"
        >
          <span class="sidebar-nav-icon">📁</span>
          <span>Workdir</span>
        </li>
        <li 
          class="sidebar-subnav-item"
          :class="{ 'sidebar-subnav-item--active': route.path.includes('/logs') }"
          @click="navigate(`/projects/${route.params.projectId}/logs`)"
        >
          <span class="sidebar-nav-icon">📋</span>
          <span>Logs</span>
        </li>
      </ul>
    </div>

    <!-- Dev mode indicator -->
    <div v-if="uiStore.devMode" class="sidebar-dev-badge">
      <span class="sidebar-dev-badge-icon">🔧</span>
      <span>Dev Mode</span>
    </div>
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: var(--s-2);
  gap: var(--s-2);
}

.sidebar-section {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}

.sidebar-section-title {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-2);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: var(--s-1) var(--s-2);
}

.sidebar-project {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-2);
  border-radius: var(--r-sm);
  background-color: var(--bg-2);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.sidebar-project:hover {
  background-color: rgba(255, 255, 255, 0.08);
}

.sidebar-project-icon {
  font-size: 18px;
}

.sidebar-project-name {
  flex: 1;
  font-weight: 500;
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.sidebar-project-chevron {
  font-size: 10px;
  color: var(--text-2);
}

.sidebar-nav {
  flex: 0;
}

.sidebar-nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.sidebar-nav-item {
  border-radius: var(--r-sm);
}

.sidebar-nav-button,
.sidebar-nav-link {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  width: 100%;
  padding: var(--s-2);
  border: none;
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.sidebar-nav-button:hover,
.sidebar-nav-link:hover {
  background-color: var(--bg-2);
  color: var(--text-0);
}

.sidebar-nav-link--active,
.sidebar-nav-item--active .sidebar-nav-button,
.sidebar-nav-item--active .sidebar-nav-link {
  background-color: rgba(91, 124, 255, 0.15);
  color: var(--accent);
}

.sidebar-nav-icon {
  font-size: 16px;
  width: 20px;
  text-align: center;
}

.sidebar-nav-label {
  flex: 1;
}

.sidebar-subnav {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.sidebar-subnav-item {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-1) var(--s-2);
  padding-left: calc(var(--s-2) + 20px + var(--s-1));
  border-radius: var(--r-sm);
  font-size: var(--text-sm);
  color: var(--text-1);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.sidebar-subnav-item:hover {
  background-color: var(--bg-2);
  color: var(--text-0);
}

.sidebar-subnav-item--active {
  background-color: rgba(91, 124, 255, 0.15);
  color: var(--accent);
}

.sidebar-dev-badge {
  margin-top: auto;
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-2);
  border-radius: var(--r-sm);
  background-color: rgba(255, 77, 109, 0.15);
  color: var(--danger);
  font-size: var(--text-sm);
}

.sidebar-dev-badge-icon {
  font-size: 14px;
}
</style>