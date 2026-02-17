<template>
  <div class="card">
    <div class="row">
      <div style="font-weight: 700">Schedules</div>
      <div class="spacer"></div>
      <select class="select" v-model="enabledFilter">
        <option value="">all</option>
        <option value="1">enabled</option>
        <option value="0">disabled</option>
      </select>
      <select class="select" v-model="typeFilter">
        <option value="">all types</option>
        <option v-for="t in enabledTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
      </select>
      <button class="btn" @click="loadAll" :disabled="loading">{{ loading ? "Loading..." : "Refresh" }}</button>
    </div>

    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border)">
      <div style="font-weight: 700; margin-bottom: 8px">Create schedule</div>
      <div class="row">
        <div style="min-width: 220px; flex: 1">
          <label class="field-label">Type</label>
          <select class="select" v-model="createForm.type" style="width: 100%">
            <option value="">-- select type --</option>
            <option v-for="t in enabledTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <div style="min-width: 170px">
          <label class="field-label">Cadence</label>
          <select class="select" v-model="createForm.cadence" style="width: 100%">
            <option value="interval">interval</option>
            <option value="cron">cron</option>
          </select>
        </div>
        <div v-if="createForm.cadence === 'interval'" style="min-width: 170px">
          <label class="field-label">Interval sec</label>
          <input class="input" type="number" min="5" max="86400" v-model.number="createForm.interval_sec" />
        </div>
        <div v-else style="min-width: 280px; flex: 1">
          <label class="field-label">Cron expression</label>
          <input class="input" v-model="createForm.cron" placeholder="*/15 * * * *" style="width: 100%" />
        </div>
        <div style="min-width: 160px">
          <label class="field-label">Start in sec</label>
          <input class="input" type="number" min="0" max="86400" v-model.number="createForm.start_in_sec" />
        </div>
      </div>
      <div class="row" style="margin-top: 8px">
        <div style="min-width: 220px; flex: 1">
          <label class="field-label">Name (optional)</label>
          <input class="input" v-model="createForm.name" placeholder="nightly report" style="width: 100%" />
        </div>
        <div style="min-width: 130px">
          <label class="field-label">Priority</label>
          <input class="input" type="number" min="0" max="10" v-model.number="createForm.priority" />
        </div>
        <div style="min-width: 130px">
          <label class="field-label">Timeout sec</label>
          <input class="input" type="number" min="1" max="3600" v-model.number="createForm.timeout_sec" />
        </div>
        <div style="min-width: 130px">
          <label class="field-label">Attempts</label>
          <input class="input" type="number" min="1" max="10" v-model.number="createForm.max_attempts" />
        </div>
      </div>
      <div style="margin-top: 8px">
        <label class="field-label">Tags (comma separated)</label>
        <input class="input" v-model="createForm.tagsText" placeholder="m4,recurring" style="width: 100%" />
      </div>
      <div style="margin-top: 8px">
        <label class="field-label">Input JSON</label>
        <textarea
          class="input"
          v-model="createForm.inputText"
          rows="6"
          style="width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
        ></textarea>
      </div>
      <div class="row" style="margin-top: 8px">
        <button class="btn primary" @click="createSchedule" :disabled="creating || createValidationErrors.length > 0">
          {{ creating ? "Creating..." : "Create schedule" }}
        </button>
        <span style="color: var(--muted); font-size: 12px">Recurring dispatch via worker scheduler loop.</span>
      </div>
      <div v-if="createValidationErrors.length" style="margin-top: 8px; color: #ff7b72; font-size: 13px">
        <div v-for="(msg, i) in createValidationErrors" :key="`ve-${i}`">- {{ msg }}</div>
      </div>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>name / type</th>
          <th>enabled</th>
          <th>cadence</th>
          <th>next run</th>
          <th>last job</th>
          <th>actions</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="s in schedules" :key="s.id">
          <td>
            <div>{{ s.name || "(no name)" }}</div>
            <div style="color: var(--muted); font-size: 12px">{{ s.type }}</div>
            <div style="color: var(--muted); font-size: 12px">{{ s.id }}</div>
          </td>
          <td>
            <span class="badge" :class="s.enabled ? 'ok' : 'err'">{{ s.enabled ? "enabled" : "disabled" }}</span>
          </td>
          <td style="min-width: 260px">
            <div class="row" style="gap: 6px; align-items: center">
              <select class="select" v-model="s.cadence" style="width: 100px">
                <option value="interval">interval</option>
                <option value="cron">cron</option>
              </select>
              <input
                v-if="s.cadence === 'interval'"
                class="input"
                type="number"
                min="5"
                max="86400"
                v-model.number="s.interval_sec"
                style="width: 120px"
              />
              <input
                v-else
                class="input"
                v-model="s.cron"
                placeholder="*/15 * * * *"
                style="min-width: 140px; flex: 1"
              />
            </div>
          </td>
          <td>
            <div>{{ s.next_run_at }}</div>
            <div v-if="s.last_run_at" style="color: var(--muted); font-size: 12px">last {{ s.last_run_at }}</div>
          </td>
          <td>
            <router-link v-if="s.last_job_id" :to="`/settings/jobs/${s.last_job_id}`">{{ s.last_job_id }}</router-link>
            <span v-else style="color: var(--muted)">none</span>
            <div v-if="s.last_error" style="margin-top: 6px; color: #ff7b72; font-size: 12px">
              {{ s.last_error.code || "SCHEDULE_ERROR" }}: {{ s.last_error.message || "error" }}
            </div>
          </td>
          <td>
            <div class="row" style="gap: 6px">
              <button class="btn" @click="toggleEnabled(s)" :disabled="s.saving">
                {{ s.enabled ? "Disable" : "Enable" }}
              </button>
              <button class="btn" @click="runNow(s)" :disabled="s.saving">Run now</button>
              <button class="btn primary" @click="saveSchedule(s)" :disabled="s.saving || !isRowValid(s) || !isRowDirty(s)">Save</button>
              <button class="btn" @click="removeSchedule(s)" :disabled="s.saving">Delete</button>
            </div>
          </td>
        </tr>
        <tr v-if="schedules.length === 0">
          <td colspan="6" style="color: var(--muted)">No schedules found.</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 8px; color: var(--muted); font-size: 12px">
      {{ loading ? "Loading schedules..." : `Loaded ${schedules.length} schedules` }}
      <span v-if="lastActionAt"> | last action: {{ lastActionAt }}</span>
    </div>

    <div v-if="statusMsg" style="margin-top: 10px; color: #7ee787; font-size: 13px">{{ statusMsg }}</div>
    <div v-if="err" style="margin-top: 10px; color: #ff7b72">{{ err }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";

const schedules = ref([]);
const types = ref([]);
const enabledFilter = ref("");
const typeFilter = ref("");
const loading = ref(false);
const creating = ref(false);
const err = ref("");
const statusMsg = ref("");
const lastActionAt = ref("");

const createForm = ref({
  name: "",
  type: "",
  cadence: "interval",
  interval_sec: 60,
  cron: "",
  start_in_sec: 0,
  priority: 5,
  timeout_sec: 120,
  max_attempts: 1,
  tagsText: "",
  inputText: '{\n  "report": "weekly"\n}'
});

const enabledTypes = computed(() => (types.value || []).filter((t) => t.enabled));

function nowTime() {
  return new Date().toLocaleTimeString();
}

function parseJsonSafe(text) {
  const raw = String(text || "").trim();
  if (!raw) return { ok: true, value: null };
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch {
    return { ok: false, error: "Input JSON is invalid." };
  }
}

function parseTags(tagsText) {
  return String(tagsText || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function inferCadence(s) {
  return String(s?.cron || "").trim() ? "cron" : "interval";
}

function withOriginal(s) {
  const cadence = inferCadence(s);
  const intervalSec = Number.isInteger(Number(s.interval_sec)) ? Number(s.interval_sec) : 60;
  const cronExpr = String(s.cron || "").trim();
  return {
    ...s,
    cadence,
    interval_sec: cadence === "interval" ? intervalSec : 60,
    cron: cronExpr,
    saving: false,
    _orig: {
      enabled: !!s.enabled,
      cadence,
      interval_sec: cadence === "interval" ? intervalSec : null,
      cron: cadence === "cron" ? cronExpr : ""
    }
  };
}

function isRowValid(s) {
  if (s.cadence === "cron") return String(s.cron || "").trim().length > 0;
  const intervalSec = Number(s.interval_sec);
  return Number.isInteger(intervalSec) && intervalSec >= 5 && intervalSec <= 86400;
}

function isRowDirty(s) {
  if (s.cadence !== s._orig.cadence) return true;
  if (s.cadence === "cron") {
    return String(s.cron || "").trim() !== String(s._orig.cron || "").trim();
  }
  return Number(s.interval_sec) !== Number(s._orig.interval_sec);
}

const createValidationErrors = computed(() => {
  const out = [];
  if (!String(createForm.value.type || "").trim()) out.push("Type is required.");
  if (createForm.value.cadence !== "interval" && createForm.value.cadence !== "cron") {
    out.push("Cadence must be interval or cron.");
  }
  if (createForm.value.cadence === "interval") {
    const intervalSec = Number(createForm.value.interval_sec);
    if (!Number.isInteger(intervalSec) || intervalSec < 5 || intervalSec > 86400) {
      out.push("Interval must be an integer between 5 and 86400.");
    }
  } else if (!String(createForm.value.cron || "").trim()) {
    out.push("Cron expression is required.");
  }
  const startInSec = Number(createForm.value.start_in_sec);
  if (!Number.isInteger(startInSec) || startInSec < 0 || startInSec > 86400) {
    out.push("Start in must be an integer between 0 and 86400.");
  }
  const parsed = parseJsonSafe(createForm.value.inputText);
  if (!parsed.ok) out.push(parsed.error);
  return out;
});

async function loadAll() {
  loading.value = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const [typesResp, schedulesResp] = await Promise.all([
      api.jobTypes(),
      api.schedules({
        enabled: enabledFilter.value || undefined,
        type: typeFilter.value || undefined,
        limit: 200
      })
    ]);
    types.value = typesResp.types || [];
    schedules.value = (schedulesResp.schedules || []).map(withOriginal);
    lastActionAt.value = nowTime();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function createSchedule() {
  if (createValidationErrors.value.length > 0) return;
  creating.value = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const parsed = parseJsonSafe(createForm.value.inputText);
    const payload = {
      name: String(createForm.value.name || "").trim() || undefined,
      type: String(createForm.value.type || "").trim(),
      start_in_sec: Number(createForm.value.start_in_sec),
      priority: Number(createForm.value.priority),
      timeout_sec: Number(createForm.value.timeout_sec),
      max_attempts: Number(createForm.value.max_attempts),
      tags: parseTags(createForm.value.tagsText),
      input: parsed.value
    };
    if (createForm.value.cadence === "cron") {
      payload.cron = String(createForm.value.cron || "").trim();
    } else {
      payload.interval_sec = Number(createForm.value.interval_sec);
    }
    const r = await api.createSchedule(payload);
    statusMsg.value = `Created schedule ${r.schedule?.id || ""}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    creating.value = false;
  }
}

async function saveSchedule(s) {
  if (!isRowValid(s)) return;
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const payload = s.cadence === "cron"
      ? { cron: String(s.cron || "").trim() }
      : { interval_sec: Number(s.interval_sec) };
    await api.updateSchedule(s.id, payload);
    statusMsg.value = `Saved schedule ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    s.saving = false;
  }
}

async function toggleEnabled(s) {
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    await api.updateSchedule(s.id, { enabled: !s.enabled });
    statusMsg.value = `${!s.enabled ? "Enabled" : "Disabled"} schedule ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    s.saving = false;
  }
}

async function runNow(s) {
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    await api.updateSchedule(s.id, { run_now: true });
    statusMsg.value = `Triggered run-now for ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    s.saving = false;
  }
}

async function removeSchedule(s) {
  if (!confirm(`Delete schedule ${s.id}?`)) return;
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    await api.deleteSchedule(s.id);
    statusMsg.value = `Deleted schedule ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    s.saving = false;
  }
}

watch([enabledFilter, typeFilter], () => {
  loadAll();
});

onMounted(loadAll);
</script>
