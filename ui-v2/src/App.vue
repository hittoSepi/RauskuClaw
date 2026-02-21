<script setup lang="ts">
import { onMounted } from 'vue'
import AppShell from './layout/AppShell.vue'
import Toast from './shared/ui/Toast.vue'
import ApiKeyGate from './components/ApiKeyGate.vue'
import NetworkOverlay from './shared/ui/NetworkOverlay.vue'
import { useAuthStore } from './stores/auth.store'

const authStore = useAuthStore()

// Bootstrap auth on mount
onMounted(() => {
  authStore.bootstrap()
})
</script>

<template>
  <!-- Loading state during bootstrap -->
  <div v-if="authStore.isBootstrapping" class="bootstrap-loading">
    <div class="bootstrap-spinner"></div>
    <span class="bootstrap-text">Loading...</span>
  </div>

  <!-- Main app after bootstrap -->
  <template v-else>
    <NetworkOverlay />
    <ApiKeyGate />
    <AppShell />
    <Toast />
  </template>
</template>

<style scoped>
.bootstrap-loading {
  position: fixed;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  background-color: var(--bg-0, #0a0a0a);
  z-index: 10000;
}

.bootstrap-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-0, #333);
  border-top-color: var(--accent-0, #3b82f6);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.bootstrap-text {
  font-size: 0.875rem;
  color: var(--text-2, #888);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style>
/* Global app styles are in style.css */
</style>