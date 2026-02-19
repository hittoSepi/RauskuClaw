<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useProjectsStore } from '../../../stores/projects.store'

const router = useRouter()
const projectsStore = useProjectsStore()

const projects = computed(() => projectsStore.projects)

function openProject(projectId: string) {
  router.push(`/projects/${projectId}/overview`)
}

function createProject() {
  // TODO: Open create project modal
  const name = prompt('Project name:')
  if (name) {
    const project = projectsStore.addProject({
      id: name.toLowerCase().replace(/\s+/g, '-'),
      name,
      tags: [],
    })
    if (project) {
      router.push(`/projects/${project.id}/overview`)
    }
  }
}
</script>

<template>
  <div class="projects-list-page">
    <header class="page-header">
      <h1 class="page-title">Projects</h1>
      <button class="btn btn-primary" @click="createProject">
        + New Project
      </button>
    </header>

    <div class="projects-grid">
      <div 
        v-for="project in projects" 
        :key="project.id"
        class="project-card"
        @click="openProject(project.id)"
      >
        <div class="project-card-header">
          <span class="project-card-icon">📁</span>
          <h2 class="project-card-name">{{ project.name }}</h2>
          <span v-if="project.isDefault" class="project-card-badge">default</span>
        </div>
        <p v-if="project.description" class="project-card-description">
          {{ project.description }}
        </p>
        <div v-if="project.repoUrl" class="project-card-meta">
          <span class="project-card-repo">📦 {{ project.repoUrl }}</span>
        </div>
        <div class="project-card-tags">
          <span v-for="tag in project.tags" :key="tag" class="tag">{{ tag }}</span>
        </div>
      </div>
    </div>

    <div v-if="projects.length === 0" class="empty-state">
      <div class="empty-state-icon">📁</div>
      <div class="empty-state-title">No projects yet</div>
      <div class="empty-state-text">Create your first project to get started.</div>
    </div>
  </div>
</template>

<style scoped>
.projects-list-page {
  padding: var(--s-3);
  height: 100%;
  overflow: auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--s-3);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.btn {
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.btn:hover {
  background-color: var(--bg-2);
  color: var(--text-0);
}

.btn-primary {
  background-color: var(--accent);
  border-color: var(--accent);
  color: white;
}

.btn-primary:hover {
  background-color: #4a6ae0;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: var(--s-3);
}

.project-card {
  padding: var(--s-3);
  border: 1px solid var(--border-0);
  border-radius: var(--r-md);
  background-color: var(--bg-1);
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease;
}

.project-card:hover {
  border-color: rgba(255, 255, 255, 0.15);
  background-color: var(--bg-2);
}

.project-card-header {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-bottom: var(--s-2);
}

.project-card-icon {
  font-size: 20px;
}

.project-card-name {
  flex: 1;
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-0);
  margin: 0;
}

.project-card-badge {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: rgba(91, 124, 255, 0.15);
  color: var(--accent);
  font-size: 11px;
}

.project-card-description {
  font-size: var(--text-sm);
  color: var(--text-2);
  margin: 0 0 var(--s-2);
}

.project-card-meta {
  font-size: var(--text-sm);
  color: var(--text-2);
  margin-bottom: var(--s-2);
}

.project-card-repo {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-card-tags {
  display: flex;
  gap: var(--s-1);
  flex-wrap: wrap;
}

.tag {
  padding: 2px 8px;
  border-radius: 999px;
  background-color: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 50%;
  text-align: center;
}

.empty-state-icon {
  font-size: 64px;
  margin-bottom: var(--s-2);
  opacity: 0.5;
}

.empty-state-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-1);
  margin-bottom: var(--s-1);
}

.empty-state-text {
  font-size: var(--text-sm);
  color: var(--text-2);
}
</style>