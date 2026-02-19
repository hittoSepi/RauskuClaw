<script setup lang="ts">
import { useUiStore } from '../stores/ui.store'
import Sidebar from './Sidebar.vue'
import Topbar from './Topbar.vue'
import InspectorDrawer from './InspectorDrawer.vue'

const uiStore = useUiStore()
</script>

<template>
  <div class="app-shell">
    <header class="app-topbar">
      <Topbar />
    </header>

    <div
      class="app-body"
      :class="{
        'inspector-closed': !uiStore.inspectorOpen,
        'sidebar-collapsed': uiStore.sidebarCollapsed,
      }"
    >
      <aside class="app-sidebar">
        <Sidebar />
      </aside>

      <main class="app-main">
        <RouterView v-slot="{ Component }">
          <component :is="Component" />
        </RouterView>
      </main>

      <aside class="app-inspector" :class="{ 'app-inspector--closed': !uiStore.inspectorOpen }">
        <InspectorDrawer />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
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
  grid-template-columns: 312px 1fr 360px;
  flex: 1;
  min-height: 0;
}

.app-body.inspector-closed {
  grid-template-columns: 312px 1fr 0px;
}

.app-body.sidebar-collapsed {
  grid-template-columns: 0px 1fr 360px;
}

.app-body.sidebar-collapsed.inspector-closed {
  grid-template-columns: 0px 1fr 0px;
}

.app-sidebar {
  border-right: 1px solid var(--border-0);
  background: var(--bg-1);
  overflow: hidden;
}

.app-main {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: var(--bg-0);
}

.app-inspector {
  border-left: 1px solid var(--border-0);
  background: var(--bg-1);
  overflow: hidden;
}

@media (max-width: 1280px) {
  .app-body {
    grid-template-columns: 312px 1fr;
  }

  .app-inspector {
    position: fixed;
    right: 0;
    top: var(--topbar-h);
    height: calc(100vh - var(--topbar-h));
    width: 360px;
    z-index: 90;
    box-shadow: var(--shadow-1);
    transform: translateX(0);
    transition: transform 200ms ease;
  }

  .app-inspector--closed {
    transform: translateX(100%);
  }
}
</style>