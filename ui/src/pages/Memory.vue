<template>
  <div class="card memory-shell">
    <div class="row memory-head">
      <div class="memory-title">Memory Management</div>
      <div class="spacer"></div>
      <label class="memory-toggle">
        <input type="checkbox" v-model="includeExpired" />
        include expired
      </label>
      <button class="btn" @click="loadScopes" :disabled="loadingScopes">
        {{ loadingScopes ? "Loading..." : "Refresh" }}
      </button>
    </div>

    <div class="row memory-filters">
      <input
        class="input memory-search"
        v-model.trim="query"
        placeholder="filter scope (contains)"
      />
      <span class="memory-summary">
        {{ loadingScopes ? "Loading scopes..." : `Scopes ${filteredScopes.length}/${scopes.length}` }}
      </span>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>scope</th>
          <th>total</th>
          <th>ready</th>
          <th>pending</th>
          <th>failed</th>
          <th>latest updated</th>
          <th>actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in filteredScopes" :key="s.scope">
          <td>{{ s.scope }}</td>
          <td>{{ s.total_count }}</td>
          <td>{{ s.ready_count }}</td>
          <td>{{ s.pending_count }}</td>
          <td>{{ s.failed_count }}</td>
          <td style="color: var(--muted)">{{ s.latest_updated_at || "-" }}</td>
          <td>
            <button class="btn" @click="openScope(s.scope)" :disabled="resetLoading">
              View
            </button>
            <button class="btn danger" @click="resetScope(s.scope)" :disabled="resetLoading">
              Reset scope
            </button>
          </td>
        </tr>
        <tr v-if="!filteredScopes.length && !loadingScopes">
          <td colspan="7" style="color: var(--muted)">No scopes found.</td>
        </tr>
      </tbody>
    </table>

    <div class="memory-reset-all">
      <div class="memory-reset-title">Reset All Memory</div>
      <div class="memory-reset-help">Type <code>RESET ALL</code> to enable full cleanup.</div>
      <div class="row memory-reset-row">
        <input
          class="input memory-reset-confirm"
          v-model.trim="resetAllConfirmText"
          placeholder='type "RESET ALL"'
        />
        <button
          class="btn danger"
          :disabled="!canResetAll || resetLoading"
          @click="resetAll"
        >
          {{ resetLoading ? "Resetting..." : "Reset all memory" }}
        </button>
      </div>
    </div>

    <div v-if="selectedScope" class="memory-details">
      <div class="row memory-details-head">
        <div class="memory-details-title">Scope: {{ selectedScope }}</div>
        <div class="spacer"></div>
        <button class="btn" @click="loadScopeRows" :disabled="loadingScopeRows">
          {{ loadingScopeRows ? "Loading..." : "Refresh scope" }}
        </button>
        <button class="btn" @click="closeScope">Close</button>
      </div>
      <table class="table">
        <thead>
          <tr>
            <th>key</th>
            <th>value preview</th>
            <th>embedding</th>
            <th>updated</th>
            <th>expires</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="m in scopeRows" :key="m.id">
            <td>{{ m.key }}</td>
            <td class="memory-value-preview">{{ previewValue(m.value) }}</td>
            <td>{{ m.embedding_status || "pending" }}</td>
            <td style="color: var(--muted)">{{ m.updated_at || "-" }}</td>
            <td style="color: var(--muted)">{{ m.expires_at || "-" }}</td>
          </tr>
          <tr v-if="!scopeRows.length && !loadingScopeRows">
            <td colspan="5" style="color: var(--muted)">No memory rows in this scope.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="statusMsg" class="memory-status ok">{{ statusMsg }}</div>
    <div v-if="err" class="memory-status err">{{ err }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";

const scopes = ref([]);
const query = ref("");
const includeExpired = ref(false);
const loadingScopes = ref(false);
const loadingScopeRows = ref(false);
const resetLoading = ref(false);
const statusMsg = ref("");
const err = ref("");
const resetAllConfirmText = ref("");
const selectedScope = ref("");
const scopeRows = ref([]);

const canResetAll = computed(() => resetAllConfirmText.value === "RESET ALL");
const filteredScopes = computed(() => {
  const needle = String(query.value || "").trim().toLowerCase();
  if (!needle) return scopes.value;
  return scopes.value.filter((s) => String(s.scope || "").toLowerCase().includes(needle));
});

async function loadScopes() {
  loadingScopes.value = true;
  err.value = "";
  try {
    const out = await api.memoryScopes({
      include_expired: includeExpired.value ? "1" : "0",
      limit: "500"
    });
    scopes.value = Array.isArray(out?.scopes) ? out.scopes : [];
  } catch (e) {
    err.value = e?.message || String(e);
  } finally {
    loadingScopes.value = false;
  }
}

async function resetScope(scope) {
  if (resetLoading.value) return;
  const target = String(scope || "").trim();
  if (!target) return;
  const ok = window.confirm(`Reset memory scope "${target}"?`);
  if (!ok) return;
  resetLoading.value = true;
  statusMsg.value = "";
  err.value = "";
  try {
    const out = await api.memoryReset({ scope: target });
    statusMsg.value = `Scope reset done (${target}). Deleted memories=${Number(out?.deleted_memories || 0)}, vectors=${Number(out?.deleted_vectors || 0)}.`;
    await loadScopes();
    if (selectedScope.value === target) await loadScopeRows();
  } catch (e) {
    err.value = e?.message || String(e);
  } finally {
    resetLoading.value = false;
  }
}

async function resetAll() {
  if (!canResetAll.value || resetLoading.value) return;
  const ok = window.confirm("Reset ALL memory scopes?");
  if (!ok) return;
  resetLoading.value = true;
  statusMsg.value = "";
  err.value = "";
  try {
    const out = await api.memoryReset({});
    statusMsg.value = `Full reset done. Deleted memories=${Number(out?.deleted_memories || 0)}, vectors=${Number(out?.deleted_vectors || 0)}.`;
    resetAllConfirmText.value = "";
    await loadScopes();
    if (selectedScope.value) await loadScopeRows();
  } catch (e) {
    err.value = e?.message || String(e);
  } finally {
    resetLoading.value = false;
  }
}

async function loadScopeRows() {
  const scope = String(selectedScope.value || "").trim();
  if (!scope) return;
  loadingScopeRows.value = true;
  err.value = "";
  try {
    const out = await api.memories({
      scope,
      include_expired: includeExpired.value ? "1" : "0",
      limit: "500"
    });
    scopeRows.value = Array.isArray(out?.memories) ? out.memories : [];
  } catch (e) {
    err.value = e?.message || String(e);
  } finally {
    loadingScopeRows.value = false;
  }
}

function openScope(scope) {
  selectedScope.value = String(scope || "").trim();
  scopeRows.value = [];
  if (selectedScope.value) void loadScopeRows();
}

function closeScope() {
  selectedScope.value = "";
  scopeRows.value = [];
}

function previewValue(value) {
  if (value == null) return "-";
  let raw = "";
  if (typeof value === "string") raw = value;
  else {
    try {
      raw = JSON.stringify(value);
    } catch {
      raw = String(value);
    }
  }
  const oneLine = raw.replace(/\s+/g, " ").trim();
  if (!oneLine) return "-";
  return oneLine.length > 120 ? `${oneLine.slice(0, 120)}...` : oneLine;
}

watch(includeExpired, () => {
  void loadScopes();
  if (selectedScope.value) void loadScopeRows();
});

onMounted(() => {
  void loadScopes();
});
</script>

<style scoped>
.memory-shell {
  min-height: 0;
}

.memory-head {
  margin-bottom: 10px;
  gap: 10px;
}

.memory-title {
  font-weight: 700;
}

.memory-toggle {
  color: var(--muted);
  font-size: 13px;
}

.memory-filters {
  margin-bottom: 8px;
  gap: 8px;
}

.memory-search {
  min-width: 260px;
  max-width: 420px;
}

.memory-summary {
  color: var(--muted);
  font-size: 12px;
}

.memory-reset-all {
  margin-top: 12px;
  border: 1px solid rgba(255, 123, 114, 0.35);
  border-radius: 10px;
  padding: 10px;
  background: rgba(255, 123, 114, 0.06);
}

.memory-details {
  margin-top: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.memory-details-head {
  margin-bottom: 8px;
  gap: 8px;
}

.memory-details-title {
  font-weight: 700;
}

.memory-value-preview {
  max-width: 460px;
  color: var(--muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.memory-reset-title {
  font-weight: 700;
}

.memory-reset-help {
  color: var(--muted);
  font-size: 12px;
  margin: 4px 0 8px;
}

.memory-reset-row {
  gap: 8px;
}

.memory-reset-confirm {
  width: 220px;
}

.memory-status {
  margin-top: 10px;
  font-size: 12px;
}

.memory-status.ok {
  color: #7ee787;
}

.memory-status.err {
  color: #ff7b72;
}

.btn.danger {
  border-color: rgba(255, 123, 114, 0.55);
  color: #ffb4ac;
}
</style>
