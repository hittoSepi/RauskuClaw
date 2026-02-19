<script setup lang="ts">
// Workdir page - M5 placeholder
</script>

<template>
  <div class="workdir-page">
    <header class="page-header">
      <h1 class="page-title">Working Directory</h1>
    </header>
    <div class="empty-state">
      <div class="empty-state-icon">📁</div>
      <div class="empty-state-title">No working directory</div>
      <div class="empty-state-text">Browse project files here.</div>
    </div>
  </div>
</template>

<style scoped>
.workdir-page { padding: var(--s-3); height: 100%; overflow: auto; }
.page-header { margin-bottom: var(--s-3); }
.page-title { font-size: var(--text-xl); font-weight: 600; color: var(--text-0); margin: 0; }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 50%; text-align: center; }
.empty-state-icon { font-size: 64px; margin-bottom: var(--s-2); opacity: 0.5; }
.empty-state-title { font-size: var(--text-lg); font-weight: 500; color: var(--text-1); margin-bottom: var(--s-1); }
.empty-state-text { font-size: var(--text-sm); color: var(--text-2); }
</style>