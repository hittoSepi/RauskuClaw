<script setup lang="ts">
/**
 * ChatComposer Component
 *
 * Message input area with textarea and send button.
 * Emits send event when user submits a message.
 */

import { ref, computed, nextTick } from 'vue'

interface Props {
  disabled?: boolean
  placeholder?: string
}

interface Emits {
  (e: 'send', text: string): void
}

const props = withDefaults(defineProps<Props>(), {
  disabled: false,
  placeholder: 'Type your message...',
})

const emit = defineEmits<Emits>()

const message = ref('')
const textareaRef = ref<HTMLTextAreaElement>()

const canSend = computed(() => message.value.trim().length > 0 && !props.disabled)

async function send() {
  if (!canSend.value) return

  const text = message.value.trim()
  message.value = ''

  // Reset textarea height
  if (textareaRef.value) {
    textareaRef.value.style.height = 'auto'
  }

  emit('send', text)

  // Re-focus textarea after send
  await nextTick()
  textareaRef.value?.focus()
}

function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}

function autoResize(e: Event) {
  const target = e.target as HTMLTextAreaElement
  target.style.height = 'auto'
  target.style.height = Math.min(target.scrollHeight, 120) + 'px'
}
</script>

<template>
  <div class="chat-composer">
    <textarea
      ref="textareaRef"
      v-model="message"
      class="chat-input"
      data-testid="chat-input"
      :placeholder="placeholder"
      :disabled="disabled"
      rows="1"
      @keydown="handleKeydown"
      @input="autoResize"
    />
    <button
      class="chat-send"
      data-testid="chat-send"
      :disabled="!canSend"
      :class="{ 'chat-send--disabled': !canSend }"
      @click="send"
    >
      Send
    </button>
  </div>
</template>

<style scoped>
.chat-composer {
  display: flex;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  border-top: 1px solid var(--border-0);
  background-color: var(--bg-0);
}

.chat-input {
  flex: 1;
  min-height: 40px;
  max-height: 120px;
  padding: var(--s-2);
  border: 1px solid var(--border-0);
  border-radius: var(--r-sm);
  background-color: var(--bg-1);
  color: var(--text-0);
  font-family: var(--font-sans);
  font-size: var(--text-md);
  line-height: 1.5;
  resize: none;
  overflow-y: auto;
  transition: border-color 150ms ease;
}

.chat-input:focus {
  outline: none;
  border-color: var(--accent);
}

.chat-input::placeholder {
  color: var(--text-2);
}

.chat-input:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.chat-send {
  padding: 0 var(--s-3);
  min-width: 70px;
  height: 40px;
  border: none;
  border-radius: var(--r-sm);
  background-color: var(--accent);
  color: white;
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: background-color 150ms ease, opacity 150ms ease;
  align-self: flex-end;
}

.chat-send:hover:not(:disabled) {
  background-color: #4a6ae0;
}

.chat-send--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.chat-send:disabled {
  cursor: not-allowed;
}
</style>
