<script setup lang="ts">
/**
 * ProjectChat Page
 *
 * Project-scoped chat interface with timeline and composer.
 * Uses the chat store for state management and persistence.
 */

import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../store/chat.store'
import ChatTimeline from '../components/ChatTimeline.vue'
import ChatComposer from '../components/ChatComposer.vue'
import { apiClient, isApiError } from '@/shared/api'
import { useAuthStore } from '@/stores/auth.store'

const route = useRoute()
const chatStore = useChatStore()
const authStore = useAuthStore()

type ChatJobType = 'codex.chat.generate' | 'ai.chat.generate'

interface JobTypeRow {
  name?: string
  enabled?: boolean
}

interface RuntimeProvidersPayload {
  providers?: {
    openai?: { enabled?: boolean }
    codex?: { enabled?: boolean }
  }
}

const projectId = computed(() => {
  return (route.params.projectId as string) || 'yleischat'
})

const messages = computed(() => chatStore.messages(projectId.value))
const hasPending = computed(() => chatStore.hasPendingMessage(projectId.value))
const isLoading = computed(() => chatStore.loading)
const sendBlockedReason = ref('')
const sendHint = ref('')
const preferredJobType = ref<ChatJobType | null>(null)

const composerDisabled = computed(() => {
  return hasPending.value || isLoading.value || Boolean(sendBlockedReason.value)
})

const composerPlaceholder = computed(() => {
  return sendBlockedReason.value || 'Type your message...'
})

function evaluateAuthPolicyBlock(): string {
  const role = String(authStore.userInfo?.role || '').toLowerCase()
  if (role === 'read') {
    return 'Read-only API key: chat job creation is disabled.'
  }

  const allowlist = authStore.userInfo?.queue_allowlist
  if (Array.isArray(allowlist) && allowlist.length > 0 && !allowlist.includes('default')) {
    return `API key queue policy blocks chat queue 'default' (allowed: ${allowlist.join(', ')}).`
  }

  return ''
}

function resolveChatPolicy(
  jobTypesResponse: { types?: unknown[] },
  runtimeResponse: RuntimeProvidersPayload
): { blockedReason: string; hint: string; jobType: ChatJobType | null } {
  const types = Array.isArray(jobTypesResponse?.types)
    ? (jobTypesResponse.types as JobTypeRow[])
    : []

  const enabledTypeNames = new Set(
    types
      .filter((t) => t?.enabled === true)
      .map((t) => String(t?.name || '').trim())
      .filter(Boolean)
  )

  const hasAiType = enabledTypeNames.has('ai.chat.generate')
  const hasCodexType = enabledTypeNames.has('codex.chat.generate')

  if (!hasAiType && !hasCodexType) {
    return {
      blockedReason: 'No enabled chat job type. Enable codex.chat.generate or ai.chat.generate in Settings > Job Types.',
      hint: '',
      jobType: null,
    }
  }

  const openaiRuntimeEnabled = runtimeResponse.providers?.openai?.enabled
  const codexRuntimeEnabled = runtimeResponse.providers?.codex?.enabled
  const aiAvailable = hasAiType && openaiRuntimeEnabled !== false
  const codexAvailable = hasCodexType && codexRuntimeEnabled !== false

  if (aiAvailable) {
    return { blockedReason: '', hint: '', jobType: 'ai.chat.generate' }
  }

  if (codexAvailable) {
    const hint = hasAiType && openaiRuntimeEnabled === false
      ? 'OpenAI runtime disabled. Using Codex provider.'
      : ''
    return { blockedReason: '', hint, jobType: 'codex.chat.generate' }
  }

  if (hasAiType && openaiRuntimeEnabled === false && hasCodexType && codexRuntimeEnabled === false) {
    return {
      blockedReason: 'Both OpenAI and Codex provider runtimes are disabled.',
      hint: '',
      jobType: null,
    }
  }

  if (hasAiType && openaiRuntimeEnabled === false) {
    return {
      blockedReason: 'ai.chat.generate is enabled, but OpenAI provider runtime is disabled.',
      hint: '',
      jobType: null,
    }
  }

  if (hasCodexType && codexRuntimeEnabled === false) {
    return {
      blockedReason: 'codex.chat.generate is enabled, but Codex provider runtime is disabled.',
      hint: '',
      jobType: null,
    }
  }

  return { blockedReason: '', hint: '', jobType: null }
}

async function refreshSendPolicy() {
  const authBlocked = evaluateAuthPolicyBlock()
  if (authBlocked) {
    sendBlockedReason.value = authBlocked
    sendHint.value = ''
    preferredJobType.value = null
    return
  }

  try {
    const [jobTypes, runtime] = await Promise.all([
      apiClient.jobTypes(),
      apiClient.runtimeProviders(),
    ])

    const resolved = resolveChatPolicy(
      { types: Array.isArray((jobTypes as { types?: unknown[] })?.types) ? (jobTypes as { types?: unknown[] }).types : [] },
      runtime as RuntimeProvidersPayload
    )

    sendBlockedReason.value = resolved.blockedReason
    sendHint.value = resolved.hint
    preferredJobType.value = resolved.jobType
  } catch (err) {
    // Fail open here: don't block send if diagnostics endpoints are unavailable.
    sendBlockedReason.value = ''
    sendHint.value = ''
    preferredJobType.value = null
    if (isApiError(err)) {
      console.warn('[project-chat] chat preflight unavailable:', err.code, err.message)
    } else {
      console.warn('[project-chat] chat preflight unavailable')
    }
  }
}

function handleSend(text: string) {
  if (sendBlockedReason.value) return
  chatStore.sendUserMessage(projectId.value, text, {
    jobType: preferredJobType.value ?? undefined,
  })
}

async function initializeProjectChat(pid: string) {
  // Ensure project state exists
  chatStore.ensureProject(pid)
  await chatStore.recoverPendingMessages(pid)
}

onMounted(() => {
  void initializeProjectChat(projectId.value)
  void refreshSendPolicy()
})

watch(
  () => projectId.value,
  (nextProjectId) => {
    void initializeProjectChat(nextProjectId)
    void refreshSendPolicy()
  }
)

watch(
  () => [
    authStore.authStatus,
    authStore.userInfo?.role || '',
    JSON.stringify(authStore.userInfo?.queue_allowlist || []),
  ],
  () => {
    void refreshSendPolicy()
  }
)
</script>

<template>
  <div class="project-chat-page" data-testid="project-chat-page">
    <!-- Header -->
    <header class="chat-header">
      <h1 class="chat-title">Chat</h1>
      <span class="chat-project">{{ projectId }}</span>
    </header>

    <p
      v-if="sendBlockedReason"
      class="chat-status chat-status--error"
      data-testid="chat-send-blocked"
    >
      {{ sendBlockedReason }}
    </p>
    <p v-else-if="sendHint" class="chat-status chat-status--info">
      {{ sendHint }}
    </p>

    <!-- Timeline -->
    <ChatTimeline class="chat-timeline-wrapper" :messages="messages" />

    <!-- Composer -->
    <ChatComposer
      class="chat-composer-wrapper"
      :disabled="composerDisabled"
      :placeholder="composerPlaceholder"
      @send="handleSend"
    />
  </div>
</template>

<style scoped>
.project-chat-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.chat-header {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border-bottom: 1px solid var(--border-0);
  background-color: var(--bg-0);
}

.chat-title {
  font-size: var(--text-lg);
  font-weight: 500;
  color: var(--text-0);
  margin: 0;
}

.chat-project {
  font-size: var(--text-sm);
  color: var(--text-2);
  padding: 2px 8px;
  background: var(--bg-2);
  border-radius: 999px;
}

.chat-timeline-wrapper {
  flex: 1;
  min-height: 0;
}

.chat-composer-wrapper {
  flex-shrink: 0;
}

.chat-status {
  margin: 0;
  padding: var(--s-2) var(--s-3);
  font-size: var(--text-sm);
  border-bottom: 1px solid var(--border-0);
}

.chat-status--error {
  color: var(--danger);
  background: rgba(255, 77, 109, 0.08);
}

.chat-status--info {
  color: var(--warn);
  background: rgba(255, 176, 32, 0.08);
}
</style>
