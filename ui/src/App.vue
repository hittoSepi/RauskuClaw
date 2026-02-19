<template>
  <div class="container app-shell">
    <div class="row app-topbar">
      <div class="app-brand">RauskuClaw</div>
      <div class="row app-nav">
        <router-link to="/chat">Chat</router-link>
        <router-link to="/settings">Settings</router-link>
      </div>
      <div class="spacer"></div>
      <input
        class="input app-key-input"
        v-model="key"
        placeholder="x-api-key (stored in session only)"
      />
      <button class="btn primary" @click="saveKey">Save</button>
    </div>

    <div class="card app-status">
      <div class="row">
        <div class="badge" :class="pingOk ? 'ok' : 'err'">
          API: {{ pingOk ? "ok" : "nope" }}
        </div>
        <div class="badge" :class="authOk ? 'ok' : ''">
          Auth: {{ authRoleLabel }}
        </div>
        <div class="badge" :title="authQueuesLabel">
          Queues: {{ authQueuesLabel }}
        </div>
        <div class="badge">Base: same origin</div>
        <div class="spacer"></div>
        <div style="color: var(--muted); font-size: 13px">
          This UI is intentionally boring. Boring survives production.
        </div>
      </div>
    </div>

    <div v-if="authRoleLabel === 'read'" class="card app-readonly-note">
      Read-only API key active. Mutating operations (create/update/delete/cancel) are blocked by server policy.
    </div>

    <div class="app-content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { computed, ref, onMounted } from "vue";
import { api, setKey } from "./api.js";
import { refreshAuthState, useAuthState } from "./auth_state.js";

const key = ref(sessionStorage.getItem("rauskuclaw_api_key") || "");
const pingOk = ref(false);
const { authInfo } = useAuthState();

function saveKey() {
  setKey(key.value);
  void refreshRuntimeStatus();
}

async function ping() {
  try {
    await api.ping();
    pingOk.value = true;
  } catch {
    pingOk.value = false;
  }
}

const authRoleLabel = computed(() => String(authInfo.value?.role || "unknown"));
const authOk = computed(() => authInfo.value && typeof authInfo.value === "object");
const authQueuesLabel = computed(() => {
  const list = Array.isArray(authInfo.value?.queue_allowlist) ? authInfo.value.queue_allowlist : null;
  if (!list || list.length < 1) return "all";
  return list.join(",");
});

async function refreshRuntimeStatus() {
  await Promise.allSettled([ping(), refreshAuthState()]);
}

onMounted(refreshRuntimeStatus);
</script>

<style scoped>
.app-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.app-topbar {
  margin-bottom: 14px;
  gap: 14px;
}

.app-brand {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.2px;
}

.app-nav {
  gap: 12px;
}

.app-key-input {
  min-width: 320px;
}

.app-status {
  margin-bottom: 14px;
}

.app-readonly-note {
  margin-bottom: 14px;
  border-color: rgba(250, 204, 116, 0.5);
  background: rgba(250, 204, 116, 0.08);
  color: #fcd68a;
  font-size: 13px;
}

.app-content {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

@media (max-width: 980px) {
  .app-key-input {
    min-width: 210px;
    flex: 1;
  }
}
</style>
