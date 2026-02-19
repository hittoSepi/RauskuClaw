<script setup lang="ts">
import { ref } from 'vue'
import { useRoute } from 'vue-router'

const route = useRoute()
const projectId = route.params.projectId as string

const message = ref('')
const messages = ref<Array<{ role: string; content: string }>>([])

function sendMessage() {
  if (!message.value.trim()) return
  messages.value.push({ role: 'user', content: message.value })
  message.value = ''
  // TODO: Integrate with API
}
</script>

<template>
  <div class="chat-page">
    <!-- Chat header -->
    <header class="chat-header">
      <h1 class="chat-title">Chat</h1>
      <span class="chat-project">{{ projectId }}</span>
    </header>

    <!-- Messages -->
    <div class="chat-messages">
      <div v-if="messages.length === 0" class="empty-state">
        <div class="empty-state-icon">💬</div>
        <div class="empty-state-title">Start a conversation</div>
        <div class="empty-state-text">Send a message to begin chatting with the AI agent.</div>
      </div>
      
      <div 
        v-for="(msg, i) in messages" 
        :key="i"
        class="message"
        :class="`message--${msg.role}`"
      >
        <div class="message-role">{{ msg.role === 'user' ? 'You' : 'Agent' }}</div>
        <div class="message-content">{{ msg.content }}</div>
      </div>
    </div>

    <!-- Input -->
    <div class="chat-input">
      <textarea 
        v-model="message"
        class="chat-textarea"
        placeholder="Type your message..."
        rows="3"
        @keydown.enter.exact.prevent="sendMessage"
      />
      <button class="chat-send-btn" @click="sendMessage">
        Send
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
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

.chat-messages {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: var(--s-3);
}

.message {
  margin-bottom: var(--s-2);
  padding: var(--s-2);
  border-radius: var(--r-md);
}

.message--user {
  background-color: rgba(91, 124, 255, 0.1);
  margin-left: 20%;
}

.message--assistant {
  background-color: var(--bg-1);
  margin-right: 20%;
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
}

.chat-input {
  display: flex;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border-top: 1px solid var(--border-0);
}

.chat-textarea {
  flex: 1;
  padding: var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background: var(--bg-1);
  color: var(--text-0);
  font-family: inherit;
  font-size: var(--text-md);
  resize: none;
}

.chat-textarea:focus {
  outline: none;
  border-color: var(--accent);
}

.chat-send-btn {
  padding: var(--s-2) var(--s-3);
  border: none;
  border-radius: var(--r-sm);
  background: var(--accent);
  color: white;
  font-size: var(--text-sm);
  cursor: pointer;
  transition: background-color 150ms ease;
}

.chat-send-btn:hover {
  background: #4a6ae0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
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