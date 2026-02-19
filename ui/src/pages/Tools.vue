<template>
  <div class="card tools-shell">
    <div class="row" style="align-items: center; margin-bottom: 8px">
      <div class="settings-flag-title">Runtime Tools</div>
      <div class="spacer"></div>
      <span class="tools-note">Muutokset tallentuvat heti ajonaikaisiksi overrideiksi.</span>
    </div>

    <div class="tools-actions">
      <button class="btn" type="button" @click="loadAll" :disabled="loading || saving">
        {{ loading ? "Loading..." : "Reload" }}
      </button>
      <button class="btn btn-primary" type="button" @click="saveOverrides" :disabled="loading || saving">
        {{ saving ? "Saving..." : "Save overrides" }}
      </button>
      <button class="btn" type="button" @click="clearOverrides" :disabled="loading || saving">
        Clear overrides
      </button>
    </div>

    <div v-if="error" class="settings-auth-error">{{ error }}</div>
    <div v-else-if="saved" class="tools-ok">Saved.</div>

    <div class="tools-grid" v-if="!loading">
      <section class="tools-group">
        <h3 class="tools-title">tool.exec</h3>
        <label class="settings-flag">
          <input type="checkbox" v-model="toolExecEnabled" />
          <span>Enabled</span>
        </label>
        <label class="settings-flag">
          <span class="settings-label">Allowlist (comma separated)</span>
          <input class="input" v-model="toolExecAllowlist" placeholder="sh,git,node,npm" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Timeout (ms)</span>
          <input class="input" type="number" min="100" max="120000" v-model.number="toolExecTimeoutMs" />
        </label>
      </section>

      <section class="tools-group">
        <h3 class="tools-title">data.fetch</h3>
        <label class="settings-flag">
          <input type="checkbox" v-model="dataFetchEnabled" />
          <span>Enabled</span>
        </label>
        <label class="settings-flag">
          <span class="settings-label">Allowlist domains (comma separated)</span>
          <input class="input" v-model="dataFetchAllowlist" placeholder="api.github.com,example.com" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Timeout (ms)</span>
          <input class="input" type="number" min="200" max="120000" v-model.number="dataFetchTimeoutMs" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Max bytes</span>
          <input class="input" type="number" min="512" max="1048576" v-model.number="dataFetchMaxBytes" />
        </label>
      </section>

      <section class="tools-group">
        <h3 class="tools-title">tools.web_search</h3>
        <label class="settings-flag">
          <input type="checkbox" v-model="webSearchEnabled" />
          <span>Enabled</span>
        </label>
        <label class="settings-flag">
          <span class="settings-label">Provider</span>
          <select class="select settings-select" v-model="webSearchProvider">
            <option value="duckduckgo">duckduckgo</option>
            <option value="brave">brave</option>
          </select>
        </label>
        <label class="settings-flag">
          <span class="settings-label">Timeout (ms)</span>
          <input class="input" type="number" min="200" max="120000" v-model.number="webSearchTimeoutMs" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Max results</span>
          <input class="input" type="number" min="1" max="20" v-model.number="webSearchMaxResults" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">DuckDuckGo base URL</span>
          <input class="input" v-model="webSearchBaseUrl" placeholder="https://api.duckduckgo.com" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Brave API key override</span>
          <input class="input" v-model="webSearchBraveApiKey" type="password" placeholder="Leave empty to clear override" />
        </label>
        <label class="settings-flag">
          <span class="settings-label">Brave endpoint</span>
          <input class="input" v-model="webSearchBraveEndpoint" placeholder="https://api.search.brave.com/res/v1/web/search" />
        </label>
      </section>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref } from "vue";
import { api } from "../api.js";

function splitCsv(raw) {
  return String(raw || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isInteger(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

const loading = ref(false);
const saving = ref(false);
const saved = ref(false);
const error = ref("");

const toolExecEnabled = ref(false);
const toolExecAllowlist = ref("");
const toolExecTimeoutMs = ref(10000);

const dataFetchEnabled = ref(false);
const dataFetchAllowlist = ref("");
const dataFetchTimeoutMs = ref(8000);
const dataFetchMaxBytes = ref(65536);

const webSearchEnabled = ref(false);
const webSearchProvider = ref("duckduckgo");
const webSearchTimeoutMs = ref(8000);
const webSearchMaxResults = ref(5);
const webSearchBaseUrl = ref("https://api.duckduckgo.com");
const webSearchBraveApiKey = ref("");
const webSearchBraveEndpoint = ref("https://api.search.brave.com/res/v1/web/search");

function applyHandlers(handlers) {
  const toolExec = handlers?.tool_exec || {};
  const dataFetch = handlers?.data_fetch || {};
  const webSearch = handlers?.web_search || {};
  toolExecEnabled.value = toolExec.enabled === true;
  toolExecAllowlist.value = Array.isArray(toolExec.allowlist) ? toolExec.allowlist.join(",") : "";
  toolExecTimeoutMs.value = Number.isInteger(toolExec.timeout_ms) ? toolExec.timeout_ms : 10000;

  dataFetchEnabled.value = dataFetch.enabled === true;
  dataFetchAllowlist.value = Array.isArray(dataFetch.allowlist) ? dataFetch.allowlist.join(",") : "";
  dataFetchTimeoutMs.value = Number.isInteger(dataFetch.timeout_ms) ? dataFetch.timeout_ms : 8000;
  dataFetchMaxBytes.value = Number.isInteger(dataFetch.max_bytes) ? dataFetch.max_bytes : 65536;

  webSearchEnabled.value = webSearch.enabled === true;
  webSearchProvider.value = (webSearch.provider === "brave" || webSearch.provider === "duckduckgo") ? webSearch.provider : "duckduckgo";
  webSearchTimeoutMs.value = Number.isInteger(webSearch.timeout_ms) ? webSearch.timeout_ms : 8000;
  webSearchMaxResults.value = Number.isInteger(webSearch.max_results) ? webSearch.max_results : 5;
  webSearchBaseUrl.value = String(webSearch.base_url || "https://api.duckduckgo.com");
}

function applyOverrides(prefs) {
  const toolExec = prefs?.tool_exec || {};
  const dataFetch = prefs?.data_fetch || {};
  const webSearch = prefs?.web_search || {};

  if (typeof toolExec.enabled === "boolean") toolExecEnabled.value = toolExec.enabled;
  if (toolExec.allowlist != null) toolExecAllowlist.value = Array.isArray(toolExec.allowlist) ? toolExec.allowlist.join(",") : String(toolExec.allowlist || "");
  if (Number.isInteger(Number(toolExec.timeout_ms))) toolExecTimeoutMs.value = Number(toolExec.timeout_ms);

  if (typeof dataFetch.enabled === "boolean") dataFetchEnabled.value = dataFetch.enabled;
  if (dataFetch.allowlist != null) dataFetchAllowlist.value = Array.isArray(dataFetch.allowlist) ? dataFetch.allowlist.join(",") : String(dataFetch.allowlist || "");
  if (Number.isInteger(Number(dataFetch.timeout_ms))) dataFetchTimeoutMs.value = Number(dataFetch.timeout_ms);
  if (Number.isInteger(Number(dataFetch.max_bytes))) dataFetchMaxBytes.value = Number(dataFetch.max_bytes);

  if (typeof webSearch.enabled === "boolean") webSearchEnabled.value = webSearch.enabled;
  if (typeof webSearch.provider === "string") {
    const p = webSearch.provider.trim().toLowerCase();
    if (p === "duckduckgo" || p === "brave") webSearchProvider.value = p;
  }
  if (Number.isInteger(Number(webSearch.timeout_ms))) webSearchTimeoutMs.value = Number(webSearch.timeout_ms);
  if (Number.isInteger(Number(webSearch.max_results))) webSearchMaxResults.value = Number(webSearch.max_results);
  if (typeof webSearch.base_url === "string") webSearchBaseUrl.value = webSearch.base_url;
  if (typeof webSearch.brave_api_key === "string") webSearchBraveApiKey.value = webSearch.brave_api_key;
  if (typeof webSearch.brave_endpoint === "string") webSearchBraveEndpoint.value = webSearch.brave_endpoint;
}

async function loadAll() {
  loading.value = true;
  error.value = "";
  saved.value = false;
  try {
    const [runtime, prefs] = await Promise.all([
      api.runtimeHandlers(),
      api.uiPrefs("runtime_tools")
    ]);
    applyHandlers(runtime?.handlers || {});
    applyOverrides(prefs?.prefs || {});
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    loading.value = false;
  }
}

function buildPrefs() {
  return {
    tool_exec: {
      enabled: toolExecEnabled.value === true,
      allowlist: splitCsv(toolExecAllowlist.value),
      timeout_ms: clampInt(toolExecTimeoutMs.value, 100, 120000, 10000)
    },
    data_fetch: {
      enabled: dataFetchEnabled.value === true,
      allowlist: splitCsv(dataFetchAllowlist.value),
      timeout_ms: clampInt(dataFetchTimeoutMs.value, 200, 120000, 8000),
      max_bytes: clampInt(dataFetchMaxBytes.value, 512, 1024 * 1024, 65536)
    },
    web_search: {
      enabled: webSearchEnabled.value === true,
      provider: webSearchProvider.value === "brave" ? "brave" : "duckduckgo",
      timeout_ms: clampInt(webSearchTimeoutMs.value, 200, 120000, 8000),
      max_results: clampInt(webSearchMaxResults.value, 1, 20, 5),
      base_url: String(webSearchBaseUrl.value || "").trim(),
      brave_api_key: String(webSearchBraveApiKey.value || "").trim(),
      brave_endpoint: String(webSearchBraveEndpoint.value || "").trim()
    }
  };
}

async function saveOverrides() {
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    await api.saveUiPrefs("runtime_tools", buildPrefs());
    await loadAll();
    saved.value = true;
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    saving.value = false;
  }
}

async function clearOverrides() {
  saving.value = true;
  error.value = "";
  saved.value = false;
  try {
    await api.saveUiPrefs("runtime_tools", {});
    await loadAll();
    saved.value = true;
  } catch (e) {
    error.value = e?.message || String(e);
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  await loadAll();
});
</script>

<style scoped>
.tools-shell {
  min-height: 0;
}

.tools-note {
  color: #7f8ea3;
  font-size: 12px;
}

.tools-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
}

.tools-ok {
  color: #5ad39f;
  font-size: 13px;
  margin-bottom: 10px;
}

.tools-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 10px;
}

.tools-group {
  border: 1px solid #1f2a3f;
  border-radius: 8px;
  padding: 10px;
  background: #0f1524;
}

.tools-title {
  margin: 0 0 8px;
  font-size: 14px;
}

.settings-flag {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 8px;
}

.settings-label {
  font-size: 12px;
  color: #9fb0c8;
}

.settings-select {
  min-width: 160px;
}

.settings-auth-error {
  color: #ff7b7b;
  font-size: 13px;
  margin-bottom: 8px;
}
</style>
