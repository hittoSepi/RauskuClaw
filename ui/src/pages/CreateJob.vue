<template>
  <div class="card">
    <div class="row" style="margin-bottom: 10px">
      <div style="font-weight: 700">Create Job</div>
      <div class="spacer"></div>
      <button class="btn" @click="reloadAll" :disabled="loadingTypes || loadingProviders">
        {{ (loadingTypes || loadingProviders) ? "Loading..." : "Reload" }}
      </button>
    </div>

    <div class="row" style="align-items: flex-start; margin-bottom: 10px">
      <div style="flex: 1; min-width: 280px">
        <label class="field-label">Type</label>
        <select class="select" v-model="form.type" style="width: 100%">
          <option value="">-- select type --</option>
          <option v-for="t in enabledTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
      </div>

      <div style="width: 220px">
        <label class="field-label">Queue</label>
        <input class="input" v-model.trim="form.queue" placeholder="default" style="width: 100%" />
      </div>

      <div style="display: flex; align-items: end">
        <button class="btn" @click="showAdvanced = !showAdvanced">
          {{ showAdvanced ? "Hide advanced" : "Show advanced" }}
        </button>
      </div>
    </div>

    <div v-if="selectedType" class="row" style="margin-bottom: 10px; gap: 8px">
      <span class="badge">handler {{ selectedType.handler }}</span>
      <span class="badge" v-if="providerSummary">{{ providerSummary }}</span>
    </div>

    <div v-if="isChatType" style="margin-top: 6px">
      <div style="font-weight: 700; margin-bottom: 6px">Chat input</div>
      <div style="color: var(--muted); font-size: 12px; margin-bottom: 8px">
        Chat-tyyppinen syöte. Tämä muodostetaan automaattisesti jobin inputiin.
      </div>

      <div style="margin-bottom: 8px">
        <label class="field-label">System (optional)</label>
        <textarea class="input" v-model="chat.system" rows="3" style="width: 100%; resize: vertical"></textarea>
      </div>

      <div>
        <label class="field-label">Prompt / command</label>
        <textarea class="input" v-model="chat.prompt" rows="7" style="width: 100%; resize: vertical" placeholder="Kirjoita pyyntö agentille..."></textarea>
      </div>

      <div style="margin-top: 10px; border: 1px solid var(--border); border-radius: 10px; padding: 10px; background: rgba(255,255,255,0.03)">
        <div class="row" style="align-items: center; margin-bottom: 8px">
          <label class="row" style="margin: 0; gap: 6px">
            <input type="checkbox" v-model="chat.memory.enabled" />
            <span>Use memory context</span>
          </label>
          <div class="spacer"></div>
          <label class="row" style="margin: 0; gap: 6px">
            <input type="checkbox" v-model="chat.memory.required" :disabled="!chat.memory.enabled" />
            <span style="color: var(--muted); font-size: 13px">Required (fail if unavailable)</span>
          </label>
        </div>
        <div class="row" :style="{ opacity: chat.memory.enabled ? 1 : 0.6 }">
          <div style="flex: 1; min-width: 220px">
            <label class="field-label">Memory scope</label>
            <input class="input" v-model="chat.memory.scope" :disabled="!chat.memory.enabled" placeholder="agent.chat" style="width: 100%" />
          </div>
          <div style="flex: 1; min-width: 220px">
            <label class="field-label">Memory query (optional)</label>
            <input class="input" v-model="chat.memory.query" :disabled="!chat.memory.enabled" placeholder="defaults to prompt" style="width: 100%" />
          </div>
          <div style="width: 150px">
            <label class="field-label">Top K</label>
            <input class="input" type="number" min="1" max="100" v-model.number="chat.memory.top_k" :disabled="!chat.memory.enabled" style="width: 100%" />
          </div>
        </div>
      </div>
    </div>

    <div v-else style="margin-top: 6px">
      <label class="field-label">Input JSON</label>
      <textarea
        class="input"
        v-model="form.inputText"
        rows="10"
        style="width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      ></textarea>
    </div>

    <div v-if="showAdvanced" style="margin-top: 12px; border-top: 1px solid rgba(255,255,255,0.07); padding-top: 10px">
      <div class="row" style="align-items: flex-start">
        <div style="width: 180px">
          <label class="field-label">Priority (0-10)</label>
          <input class="input" type="number" min="0" max="10" v-model.number="form.priority" style="width: 100%" />
        </div>

        <div style="width: 180px">
          <label class="field-label">Timeout (sec)</label>
          <input class="input" type="number" min="1" max="3600" v-model.number="form.timeout_sec" style="width: 100%" />
        </div>

        <div style="width: 180px">
          <label class="field-label">Max attempts</label>
          <input class="input" type="number" min="1" max="10" v-model.number="form.max_attempts" style="width: 100%" />
        </div>
      </div>

      <div style="margin-top: 10px">
        <label class="field-label">Tags (comma separated)</label>
        <input class="input" v-model="form.tagsText" placeholder="dashboard, nightly" style="width: 100%" />
      </div>

      <div style="margin-top: 10px">
        <label class="field-label">Callback URL (optional)</label>
        <input class="input" v-model="form.callback_url" placeholder="https://example.com/hooks/rauskuclaw" style="width: 100%" />
      </div>

      <div style="margin-top: 10px">
        <label class="field-label">Idempotency-Key (optional)</label>
        <input class="input" v-model="form.idempotencyKey" placeholder="leave empty for random" style="width: 100%" />
      </div>

      <div style="margin-top: 10px" v-if="isChatType">
        <label class="field-label">Raw Input JSON override (optional)</label>
        <textarea
          class="input"
          v-model="form.inputText"
          rows="7"
          style="width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
          placeholder="Jos täytät tämän, tätä käytetään chat-kenttien sijaan"
        ></textarea>
      </div>
    </div>

    <div class="row" style="margin-top: 12px">
      <button class="btn primary" @click="submit" :disabled="submitting || !canSubmit">
        {{ submitting ? "Creating..." : "Create job" }}
      </button>
      <span style="color: var(--muted); font-size: 13px">Creates with `/v1/jobs`</span>
    </div>

    <div v-if="statusMsg" style="margin-top: 10px; color: #7ee787; font-size: 13px">
      {{ statusMsg }}
    </div>

    <div style="margin-top: 8px; color: var(--muted); font-size: 12px">
      {{ loadingTypes ? "Loading job types..." : `Enabled types: ${enabledTypes.length}` }}
      <span v-if="lastActionAt"> | last action: {{ lastActionAt }}</span>
    </div>

    <div v-if="validationErrors.length" style="margin-top: 10px; color: #ff7b72; font-size: 13px">
      <div style="font-weight: 700; margin-bottom: 4px">Fix before submit:</div>
      <div v-for="(v, i) in validationErrors" :key="i">- {{ v }}</div>
    </div>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">{{ err }}</div>

    <div v-if="createdJob" style="margin-top: 12px">
      <div class="row" style="margin-bottom: 6px">
        <div style="font-weight: 700">Agent chat log</div>
        <div class="spacer"></div>
        <span class="badge" :class="badgeClass(createdJob.status)">{{ createdJob.status }}</span>
        <button class="btn" @click="refreshCreated" :disabled="refreshingCreated">{{ refreshingCreated ? "Refreshing..." : "Refresh" }}</button>
      </div>

      <div style="color: var(--muted); font-size: 12px; margin-bottom: 6px">Job {{ createdJob.id }}</div>

      <pre style="max-height: 260px; overflow: auto; margin-bottom: 8px">{{ createdLogsText }}</pre>

      <div v-if="createdResultText" style="margin-top: 8px">
        <div style="font-weight: 700; margin-bottom: 4px">Agent response</div>
        <pre style="max-height: 260px; overflow: auto">{{ createdResultText }}</pre>
      </div>

      <div style="margin-top: 8px">
        <router-link :to="`/settings/jobs/${createdJob.id}`">Open full job detail</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { api } from "../api.js";

const types = ref([]);
const providerInfo = ref({ codex: null, openai: null });
const loadingTypes = ref(false);
const loadingProviders = ref(false);
const submitting = ref(false);
const err = ref("");
const statusMsg = ref("");
const createdJob = ref(null);
const refreshingCreated = ref(false);
const createdLogs = ref([]);
const lastActionAt = ref("");
const showAdvanced = ref(false);
let createdTimer = null;

const form = ref({
  type: "",
  queue: "default",
  priority: 5,
  timeout_sec: 120,
  max_attempts: 1,
  tagsText: "",
  callback_url: "",
  idempotencyKey: "",
  inputText: '{\n  "report": "weekly"\n}'
});

const chat = ref({
  system: "",
  prompt: "",
  memory: {
    enabled: false,
    scope: "",
    query: "",
    top_k: 5,
    required: false
  }
});

const enabledTypes = computed(() => (types.value || []).filter(t => t.enabled));
const selectedType = computed(() => enabledTypes.value.find(t => t.name === form.value.type) || null);
const isChatType = computed(() => {
  const t = selectedType.value;
  if (!t) return false;
  if (t.name === "codex.chat.generate" || t.name === "ai.chat.generate") return true;
  return String(t.name || "").includes("chat.generate");
});

const providerSummary = computed(() => {
  const t = selectedType.value;
  if (!t) return "";
  if (t.name === "codex.chat.generate") {
    const c = providerInfo.value.codex;
    if (!c) return "codex provider";
    const mode = c.exec_mode || "online";
    const model = c.model || "(no model)";
    return `codex ${mode} • model ${model}`;
  }
  if (t.name === "ai.chat.generate") {
    const o = providerInfo.value.openai;
    if (!o) return "openai provider";
    return `openai • model ${o.model || "(no model)"}`;
  }
  return "";
});

const createdLogsText = computed(() =>
  (createdLogs.value || [])
    .map(l => `${l.ts} [${l.level}] ${l.message}${l.meta ? " " + JSON.stringify(l.meta) : ""}`)
    .join("\n")
);

const createdResultText = computed(() => {
  const r = createdJob.value?.result;
  if (!r) return "";
  if (typeof r.output_text === "string" && r.output_text.trim()) return r.output_text;
  return JSON.stringify(r, null, 2);
});

function parseInputJsonSafe(text) {
  const raw = (text || "").trim();
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Input JSON is invalid" };
  }
}

function isValidHttpUrl(s) {
  if (!s) return true;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function chatInputObject() {
  const out = {};
  const system = String(chat.value.system || "").trim();
  const prompt = String(chat.value.prompt || "").trim();
  if (system) out.system = system;
  if (prompt) out.prompt = prompt;
  if (chat.value.memory?.enabled) {
    const topK = Number(chat.value.memory.top_k);
    const mem = {
      scope: String(chat.value.memory.scope || "").trim(),
      top_k: Number.isInteger(topK) ? topK : 5,
      required: chat.value.memory.required === true
    };
    const query = String(chat.value.memory.query || "").trim();
    if (query) mem.query = query;
    out.memory = mem;
  }
  return out;
}

function resolvedInputObject() {
  if (isChatType.value) {
    const raw = String(form.value.inputText || "").trim();
    if (showAdvanced.value && raw) {
      const parsed = parseInputJsonSafe(raw);
      return parsed.ok ? parsed.value : null;
    }
    return chatInputObject();
  }

  const parsed = parseInputJsonSafe(form.value.inputText);
  return parsed.ok ? parsed.value : null;
}

const validationErrors = computed(() => {
  const out = [];
  const p = Number(form.value.priority);
  const t = Number(form.value.timeout_sec);
  const a = Number(form.value.max_attempts);
  const callback = (form.value.callback_url || "").trim();
  const queue = String(form.value.queue || "").trim() || "default";

  if (!form.value.type) out.push("Job type is required.");
  if (!/^[a-z0-9._:-]{1,80}$/i.test(queue)) out.push("Queue must match ^[a-z0-9._:-]{1,80}$.");
  if (!Number.isInteger(p) || p < 0 || p > 10) out.push("Priority must be an integer between 0 and 10.");
  if (!Number.isInteger(t) || t < 1 || t > 3600) out.push("Timeout must be an integer between 1 and 3600.");
  if (!Number.isInteger(a) || a < 1 || a > 10) out.push("Max attempts must be an integer between 1 and 10.");
  if (!isValidHttpUrl(callback)) out.push("Callback URL must start with http:// or https://");

  if (isChatType.value) {
    const raw = String(form.value.inputText || "").trim();
    if (showAdvanced.value && raw) {
      const parsed = parseInputJsonSafe(raw);
      if (!parsed.ok) out.push(parsed.error);
    } else {
      const prompt = String(chat.value.prompt || "").trim();
      if (!prompt) out.push("Prompt is required for chat type.");
      if (chat.value.memory?.enabled) {
        const scope = String(chat.value.memory.scope || "").trim();
        if (!scope || !/^[a-z0-9._:-]{2,80}$/i.test(scope)) {
          out.push("Memory scope must match ^[a-z0-9._:-]{2,80}$.");
        }
        const topK = Number(chat.value.memory.top_k);
        if (!Number.isInteger(topK) || topK < 1 || topK > 100) {
          out.push("Memory top_k must be an integer between 1 and 100.");
        }
      }
    }
  } else {
    const parsed = parseInputJsonSafe(form.value.inputText);
    if (!parsed.ok) out.push(parsed.error);
  }

  return out;
});

const canSubmit = computed(() => validationErrors.value.length === 0 && !loadingTypes.value);

function parseTags(text) {
  return (text || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function makeIdempotencyKey() {
  const now = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `ui-${now}-${rand}`;
}

function badgeClass(s) {
  if (s === "succeeded") return "ok";
  if (s === "failed") return "err";
  if (s === "running") return "warn";
  return "";
}

function startCreatedPolling() {
  stopCreatedPolling();
  if (!createdJob.value?.id) return;
  createdTimer = setInterval(async () => {
    const status = createdJob.value?.status;
    if (status === "succeeded" || status === "failed" || status === "cancelled") {
      stopCreatedPolling();
      return;
    }
    await refreshCreated();
  }, 1500);
}

function stopCreatedPolling() {
  if (createdTimer) {
    clearInterval(createdTimer);
    createdTimer = null;
  }
}

async function refreshCreated() {
  if (!createdJob.value?.id) return;
  refreshingCreated.value = true;
  try {
    const [j, l] = await Promise.all([
      api.job(createdJob.value.id),
      api.jobLogs(createdJob.value.id, 400)
    ]);
    createdJob.value = j.job || createdJob.value;
    createdLogs.value = l.logs || [];
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    refreshingCreated.value = false;
  }
}

async function loadTypes() {
  loadingTypes.value = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const r = await api.jobTypes();
    types.value = r.types || [];
    if (!form.value.type) {
      const first = (r.types || []).find(t => t.enabled);
      if (first) form.value.type = first.name;
    }
    lastActionAt.value = new Date().toLocaleTimeString();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loadingTypes.value = false;
  }
}

async function loadProviders() {
  loadingProviders.value = true;
  try {
    const r = await api.runtimeProviders();
    providerInfo.value = r.providers || { codex: null, openai: null };
  } catch {
    providerInfo.value = { codex: null, openai: null };
  } finally {
    loadingProviders.value = false;
  }
}

async function reloadAll() {
  await Promise.all([loadTypes(), loadProviders()]);
}

watch(selectedType, (t) => {
  if (!t) return;
  if (Number.isInteger(t.default_timeout_sec)) form.value.timeout_sec = t.default_timeout_sec;
  if (Number.isInteger(t.default_max_attempts)) form.value.max_attempts = t.default_max_attempts;
  if (isChatType.value) {
    form.value.inputText = "";
    if (!chat.value.prompt) chat.value.prompt = "";
  }
});

async function submit() {
  err.value = "";
  statusMsg.value = "";
  createdJob.value = null;
  createdLogs.value = [];
  stopCreatedPolling();

  if (validationErrors.value.length) {
    err.value = validationErrors.value[0];
    return;
  }

  const payload = {
    type: form.value.type,
    queue: String(form.value.queue || "").trim() || "default",
    input: resolvedInputObject(),
    priority: Number(form.value.priority),
    timeout_sec: Number(form.value.timeout_sec),
    max_attempts: Number(form.value.max_attempts),
    tags: parseTags(form.value.tagsText),
    callback_url: (form.value.callback_url || "").trim() || undefined
  };

  const idempotencyKey = (form.value.idempotencyKey || "").trim() || makeIdempotencyKey();

  submitting.value = true;
  try {
    const r = await api.createJob(payload, { idempotencyKey });
    createdJob.value = r.job || null;
    form.value.idempotencyKey = idempotencyKey;
    statusMsg.value = `Job created successfully${createdJob.value?.id ? ` (${createdJob.value.id})` : ""}.`;
    lastActionAt.value = new Date().toLocaleTimeString();
    await refreshCreated();
    startCreatedPolling();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => {
  await reloadAll();
});

onBeforeUnmount(() => {
  stopCreatedPolling();
});
</script>
