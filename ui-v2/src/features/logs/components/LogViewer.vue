<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { LogLine } from '@/stores/logs.store'

interface Props {
  logs: LogLine[]
  loading?: boolean
  hasMore?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  loading: false,
  hasMore: false,
})

const emit = defineEmits<{
  loadMore: []
  selectLine: [line: LogLine, index: number]
}>()

// Refs
const logLinesRef = ref<HTMLElement | null>(null)

// Follow tail state
const followTail = ref(true)

// Windowed rendering for performance (render visible subset)
const WINDOW_SIZE = 100 // Render 100 lines before/after viewport
const scrollTop = ref(0)
const viewportHeight = ref(600)

// Computed: windowed logs for performance
// Only render logs near the viewport to handle 2000+ lines efficiently
const windowedLogs = computed(() => {
  const lineHeight = 25 // Approximate line height in pixels
  const startLine = Math.max(0, Math.floor(scrollTop.value / lineHeight) - WINDOW_SIZE)
  const endLine = Math.min(
    props.logs.length,
    Math.ceil((scrollTop.value + viewportHeight.value) / lineHeight) + WINDOW_SIZE
  )

  return props.logs.slice(startLine, endLine).map((log, idx) => ({
    log,
    actualIndex: startLine + idx,
  }))
})

// Helper: format timestamp
function formatTime(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }) + '.' +
    String(date.getMilliseconds()).padStart(3, '0')
}

// Helper: level colors
function getLevelColor(level: string): string {
  const colors: Record<string, string> = {
    debug: 'var(--text-2)',
    info: 'var(--text-1)',
    warn: 'var(--warn)',
    error: 'var(--danger)',
  }
  return colors[level] ?? 'var(--text-1)'
}

function getLevelBackground(level: string): string {
  const colors: Record<string, string> = {
    debug: 'transparent',
    info: 'transparent',
    warn: 'rgba(255, 176, 32, 0.1)',
    error: 'rgba(255, 77, 109, 0.1)',
  }
  return colors[level] ?? 'transparent'
}

// Scroll handling
function handleScroll() {
  if (!logLinesRef.value) return

  scrollTop.value = logLinesRef.value.scrollTop
  viewportHeight.value = logLinesRef.value.clientHeight

  // Check if user scrolled up (disable follow)
  const scrollObj = logLinesRef.value
  const distanceFromBottom = scrollObj.scrollHeight - scrollObj.scrollTop - scrollObj.clientHeight

  // Disable follow if user scrolled up more than 200px
  if (distanceFromBottom > 200) {
    followTail.value = false
  }
}

// Scroll to bottom (for follow tail)
async function scrollToBottom() {
  await nextTick()
  if (logLinesRef.value) {
    logLinesRef.value.scrollTop = logLinesRef.value.scrollHeight
  }
}

// Toggle follow tail
function toggleFollowTail() {
  followTail.value = !followTail.value
  if (followTail.value) {
    scrollToBottom()
  }
}

// Watch for new logs when following
watch(() => props.logs.length, async (newLen, oldLen) => {
  if (followTail.value && newLen > (oldLen ?? 0)) {
    await nextTick()
    scrollToBottom()
  }
})

// Initial scroll to bottom when logs are loaded
watch(() => props.logs.length > 0, async (hasLogs) => {
  if (hasLogs && followTail.value) {
    await nextTick()
    scrollToBottom()
  }
})

// Handle load more
function handleLoadMore() {
  emit('loadMore')
}

// Handle log line selection
function handleLogLineClick(line: LogLine, index: number) {
  emit('selectLine', line, index)
}

// Lifecycle
onMounted(() => {
  if (logLinesRef.value) {
    logLinesRef.value.addEventListener('scroll', handleScroll)
  }
})

onUnmounted(() => {
  if (logLinesRef.value) {
    logLinesRef.value.removeEventListener('scroll', handleScroll)
  }
})
</script>

<template>
  <div class="log-viewer" data-testid="log-viewer">
    <!-- Loading overlay -->
    <div v-if="loading && logs.length === 0" class="log-viewer-loading">
      <div class="spinner"></div>
      <span>Loading logs...</span>
    </div>

    <!-- Empty state -->
    <div v-else-if="logs.length === 0" class="log-viewer-empty">
      <div class="log-viewer-empty-icon">📄</div>
      <div class="log-viewer-empty-title">No logs available</div>
    </div>

    <!-- Log viewer with toolbar -->
    <template v-else>
      <!-- Toolbar -->
      <div class="log-viewer-toolbar">
        <div class="log-viewer-info">
          <span class="log-viewer-count">{{ logs.length }} lines</span>
          <span v-if="hasMore" class="log-viewer-more"> (more available)</span>
        </div>
        <div class="log-viewer-actions">
          <button
            v-if="hasMore"
            class="toolbar-btn"
            :disabled="loading"
            @click="handleLoadMore"
            data-testid="load-older-btn"
          >
            {{ loading ? 'Loading...' : 'Load older' }}
          </button>
          <button
            class="follow-toggle"
            :class="{ 'follow-toggle--active': followTail }"
            @click="toggleFollowTail"
          >
            <span class="follow-toggle-icon">{{ followTail ? '🔗' : '🔓' }}</span>
            Follow tail
          </button>
          <button
            class="toolbar-btn"
            @click="scrollToBottom"
            data-testid="jump-to-bottom-btn"
          >
            Jump to bottom ⬇
          </button>
        </div>
      </div>

      <!-- Log lines container with windowed rendering -->
      <div
        ref="logLinesRef"
        class="log-lines"
      >
        <!-- Top spacer for windowing -->
        <div
          v-if="windowedLogs.length > 0"
          :style="{ height: `${((windowedLogs[0]?.actualIndex ?? 0) * 25)}px` }"
          class="log-spacer"
        ></div>

        <!-- Windowed log lines -->
        <div
          v-for="{ log, actualIndex } in windowedLogs"
          :key="actualIndex"
          class="log-line"
          :style="{ backgroundColor: getLevelBackground(log.level) }"
          :data-level="log.level"
          :data-index="actualIndex"
          :data-testid="`log-line-${actualIndex}`"
          @click="handleLogLineClick(log, actualIndex)"
        >
          <span class="log-time">{{ formatTime(log.ts) }}</span>
          <span
            class="log-level"
            :style="{ color: getLevelColor(log.level) }"
          >
            {{ log.level.toUpperCase() }}
          </span>
          <span class="log-message">{{ log.message }}</span>
        </div>

        <!-- Bottom spacer for windowing -->
        <div
          :style="{ height: `${(logs.length - (windowedLogs[windowedLogs.length - 1]?.actualIndex ?? 0) - 1) * 25}px` }"
          class="log-spacer"
        ></div>

        <!-- Loading more indicator -->
        <div v-if="loading" class="log-viewer-loading-more">
          <div class="spinner spinner--small"></div>
          <span>Loading more...</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.log-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: var(--bg-0);
  border-radius: var(--r-sm);
  overflow: hidden;
}

.log-viewer-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-2);
  padding: var(--s-4);
  color: var(--text-2);
}

.spinner {
  width: 20px;
  height: 20px;
  border: 2px solid var(--border-0);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

.spinner--small {
  width: 16px;
  height: 16px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.log-viewer-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
}

.log-viewer-empty-icon {
  font-size: 48px;
  margin-bottom: var(--s-2);
  opacity: 0.5;
}

.log-viewer-empty-title {
  font-size: var(--text-md);
  color: var(--text-2);
}

.log-viewer-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--s-2) var(--s-3);
  border-bottom: 1px solid var(--border-0);
  background-color: var(--bg-1);
}

.log-viewer-info {
  font-size: var(--text-sm);
  color: var(--text-2);
}

.log-viewer-more {
  color: var(--accent);
}

.log-viewer-actions {
  display: flex;
  align-items: center;
  gap: var(--s-2);
}

.toolbar-btn {
  padding: 4px var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background-color: var(--bg-2);
  color: var(--text-1);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease;
}

.toolbar-btn:hover:not(:disabled) {
  background-color: var(--accent);
  color: white;
}

.toolbar-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.follow-toggle {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: 4px var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease, color 150ms ease, border-color 150ms ease;
}

.follow-toggle:hover {
  background-color: var(--bg-2);
  color: var(--text-1);
}

.follow-toggle--active {
  background-color: var(--accent);
  border-color: var(--accent);
  color: white;
}

.follow-toggle-icon {
  font-size: 14px;
}

.log-lines {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--s-2);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.6;
}

.log-spacer {
  pointer-events: none;
}

.log-line {
  display: grid;
  grid-template-columns: 90px 50px 1fr;
  gap: var(--s-1);
  padding: 2px var(--s-1);
  border-radius: 4px;
  min-height: 25px;
  cursor: pointer;
  transition: background-color 150ms ease;
}

.log-line:hover {
  background-color: var(--bg-2);
}

.log-time {
  color: var(--text-2);
  user-select: none;
}

.log-level {
  font-weight: 600;
  user-select: none;
}

.log-message {
  color: var(--text-0);
  word-break: break-all;
}

.log-viewer-loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--s-1);
  padding: var(--s-2);
  color: var(--text-2);
  font-size: var(--text-sm);
}
</style>
