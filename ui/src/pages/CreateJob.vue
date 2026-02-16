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
      <button class="btn primary" @click="submit" :disabled="submitting">
        {{ submitting ? "Creating..." : "Create job" }}
      </button>
      <span style="color: var(--muted); font-size: 13px">Creates with `/v1/jobs`</span>
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
const createdJob = ref(null);

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

async function loadTypes() {
  loadingTypes.value = true;
  err.value = "";
  try {
    const r = await api.jobTypes();
    types.value = r.types || [];
    if (!form.value.type) {
      const first = (r.types || []).find(t => t.enabled);
      if (first) form.value.type = first.name;
    }
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loadingTypes.value = false;
  }
}

function parseInputJson(text) {
  const raw = (text || "").trim();
  if (!raw) return null;
  return JSON.parse(raw);
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
  createdJob.value = null;

  if (!form.value.type) {
    err.value = "Please select a job type";
    return;
  }

  let input;
  try {
    input = parseInputJson(form.value.inputText);
  } catch {
    err.value = "Input JSON is invalid";
    return;
  }

  const payload = {
    type: form.value.type,
    input,
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
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    submitting.value = false;
  }
}

onMounted(loadTypes);
</script>
