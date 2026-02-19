<template>
  <div class="card">
    <div class="row">
      <div style="font-weight: 700">Job types</div>
      <div class="spacer"></div>
      <button class="btn" @click="load" :disabled="loading">{{ loading ? "Loading..." : "Refresh" }}</button>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>name</th>
          <th>enabled</th>
          <th>handler</th>
          <th>default timeout</th>
          <th>default attempts</th>
          <th>actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in types" :key="t.name">
          <td>{{ t.name }}</td>
          <td>
            <label class="row" style="gap: 6px">
              <input type="checkbox" v-model="t.enabled" :disabled="isReadOnly" />
              <span class="badge" :class="t.enabled ? 'ok' : 'err'">{{ t.enabled }}</span>
            </label>
          </td>
          <td>
            <input class="input" v-model="t.handler" style="width: 100%; min-width: 230px" :disabled="isReadOnly" />
          </td>
          <td>
            <input
              class="input"
              type="number"
              min="1"
              max="3600"
              v-model.number="t.default_timeout_sec"
              :disabled="isReadOnly"
              style="width: 110px"
            />
          </td>
          <td>
            <input
              class="input"
              type="number"
              min="1"
              max="10"
              v-model.number="t.default_max_attempts"
              :disabled="isReadOnly"
              style="width: 90px"
            />
          </td>
          <td>
            <div class="row" style="gap: 6px">
              <button class="btn primary" @click="saveType(t)" :disabled="isReadOnly || !isDirty(t) || !isValid(t) || t.saving">
                {{ t.saving ? "Saving..." : "Save" }}
              </button>
              <button class="btn" @click="resetType(t)" :disabled="isReadOnly || !isDirty(t) || t.saving">Reset</button>
            </div>
            <div v-if="t.localErr" style="margin-top: 6px; color: #ff7b72; font-size: 12px">
              {{ t.localErr }}
            </div>
          </td>
        </tr>
        <tr v-if="types.length === 0">
          <td colspan="6" style="color: var(--muted)">No job types found.</td>
        </tr>
      </tbody>
    </table>

    <div v-if="statusMsg" style="margin-top: 10px; color: #7ee787; font-size: 13px">
      {{ statusMsg }}
    </div>

    <div style="margin-top: 8px; color: var(--muted); font-size: 12px">
      {{ loading ? "Loading job types..." : `Loaded ${types.length} job types` }}
      <span v-if="lastActionAt"> | last action: {{ lastActionAt }}</span>
    </div>
    <div v-if="isReadOnly" style="margin-top: 8px; color: #f59e0b; font-size: 12px">
      Read-only API key active: job type updates are disabled.
    </div>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">
      {{ err }}
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";
import { refreshAuthState, useAuthState } from "../auth_state.js";

const types = ref([]);
const err = ref("");
const statusMsg = ref("");
const loading = ref(false);
const lastActionAt = ref("");
const { isReadOnly } = useAuthState();

function toEditable(t) {
  return {
    name: t.name,
    enabled: !!t.enabled,
    handler: t.handler,
    default_timeout_sec: Number(t.default_timeout_sec),
    default_max_attempts: Number(t.default_max_attempts),
    saving: false,
    localErr: "",
    _original: {
      enabled: !!t.enabled,
      handler: t.handler,
      default_timeout_sec: Number(t.default_timeout_sec),
      default_max_attempts: Number(t.default_max_attempts),
    }
  };
}

function isDirty(t) {
  return (
    t.enabled !== t._original.enabled ||
    t.handler !== t._original.handler ||
    Number(t.default_timeout_sec) !== t._original.default_timeout_sec ||
    Number(t.default_max_attempts) !== t._original.default_max_attempts
  );
}

function isValid(t) {
  const to = Number(t.default_timeout_sec);
  const ma = Number(t.default_max_attempts);
  return (
    typeof t.handler === "string" &&
    t.handler.trim().length > 0 &&
    Number.isInteger(to) &&
    to >= 1 &&
    to <= 3600 &&
    Number.isInteger(ma) &&
    ma >= 1 &&
    ma <= 10
  );
}

function resetType(t) {
  t.enabled = t._original.enabled;
  t.handler = t._original.handler;
  t.default_timeout_sec = t._original.default_timeout_sec;
  t.default_max_attempts = t._original.default_max_attempts;
  t.localErr = "";
  statusMsg.value = `Reset unsaved changes for '${t.name}'.`;
  lastActionAt.value = new Date().toLocaleTimeString();
}

async function load() {
  err.value = "";
  statusMsg.value = "";
  loading.value = true;
  try {
    const r = await api.jobTypes();
    types.value = (r.types || []).map(toEditable);
    lastActionAt.value = new Date().toLocaleTimeString();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function saveType(t) {
  if (isReadOnly.value) {
    t.localErr = "Read-only API key: updates are disabled.";
    return;
  }
  t.localErr = "";
  err.value = "";
  statusMsg.value = "";
  if (!isValid(t)) {
    t.localErr = "Invalid values: handler, timeout (1..3600), attempts (1..10)";
    return;
  }

  t.saving = true;
  try {
    const payload = {
      enabled: !!t.enabled,
      handler: String(t.handler).trim(),
      default_timeout_sec: Number(t.default_timeout_sec),
      default_max_attempts: Number(t.default_max_attempts),
    };
    const r = await api.updateJobType(t.name, payload);
    const updated = toEditable(r.type || payload);
    t.enabled = updated.enabled;
    t.handler = updated.handler;
    t.default_timeout_sec = updated.default_timeout_sec;
    t.default_max_attempts = updated.default_max_attempts;
    t._original = updated._original;
    statusMsg.value = `Saved '${t.name}' successfully.`;
    lastActionAt.value = new Date().toLocaleTimeString();
  } catch (e) {
    t.localErr = e.message || String(e);
    err.value = t.localErr;
  } finally {
    t.saving = false;
  }
}

onMounted(async () => {
  await refreshAuthState();
  await load();
});
</script>
