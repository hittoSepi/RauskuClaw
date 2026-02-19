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
      <router-link to="/settings/tools" class="settings-nav-link">Tools</router-link>
      <router-link to="/settings/prompts" class="settings-nav-link">Prompts</router-link>
    </div>

    <div class="settings-flags">
      <div class="row" style="align-items: center">
        <div class="settings-flag-title">Auth Identity</div>
        <div class="spacer"></div>
        <button class="btn" @click="loadAuthWhoami" :disabled="authLoading">
          {{ authLoading ? "Loading..." : "Reload identity" }}
        </button>
      </div>
      <div v-if="authError" class="settings-auth-error">{{ authError }}</div>
      <div v-else-if="authInfo" class="settings-auth-grid">
        <span class="badge">name {{ authInfo.name || "(unknown)" }}</span>
        <span class="badge">role {{ authInfo.role || "(unknown)" }}</span>
        <span class="badge">sse {{ authInfo.sse ? "yes" : "no" }}</span>
        <span class="badge">write {{ authInfo.can_write ? "yes" : "no" }}</span>
        <span class="badge">queues {{ authQueueLabel }}</span>
      </div>
      <div v-else class="settings-auth-muted">No auth identity loaded yet.</div>
    </div>

    <div class="settings-flags">
      <div class="row" style="align-items: center">
        <div class="settings-flag-title">Runtime Handlers</div>
        <div class="spacer"></div>
        <button class="btn" @click="loadRuntimeHandlers" :disabled="handlersLoading">
          {{ handlersLoading ? "Loading..." : "Reload handlers" }}
        </button>
      </div>
      <div v-if="handlersError" class="settings-auth-error">{{ handlersError }}</div>
      <div v-else-if="handlersInfo" class="settings-auth-grid">
        <span class="badge">deploy {{ handlersInfo.deploy?.enabled ? "on" : "off" }}</span>
        <span class="badge">tool.exec {{ handlersInfo.tool_exec?.enabled ? "on" : "off" }}</span>
        <span class="badge">data.fetch {{ handlersInfo.data_fetch?.enabled ? "on" : "off" }}</span>
        <span class="badge">web_search {{ handlersInfo.web_search?.enabled ? "on" : "off" }}</span>
        <span class="badge" v-if="handlersInfo.tool_exec?.timeout_ms != null">tool.exec timeout {{ handlersInfo.tool_exec.timeout_ms }}ms</span>
        <span class="badge" v-if="handlersInfo.data_fetch?.timeout_ms != null">data.fetch timeout {{ handlersInfo.data_fetch.timeout_ms }}ms</span>
        <span class="badge" v-if="handlersInfo.data_fetch?.max_bytes != null">data.fetch max {{ handlersInfo.data_fetch.max_bytes }}B</span>
        <span class="badge" v-if="handlersInfo.web_search?.timeout_ms != null">web_search timeout {{ handlersInfo.web_search.timeout_ms }}ms</span>
        <span class="badge" v-if="handlersInfo.web_search?.max_results != null">web_search max {{ handlersInfo.web_search.max_results }}</span>
        <span class="badge" v-if="handlersInfo.web_search?.provider">web_search provider {{ handlersInfo.web_search.provider }}</span>
      </div>
      <div v-else class="settings-auth-muted">No runtime handler status loaded yet.</div>
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
      <label class="settings-flag">
        <input type="checkbox" v-model="chatPlannerEnabled" />
        <span>Planner enabled in chat</span>
      </label>
      <label class="settings-flag">
        <input type="checkbox" v-model="chatRouterEnabled" />
        <span>Router enabled in chat (auto mode routing)</span>
      </label>
      <label class="settings-flag">
        <span class="settings-label">Chat max prompt tokens (approx)</span>
        <input class="input" type="number" min="512" max="200000" v-model.number="chatMaxPromptTokens" />
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
        <span class="settings-label">Auto-allow types</span>
        <div class="settings-types-picker" :style="{ opacity: suggestedApprovalMode === 'smart' ? 1 : 0.55 }">
          <label v-for="t in suggestedAutoAllowTypeOptions" :key="`allow-${t}`" class="settings-type-item">
            <input
              type="checkbox"
              :checked="suggestedAutoAllowTypesSelected.includes(t)"
              :disabled="suggestedApprovalMode !== 'smart'"
              @change="toggleSuggestedAutoAllowType(t, $event)"
            />
            <span>{{ t }}</span>
          </label>
          <div v-if="!suggestedAutoAllowTypeOptions.length" class="settings-auth-muted">
            No enabled job types loaded.
          </div>
        </div>
      </label>
    </div>

    <div class="settings-content">
      <router-view />
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import { refreshAuthState, useAuthState } from "../auth_state.js";
import {
  getUiPrefs,
  loadUiPrefsFromApi,
  setChatMemoryDefaultEnabled,
  setChatMemoryWriteDefaultEnabled,
  setChatPlannerEnabled,
  setChatRouterEnabled,
  setChatMaxPromptTokens,
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
const chatPlannerEnabled = ref(prefs.chatPlannerEnabled !== false);
const chatRouterEnabled = ref(prefs.chatRouterEnabled !== false);
const suggestedApprovalMode = ref(prefs.suggestedApprovalMode);
const suggestedAutoMaxTimeoutSec = ref(prefs.suggestedAutoMaxTimeoutSec);
const suggestedAutoMaxAttempts = ref(prefs.suggestedAutoMaxAttempts);
const suggestedAutoMaxPriority = ref(prefs.suggestedAutoMaxPriority);
const suggestedAutoAllowTypes = ref(prefs.suggestedAutoAllowTypes);
const chatMaxPromptTokens = ref(prefs.chatMaxPromptTokens || 12000);
const suggestedAutoAllowTypesSelected = ref([]);
const suggestedAutoAllowTypeOptions = ref([]);
const { authInfo, authError, authLoading } = useAuthState();
const handlersInfo = ref(null);
const handlersLoading = ref(false);
const handlersError = ref("");
const authQueueLabel = computed(() => {
  const list = Array.isArray(authInfo.value?.queue_allowlist) ? authInfo.value.queue_allowlist : null;
  if (!list || list.length < 1) return "all";
  return list.join(",");
});
async function loadAuthWhoami() { await refreshAuthState(); }
async function loadRuntimeHandlers() {
  handlersLoading.value = true;
  handlersError.value = "";
  try {
    const out = await api.runtimeHandlers();
    handlersInfo.value = out?.handlers || null;
  } catch (e) {
    handlersInfo.value = null;
    handlersError.value = e?.message || String(e);
  } finally {
    handlersLoading.value = false;
  }
}

function parseCsvTypes(value) {
  return String(value || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function syncSuggestedAutoAllowTypesSelection(csvValue) {
  suggestedAutoAllowTypesSelected.value = parseCsvTypes(csvValue);
}

function refreshSuggestedAutoAllowTypeOptions(jobTypesPayload) {
  const rows = Array.isArray(jobTypesPayload) ? jobTypesPayload : [];
  const enabled = rows
    .filter((r) => r && r.enabled === true)
    .map((r) => String(r.name || "").trim())
    .filter(Boolean);
  const merged = Array.from(new Set([...enabled, ...suggestedAutoAllowTypesSelected.value]));
  suggestedAutoAllowTypeOptions.value = merged.sort((a, b) => a.localeCompare(b));
}

function toggleSuggestedAutoAllowType(typeName, event) {
  const t = String(typeName || "").trim();
  if (!t) return;
  const checked = event?.target?.checked === true;
  const set = new Set(suggestedAutoAllowTypesSelected.value);
  if (checked) set.add(t);
  else set.delete(t);
  const next = Array.from(set).sort((a, b) => a.localeCompare(b));
  suggestedAutoAllowTypesSelected.value = next;
  suggestedAutoAllowTypes.value = next.join(",");
}

onMounted(async () => {
  const loaded = await loadUiPrefsFromApi();
  devMode.value = loaded.devMode;
  chatMemoryDefaultEnabled.value = loaded.chatMemoryDefaultEnabled;
  chatMemoryWriteDefaultEnabled.value = loaded.chatMemoryWriteDefaultEnabled;
  chatPlannerEnabled.value = loaded.chatPlannerEnabled !== false;
  chatRouterEnabled.value = loaded.chatRouterEnabled !== false;
  suggestedApprovalMode.value = loaded.suggestedApprovalMode;
  suggestedAutoMaxTimeoutSec.value = loaded.suggestedAutoMaxTimeoutSec;
  suggestedAutoMaxAttempts.value = loaded.suggestedAutoMaxAttempts;
  suggestedAutoMaxPriority.value = loaded.suggestedAutoMaxPriority;
  suggestedAutoAllowTypes.value = loaded.suggestedAutoAllowTypes;
  chatMaxPromptTokens.value = loaded.chatMaxPromptTokens || 12000;
  syncSuggestedAutoAllowTypesSelection(loaded.suggestedAutoAllowTypes);
  try {
    const jt = await api.jobTypes();
    refreshSuggestedAutoAllowTypeOptions(jt?.types || []);
  } catch {
    refreshSuggestedAutoAllowTypeOptions([]);
  }
  await loadAuthWhoami();
  await loadRuntimeHandlers();
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
watch(chatPlannerEnabled, (v) => {
  setChatPlannerEnabled(v === true);
});
watch(chatRouterEnabled, (v) => {
  setChatRouterEnabled(v === true);
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
  syncSuggestedAutoAllowTypesSelection(v);
  setSuggestedAutoAllowTypes(v);
});
watch(chatMaxPromptTokens, (v) => {
  setChatMaxPromptTokens(v);
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

.settings-auth-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.settings-auth-error {
  color: #ff7b72;
  font-size: 12px;
}

.settings-auth-muted {
  color: var(--muted);
  font-size: 12px;
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

.settings-types-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 10px;
}

.settings-type-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text);
  padding: 4px 6px;
  border: 1px solid var(--border);
  border-radius: 999px;
}

@media (max-width: 980px) {
  .settings-inline-grid {
    grid-template-columns: 1fr;
  }
}
</style>
