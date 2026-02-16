<template>
  <div class="container">
    <div class="row" style="margin-bottom: 14px">
      <div style="font-size: 18px; font-weight: 700">OpenClaw UI</div>
      <div class="spacer"></div>
      <router-link to="/jobs">Jobs</router-link>
      <router-link to="/jobs/new">Create Job</router-link>
      <router-link to="/types">Types</router-link>
      <div class="spacer"></div>
      <input class="input" style="min-width: 320px"
             v-model="key" placeholder="x-api-key (stored in session only)" />
      <button class="btn primary" @click="saveKey">Save</button>
    </div>

    <div class="card" style="margin-bottom: 14px">
      <div class="row">
        <div class="badge" :class="pingOk ? 'ok' : 'err'">
          API: {{ pingOk ? "ok" : "nope" }}
        </div>
        <div class="badge">Base: same origin</div>
        <div class="spacer"></div>
        <div style="color: var(--muted); font-size: 13px">
          This UI is intentionally boring. Boring survives production.
        </div>
      </div>
    </div>

    <router-view />
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api, setKey } from "./api.js";

const key = ref(sessionStorage.getItem("openclaw_api_key") || "");
const pingOk = ref(false);

function saveKey() {
  setKey(key.value);
  ping();
}

async function ping() {
  try {
    await api.ping();
    pingOk.value = true;
  } catch {
    pingOk.value = false;
  }
}

onMounted(ping);
</script>

<style scoped>
a { margin-left: 12px; }
</style>
