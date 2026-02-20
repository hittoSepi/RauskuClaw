<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useProjectMetaStore } from '@/stores/projectMeta.store'
import { useProjectsStore } from '@/stores/projects.store'

const route = useRoute()
const router = useRouter()
const projectMetaStore = useProjectMetaStore()
const projectsStore = useProjectsStore()

const projectId = computed(() => route.params.projectId as string)
const project = computed(() => projectsStore.getProjectById(projectId.value))
const meta = computed(() => projectMetaStore.getMeta(projectId.value))

// Form state
const displayName = ref(meta.value.displayName || project.value?.name || '')
const notes = ref(meta.value.notes || '')
const tags = ref(meta.value.tags?.join(', ') || '')
const defaultTab = ref(meta.value.defaultTab || 'chat')

// UI state
const isSaving = ref(false)
const saveMessage = ref<{ type: 'success' | 'error', text: string } | null>(null)
const showArchiveConfirm = ref(false)
const archiveConfirmInput = ref('')

// Computed
const isArchived = computed(() => meta.value.isArchived || false)
const projectDisplayName = computed(() => {
  return meta.value.displayName || project.value?.name || projectId.value
})

function showSuccess(msg: string) {
  saveMessage.value = { type: 'success', text: msg }
  setTimeout(() => (saveMessage.value = null), 3000)
}

function showError(msg: string) {
  saveMessage.value = { type: 'error', text: msg }
  setTimeout(() => (saveMessage.value = null), 5000)
}

async function saveSettings() {
  if (isSaving.value) return

  isSaving.value = true
  saveMessage.value = null

  try {
    // Parse tags from comma-separated input
    const parsedTags = tags.value
      .split(',')
      .map((t: string) => t.trim())
      .filter((t: string) => t.length > 0)

    projectMetaStore.updateMeta(projectId.value, {
      displayName: displayName.value || undefined,
      notes: notes.value || undefined,
      tags: parsedTags.length > 0 ? parsedTags : undefined,
      defaultTab: defaultTab.value || undefined,
    })

    showSuccess('Settings saved')
  } catch (err) {
    showError(err instanceof Error ? err.message : 'Failed to save settings')
  } finally {
    isSaving.value = false
  }
}

function openArchiveConfirm() {
  archiveConfirmInput.value = ''
  showArchiveConfirm.value = true
}

function closeArchiveConfirm() {
  showArchiveConfirm.value = false
  archiveConfirmInput.value = ''
}

async function confirmArchive() {
  if (archiveConfirmInput.value !== projectId.value) {
    showError('Type the project ID to confirm')
    return
  }

  projectMetaStore.setArchived(projectId.value, true)
  closeArchiveConfirm()
  showSuccess('Project archived')

  // Navigate back to projects list after short delay
  setTimeout(() => {
    router.push('/projects')
  }, 1500)
}

async function confirmUnarchive() {
  projectMetaStore.setArchived(projectId.value, false)
  showSuccess('Project unarchived')
}

// Memory management actions (placeholder for now)
function clearWorkingMemory() {
  // TODO: Call DELETE /v1/working-memory when scoping is available
  showError('Clearing working memory requires backend scoping support (Milestone 23)')
}

function resetProjectMemory() {
  // TODO: Call POST /v1/memory/reset with scope when available
  showError('Resetting memory requires backend scoping support (Milestone 23)')
}
</script>

<template>
  <div class="project-settings-page" data-testid="project-settings">
    <header class="page-header">
      <div class="page-header-left">
        <h1 class="page-title">Project Settings - {{ projectDisplayName }}</h1>
        <span v-if="project" class="project-id-badge">{{ project.id }}</span>
      </div>
      <button
        class="btn btn-primary"
        :disabled="isSaving"
        @click="saveSettings"
        data-testid="project-settings-save"
      >
        {{ isSaving ? 'Saving...' : 'Save Changes' }}
      </button>
    </header>

    <!-- Save message banner -->
    <div
      v-if="saveMessage"
      :class="['message-banner', `message-banner--${saveMessage.type}`]"
    >
      <span class="message-text">{{ saveMessage.text }}</span>
      <button class="message-close" @click="saveMessage = null">×</button>
    </div>

    <div class="settings-content">
      <!-- General Section -->
      <section class="settings-section">
        <h2 class="section-title">General</h2>

        <div class="form-group">
          <label for="display-name" class="form-label">Display Name</label>
          <input
            id="display-name"
            v-model="displayName"
            type="text"
            class="form-input"
            placeholder="Project display name"
            data-testid="project-display-name"
          />
          <span class="form-help">Shown in UI instead of project ID</span>
        </div>

        <div class="form-group">
          <label for="notes" class="form-label">Notes</label>
          <textarea
            id="notes"
            v-model="notes"
            class="form-textarea"
            rows="4"
            placeholder="Project notes, documentation, or reminders..."
            data-testid="project-notes"
          />
        </div>

        <div class="form-group">
          <label for="tags" class="form-label">Tags</label>
          <input
            id="tags"
            v-model="tags"
            type="text"
            class="form-input"
            placeholder="tag1, tag2, tag3"
            data-testid="project-tags"
          />
          <span class="form-help">Comma-separated tags for organization</span>
        </div>

        <div class="form-group">
          <label for="default-tab" class="form-label">Default Tab</label>
          <select
            id="default-tab"
            v-model="defaultTab"
            class="form-select"
            data-testid="project-default-tab"
          >
            <option value="overview">Overview</option>
            <option value="chat">Chat</option>
            <option value="tasks">Tasks</option>
            <option value="memory">Memory</option>
            <option value="repo">Repo</option>
            <option value="workdir">Workdir</option>
            <option value="logs">Logs</option>
          </select>
          <span class="form-help">Which tab to show by default</span>
        </div>

        <div class="form-group">
          <label class="form-label">Project ID</label>
          <div class="project-id-display">
            <code class="project-id-code">{{ projectId }}</code>
          </div>
          <span class="form-help">Used in URLs and API calls</span>
        </div>
      </section>

      <!-- Maintenance Section -->
      <section class="settings-section">
        <h2 class="section-title">Maintenance</h2>

        <div class="action-row">
          <div class="action-info">
            <h3 class="action-title">Clear Working Memory</h3>
            <p class="action-description">
              Clear the working memory state for this project (unsaved session data).
            </p>
          </div>
          <button
            class="btn btn-secondary"
            disabled
            @click="clearWorkingMemory"
            data-testid="project-clear-working-memory"
          >
            Clear Memory
          </button>
        </div>

        <div class="action-row">
          <div class="action-info">
            <h3 class="action-title">Reset Project Memories</h3>
            <p class="action-description">
              Delete all stored memories for this project. This action cannot be undone.
            </p>
          </div>
          <button
            class="btn btn-secondary"
            disabled
            @click="resetProjectMemory"
            data-testid="project-reset-memory"
          >
            Reset Memories
          </button>
        </div>
      </section>

      <!-- Danger Zone Section -->
      <section class="settings-section settings-section--danger">
        <h2 class="section-title section-title--danger">Danger Zone</h2>

        <div v-if="!isArchived" class="action-row">
          <div class="action-info">
            <h3 class="action-title">Archive Project</h3>
            <p class="action-description">
              Hide this project from the project list. You can unarchive it later from settings.
            </p>
          </div>
          <button
            class="btn btn-danger"
            @click="openArchiveConfirm"
            data-testid="project-archive"
          >
            Archive Project
          </button>
        </div>

        <div v-else class="action-row">
          <div class="action-info">
            <h3 class="action-title">Unarchive Project</h3>
            <p class="action-description">
              Show this project in the project list again.
            </p>
          </div>
          <button
            class="btn btn-secondary"
            @click="confirmUnarchive"
            data-testid="project-unarchive"
          >
            Unarchive Project
          </button>
        </div>

        <div class="action-row">
          <div class="action-info">
            <h3 class="action-title">Delete Project</h3>
            <p class="action-description">
              Permanently delete this project and all its data. This action cannot be undone.
            </p>
            <p class="action-note">
              <strong>Note:</strong> Hard delete is coming in Milestone 23. For now, use Archive to hide projects.
            </p>
          </div>
          <button
            class="btn btn-danger"
            disabled
            title="Coming in Milestone 23"
            data-testid="project-delete"
          >
            Delete Project
          </button>
        </div>
      </section>
    </div>

    <!-- Archive Confirmation Modal -->
    <div
      v-if="showArchiveConfirm"
      class="modal-overlay"
      data-testid="archive-confirm-modal"
    >
      <div class="modal">
        <div class="modal-header">
          <h2 class="modal-title">Confirm Archive</h2>
          <button class="modal-close" @click="closeArchiveConfirm">×</button>
        </div>
        <div class="modal-body">
          <p>
            Are you sure you want to archive <strong>{{ projectId }}</strong>?
          </p>
          <p>This will hide the project from the project list. You can unarchive it later.</p>
          <p>
            Type <code>{{ projectId }}</code> to confirm:
          </p>
          <input
            v-model="archiveConfirmInput"
            type="text"
            class="form-input"
            :placeholder="projectId"
            data-testid="archive-confirm-input"
          />
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" @click="closeArchiveConfirm">
            Cancel
          </button>
          <button
            class="btn btn-danger"
            :disabled="archiveConfirmInput !== projectId"
            @click="confirmArchive"
            data-testid="archive-confirm-button"
          >
            Archive Project
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.project-settings-page {
  padding: var(--s-3);
  height: 100%;
  overflow: auto;
}

.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: var(--s-4);
}

.page-header-left {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.page-title {
  font-size: var(--text-xl);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.project-id-badge {
  padding: var(--s-1) var(--s-2);
  background: var(--bg-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  font-size: var(--text-xs);
  font-family: monospace;
  color: var(--text-1);
}

.message-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-sm);
  margin-bottom: var(--s-3);
}

.message-banner--success {
  background: var(--success-bg);
  border: 1px solid var(--success);
  color: var(--success);
}

.message-banner--error {
  background: var(--error-bg);
  border: 1px solid var(--error);
  color: var(--error);
}

.message-close {
  background: none;
  border: none;
  font-size: var(--text-xl);
  cursor: pointer;
  padding: 0;
  margin-left: var(--s-2);
  color: inherit;
}

.settings-content {
  display: flex;
  flex-direction: column;
  gap: var(--s-6);
}

.settings-section {
  background: var(--bg-1);
  border: 1px solid var(--border-0);
  border-radius: var(--r-md);
  padding: var(--s-4);
}

.settings-section--danger {
  border-color: var(--error);
  background: rgba(239, 68, 68, 0.05);
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-0);
  margin: 0 0 var(--s-4) 0;
}

.section-title--danger {
  color: var(--error);
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  margin-bottom: var(--s-4);
}

.form-label {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-1);
}

.form-input,
.form-textarea,
.form-select {
  padding: var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background: var(--bg-0);
  color: var(--text-0);
  font-size: var(--text-sm);
  font-family: inherit;
}

.form-input:focus,
.form-textarea:focus,
.form-select:focus {
  outline: none;
  border-color: var(--accent);
}

.form-textarea {
  resize: vertical;
  min-height: 80px;
}

.form-help {
  font-size: var(--text-xs);
  color: var(--text-2);
}

.project-id-display {
  padding: var(--s-2);
  background: var(--bg-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
}

.project-id-code {
  font-family: monospace;
  font-size: var(--text-sm);
  color: var(--text-1);
}

.action-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-3) 0;
  border-bottom: 1px solid var(--border-1);
}

.action-row:last-child {
  border-bottom: none;
}

.action-info {
  flex: 1;
}

.action-title {
  font-size: var(--text-base);
  font-weight: 500;
  color: var(--text-0);
  margin: 0 0 var(--s-1) 0;
}

.action-description {
  font-size: var(--text-sm);
  color: var(--text-1);
  margin: 0;
}

.action-note {
  font-size: var(--text-xs);
  color: var(--text-2);
  margin: var(--s-1) 0 0 0;
}

/* Buttons */
.btn {
  padding: var(--s-2) var(--s-3);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background: var(--bg-2);
  color: var(--text-1);
  font-size: var(--text-sm);
  font-family: inherit;
  cursor: pointer;
  transition: all 150ms ease;
}

.btn:hover:not(:disabled) {
  background: var(--bg-3);
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}

.btn-primary:hover:not(:disabled) {
  opacity: 0.9;
}

.btn-secondary {
  background: var(--bg-2);
  border-color: var(--border-0);
}

.btn-danger {
  background: var(--error);
  color: white;
  border-color: var(--error);
}

.btn-danger:hover:not(:disabled) {
  opacity: 0.9;
}

/* Modal */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: var(--s-3);
}

.modal {
  background: var(--bg-0);
  border-radius: var(--r-md);
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.2);
  max-width: 500px;
  width: 100%;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-4);
  border-bottom: 1px solid var(--border-0);
}

.modal-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-0);
  margin: 0;
}

.modal-close {
  background: none;
  border: none;
  font-size: var(--text-xl);
  color: var(--text-1);
  cursor: pointer;
  padding: 0;
}

.modal-body {
  padding: var(--s-4);
}

.modal-body p {
  margin: 0 0 var(--s-3) 0;
  color: var(--text-1);
}

.modal-body code {
  padding: var(--s-1);
  background: var(--bg-2);
  border-radius: var(--r-sm);
  font-family: monospace;
  font-size: var(--text-sm);
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: var(--s-2);
  padding: var(--s-4);
  border-top: 1px solid var(--border-0);
}
</style>
