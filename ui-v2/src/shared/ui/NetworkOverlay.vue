<script setup lang="ts">
/**
 * Network Offline Overlay
 *
 * Shows a centered modal when browser reports being offline.
 * Disappears automatically when connection returns.
 * Does not block user interaction (pointer-events: none on backdrop).
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
    <div class="network-overlay-backdrop"></div>
    <div class="network-overlay-card">
      <span class="network-overlay-badge" aria-hidden="true">
        <span class="network-overlay-warn">⚠</span>
        <span class="network-overlay-sat">📡</span>
      </span>

      <div class="network-overlay-content">
        <div class="network-overlay-title">Offline!</div>
        <div class="network-overlay-text">No network connection. Sending messages will fail.</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.network-overlay {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  justify-items: center;
  z-index: 9999;
  pointer-events: none;
}

.network-overlay-backdrop {
  position: absolute;
  inset: 0;
  background-color: rgba(11, 15, 20, 0.75);
  /* Using --bg-0 (#0B0F14) with 75% opacity */
}

.network-overlay-card {
  display: flex;
  align-items: center;
  gap: var(--s-3);
  background: var(--bg-2);
  color: var(--text-0);
  border: 1px solid var(--border-0);
  border-radius: var(--r-lg);
  padding: var(--s-3) var(--s-4);
  box-shadow: var(--shadow-1);
  max-width: min(480px, calc(100vw - 2 * var(--s-3)));
  pointer-events: auto;

  /* Danger accent bar on left */
  border-left: 4px solid var(--danger);
}

.network-overlay-badge {
  position: relative;
  width: 56px;
  height: 56px;
  display: grid;
  place-items: center;
  border-radius: var(--r-lg);
  background: var(--bg-1);
  border: 1px solid var(--border-0);
  box-shadow: var(--shadow-1);
  flex: 0 0 auto;
}

.network-overlay-warn {
  font-size: 44px;
  line-height: 1;
  color: var(--danger);
}

.network-overlay-sat {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  font-size: 18px;
  line-height: 1;
  transform: translateY(2px);
}

.network-overlay-content {
  flex: 1;
}

.network-overlay-title {
  font-weight: 800;
  font-size: 20px;
  color: var(--danger);
  margin-bottom: 2px;
}

.network-overlay-text {
  font-size: var(--text-md);
  color: var(--text-0);
}
</style>
