<script setup lang="ts">
/**
 * Network Offline Overlay
 *
 * Shows a banner when browser reports being offline.
 * Disappears automatically when connection returns.
 */

import { computed } from 'vue'
import { useNetworkStatus } from '@/shared/network/useNetworkStatus'

const { isOnline } = useNetworkStatus()
const visible = computed(() => !isOnline.value)
</script>

<template>
  <div
    v-if="visible"
    class="network-overlay"
    data-testid="network-offline-overlay"
    role="status"
    aria-live="polite"
  >
    <div class="network-overlay-card">
      <div class="network-overlay-title">Offline</div>
      <div class="network-overlay-text">No network connection. Sending messages will fail.</div>
    </div>
  </div>
</template>

<style scoped>
.network-overlay {
  position: fixed;
  top: var(--s-3);
  left: 50%;
  transform: translateX(-50%);
  z-index: 9999;
  pointer-events: none;
}

.network-overlay-card {
  background: var(--bg-2);
  color: var(--text-0);
  border: 1px solid var(--border-0);
  border-radius: var(--r-lg);
  padding: var(--s-2) var(--s-3);
  box-shadow: var(--shadow-1);
  max-width: min(520px, calc(100vw - 2 * var(--s-3)));
}

.network-overlay-title {
  font-weight: 600;
  margin-bottom: 2px;
}

.network-overlay-text {
  color: var(--text-1);
  font-size: var(--text-sm);
}
</style>
