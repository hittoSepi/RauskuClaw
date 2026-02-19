<script setup lang="ts">
import AppShell from './layout/AppShell.vue'
import Toast from './shared/ui/Toast.vue'
import ApiKeyGate from './components/ApiKeyGate.vue'
</script>

<template>
  <ApiKeyGate />
  <AppShell />
  <Toast />
</template>

<style>
/* Global app styles are in style.css */
</style>