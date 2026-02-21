<script setup lang="ts">
/**
 * ChatTimeline Component
 *
 * Displays a chronological list of chat messages.
 * Supports user, assistant, and system messages with different styling.
 */

import { ref, watch, nextTick, computed } from 'vue'
import type { ChatMessage } from '../store/chat.store'

interface Props {
  messages: ChatMessage[]
}

const props = defineProps<Props>()

// Auto-scroll logic
const timelineRef = ref<HTMLElement>()
const shouldAutoScroll = ref(true)

function handleScroll() {
  if (!timelineRef.value) return
  const { scrollTop, scrollHeight, clientHeight } = timelineRef.value
  const distanceToBottom = scrollHeight - scrollTop - clientHeight
  shouldAutoScroll.value = distanceToBottom < 100
}

let rafId: number | null = null
function scheduleAutoScroll() {
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    if (shouldAutoScroll.value && timelineRef.value) {
      timelineRef.value.scrollTop = timelineRef.value.scrollHeight
    }
    rafId = null
  })
}

// Watch only message count and last message content (avoid expensive deep watch)
const lastMessage = computed(() => props.messages[props.messages.length - 1])
const lastContentLength = computed(() => lastMessage.value?.content.length ?? 0)

watch([() => props.messages.length, lastContentLength], async () => {
  await nextTick()
  scheduleAutoScroll()
})
</script>

<template>
  <div
    ref="timelineRef"
    class="chat-timeline"
    data-testid="chat-timeline"
    @scroll="handleScroll"
  >
    <!-- Empty state -->
    <div v-if="messages.length === 0" class="empty-state">
      <div class="empty-state-icon">💬</div>
      <div class="empty-state-title">Start a conversation</div>
      <div class="empty-state-text">
        Send a message to begin chatting with the AI agent.
      </div>
    </div>

    <!-- Messages -->
    <div
      v-for="msg in messages"
      :key="`${msg.id}-${msg.status || 'none'}`"
      class="chat-message"
      :data-testid="
        msg.role === 'user'
          ? 'chat-msg-user'
          : msg.role === 'assistant'
            ? 'chat-msg-assistant'
            : 'chat-msg-system'
      "
      :class="`chat-message--${msg.role}`"
    >
      <!-- User message -->
      <template v-if="msg.role === 'user'">
        <div class="message-bubble message-bubble--user">
          <div class="message-role">You</div>
          <div class="message-content">{{ msg.content }}</div>
        </div>
      </template>

      <!-- Assistant message -->
      <template v-else-if="msg.role === 'assistant'">
        <div class="message-bubble message-bubble--assistant">
          <div class="message-role">Agent</div>

          <!-- Pending state -->
          <div
            v-if="msg.status === 'pending'"
            class="message-pending"
            data-testid="chat-assistant-pending"
          >
            <span class="pending-dots"></span>
          </div>

          <!-- Streaming state -->
          <div
            v-else-if="msg.status === 'streaming'"
            class="message-streaming"
            data-testid="chat-assistant-streaming"
          >
            <div class="streaming-content">{{ msg.content }}</div>
            <span class="streaming-caret">▍</span>
          </div>

          <!-- Error state -->
          <div v-else-if="msg.status === 'error'" class="message-error">
            <div class="error-text">{{ msg.content }}</div>
            <div v-if="msg.error" class="error-details">{{ msg.error }}</div>
          </div>

          <!-- Success state -->
          <div v-else class="message-content">{{ msg.content }}</div>
        </div>
      </template>

      <!-- System message -->
      <template v-else-if="msg.role === 'system'">
        <div class="message-bubble message-bubble--system">
          <div class="message-content">{{ msg.content }}</div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.chat-timeline {
  display: flex;
  flex-direction: column;
  gap: var(--s-2);
  padding: var(--s-3);
  overflow-y: auto;
  min-height: 0;
  flex: 1;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: var(--s-4);
}

.empty-state-icon {
  font-size: 48px;
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

.chat-message {
  display: flex;
  width: 100%;
}

.chat-message--user {
  justify-content: flex-end;
}

.chat-message--assistant {
  justify-content: flex-start;
}

.chat-message--system {
  justify-content: center;
}

.message-bubble {
  max-width: 80%;
  padding: var(--s-2);
  border-radius: var(--r-md);
}

.message-bubble--user {
  background-color: rgba(91, 124, 255, 0.12);
  border: 1px solid rgba(91, 124, 255, 0.2);
}

.message-bubble--assistant {
  background-color: var(--bg-1);
  border: 1px solid var(--border-0);
  min-width: 120px;
}

.message-bubble--system {
  background-color: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-0);
}

.message-role {
  font-size: var(--text-sm);
  font-weight: 500;
  color: var(--text-2);
  margin-bottom: 4px;
}

.message-content {
  font-size: var(--text-md);
  color: var(--text-0);
  white-space: pre-wrap;
  word-break: break-word;
}

.message-bubble--user .message-content {
  color: var(--text-0);
}

.message-pending {
  display: flex;
  align-items: center;
  height: 24px;
}

.pending-dots {
  display: inline-flex;
  gap: 4px;
}

.pending-dots::before,
.pending-dots::after {
  content: '';
  width: 8px;
  height: 8px;
  background-color: var(--text-2);
  border-radius: 50%;
  animation: pulse 1.4s ease-in-out infinite;
}

.pending-dots::before {
  animation-delay: 0s;
}

.pending-dots::after {
  animation-delay: 0.2s;
}

@keyframes pulse {
  0%, 80%, 100% {
    opacity: 0.3;
    transform: scale(0.8);
  }
  40% {
    opacity: 1;
    transform: scale(1);
  }
}

.message-streaming {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.streaming-content {
  flex: 1;
  font-size: var(--text-md);
  color: var(--text-0);
  white-space: pre-wrap;
  word-break: break-word;
}

.streaming-caret {
  display: inline-block;
  width: 8px;
  height: 18px;
  color: var(--text-0); /* Use reliable token, not --accent */
  animation: blink 1s step-end infinite;
  flex-shrink: 0;
}

@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.message-error {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.error-text {
  font-size: var(--text-md);
  color: var(--danger);
}

.error-details {
  font-size: var(--text-sm);
  color: var(--text-2);
}
</style>
