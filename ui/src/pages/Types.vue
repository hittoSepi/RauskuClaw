<template>
  <div class="card">
    <div class="row">
      <div style="font-weight: 700">Job types</div>
      <div class="spacer"></div>
      <button class="btn" @click="load">Refresh</button>
    </div>

    <table class="table">
      <thead>
        <tr>
          <th>name</th>
          <th>enabled</th>
          <th>handler</th>
          <th>default timeout</th>
          <th>default attempts</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="t in types" :key="t.name">
          <td>{{ t.name }}</td>
          <td>
            <span class="badge" :class="t.enabled ? 'ok' : 'err'">{{ t.enabled }}</span>
          </td>
          <td style="color: var(--muted)">{{ t.handler }}</td>
          <td>{{ t.default_timeout_sec }}s</td>
          <td>{{ t.default_max_attempts }}</td>
        </tr>
      </tbody>
    </table>

    <div v-if="err" style="margin-top: 12px; color: #ff7b72">
      {{ err }}
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from "vue";
import { api } from "../api.js";

const types = ref([]);
const err = ref("");

async function load() {
  err.value = "";
  try {
    const r = await api.jobTypes();
    types.value = r.types || [];
  } catch (e) {
    err.value = e.message || String(e);
  }
}

onMounted(load);
</script>
