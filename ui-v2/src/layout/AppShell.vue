<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '../stores/ui.store'
import Sidebar from './Sidebar.vue'
import Topbar from './Topbar.vue'
import InspectorDrawer from './InspectorDrawer.vue'

const uiStore = useUiStore()

const sidebarWidth = computed(() => uiStore.sidebarCollapsed ? '0px' : 'var(--sidebar-w)')
const inspectorWidth = computed(() => uiStore.inspectorOpen ? 'var(--inspector-w)' : 'var(--inspector-w-collapsed)')

// Responsive: on narrow screens, inspector becomes overlay
const isNarrow = computed(() => {
  if (typeof window === 'undefined') return false
  return window.innerWidth < 1280
})

const handleResize = () => {
  // Force re-computation on resize
}

onMounted(() => {
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})
</script>

<template>
  <div class="app-shell">
    <!-- Topbar -->
    <header class="app-topbar">
      <Topbar />
    </header>
    
    <!-- Main layout grid -->
    <div class="app-body">
      <!-- Sidebar -->
      <aside 
        class="app-sidebar" 
        :class="{ 'app-sidebar--collapsed': uiStore.sidebarCollapsed }"
      >
        <Sidebar />
      </aside>
      
      <!-- Main content -->
      <main class="app-main">
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>
      
      <!-- Inspector -->
      <aside 
        class="app-inspector" 
        :class="{ 
          'app-inspector--closed': !uiStore.inspectorOpen,
          'app-inspector--overlay': isNarrow && uiStore.inspectorOpen 
        }"
      >
        <InspectorDrawer />
      </aside>
      
      <!-- Inspector overlay backdrop (narrow screens) -->
      <div 
        v-if="isNarrow && uiStore.inspectorOpen" 
        class="app-inspector-backdrop"
        @click="uiStore.setInspectorOpen(false)"
      />
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  background-color: var(--bg-0);
}

.app-topbar {
  height: var(--topbar-h);
  border-bottom: 1px solid var(--border-0);
  background-color: var(--bg-1);
  position: sticky;
  top: 0;
  z-index: 100;
}

.app-body {
  display: grid;
  grid-template-columns: v-bind(sidebarWidth) '1fr' v-bind(inspectorWidth);
  flex: 1;
  min-height: 0;
  position: relative;
}

.app-sidebar {
  width: var(--sidebar-w);
  border-right: 1px solid var(--border-0);
  background-color: var(--bg-1);
  overflow: hidden;
  transition: width 200ms ease, opacity 200ms ease;
}

.app-sidebar--collapsed {
  width: 0;
  opacity: 0;
}

.app-main {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background-color: var(--bg-0);
}

.app-inspector {
  width: var(--inspector-w);
  border-left: 1px solid var(--border-0);
  background-color: var(--bg-1);
  overflow: hidden;
  transition: width 200ms ease, opacity 200ms ease;
}

.app-inspector--closed {
  width: 0;
  opacity: 0;
  border-left: none;
}

.app-inspector--overlay {
  position: fixed;
  right: 0;
  top: var(--topbar-h);
  height: calc(100vh - var(--topbar-h));
  z-index: 90;
  box-shadow: var(--shadow-1);
}

.app-inspector-backdrop {
  position: fixed;
  inset: 0;
  top: var(--topbar-h);
  background-color: rgba(0, 0, 0, 0.5);
  z-index: 80;
}

@media (max-width: 1280px) {
  .app-body {
    grid-template-columns: v-bind(sidebarWidth) '1fr';
  }
  
  .app-inspector:not(.app-inspector--closed) {
    position: fixed;
  }
}
</style>