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

      <button class="btn" @click="clearFilters" :disabled="loading || (!status && !type)">Clear filters</button>
      <button class="btn" @click="load" :disabled="loading">{{ loading ? "Refreshing..." : "Refresh" }}</button>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>created</th>
          <th>type</th>
          <th>status</th>
          <th>attempts</th>
          <th>priority</th>
          <th>id</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="j in jobs" :key="j.id">
          <td style="color: var(--muted)">{{ j.created_at }}</td>
          <td>{{ j.type }}</td>
          <td>
            <span class="badge" :class="badgeClass(j.status)">{{ j.status }}</span>
          </td>
          <td>{{ j.attempts }}/{{ j.max_attempts }}</td>
          <td>{{ j.priority }}</td>
          <td>
            <router-link :to="`/jobs/${j.id}`">{{ j.id }}</router-link>
          </td>
        </tr>
        <tr v-if="jobs.length === 0">
          <td colspan="6" style="color: var(--muted)">
            {{ status || type ? "No jobs found with current filters." : "No jobs found." }}
          </td>
        </tr>
      </tbody>
    </table>

    <div style="margin-top: 10px; color: var(--muted); font-size: 13px">
      {{ loading ? "Loading jobs..." : `Loaded ${jobs.length} jobs` }}
    </div>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">
      {{ err }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onBeforeUnmount } from "vue";
import { api } from "../api.js";

const status = ref("");
const type = ref("");
const jobs = ref([]);
const types = ref([]);
const err = ref("");
const loading = ref(false);
let lastLoadId = 0;
let filterTimer = null;

const typeNames = computed(() => types.value.map(t => t.name));

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
        limit: 100
      })
    ]);
    if (loadId !== lastLoadId) return;
    types.value = t.types || [];
    jobs.value = r.jobs || [];
  } catch (e) {
    if (loadId !== lastLoadId) return;
    err.value = e.message || String(e);
  } finally {
    if (loadId === lastLoadId) loading.value = false;
  }
}

function clearFilters() {
  status.value = "";
  type.value = "";
}

watch([status, type], () => {
  if (filterTimer) clearTimeout(filterTimer);
  filterTimer = setTimeout(() => {
    filterTimer = null;
    load();
  }, 180);
});

onMounted(async () => {
  await load();
});

onBeforeUnmount(() => {
  if (filterTimer) clearTimeout(filterTimer);
});
</script>
