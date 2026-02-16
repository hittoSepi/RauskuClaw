<template>
  <div class="card">
    <div class="row" style="margin-bottom: 10px">
      <div style="font-weight: 700">Job</div>
      <div class="spacer"></div>
      <button class="btn" @click="load">Refresh</button>
      <button class="btn" v-if="job && (job.status==='queued' || job.status==='running')" @click="cancel">
        Cancel
      </button>
    </div>

    <div v-if="job">
      <div class="row" style="margin-bottom: 10px">
        <span class="badge">{{ job.type }}</span>
        <span class="badge" :class="badgeClass(job.status)">{{ job.status }}</span>
        <span class="badge">attempts {{ job.attempts }}/{{ job.max_attempts }}</span>
        <span class="badge">priority {{ job.priority }}</span>
        <span class="badge">timeout {{ job.timeout_sec }}s</span>
      </div>

      <div style="color: var(--muted); font-size: 13px; margin-bottom: 10px">
        {{ job.id }}
      </div>

      <div class="row" style="align-items:flex-start">
        <div style="flex:1; min-width: 320px">
          <div style="font-weight: 700; margin-bottom: 6px">Input</div>
          <pre>{{ pretty(job.input) }}</pre>
        </div>

        <div style="flex:1; min-width: 320px">
          <div style="font-weight: 700; margin-bottom: 6px">Result</div>
          <pre>{{ pretty(job.result) }}</pre>
        </div>
      </div>

      <div style="margin-top: 12px" v-if="job.error">
        <div style="font-weight: 700; margin-bottom: 6px; color:#ff7b72">Error</div>
        <pre>{{ pretty(job.error) }}</pre>
      </div>

      <div style="margin-top: 14px">
        <div class="row">
          <div style="font-weight: 700">Logs</div>
          <div class="spacer"></div>
          <label style="color: var(--muted); font-size: 13px">
            auto refresh
            <input type="checkbox" v-model="auto" />
          </label>
        </div>
        <pre style="margin-top: 8px">{{ logsText }}</pre>
      </div>
    </div>

    <div v-else style="color: var(--muted)">Loading...</div>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">
      {{ err }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api.js";

const props = defineProps({ id: String });

const job = ref(null);
const logs = ref([]);
const err = ref("");
const auto = ref(true);
let timer = null;

function badgeClass(s) {
  if (s === "succeeded") return "ok";
  if (s === "failed") return "err";
  if (s === "running") return "warn";
  return "";
}

function pretty(x) {
  return JSON.stringify(x ?? null, null, 2);
}

const logsText = computed(() =>
  (logs.value || [])
    .map(l => `${l.ts} [${l.level}] ${l.message}${l.meta ? " " + JSON.stringify(l.meta) : ""}`)
    .join("\n")
);

async function load() {
  err.value = "";
  try {
    const r = await api.job(props.id);
    job.value = r.job;
    const l = await api.jobLogs(props.id, 500);
    logs.value = l.logs || [];
  } catch (e) {
    err.value = e.message || String(e);
  }
}

async function cancel() {
  try {
    await api.cancelJob(props.id);
    await load();
  } catch (e) {
    err.value = e.message || String(e);
  }
}

function start() {
  stop();
  timer = setInterval(() => {
    if (auto.value) load();
  }, 1500);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

onMounted(() => { load(); start(); });
onBeforeUnmount(stop);
</script>
