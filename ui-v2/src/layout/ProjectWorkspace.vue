<script setup lang="ts">
import { computed, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useProjectsStore } from '../stores/projects.store'

const route = useRoute()
const projectsStore = useProjectsStore()

const projectId = computed(() => route.params.projectId as string)

// Update current project when route changes
watch(projectId, (newId) => {
  if (newId) {
    projectsStore.setCurrentProject(newId)
  }
}, { immediate: true })
</script>

<template>
  <div class="project-workspace">
    <!-- Project sub-tabs -->
    <nav class="project-tabs">
      <RouterLink 
        :to="`/projects/${projectId}/overview`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/overview') }"
      >
        Overview
      </RouterLink>
      <RouterLink 
        :to="`/projects/${projectId}/chat`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/chat') }"
      >
        Chat
      </RouterLink>
      <RouterLink 
        :to="`/projects/${projectId}/tasks`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/tasks') }"
      >
        Tasks
      </RouterLink>
      <RouterLink 
        :to="`/projects/${projectId}/memory`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/memory') }"
      >
        Memory
      </RouterLink>
      <RouterLink 
        :to="`/projects/${projectId}/repo`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/repo') }"
      >
        Repo
      </RouterLink>
      <RouterLink 
        :to="`/projects/${projectId}/workdir`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/workdir') }"
      >
        Workdir
      </RouterLink>
      <RouterLink
        :to="`/projects/${projectId}/logs`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/logs') }"
      >
        Logs
      </RouterLink>
      <RouterLink
        :to="`/projects/${projectId}/settings`"
        class="project-tab"
        :class="{ 'router-link-active': $route.path.includes('/settings') }"
      >
        Settings
      </RouterLink>
    </nav>

    <!-- Tab content -->
    <div class="project-content">
      <RouterView />
    </div>
  </div>
</template>

<style scoped>
.project-workspace {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.project-tabs {
  display: flex;
  gap: 2px;
  padding: 0 var(--s-2);
  border-bottom: 1px solid var(--border-0);
  background-color: var(--bg-1);
  overflow-x: auto;
}

.project-tab {
  padding: var(--s-2) var(--s-3);
  font-size: var(--text-sm);
  color: var(--text-1);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: color 150ms ease, border-color 150ms ease;
  white-space: nowrap;
}

.project-tab:hover {
  color: var(--text-0);
}

.project-tab.router-link-active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.project-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
</style>