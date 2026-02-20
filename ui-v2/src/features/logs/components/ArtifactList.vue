<script setup lang="ts">
import { ref } from 'vue'
import type { Artifact, ArtifactKind } from '@/stores/logs.store'

interface Props {
  artifacts: Artifact[]
}

defineProps<Props>()

// Track which artifact had its link copied (for feedback)
const copiedArtifactId = ref<string | null>(null)

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  })
}

function getKindIcon(kind: ArtifactKind): string {
  const icons: Record<ArtifactKind, string> = {
    report: '📋',
    trace: '🔍',
    video: '🎬',
    screenshot: '🖼️',
    log: '📄',
    json: '{ }',
    archive: '📦',
    other: '📎',
  }
  return icons[kind]
}

async function copyLink(artifact: Artifact) {
  if (!artifact.href) return

  try {
    // Try modern clipboard API
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(artifact.href)
    } else {
      // Fallback for older browsers or non-secure contexts
      const textArea = document.createElement('textarea')
      textArea.value = artifact.href
      textArea.style.position = 'fixed'
      textArea.style.left = '-999999px'
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand('copy')
      document.body.removeChild(textArea)
    }

    // Show feedback
    copiedArtifactId.value = artifact.id
    setTimeout(() => {
      copiedArtifactId.value = null
    }, 2000)
  } catch {
    // Silently fail if copy doesn't work
  }
}
</script>

<template>
  <div class="artifact-list">
    <!-- Empty state -->
    <div v-if="artifacts.length === 0" class="artifact-list-empty">
      <div class="artifact-list-empty-text">No artifacts for this run</div>
    </div>

    <!-- Artifacts -->
    <div v-else class="artifact-items">
      <div
        v-for="artifact in artifacts"
        :key="artifact.id"
        class="artifact-item"
        :data-testid="`artifact-${artifact.id}`"
      >
        <div class="artifact-icon">{{ getKindIcon(artifact.kind) }}</div>
        <div class="artifact-info">
          <div class="artifact-name-row">
            <div class="artifact-name">{{ artifact.name }}</div>
            <span class="artifact-kind-badge">{{ artifact.kind }}</span>
          </div>
          <div class="artifact-meta">
            {{ formatSize(artifact.sizeBytes) }} · {{ artifact.contentType }}
          </div>
          <div class="artifact-time">{{ formatTime(artifact.createdAt) }}</div>
        </div>
        <div class="artifact-actions">
          <a
            :href="artifact.href || '#'"
            :disabled="!artifact.href"
            class="artifact-btn artifact-btn--open"
            :class="{ 'artifact-btn--disabled': !artifact.href }"
            :data-testid="`artifact-open-${artifact.id}`"
            :target="artifact.href ? '_blank' : undefined"
            :rel="artifact.href ? 'noopener' : undefined"
          >
            Open
          </a>
          <button
            class="artifact-btn artifact-btn--copy"
            :class="{ 'artifact-btn--disabled': !artifact.href }"
            :disabled="!artifact.href"
            :data-testid="`artifact-copy-${artifact.id}`"
            @click="copyLink(artifact)"
          >
            {{ copiedArtifactId === artifact.id ? 'Copied!' : 'Copy link' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.artifact-list {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
}

.artifact-list-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: var(--s-3);
  color: var(--text-2);
  font-size: var(--text-sm);
}

.artifact-items {
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
}

.artifact-item {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2);
  border-radius: var(--r-sm);
  background-color: var(--bg-1);
  border: 1px solid var(--border-0);
}

.artifact-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.artifact-info {
  flex: 1;
  min-width: 0;
}

.artifact-name-row {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  margin-bottom: 2px;
}

.artifact-name {
  font-size: var(--text-sm);
  color: var(--text-0);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.artifact-kind-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  border-radius: 3px;
  background-color: var(--bg-2);
  color: var(--text-2);
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  white-space: nowrap;
  flex-shrink: 0;
}

.artifact-meta {
  font-size: 11px;
  color: var(--text-2);
}

.artifact-time {
  font-size: 11px;
  color: var(--text-2);
}

.artifact-actions {
  display: flex;
  gap: var(--s-1);
  flex-shrink: 0;
}

.artifact-btn {
  padding: 4px var(--s-2);
  border-radius: var(--r-sm);
  background-color: var(--bg-2);
  color: var(--text-1);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
  border: 1px solid transparent;
  text-decoration: none;
}

.artifact-btn:hover:not(.artifact-btn--disabled) {
  background-color: var(--accent);
  color: white;
}

.artifact-btn--open {
  text-decoration: none;
}

.artifact-btn--disabled {
  opacity: 0.5;
  cursor: not-allowed;
  background-color: var(--bg-2);
  color: var(--text-2);
}

.artifact-btn--disabled:hover {
  background-color: var(--bg-2);
  color: var(--text-2);
}

.artifact-btn--copy {
  border: 1px solid var(--border-0);
}
</style>
