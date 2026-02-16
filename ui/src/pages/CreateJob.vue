<template>
  <div class="card">
    <div class="row" style="margin-bottom: 10px">
      <div style="font-weight: 700">Create Job</div>
      <div class="spacer"></div>
      <button class="btn" @click="loadTypes" :disabled="loadingTypes">
        {{ loadingTypes ? "Loading..." : "Reload types" }}
      </button>
    </div>

    <div class="row" style="align-items: flex-start">
      <div style="flex: 1; min-width: 280px">
        <label class="field-label">Type</label>
        <select class="select" v-model="form.type" style="width: 100%">
          <option value="">-- select type --</option>
          <option v-for="t in enabledTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
        </select>
      </div>

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
      <input class="input" v-model="form.callback_url" placeholder="https://example.com/hooks/openclaw" style="width: 100%" />
    </div>

    <div style="margin-top: 10px">
      <label class="field-label">Idempotency-Key (optional)</label>
      <input class="input" v-model="form.idempotencyKey" placeholder="leave empty for random" style="width: 100%" />
    </div>

    <div style="margin-top: 10px">
      <label class="field-label">Input JSON</label>
      <textarea
        class="input"
        v-model="form.inputText"
        rows="12"
        style="width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
      ></textarea>
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
      <div style="font-weight: 700; margin-bottom: 6px">Created</div>
      <pre>{{ JSON.stringify(createdJob, null, 2) }}</pre>
      <div style="margin-top: 8px">
        <router-link :to="`/jobs/${createdJob.id}`">Open job detail</router-link>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { api } from "../api.js";

const types = ref([]);
const loadingTypes = ref(false);
const submitting = ref(false);
const err = ref("");
const statusMsg = ref("");
const createdJob = ref(null);
const lastActionAt = ref("");

const form = ref({
  type: "",
  priority: 5,
  timeout_sec: 120,
  max_attempts: 1,
  tagsText: "",
  callback_url: "",
  idempotencyKey: "",
  inputText: '{\n  "report": "weekly"\n}'
});

const enabledTypes = computed(() => (types.value || []).filter(t => t.enabled));

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

const validationErrors = computed(() => {
  const out = [];
  const p = Number(form.value.priority);
  const t = Number(form.value.timeout_sec);
  const a = Number(form.value.max_attempts);
  const callback = (form.value.callback_url || "").trim();

  if (!form.value.type) out.push("Job type is required.");
  if (!Number.isInteger(p) || p < 0 || p > 10) out.push("Priority must be an integer between 0 and 10.");
  if (!Number.isInteger(t) || t < 1 || t > 3600) out.push("Timeout must be an integer between 1 and 3600.");
  if (!Number.isInteger(a) || a < 1 || a > 10) out.push("Max attempts must be an integer between 1 and 10.");
  if (!isValidHttpUrl(callback)) out.push("Callback URL must start with http:// or https://");

  const parsed = parseInputJsonSafe(form.value.inputText);
  if (!parsed.ok) out.push(parsed.error);

  return out;
});

const canSubmit = computed(() => validationErrors.value.length === 0 && !loadingTypes.value);

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

async function submit() {
  err.value = "";
  statusMsg.value = "";
  createdJob.value = null;

  if (validationErrors.value.length) {
    err.value = validationErrors.value[0];
    return;
  }

  const parsedInput = parseInputJsonSafe(form.value.inputText);
  if (!parsedInput.ok) {
    err.value = parsedInput.error;
    return;
  }

  const payload = {
    type: form.value.type,
    input: parsedInput.value,
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
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    submitting.value = false;
  }
}

onMounted(loadTypes);
</script>
