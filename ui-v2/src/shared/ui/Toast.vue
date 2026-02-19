<script setup lang="ts">
import { useUiStore } from '../../stores/ui.store'

const uiStore = useUiStore()

function getTypeClass(type: string) {
  switch (type) {
    case 'success': return 'toast--success'
    case 'error': return 'toast--error'
    case 'warning': return 'toast--warning'
    default: return 'toast--info'
  }
}

function getIcon(type: string) {
  switch (type) {
    case 'success': return '✓'
    case 'error': return '✕'
    case 'warning': return '⚠'
    default: return 'ℹ'
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div 
          v-for="toast in uiStore.toasts" 
          :key="toast.id"
          class="toast"
          :class="getTypeClass(toast.type)"
        >
          <span class="toast-icon">{{ getIcon(toast.type) }}</span>
          <span class="toast-message">{{ toast.message }}</span>
          <button class="toast-close" @click="uiStore.removeToast(toast.id)">✕</button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-container {
  position: fixed;
  bottom: var(--s-3);
  right: var(--s-3);
  display: flex;
  flex-direction: column;
  gap: var(--s-1);
  z-index: 1000;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--s-1);
  padding: var(--s-2) var(--s-3);
  border-radius: var(--r-sm);
  background-color: var(--bg-2);
  border: 1px solid var(--border-0);
  color: var(--text-0);
  font-size: var(--text-sm);
  box-shadow: var(--shadow-1);
  min-width: 280px;
  max-width: 400px;
}

.toast--success {
  border-color: rgba(56, 217, 150, 0.4);
  background-color: rgba(56, 217, 150, 0.1);
}

.toast--error {
  border-color: rgba(255, 77, 109, 0.4);
  background-color: rgba(255, 77, 109, 0.1);
}

.toast--warning {
  border-color: rgba(255, 176, 32, 0.4);
  background-color: rgba(255, 176, 32, 0.1);
}

.toast--info {
  border-color: rgba(91, 124, 255, 0.4);
  background-color: rgba(91, 124, 255, 0.1);
}

.toast-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}

.toast--success .toast-icon { color: var(--success); }
.toast--error .toast-icon { color: var(--danger); }
.toast--warning .toast-icon { color: var(--warn); }
.toast--info .toast-icon { color: var(--accent); }

.toast-message {
  flex: 1;
}

.toast-close {
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
  cursor: pointer;
}

.toast-close:hover {
  color: var(--text-0);
  background-color: rgba(255, 255, 255, 0.1);
}

/* Transitions */
.toast-enter-active,
.toast-leave-active {
  transition: all 200ms ease;
}

.toast-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.toast-leave-to {
  opacity: 0;
  transform: translateX(100%);
}
</style>