<script setup lang="ts">
import { useUiStore } from '../../../stores/ui.store'

const uiStore = useUiStore()
</script>

<template>
  <div class="settings-page">
    <header class="page-header">
      <h1 class="page-title">Settings</h1>
    </header>

    <div class="settings-content">
      <!-- Dev Mode -->
      <div class="settings-section">
        <h2 class="section-title">Developer</h2>
        <div class="settings-item">
          <div class="settings-item-info">
            <div class="settings-item-label">Dev Mode</div>
            <div class="settings-item-description">Enable advanced features and debugging tools</div>
          </div>
          <button 
            class="toggle-btn"
            :class="{ 'toggle-btn--active': uiStore.devMode }"
            @click="uiStore.toggleDevMode"
          >
            {{ uiStore.devMode ? 'ON' : 'OFF' }}
          </button>
        </div>
      </div>

      <!-- Inspector -->
      <div class="settings-section">
        <h2 class="section-title">Layout</h2>
        <div class="settings-item">
          <div class="settings-item-info">
            <div class="settings-item-label">Inspector</div>
            <div class="settings-item-description">Show/hide the right inspector panel</div>
          </div>
          <button 
            class="toggle-btn"
            :class="{ 'toggle-btn--active': uiStore.inspectorOpen }"
            @click="uiStore.toggleInspector"
          >
            {{ uiStore.inspectorOpen ? 'OPEN' : 'CLOSED' }}
          </button>
        </div>
      </div>

      <!-- About -->
      <div class="settings-section">
        <h2 class="section-title">About</h2>
        <div class="settings-item">
          <div class="settings-item-info">
            <div class="settings-item-label">RauskuClaw UI v2</div>
            <div class="settings-item-description">Project Dashboard + AI Agent Workspace</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page { padding: var(--s-3); height: 100%; overflow: auto; max-width: 600px; }
.page-header { margin-bottom: var(--s-3); }
.page-title { font-size: var(--text-xl); font-weight: 600; color: var(--text-0); margin: 0; }
.settings-content { display: flex; flex-direction: column; gap: var(--s-3); }
.settings-section { border: 1px solid var(--border-0); border-radius: var(--r-md); padding: var(--s-3); background: var(--bg-1); }
.section-title { font-size: var(--text-lg); font-weight: 500; color: var(--text-0); margin: 0 0 var(--s-2); }
.settings-item { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.settings-item-info { flex: 1; }
.settings-item-label { font-size: var(--text-md); color: var(--text-0); margin-bottom: 2px; }
.settings-item-description { font-size: var(--text-sm); color: var(--text-2); }
.toggle-btn { padding: var(--s-1) var(--s-2); border: 1px solid var(--border-0); border-radius: var(--r-sm); background: transparent; color: var(--text-1); font-size: var(--text-sm); cursor: pointer; min-width: 80px; }
.toggle-btn:hover { background-color: var(--bg-2); }
.toggle-btn--active { background-color: rgba(91, 124, 255, 0.15); border-color: var(--accent); color: var(--accent); }
</style>