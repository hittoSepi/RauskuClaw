<script setup lang="ts">
import { useRouter } from 'vue-router'

const router = useRouter()

function goHome() {
  router.push('/')
}
</script>

<template>
  <div class="not-found-page">
    <div class="not-found-content">
      <div class="not-found-code">404</div>
      <div class="not-found-title">Page Not Found</div>
      <div class="not-found-text">The page you're looking for doesn't exist.</div>
      <button class="home-btn" @click="goHome">Go Home</button>
    </div>
  </div>
</template>

<style scoped>
.not-found-page { display: flex; align-items: center; justify-content: center; height: 100%; padding: var(--s-3); }
.not-found-content { text-align: center; }
.not-found-code { font-size: 120px; font-weight: 700; color: var(--accent); line-height: 1; margin-bottom: var(--s-2); }
.not-found-title { font-size: var(--text-xl); font-weight: 500; color: var(--text-0); margin-bottom: var(--s-1); }
.not-found-text { font-size: var(--text-md); color: var(--text-2); margin-bottom: var(--s-3); }
.home-btn { padding: var(--s-2) var(--s-3); border: 1px solid var(--accent); border-radius: var(--r-sm); background: transparent; color: var(--accent); font-size: var(--text-sm); cursor: pointer; }
.home-btn:hover { background-color: rgba(91, 124, 255, 0.15); }
</style>