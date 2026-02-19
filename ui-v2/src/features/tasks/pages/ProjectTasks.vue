<script setup lang="ts">
// Tasks page - M3 placeholder
</script>

<template>
  <div class="tasks-page">
    <header class="page-header">
      <h1 class="page-title">Tasks</h1>
      <button class="btn">+ New Task</button>
    </header>
    <div class="empty-state">
      <div class="empty-state-icon">✅</div>
      <div class="empty-state-title">No tasks yet</div>
      <div class="empty-state-text">Create tasks to track your project progress.</div>
    </div>
  </div>
</template>

<style scoped>
.tasks-page { padding: var(--s-3); height: 100%; overflow: auto; }
.page-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--s-3); }
.page-title { font-size: var(--text-xl); font-weight: 600; color: var(--text-0); margin: 0; }
.btn { padding: var(--s-2) var(--s-3); border: 1px solid var(--border-0); border-radius: var(--r-sm); background: transparent; color: var(--text-1); cursor: pointer; }
.btn:hover { background-color: var(--bg-2); }
.empty-state { display: flex; flex-direction: column; align-items: center; justify-content: center; height: 50%; text-align: center; }
.empty-state-icon { font-size: 64px; margin-bottom: var(--s-2); opacity: 0.5; }
.empty-state-title { font-size: var(--text-lg); font-weight: 500; color: var(--text-1); margin-bottom: var(--s-1); }
.empty-state-text { font-size: var(--text-sm); color: var(--text-2); }
</style>