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
      <select v-if="hasQueueAllowlist" class="select" v-model="queueFilter">
        <option value="">all queues</option>
        <option v-for="qName in queueAllowlist" :key="`f-${qName}`" :value="qName">{{ qName }}</option>
      </select>
      <input v-else class="input" v-model.trim="queueFilter" placeholder="queue (default)" style="width: 150px" />
      <button class="btn" @click="loadAll" :disabled="loading">{{ loading ? "Loading..." : "Refresh" }}</button>
    </div>
    <div v-if="queueAllowlistLabel !== 'all'" style="margin-top: 8px; color: var(--muted); font-size: 12px">
      Queue scope: {{ queueAllowlistLabel }} (applied by API key policy)
    </div>

    <div style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border)">
      <div style="font-weight: 700; margin-bottom: 8px">Create schedule</div>
      <div class="row">
        <div style="min-width: 220px; flex: 1">
          <label class="field-label">Type</label>
          <select class="select" v-model="createForm.type" style="width: 100%" :disabled="isReadOnly || creating">
            <option value="">-- select type --</option>
            <option v-for="t in enabledTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
          </select>
        </div>
        <div style="min-width: 170px">
          <label class="field-label">Queue</label>
          <select v-if="hasQueueAllowlist" class="select" v-model="createForm.queue" style="width: 100%" :disabled="isReadOnly || creating">
            <option v-for="qName in queueAllowlist" :key="`c-${qName}`" :value="qName">{{ qName }}</option>
          </select>
          <input v-else class="input" v-model.trim="createForm.queue" placeholder="default" :disabled="isReadOnly || creating" />
        </div>
        <div style="min-width: 170px">
          <label class="field-label">Cadence</label>
          <select class="select" v-model="createForm.cadence" style="width: 100%" :disabled="isReadOnly || creating">
            <option value="interval">interval</option>
            <option value="cron">cron</option>
          </select>
        </div>
        <div v-if="createForm.cadence === 'interval'" style="min-width: 170px">
          <label class="field-label">Interval sec</label>
          <input class="input" type="number" min="5" max="86400" v-model.number="createForm.interval_sec" :disabled="isReadOnly || creating" />
        </div>
        <div v-else style="min-width: 280px; flex: 1">
          <label class="field-label">Cron expression</label>
          <input class="input" v-model="createForm.cron" placeholder="*/15 * * * *" style="width: 100%" :disabled="isReadOnly || creating" />
        </div>
        <div style="min-width: 160px">
          <label class="field-label">Start in sec</label>
          <input class="input" type="number" min="0" max="86400" v-model.number="createForm.start_in_sec" :disabled="isReadOnly || creating" />
        </div>
      </div>
      <div class="row" style="margin-top: 8px">
        <div style="min-width: 220px; flex: 1">
          <label class="field-label">Name (optional)</label>
          <input class="input" v-model="createForm.name" placeholder="nightly report" style="width: 100%" :disabled="isReadOnly || creating" />
        </div>
        <div style="min-width: 130px">
          <label class="field-label">Priority</label>
          <input class="input" type="number" min="0" max="10" v-model.number="createForm.priority" :disabled="isReadOnly || creating" />
        </div>
        <div style="min-width: 130px">
          <label class="field-label">Timeout sec</label>
          <input class="input" type="number" min="1" max="3600" v-model.number="createForm.timeout_sec" :disabled="isReadOnly || creating" />
        </div>
        <div style="min-width: 130px">
          <label class="field-label">Attempts</label>
          <input class="input" type="number" min="1" max="10" v-model.number="createForm.max_attempts" :disabled="isReadOnly || creating" />
        </div>
      </div>
      <div style="margin-top: 8px">
        <label class="field-label">Tags (comma separated)</label>
        <input class="input" v-model="createForm.tagsText" placeholder="m4,recurring" style="width: 100%" :disabled="isReadOnly || creating" />
      </div>
      <div style="margin-top: 8px">
        <label class="field-label">Input JSON</label>
        <textarea
          class="input"
          v-model="createForm.inputText"
          rows="6"
          style="width: 100%; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
          :disabled="isReadOnly || creating"
        ></textarea>
      </div>
      <div class="row" style="margin-top: 8px">
        <button class="btn primary" @click="createSchedule" :disabled="isReadOnly || creating || createValidationErrors.length > 0">
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
          <th>queue</th>
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
          <td style="min-width: 150px">
            <select v-if="hasQueueAllowlist" class="select" v-model="s.queue" :disabled="s.saving || isReadOnly" style="width: 100%">
              <option v-for="qName in queueAllowlist" :key="`r-${s.id}-${qName}`" :value="qName">{{ qName }}</option>
            </select>
            <input v-else class="input" v-model.trim="s.queue" :disabled="s.saving || isReadOnly" placeholder="default" style="width: 100%" />
          </td>
          <td>
            <span class="badge" :class="s.enabled ? 'ok' : 'err'">{{ s.enabled ? "enabled" : "disabled" }}</span>
          </td>
          <td style="min-width: 260px">
            <div class="row" style="gap: 6px; align-items: center">
              <select class="select" v-model="s.cadence" style="width: 100px" :disabled="s.saving || isReadOnly">
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
                :disabled="s.saving || isReadOnly"
                style="width: 120px"
              />
              <input
                v-else
                class="input"
                v-model="s.cron"
                :disabled="s.saving || isReadOnly"
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
              <button class="btn" @click="toggleEnabled(s)" :disabled="s.saving || isReadOnly">
                {{ s.enabled ? "Disable" : "Enable" }}
              </button>
              <button class="btn" @click="runNow(s)" :disabled="s.saving || isReadOnly">Run now</button>
              <button class="btn primary" @click="saveSchedule(s)" :disabled="s.saving || isReadOnly || !isRowValid(s) || !isRowDirty(s)">Save</button>
              <button class="btn" @click="removeSchedule(s)" :disabled="s.saving || isReadOnly">Delete</button>
            </div>
          </td>
        </tr>
        <tr v-if="schedules.length === 0">
          <td colspan="7" style="color: var(--muted)">No schedules found.</td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 8px; color: var(--muted); font-size: 12px">
      {{ loading ? "Loading schedules..." : `Loaded ${schedules.length} schedules` }}
      <span v-if="lastActionAt"> | last action: {{ lastActionAt }}</span>
    </div>

    <div v-if="isReadOnly" style="margin-top: 8px; color: #f59e0b; font-size: 12px">
      Read-only API key active: schedule create/update/delete actions are disabled.
    </div>

    <div v-if="statusMsg" style="margin-top: 10px; color: #7ee787; font-size: 13px">{{ statusMsg }}</div>
    <div v-if="err" style="margin-top: 10px; color: #ff7b72">{{ err }}</div>
  </div>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import { refreshAuthState, useAuthState } from "../auth_state.js";

const schedules = ref([]);
const types = ref([]);
const enabledFilter = ref("");
const typeFilter = ref("");
const queueFilter = ref("");
const loading = ref(false);
const creating = ref(false);
const err = ref("");
const statusMsg = ref("");
const lastActionAt = ref("");
const { isReadOnly, queueAllowlist } = useAuthState();

const createForm = ref({
  name: "",
  type: "",
  queue: "default",
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
const hasQueueAllowlist = computed(() => Array.isArray(queueAllowlist.value) && queueAllowlist.value.length > 0);
const queueAllowlistLabel = computed(() => {
  if (!hasQueueAllowlist.value) return "all";
  return queueAllowlist.value.join(",");
});

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
  const queue = String(s.queue || "default").trim() || "default";
  return {
    ...s,
    queue,
    cadence,
    interval_sec: cadence === "interval" ? intervalSec : 60,
    cron: cronExpr,
    saving: false,
    _orig: {
      queue,
      enabled: !!s.enabled,
      cadence,
      interval_sec: cadence === "interval" ? intervalSec : null,
      cron: cadence === "cron" ? cronExpr : ""
    }
  };
}

function isRowValid(s) {
  const queue = String(s.queue || "").trim() || "default";
  if (!/^[a-z0-9._:-]{1,80}$/i.test(queue)) return false;
  if (hasQueueAllowlist.value && !queueAllowlist.value.includes(queue)) return false;
  if (s.cadence === "cron") return String(s.cron || "").trim().length > 0;
  const intervalSec = Number(s.interval_sec);
  return Number.isInteger(intervalSec) && intervalSec >= 5 && intervalSec <= 86400;
}

function isRowDirty(s) {
  if (String(s.queue || "default").trim() !== String(s._orig.queue || "default").trim()) return true;
  if (s.cadence !== s._orig.cadence) return true;
  if (s.cadence === "cron") {
    return String(s.cron || "").trim() !== String(s._orig.cron || "").trim();
  }
  return Number(s.interval_sec) !== Number(s._orig.interval_sec);
}

const createValidationErrors = computed(() => {
  const out = [];
  if (!String(createForm.value.type || "").trim()) out.push("Type is required.");
  const queue = String(createForm.value.queue || "").trim() || "default";
  if (!/^[a-z0-9._:-]{1,80}$/i.test(queue)) out.push("Queue must match ^[a-z0-9._:-]{1,80}$.");
  if (hasQueueAllowlist.value && !queueAllowlist.value.includes(queue)) {
    out.push(`Queue '${queue}' is not allowed. Allowed queues: ${queueAllowlist.value.join(", ")}.`);
  }
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

function setAllowedQueueError(e, fallbackMessage) {
  const allowedQueues = Array.isArray(e?.data?.error?.details?.allowed_queues)
    ? e.data.error.details.allowed_queues
    : null;
  if (e?.status === 403 && allowedQueues && allowedQueues.length > 0) {
    err.value = `${fallbackMessage} Allowed queues: ${allowedQueues.join(", ")}.`;
    return true;
  }
  return false;
}

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
        queue: queueFilter.value || undefined,
        limit: 200
      })
    ]);
    types.value = typesResp.types || [];
    schedules.value = (schedulesResp.schedules || []).map(withOriginal);
    lastActionAt.value = nowTime();
  } catch (e) {
    if (!setAllowedQueueError(e, "Queue filter is not allowed for this API key.")) {
      err.value = e.message || String(e);
    }
  } finally {
    loading.value = false;
  }
}

async function createSchedule() {
  if (isReadOnly.value || createValidationErrors.value.length > 0) return;
  creating.value = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const parsed = parseJsonSafe(createForm.value.inputText);
    const payload = {
      name: String(createForm.value.name || "").trim() || undefined,
      type: String(createForm.value.type || "").trim(),
      queue: String(createForm.value.queue || "").trim() || "default",
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
    if (!setAllowedQueueError(e, "Schedule create blocked by queue policy.")) {
      err.value = e.message || String(e);
    }
  } finally {
    creating.value = false;
  }
}

async function saveSchedule(s) {
  if (isReadOnly.value || !isRowValid(s)) return;
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const payload = {
      queue: String(s.queue || "").trim() || "default",
      ...(s.cadence === "cron"
        ? { cron: String(s.cron || "").trim() }
        : { interval_sec: Number(s.interval_sec) })
    };
    await api.updateSchedule(s.id, payload);
    statusMsg.value = `Saved schedule ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    if (!setAllowedQueueError(e, "Schedule update blocked by queue policy.")) {
      err.value = e.message || String(e);
    }
  } finally {
    s.saving = false;
  }
}

async function toggleEnabled(s) {
  if (isReadOnly.value) return;
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    await api.updateSchedule(s.id, { enabled: !s.enabled });
    statusMsg.value = `${!s.enabled ? "Enabled" : "Disabled"} schedule ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    if (!setAllowedQueueError(e, "Schedule update blocked by queue policy.")) {
      err.value = e.message || String(e);
    }
  } finally {
    s.saving = false;
  }
}

async function runNow(s) {
  if (isReadOnly.value) return;
  s.saving = true;
  err.value = "";
  statusMsg.value = "";
  try {
    await api.updateSchedule(s.id, { run_now: true });
    statusMsg.value = `Triggered run-now for ${s.id}`;
    lastActionAt.value = nowTime();
    await loadAll();
  } catch (e) {
    if (!setAllowedQueueError(e, "Schedule run-now blocked by queue policy.")) {
      err.value = e.message || String(e);
    }
  } finally {
    s.saving = false;
  }
}

async function removeSchedule(s) {
  if (isReadOnly.value) return;
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
    if (!setAllowedQueueError(e, "Schedule delete blocked by queue policy.")) {
      err.value = e.message || String(e);
    }
  } finally {
    s.saving = false;
  }
}

watch([enabledFilter, typeFilter, queueFilter], () => {
  loadAll();
});

watch(
  () => queueAllowlist.value,
  (list) => {
    if (!Array.isArray(list) || list.length < 1) return;
    const currentCreateQueue = String(createForm.value.queue || "").trim() || "default";
    if (!list.includes(currentCreateQueue)) createForm.value.queue = list[0];
    if (queueFilter.value && !list.includes(queueFilter.value)) queueFilter.value = "";
  },
  { immediate: true }
);

onMounted(async () => {
  await refreshAuthState();
  await loadAll();
});
</script>
