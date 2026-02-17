<template>
  <div class="card settings-shell">
    <div class="row settings-head">
      <div class="settings-title">Settings</div>
      <div class="spacer"></div>
      <div class="settings-subtitle">Operations, runs, and types in one place.</div>
    </div>

    <div class="row settings-nav">
      <router-link to="/settings/jobs" class="settings-nav-link">Jobs</router-link>
      <router-link to="/settings/jobs/new" class="settings-nav-link">Create Job</router-link>
      <router-link to="/settings/schedules" class="settings-nav-link">Schedules</router-link>
      <router-link to="/settings/types" class="settings-nav-link">Types</router-link>
      <router-link to="/settings/memory" class="settings-nav-link">Memory</router-link>
    </div>

    <div class="settings-flags">
      <label class="settings-flag">
        <input type="checkbox" v-model="devMode" />
        <span>Dev mode (show debug notices + advanced chat controls)</span>
      </label>
      <label class="settings-flag">
        <input type="checkbox" v-model="chatMemoryDefaultEnabled" />
        <span>Chat memory enabled by default</span>
      </label>
      <label class="settings-flag">
        <input type="checkbox" v-model="chatMemoryWriteDefaultEnabled" />
        <span>Chat memory write-back enabled by default</span>
      </label>
    </div>

    <div class="settings-flags">
      <div class="settings-flag-title">Suggested Jobs Approval Policy</div>
      <label class="settings-flag">
        <span class="settings-label">Mode</span>
        <select class="select settings-select" v-model="suggestedApprovalMode">
          <option value="smart">Smart (short jobs auto, long jobs require approval)</option>
          <option value="always">Always require approval</option>
          <option value="never">Auto-run all suggested jobs</option>
        </select>
      </label>
      <div class="settings-inline-grid" :style="{ opacity: suggestedApprovalMode === 'smart' ? 1 : 0.55 }">
        <label class="settings-flag">
          <span class="settings-label">Max timeout sec (auto)</span>
          <input class="input" type="number" min="1" max="3600" v-model.number="suggestedAutoMaxTimeoutSec" :disabled="suggestedApprovalMode !== 'smart'" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Max attempts (auto)</span>
          <input class="input" type="number" min="1" max="10" v-model.number="suggestedAutoMaxAttempts" :disabled="suggestedApprovalMode !== 'smart'" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Max priority (auto)</span>
          <input class="input" type="number" min="0" max="10" v-model.number="suggestedAutoMaxPriority" :disabled="suggestedApprovalMode !== 'smart'" />
        </label>
      </div>
      <label class="settings-flag">
        <span class="settings-label">Auto-allow types (comma separated)</span>
        <input
          class="input"
          v-model="suggestedAutoAllowTypes"
          :disabled="suggestedApprovalMode !== 'smart'"
          placeholder="report.generate,memory.write"
        />
      </label>
    </div>

    <div class="settings-content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import {
  getUiPrefs,
  loadUiPrefsFromApi,
  setChatMemoryDefaultEnabled,
  setChatMemoryWriteDefaultEnabled,
  setDevModeEnabled,
  setSuggestedApprovalMode,
  setSuggestedAutoAllowTypes,
  setSuggestedAutoMaxAttempts,
  setSuggestedAutoMaxPriority,
  setSuggestedAutoMaxTimeoutSec
} from "../ui_prefs.js";

const prefs = getUiPrefs();
const devMode = ref(prefs.devMode);
const chatMemoryDefaultEnabled = ref(prefs.chatMemoryDefaultEnabled);
const chatMemoryWriteDefaultEnabled = ref(prefs.chatMemoryWriteDefaultEnabled);
const suggestedApprovalMode = ref(prefs.suggestedApprovalMode);
const suggestedAutoMaxTimeoutSec = ref(prefs.suggestedAutoMaxTimeoutSec);
const suggestedAutoMaxAttempts = ref(prefs.suggestedAutoMaxAttempts);
const suggestedAutoMaxPriority = ref(prefs.suggestedAutoMaxPriority);
const suggestedAutoAllowTypes = ref(prefs.suggestedAutoAllowTypes);

onMounted(async () => {
  const loaded = await loadUiPrefsFromApi();
  devMode.value = loaded.devMode;
  chatMemoryDefaultEnabled.value = loaded.chatMemoryDefaultEnabled;
  chatMemoryWriteDefaultEnabled.value = loaded.chatMemoryWriteDefaultEnabled;
  suggestedApprovalMode.value = loaded.suggestedApprovalMode;
  suggestedAutoMaxTimeoutSec.value = loaded.suggestedAutoMaxTimeoutSec;
  suggestedAutoMaxAttempts.value = loaded.suggestedAutoMaxAttempts;
  suggestedAutoMaxPriority.value = loaded.suggestedAutoMaxPriority;
  suggestedAutoAllowTypes.value = loaded.suggestedAutoAllowTypes;
});

watch(devMode, (v) => {
  setDevModeEnabled(v === true);
});
watch(chatMemoryDefaultEnabled, (v) => {
  setChatMemoryDefaultEnabled(v === true);
});
watch(chatMemoryWriteDefaultEnabled, (v) => {
  setChatMemoryWriteDefaultEnabled(v === true);
});
watch(suggestedApprovalMode, (v) => {
  setSuggestedApprovalMode(v);
});
watch(suggestedAutoMaxTimeoutSec, (v) => {
  setSuggestedAutoMaxTimeoutSec(v);
});
watch(suggestedAutoMaxAttempts, (v) => {
  setSuggestedAutoMaxAttempts(v);
});
watch(suggestedAutoMaxPriority, (v) => {
  setSuggestedAutoMaxPriority(v);
});
watch(suggestedAutoAllowTypes, (v) => {
  setSuggestedAutoAllowTypes(v);
});
</script>

<style scoped>
.settings-shell {
  min-height: calc(100vh - 170px);
}

.settings-head {
  gap: 10px;
  margin-bottom: 10px;
}

.settings-title {
  font-size: 20px;
  font-weight: 800;
}

.settings-subtitle {
  font-size: 13px;
  color: var(--muted);
}

.settings-nav {
  gap: 8px;
  margin-bottom: 14px;
  flex-wrap: wrap;
}

.settings-nav-link {
  display: inline-flex;
  align-items: center;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text);
  text-decoration: none;
  font-size: 13px;
  background: rgba(255, 255, 255, 0.02);
}

.settings-nav-link.router-link-active {
  background: rgba(112, 178, 255, 0.2);
  border-color: rgba(112, 178, 255, 0.45);
}

.settings-content {
  min-height: 0;
}

.settings-flags {
  margin-bottom: 12px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.settings-flag {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.settings-flag-title {
  font-size: 13px;
  font-weight: 700;
  color: #dce7ff;
}

.settings-label {
  min-width: 220px;
  color: var(--muted);
}

.settings-select {
  width: 100%;
}

.settings-inline-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}

@media (max-width: 980px) {
  .settings-inline-grid {
    grid-template-columns: 1fr;
  }
}
</style>
