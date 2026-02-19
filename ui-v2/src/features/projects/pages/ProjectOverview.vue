<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectsStore } from '../../../stores/projects.store'

const route = useRoute()
const router = useRouter()
const projectsStore = useProjectsStore()

const projectId = computed(() => route.params.projectId as string)
const project = computed(() => projectsStore.getProjectById(projectId.value))

function openChat() {
  router.push(`/projects/${projectId.value}/chat`)
}

function openTasks() {
  router.push(`/projects/${projectId.value}/tasks`)
}

function openLogs() {
  router.push(`/projects/${projectId.value}/logs`)
}
</script>

<template>
  <div class="project-overview">
    <div v-if="project" class="overview-content">
      <!-- Project header -->
      <header class="overview-header">
        <h1 class="overview-title">{{ project.name }}</h1>
        <span v-if="project.isDefault" class="overview-badge">default</span>
      </header>

      <p v-if="project.description" class="overview-description">
        {{ project.description }}
      </p>

      <!-- Quick stats -->
      <div class="overview-stats">
        <div class="stat-card">
          <div class="stat-value">-</div>
          <div class="stat-label">Tasks</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">-</div>
          <div class="stat-label">Memory Entries</div>
        </div>
        <div class="stat-card">
          <div class="stat-value">-</div>
          <div class="stat-label">Runs</div>
        </div>
      </div>

      <!-- Quick actions -->
      <div class="overview-actions">
        <button class="action-btn" @click="openChat">
          <span class="action-icon">💬</span>
          Open Chat
        </button>
        <button class="action-btn" @click="openTasks">
          <span class="action-icon">✅</span>
          View Tasks
        </button>
        <button class="action-btn" @click="openLogs">
          <span class="action-icon">📋</span>
          View Logs
        </button>
      </div>

      <!-- Project info -->
      <div class="overview-section">
        <h2 class="section-title">Project Info</h2>
        <div class="info-grid">
          <div class="info-item">
            <div class="info-label">ID</div>
            <div class="info-value">{{ project.id }}</div>
          </div>
          <div v-if="project.repoUrl" class="info-item">
            <div class="info-label">Repository</div>
            <div class="info-value">{{ project.repoUrl }}</div>
          </div>
          <div v-if="project.branch" class="info-item">
            <div class="info-label">Branch</div>
            <div class="info-value">{{ project.branch }}</div>
          </div>
          <div class="info-item">
            <div class="info-label">Created</div>
            <div class="info-value">{{ new Date(project.createdAt).toLocaleDateString() }}</div>
          </div>
        </div>
      </div>
    </div>

    <div v-else class="empty-state">
      <div class="empty-state-icon">📁</div>
      <div class="empty-state-title">Project not found</div>
      <div class="empty-state-text">This project doesn't exist or has been deleted.</div>
    </div>
  </div>
</template>

<style scoped>
.project-overview {
  padding: var(--s-3);
  height: 100%;
  overflow: auto;
}

.overview-content {
  max-width: 800px;
}

.overview-header {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-bottom: var(--s-2);
}

.overview-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.overview-badge {
  padding: 4px 12px;
  border-radius: 999px;
  background-color: rgba(91, 124, 255, 0.15);
  color: var(--accent);
  font-size: var(--text-sm);
}

.overview-description {
  font-size: var(--text-md);
  color: var(--text-1);
  margin: 0 0 var(--s-3);
}

.overview-stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--s-2);
  margin-bottom: var(--s-3);
}

.stat-card {
  padding: var(--s-3);
  border: 1px solid var(--border-0);
  border-radius: var(--r-md);
  background-color: var(--bg-1);
  text-align: center;
}

.stat-value {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
}

.stat-label {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.overview-actions {
  display: flex;
  gap: var(--s-2);
  margin-bottom: var(--s-3);
}

.action-btn {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background: transparent;
  color: var(--text-1);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, border-color 150ms ease;
}

.action-btn:hover {
  background-color: var(--bg-2);
  border-color: rgba(255, 255, 255, 0.15);
}

.action-icon {
  font-size: 16px;
}

.overview-section {
  margin-bottom: var(--s-3);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-0);
  margin: 0 0 var(--s-2);
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--s-2);
}

.info-item {
  padding: var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background-color: var(--bg-1);
}

.info-label {
  font-size: var(--text-sm);
  color: var(--text-2);
  margin-bottom: 4px;
}

.info-value {
  font-size: var(--text-md);
  color: var(--text-0);
  word-break: break-word;
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