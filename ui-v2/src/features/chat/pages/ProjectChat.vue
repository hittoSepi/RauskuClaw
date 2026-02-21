<script setup lang="ts">
/**
 * ProjectChat Page
 *
 * Project-scoped chat interface with timeline and composer.
 * Uses the chat store for state management and persistence.
 */

import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useChatStore } from '../store/chat.store'
import ChatTimeline from '../components/ChatTimeline.vue'
import ChatComposer from '../components/ChatComposer.vue'

const route = useRoute()
const chatStore = useChatStore()

const projectId = computed(() => {
  return (route.params.projectId as string) || 'yleischat'
})

const messages = computed(() => chatStore.messages(projectId.value))
const hasPending = computed(() => chatStore.hasPendingMessage(projectId.value))
const isLoading = computed(() => chatStore.loading)

function handleSend(text: string) {
  chatStore.sendUserMessage(projectId.value, text)
}

onMounted(() => {
  // Ensure project state exists
  chatStore.ensureProject(projectId.value)
})
</script>

<template>
  <div class="project-chat-page" data-testid="project-chat-page">
    <!-- Header -->
    <header class="chat-header">
      <h1 class="chat-title">Chat</h1>
      <span class="chat-project">{{ projectId }}</span>
    </header>

    <!-- Timeline -->
    <ChatTimeline class="chat-timeline-wrapper" :messages="messages" />

    <!-- Composer -->
    <ChatComposer
      class="chat-composer-wrapper"
      :disabled="hasPending || isLoading"
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
</style>
