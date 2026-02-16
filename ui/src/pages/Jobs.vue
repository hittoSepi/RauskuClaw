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

      <button class="btn" @click="load">Refresh</button>
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
          <td colspan="6" style="color: var(--muted)">No jobs found.</td>
        </tr>
      </tbody>
    </table>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">
      {{ err }}
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from "vue";
import { api } from "../api.js";

const status = ref("");
const type = ref("");
const jobs = ref([]);
const types = ref([]);
const err = ref("");

const typeNames = computed(() => types.value.map(t => t.name));

function badgeClass(s) {
  if (s === "succeeded") return "ok";
  if (s === "failed") return "err";
  if (s === "running") return "warn";
  return "";
}

async function load() {
  err.value = "";
  try {
    const t = await api.jobTypes();
    types.value = t.types || [];
    const r = await api.jobs({
      status: status.value || undefined,
      type: type.value || undefined,
      limit: 100
    });
    jobs.value = r.jobs || [];
  } catch (e) {
    err.value = e.message || String(e);
  }
}

onMounted(load);
</script>
