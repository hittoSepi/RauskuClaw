<template>
  <div class="card">
    <div class="row">
      <div style="font-weight: 700">Jobs</div>
      <div class="spacer"></div>

      <select class="select" v-model="status">
        <option value="">all statuses</option>
        <option>queued</option>
        <option>running</option>
        <option>succeeded</option>
        <option>failed</option>
        <option>cancelled</option>
      </select>

      <select class="select" v-model="type">
        <option value="">all types</option>
        <option v-for="t in typeNames" :key="t" :value="t">{{ t }}</option>
      </select>

      <select
        v-if="hasQueueAllowlist"
        class="select"
        v-model="queue"
        style="width: 170px"
      >
        <option value="">all queues</option>
        <option v-for="qName in queueAllowlist" :key="qName" :value="qName">{{ qName }}</option>
      </select>
      <input
        v-else
        class="input"
        v-model.trim="queue"
        placeholder="queue (default)"
        style="width: 170px"
      />

      <input
        class="input"
        v-model.trim="q"
        placeholder="search job id or type"
        style="min-width: 220px"
      />

      <label style="color: var(--muted); font-size: 13px">
        auto refresh
        <input type="checkbox" v-model="autoRefresh" />
      </label>

      <button class="btn" @click="clearFilters" :disabled="loading || (!status && !type && !queue)">Clear filters</button>
      <button class="btn" @click="load" :disabled="loading">{{ loading ? "Refreshing..." : "Refresh" }}</button>
    </div>
    <div v-if="queueAllowlistLabel !== 'all'" style="margin-bottom: 10px; color: var(--muted); font-size: 12px">
      Queue scope: {{ queueAllowlistLabel }} (applied by API key policy)
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>created</th>
          <th>type</th>
          <th>status</th>
          <th>queue</th>
          <th>attempts</th>
          <th>priority</th>
          <th>id</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="j in visibleJobs" :key="j.id">
          <td style="color: var(--muted)">{{ j.created_at }}</td>
          <td>{{ j.type }}</td>
          <td>
            <span class="badge" :class="badgeClass(j.status)">{{ j.status }}</span>
          </td>
          <td>{{ j.queue || "default" }}</td>
          <td>{{ j.attempts }}/{{ j.max_attempts }}</td>
          <td>{{ j.priority }}</td>
          <td>
            <router-link :to="`/settings/jobs/${j.id}`">{{ j.id }}</router-link>
          </td>
        </tr>
        <tr v-if="visibleJobs.length === 0">
          <td colspan="7" style="color: var(--muted)">
            {{ status || type || queue || q ? "No jobs found with current filters/search." : "No jobs found." }}
          </td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 10px; color: var(--muted); font-size: 13px">
      {{ loading ? "Loading jobs..." : `Loaded ${jobs.length} jobs` }}
      <span v-if="visibleJobs.length !== jobs.length"> | showing {{ visibleJobs.length }}</span>
      <span v-if="lastLoadedAt"> | last refresh: {{ lastLoadedAt }}</span>
    </div>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">
      {{ err }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api.js";
import { refreshAuthState, useAuthState } from "../auth_state.js";

const status = ref("");
const type = ref("");
const queue = ref("");
const q = ref("");
const autoRefresh = ref(false);
const jobs = ref([]);
const types = ref([]);
const err = ref("");
const loading = ref(false);
const lastLoadedAt = ref("");
const { queueAllowlist } = useAuthState();
let lastLoadId = 0;
let filterTimer = null;
let autoTimer = null;

const typeNames = computed(() => types.value.map(t => t.name));
const queueAllowlistLabel = computed(() => {
  if (!Array.isArray(queueAllowlist.value) || queueAllowlist.value.length < 1) return "all";
  return queueAllowlist.value.join(",");
});
const hasQueueAllowlist = computed(() => Array.isArray(queueAllowlist.value) && queueAllowlist.value.length > 0);
const visibleJobs = computed(() => {
  const needle = q.value.trim().toLowerCase();
  if (!needle) return jobs.value;
  return jobs.value.filter((j) =>
    String(j.id || "").toLowerCase().includes(needle) ||
    String(j.type || "").toLowerCase().includes(needle)
  );
});

function badgeClass(s) {
  if (s === "succeeded") return "ok";
  if (s === "failed") return "err";
  if (s === "running") return "warn";
  return "";
}

async function load() {
  const loadId = ++lastLoadId;
  loading.value = true;
  err.value = "";
  try {
    const [t, r] = await Promise.all([
      api.jobTypes(),
      api.jobs({
        status: status.value || undefined,
        type: type.value || undefined,
        queue: queue.value || undefined,
        limit: 100
      })
    ]);
    if (loadId !== lastLoadId) return;
    types.value = t.types || [];
    jobs.value = r.jobs || [];
    lastLoadedAt.value = new Date().toLocaleTimeString();
  } catch (e) {
    if (loadId !== lastLoadId) return;
    const allowedQueues = Array.isArray(e?.data?.error?.details?.allowed_queues)
      ? e.data.error.details.allowed_queues
      : null;
    if (e?.status === 403 && allowedQueues && allowedQueues.length > 0) {
      err.value = `Queue '${queue.value || "(all)"}' is not allowed for this API key. Allowed queues: ${allowedQueues.join(", ")}.`;
    } else {
      err.value = e.message || String(e);
    }
  } finally {
    if (loadId === lastLoadId) loading.value = false;
  }
}

function clearFilters() {
  status.value = "";
  type.value = "";
  queue.value = "";
}

watch([status, type, queue], () => {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    filterTimer = null;
    load();
  }, 180);
});

watch(autoRefresh, (enabled) => {
  if (autoTimer) {
    clearInterval(autoTimer);
    autoTimer = null;
  }
  if (enabled) {
    autoTimer = setInterval(() => {
      load();
    }, 5000);
  }
});

onMounted(async () => {
  await refreshAuthState();
  await load();
});

watch(
  () => queueAllowlist.value,
  (list) => {
    if (!Array.isArray(list) || list.length < 1) return;
    if (queue.value && !list.includes(queue.value)) queue.value = "";
  },
  { immediate: true }
);

onBeforeUnmount(() => {
  if (filterTimer) clearTimeout(filterTimer);
  if (autoTimer) clearInterval(autoTimer);
});
</script>
