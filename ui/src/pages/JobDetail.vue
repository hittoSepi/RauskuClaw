<template>
  <div class="card">
    <div class="row" style="margin-bottom: 10px">
      <div style="font-weight: 700">Job</div>
      <div class="spacer"></div>
      <span class="badge" :class="streamBadgeClass">{{ streamLabel }}</span>
      <button class="btn" @click="load" :disabled="loading">{{ loading ? "Refreshing..." : "Refresh" }}</button>
      <button
        class="btn"
        v-if="job && (job.status==='queued' || job.status==='running')"
        @click="cancel"
        :disabled="cancelling"
      >
        {{ cancelling ? "Cancelling..." : "Cancel" }}
      </button>
    </div>

    <div style="margin-bottom: 10px; color: var(--muted); font-size: 12px">
      {{ loading ? "Loading job data..." : "Idle" }}
      <span v-if="lastLoadedAt"> | last refresh: {{ lastLoadedAt }}</span>
    </div>

    <div v-if="statusMsg" style="margin-bottom: 10px; color: #7ee787; font-size: 13px">
      {{ statusMsg }}
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
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api.js";

const props = defineProps({ id: String });

const job = ref(null);
const logs = ref([]);
const err = ref("");
const statusMsg = ref("");
const auto = ref(true);
const loading = ref(false);
const cancelling = ref(false);
const streamStatus = ref("off");
const lastLoadedAt = ref("");
let stream = null;
let reconnectTimer = null;

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

const streamLabel = computed(() => {
  if (!auto.value) return "stream off";
  if (streamStatus.value === "live") return "stream live";
  if (streamStatus.value === "reconnecting") return "stream reconnecting";
  return "stream idle";
});

const streamBadgeClass = computed(() => {
  if (!auto.value) return "";
  if (streamStatus.value === "live") return "ok";
  if (streamStatus.value === "reconnecting") return "warn";
  return "";
});

async function load() {
  loading.value = true;
  err.value = "";
  statusMsg.value = "";
  try {
    const r = await api.job(props.id);
    job.value = r.job;
    const l = await api.jobLogs(props.id, 500);
    logs.value = (l.logs || []).map(x => ({ ...x, id: x.id ?? null }));
    lastLoadedAt.value = new Date().toLocaleTimeString();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loading.value = false;
  }
}

async function cancel() {
  cancelling.value = true;
  err.value = "";
  statusMsg.value = "";
  try {
    await api.cancelJob(props.id);
    await load();
    statusMsg.value = "Cancel request submitted successfully.";
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    cancelling.value = false;
  }
}

function appendLog(logRow) {
  if (logRow?.id != null && logs.value.some(x => x.id === logRow.id)) return;
  logs.value.push(logRow);
  if (logs.value.length > 2000) logs.value = logs.value.slice(-2000);
}

function currentMaxLogId() {
  let max = 0;
  for (const l of logs.value) {
    if (Number.isInteger(l?.id) && l.id > max) max = l.id;
  }
  return max;
}

function streamUrl() {
  const key = sessionStorage.getItem("openclaw_api_key") || "";
  const qs = new URLSearchParams();
  if (key) qs.set("api_key", key);
  const sinceLogId = currentMaxLogId();
  if (sinceLogId > 0) qs.set("since_log_id", String(sinceLogId));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  return `/v1/jobs/${encodeURIComponent(props.id)}/stream${suffix}`;
}

function scheduleReconnect() {
  if (reconnectTimer || !auto.value) return;
  streamStatus.value = "reconnecting";
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectStream();
  }, 2000);
}

function disconnectStream() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (stream) {
    stream.close();
    stream = null;
  }
}

function connectStream() {
  disconnectStream();
  if (!auto.value) return;

  const es = new EventSource(streamUrl());
  stream = es;
  streamStatus.value = "live";

  es.addEventListener("job_update", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      if (data?.job) job.value = data.job;
      err.value = "";
    } catch {}
  });

  es.addEventListener("log_append", (ev) => {
    try {
      const data = JSON.parse(ev.data || "{}");
      appendLog(data);
      err.value = "";
    } catch {}
  });

  es.addEventListener("end", () => {
    streamStatus.value = "off";
    disconnectStream();
  });

  es.onerror = () => {
    if (stream !== es) return;
    es.close();
    stream = null;
    streamStatus.value = "reconnecting";
    scheduleReconnect();
  };
}

watch(auto, (enabled) => {
  if (enabled) {
    streamStatus.value = "reconnecting";
    connectStream();
  } else {
    streamStatus.value = "off";
    disconnectStream();
  }
});

onMounted(async () => {
  await load();
  connectStream();
});

onBeforeUnmount(disconnectStream);
</script>
