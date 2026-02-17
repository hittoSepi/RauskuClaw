<template>
  <div class="card chat-card">
    <div class="chat-grid" :class="{ 'workspace-wide': workspaceWide }">
      <section class="chat-column">
        <div class="row" style="margin-bottom: 10px">
          <div style="font-weight: 700">Agent Chat</div>
          <div class="spacer"></div>
          <button v-if="isDevMode" class="btn" @click="reloadTypes" :disabled="loadingTypes">{{ loadingTypes ? "Loading..." : "Reload" }}</button>
          <button class="btn" @click="clearChat" :disabled="sending">Clear</button>
        </div>

        <div v-if="isDevMode" class="row" style="margin-bottom: 10px; align-items: flex-end">
          <div style="min-width: 280px; flex: 1">
            <label class="field-label">Chat type</label>
            <select class="select" v-model="selectedType" style="width: 100%">
              <option value="">-- select chat type --</option>
              <option v-for="t in chatTypes" :key="t.name" :value="t.name">{{ t.name }}</option>
            </select>
          </div>
          <label class="row" style="margin: 0 0 4px 0; gap: 6px">
            <input type="checkbox" v-model="plannerMode" :disabled="sending || creatingJobs" />
            <span style="color: var(--muted); font-size: 13px">Planner phase (split to subjobs first)</span>
          </label>
          <label class="row" style="margin: 0 0 4px 0; gap: 6px">
            <input type="checkbox" v-model="autoCreateJobs" :disabled="sending || creatingJobs" />
            <span style="color: var(--muted); font-size: 13px">Auto-run safe suggested jobs</span>
          </label>
        </div>

        <div v-if="isDevMode && selectedTypeInfo" class="row" style="margin-bottom: 10px">
          <span class="badge">handler {{ selectedTypeInfo.handler }}</span>
          <span class="badge">timeout {{ selectedTimeoutSec }}s</span>
          <span class="badge">attempts {{ selectedMaxAttempts }}</span>
        </div>

        <div v-if="isDevMode" class="memory-panel">
          <div class="row" style="align-items: center; margin-bottom: 6px">
            <label class="row" style="margin: 0; gap: 6px">
              <input type="checkbox" v-model="memory.enabled" :disabled="sending" />
              <span>Use memory context</span>
            </label>
            <div class="spacer"></div>
            <label class="row" style="margin: 0; gap: 6px">
              <input type="checkbox" v-model="memory.required" :disabled="!memory.enabled || sending" />
              <span style="color: var(--muted); font-size: 13px">Required (fail if unavailable)</span>
            </label>
          </div>
          <div class="row memory-grid" :style="{ opacity: memory.enabled ? 1 : 0.6 }">
            <div>
              <label class="field-label">Scope</label>
              <input class="input" v-model="memory.scope" :disabled="!memory.enabled || sending" placeholder="agent.chat" style="width: 100%" />
            </div>
            <div>
              <label class="field-label">Query (optional)</label>
              <input class="input" v-model="memory.query" :disabled="!memory.enabled || sending" placeholder="defaults to current prompt" style="width: 100%" />
            </div>
            <div>
              <label class="field-label">Top K</label>
              <input class="input" type="number" min="1" max="100" v-model.number="memory.top_k" :disabled="!memory.enabled || sending" style="width: 100%" />
            </div>
          </div>
          <div v-if="memoryValidationError" class="memory-error">{{ memoryValidationError }}</div>

          <div style="height: 1px; background: var(--border); margin: 10px 0"></div>

          <div class="row" style="align-items: center; margin-bottom: 6px">
            <label class="row" style="margin: 0; gap: 6px">
              <input type="checkbox" v-model="memoryWrite.enabled" :disabled="sending" />
              <span>Write assistant replies to memory</span>
            </label>
            <div class="spacer"></div>
            <label class="row" style="margin: 0; gap: 6px">
              <input type="checkbox" v-model="memoryWrite.required" :disabled="!memoryWrite.enabled || sending" />
              <span style="color: var(--muted); font-size: 13px">Required (fail if unavailable)</span>
            </label>
          </div>
          <div class="row memory-grid" :style="{ opacity: memoryWrite.enabled ? 1 : 0.6 }">
            <div>
              <label class="field-label">Write scope</label>
              <input class="input" v-model="memoryWrite.scope" :disabled="!memoryWrite.enabled || sending" placeholder="agent.chat" style="width: 100%" />
            </div>
            <div>
              <label class="field-label">Write key (optional)</label>
              <input class="input" v-model="memoryWrite.key" :disabled="!memoryWrite.enabled || sending" placeholder="chat.reply.custom" style="width: 100%" />
            </div>
            <div>
              <label class="field-label">TTL sec (optional)</label>
              <input class="input" type="number" min="1" max="31536000" v-model.number="memoryWrite.ttl_sec" :disabled="!memoryWrite.enabled || sending" style="width: 100%" />
            </div>
          </div>
          <div v-if="memoryWriteValidationError" class="memory-error">{{ memoryWriteValidationError }}</div>
        </div>
        <div v-else class="memory-passive-note">Memory defaults are managed in Settings.</div>

        <div class="chat-main">
          <div ref="chatLogEl" class="chat-log">
            <div v-if="messages.length === 0" style="color: var(--muted); font-size: 13px">
              Aloita keskustelu. Agentti voi ehdottaa jobeja keskustelun pohjalta.
            </div>
            <div v-for="(m, i) in messages" :key="i" :class="['msg', m.role === 'user' ? 'msg-user' : 'msg-assistant']">
              <div class="msg-meta">
                <span>{{ m.role === "user" ? "You" : "Agent" }}</span>
                <span>{{ m.ts }}</span>
                <span v-if="m.jobId" style="color: var(--muted)">job {{ m.jobId }}</span>
                <span v-if="m.role === 'assistant' && m.pending" class="pending-pill">processing...</span>
                <span
                  v-if="m.role === 'assistant' && m.memoryWriteStatus"
                  :class="['memory-write-pill', `memory-write-pill-${m.memoryWriteStatus.status || 'unknown'}`]"
                  :title="m.memoryWriteStatus.message || ''"
                >
                  {{ formatMemoryWriteStatusLabel(m.memoryWriteStatus) }}
                </span>
                <button
                  v-if="isDevMode && m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length"
                  class="trace-toggle"
                  type="button"
                  @click="toggleTrace(i)"
                >
                  {{ isTraceOpen(i) ? "Hide thought bubble" : "Show thought bubble" }}
                </button>
              </div>
              <div v-if="isDevMode && m.role === 'assistant' && Array.isArray(m.trace) && m.trace.length && isTraceOpen(i)" class="trace-panel">
                <div v-for="(t, ti) in m.trace" :key="`${i}-trace-${ti}`" class="trace-line">
                  <span class="trace-time">{{ t.ts }}</span>
                  <span>{{ t.text }}</span>
                </div>
              </div>
              <pre>{{ m.content }}</pre>
            </div>
            <div v-if="proposedJobs.length" class="msg msg-assistant msg-suggested">
              <div class="msg-meta">
                <span>Agent</span>
                <span>{{ nowTime() }}</span>
                <span>suggested jobs</span>
                <span class="badge">policy {{ suggestedApprovalMode }}</span>
                <div class="spacer"></div>
                <button
                  v-if="autoSuggestedCount > 0"
                  class="btn primary"
                  @click="createProposedJobs('auto')"
                  :disabled="creatingJobs || sending"
                >
                  {{ creatingJobs ? "Creating..." : `Create auto (${autoSuggestedCount})` }}
                </button>
                <button
                  v-if="approvalSuggestedCount > 0"
                  class="btn"
                  @click="createProposedJobs('approval')"
                  :disabled="creatingJobs || sending"
                >
                  {{ creatingJobs ? "Creating..." : `Approve (${approvalSuggestedCount})` }}
                </button>
                <button class="btn" @click="createProposedJobs('all')" :disabled="creatingJobs || sending">
                  {{ creatingJobs ? "Creating..." : `Create all (${proposedJobs.length})` }}
                </button>
              </div>
              <div v-for="(j, i) in proposedJobs" :key="i" class="suggested-job-item">
                <div class="row" style="margin-bottom: 6px">
                  <span class="badge">{{ j.type }}</span>
                  <span v-if="j.queue" class="badge">q {{ j.queue }}</span>
                  <span class="badge">p{{ j.priority }}</span>
                  <span class="badge">{{ j.timeout_sec }}s</span>
                  <span class="badge">attempts {{ j.max_attempts }}</span>
                  <span
                    :class="['badge', suggestedJobDecisions[i]?.auto ? 'suggested-auto-badge' : 'suggested-approval-badge']"
                    :title="(suggestedJobDecisions[i]?.reasons || []).join('; ')"
                  >
                    {{ suggestedJobDecisions[i]?.auto ? "auto" : "needs approval" }}
                  </span>
                  <div class="spacer"></div>
                  <button
                    class="btn suggested-job-remove"
                    type="button"
                    title="Remove suggested job"
                    aria-label="Remove suggested job"
                    @click="removeProposedJob(i)"
                    :disabled="creatingJobs || sending"
                  >
                    🗑
                  </button>
                </div>
                <div
                  v-if="isDevMode && suggestedJobDecisions[i] && suggestedJobDecisions[i].reasons && suggestedJobDecisions[i].reasons.length"
                  class="suggested-job-reasons"
                >
                  {{ suggestedJobDecisions[i].reasons.join(" | ") }}
                </div>
                <pre class="suggested-job-pre">{{ JSON.stringify(j.input, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </div>

        <div class="chat-composer">
          <label class="field-label">Message</label>
          <div class="composer-row">
            <textarea
              class="input composer-input"
              v-model="draft"
              rows="3"
              placeholder="Esim: 'Luo deploy job stagingiin ja raportti job sen jälkeen.'"
            ></textarea>
            <button class="btn primary composer-send" @click="sendMessage" :disabled="!canSend">
              {{ sending ? "Sending..." : "Send" }}
            </button>
          </div>
          <div class="row" style="margin-top: 8px">
            <span style="color: var(--muted); font-size: 13px">Creates provider-backed chat jobs under the hood.</span>
            <span v-if="sendDisabledReason" style="margin-left: 10px; color: #f59e0b; font-size: 13px">{{ sendDisabledReason }}</span>
          </div>
        </div>

        <div v-if="isDevMode && statusMsg" class="chat-status ok">{{ statusMsg }}</div>
        <div v-if="err" class="chat-status err">{{ err }}</div>
      </section>

      <aside class="jobs-column">
        <div class="row" style="margin-bottom: 6px">
          <div class="workspace-head">Job List</div>
          <div class="spacer"></div>
          <button class="btn workspace-up" @click="trackedJobs = []" :disabled="!trackedJobs.length">
            Clear
          </button>
        </div>
        <div class="workspace-jobs-list">
          <div v-if="!trackedJobs.length" class="workspace-empty">No created jobs yet.</div>
          <div v-for="j in trackedJobs" :key="j.id" class="workspace-job-item">
            <span class="workspace-job-id">{{ j.id }}</span>
            <span class="badge">{{ j.type || "job" }}</span>
            <span :class="['workspace-job-status', `workspace-job-status-${j.status || 'pending'}`]">
              {{ j.status || "pending" }}
            </span>
          </div>
        </div>
      </aside>

      <aside class="workspace-column">
        <div class="row workspace-head-row">
          <div class="workspace-head">Workspace Files</div>
          <div class="spacer"></div>
          <input
            ref="workspaceUploadInputEl"
            type="file"
            multiple
            class="workspace-hidden-input"
            @change="onWorkspaceUploadPicked"
          />
          <button class="btn" @click="createWorkspaceFile" :disabled="workspaceActionLoading">
            New File
          </button>
          <button class="btn" @click="createWorkspaceFolder" :disabled="workspaceActionLoading">
            New Folder
          </button>
          <button class="btn" @click="renameOrMoveWorkspaceEntry" :disabled="workspaceActionLoading">
            Rename/Move
          </button>
          <button class="btn" @click="openWorkspaceUploadPicker" :disabled="workspaceUploadLoading">
            {{ workspaceUploadLoading ? "Uploading..." : "Upload" }}
          </button>
          <button class="btn" @click="workspaceWide = !workspaceWide">
            {{ workspaceWide ? "Default width" : "Wider pane" }}
          </button>
          <button class="btn" @click="loadWorkspace(workspacePath)" :disabled="workspaceLoading">
            {{ workspaceLoading ? "Loading..." : "Reload" }}
          </button>
        </div>
        <div class="workspace-path">
          <span class="badge">path {{ workspacePath }}</span>
          <button
            class="btn workspace-up"
            @click="loadWorkspace(parentWorkspacePath(workspacePath))"
            :disabled="workspaceLoading || workspacePath === '.'"
          >
            Up
          </button>
        </div>
        <div v-if="workspaceError" class="workspace-error">{{ workspaceError }}</div>
        <div
          class="workspace-list"
          :class="{ 'workspace-dropzone-active': workspaceDragActive }"
          @dragenter.prevent="onWorkspaceDragEnter"
          @dragover.prevent="onWorkspaceDragOver"
          @dragleave.prevent="onWorkspaceDragLeave"
          @drop.prevent="onWorkspaceDrop"
        >
          <a
            v-for="entry in workspaceEntries"
            :key="entry.path"
            href="#"
            class="workspace-item workspace-item-link"
            :class="{ 'workspace-item-active': !entry.is_dir && selectedWorkspaceFile?.path === entry.path }"
            @click.prevent="onWorkspaceEntryClick(entry)"
          >
            <span class="workspace-entry-main">
              <span
                class="workspace-entry-icon"
                :class="`workspace-entry-icon-${fileIcon(entry).kind}`"
                :title="fileIcon(entry).token"
              >
                <img
                  v-if="fileIcon(entry).src"
                  class="workspace-entry-icon-img"
                  :src="fileIcon(entry).src"
                  :alt="`${fileIcon(entry).token} icon`"
                />
                <span v-else>{{ fileIcon(entry).token }}</span>
              </span>
              <span
                v-if="entry.is_dir"
                class="workspace-entry-name"
              >
                {{ entry.name }}/
              </span>
              <span
                v-else
                class="workspace-entry-name workspace-file"
              >
                {{ entry.name }}
              </span>
            </span>
            <span class="badge">{{ entry.is_dir ? "dir" : (formatSize(entry.size) || "file") }}</span>
          </a>
          <div v-if="!workspaceEntries.length && !workspaceLoading && !workspaceError" class="workspace-empty">
            No files.
          </div>
        </div>
        <div class="workspace-preview">
          <div class="row" style="margin-bottom: 6px">
            <div class="workspace-head">File Preview</div>
            <div class="spacer"></div>
            <button
              v-if="selectedWorkspaceFile?.path && !workspaceEditMode"
              class="btn workspace-up"
              @click="startWorkspaceEdit"
              :disabled="workspaceFileLoading || workspaceSaveLoading"
            >
              Edit
            </button>
            <button
              v-if="selectedWorkspaceFile?.path && workspaceEditMode"
              class="btn workspace-up"
              @click="saveWorkspaceEdit"
              :disabled="workspaceSaveLoading"
            >
              {{ workspaceSaveLoading ? "Saving..." : "Save" }}
            </button>
            <button
              v-if="selectedWorkspaceFile?.path && workspaceEditMode"
              class="btn workspace-up"
              @click="cancelWorkspaceEdit"
              :disabled="workspaceSaveLoading"
            >
              Cancel
            </button>
            <button
              v-if="selectedWorkspaceFile?.path"
              class="btn workspace-up"
              @click="downloadWorkspaceFile(selectedWorkspaceFile.path)"
            >
              Download
            </button>
            <button
              v-if="selectedWorkspaceFile?.path"
              class="btn workspace-up workspace-danger"
              @click="removeWorkspaceFile(selectedWorkspaceFile.path)"
              :disabled="workspaceSaveLoading || workspaceFileLoading || workspaceUploadLoading"
            >
              Delete
            </button>
          </div>
          <div v-if="workspaceFileLoading" class="workspace-empty">Loading file...</div>
          <div v-else-if="workspaceFileError" class="workspace-error">{{ workspaceFileError }}</div>
          <div v-else-if="selectedWorkspaceFile" class="workspace-preview-body">
            <div class="workspace-preview-meta">
              <span class="badge">{{ selectedWorkspaceFile.path }}</span>
              <span class="badge">{{ formatSize(selectedWorkspaceFile.size) || "file" }}</span>
              <span class="badge">lang {{ workspaceDetectedLang }}</span>
            </div>
            <textarea
              v-if="workspaceEditMode"
              class="input workspace-editor"
              v-model="workspaceDraft"
              @keydown="onWorkspaceEditorKeydown"
              :disabled="workspaceSaveLoading"
            ></textarea>
            <pre v-else class="workspace-pre"><code class="hljs workspace-code" v-html="workspaceHighlightedHtml"></code></pre>
          </div>
          <div v-else class="workspace-empty">Select a file to preview.</div>
          <div v-if="workspaceFileStatus" class="workspace-ok">{{ workspaceFileStatus }}</div>
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { api } from "../api.js";
import { getUiPrefs, loadUiPrefsFromApi } from "../ui_prefs.js";
import { detectLanguageForFilename, highlightCodeAuto } from "../highlight.js";
import { iconAssetForEntry } from "../file_icons.js";
import {
  buildMemoryInput,
  buildMemoryWriteInput,
  formatMemoryWriteStatusLabel,
  parseMemoryWriteStatus,
  validateMemoryInput,
  validateMemoryWriteInput
} from "../chat_memory.js";
import {
  buildCreateJobPayload,
  evaluateSuggestedJobDecisions,
  parseFilterAndDecideSuggestedJobs,
  selectSuggestedJobsForCreation
} from "../suggested_jobs_flow.js";

const AGENT_SYSTEM_PROMPT = [
  "You are RauskuClaw operator assistant.",
  "Answer normally in plain text.",
  "Suggest only job types that exist in the current enabled job type list.",
  "Do not invent new type names (for example: memory.write).",
  "If user asks actions suitable as jobs, append a fenced block:",
  "```rausku_jobs",
  "{\"jobs\":[{\"type\":\"...\",\"input\":{},\"priority\":5,\"timeout_sec\":120,\"max_attempts\":1,\"tags\":[\"chat\"]}]}",
  "```",
  "Only include valid RauskuClaw job payload fields for each suggested job."
].join("\n");

const PLANNER_SYSTEM_PROMPT = [
  "You are RauskuClaw planner.",
  "Your task is to split user request into executable subjobs.",
  "Return only one fenced block in this exact format and no other text:",
  "```rausku_jobs",
  "{\"jobs\":[{\"type\":\"...\",\"input\":{},\"queue\":\"default\",\"priority\":5,\"timeout_sec\":120,\"max_attempts\":1,\"tags\":[\"chat\",\"plan\"]}]}",
  "```",
  "Use only enabled job type names from the provided list.",
  "Prefer 1-6 subjobs, keep each input minimal and concrete.",
  "Include optional queue only when needed, otherwise use default queue."
].join("\n");

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const CHAT_SESSION_KEY = "rauskuclaw_chat_session_v1";

const types = ref([]);
const loadingTypes = ref(false);
const selectedType = ref("");
const messages = ref([]);
const draft = ref("");
const sending = ref(false);
const pendingChatJob = ref(null);
const creatingJobs = ref(false);
const proposedJobs = ref([]);
const plannerMode = ref(true);
const autoCreateJobs = ref(false);
const statusMsg = ref("");
const err = ref("");
const chatLogEl = ref(null);
const traceOpen = ref({});
const isDevMode = ref(false);
const workspacePath = ref(".");
const workspaceEntries = ref([]);
const workspaceLoading = ref(false);
const workspaceError = ref("");
const workspaceWide = ref(false);
const workspaceUploadInputEl = ref(null);
const workspaceUploadLoading = ref(false);
const workspaceActionLoading = ref(false);
const workspaceDragActive = ref(false);
const workspaceDragDepth = ref(0);
const selectedWorkspaceFile = ref(null);
const workspaceFileLoading = ref(false);
const workspaceFileError = ref("");
const workspaceFileStatus = ref("");
const workspaceEditMode = ref(false);
const workspaceDraft = ref("");
const workspaceSaveLoading = ref(false);
const trackedJobs = ref([]);
const suggestedApprovalMode = ref("smart");
const suggestedAutoMaxTimeoutSec = ref(30);
const suggestedAutoMaxAttempts = ref(1);
const suggestedAutoMaxPriority = ref(5);
const suggestedAutoAllowTypes = ref(["report.generate", "memory.write"]);
const memory = ref({
  enabled: false,
  scope: "",
  query: "",
  top_k: 5,
  required: false
});
const memoryWrite = ref({
  enabled: false,
  scope: "",
  key: "",
  ttl_sec: null,
  required: false
});

const chatTypes = computed(() =>
  (types.value || []).filter((t) => t.enabled && String(t.name || "").includes("chat.generate"))
);
const enabledTypeNames = computed(() =>
  (types.value || []).filter((t) => t.enabled).map((t) => String(t.name || "").trim()).filter(Boolean)
);

const selectedTypeInfo = computed(() => chatTypes.value.find((t) => t.name === selectedType.value) || null);
const selectedTimeoutSec = computed(() => Number(selectedTypeInfo.value?.default_timeout_sec) || 180);
const selectedMaxAttempts = computed(() => Number(selectedTypeInfo.value?.default_max_attempts) || 1);
const memoryValidationError = computed(() => validateMemoryInput(memory.value));
const memoryWriteValidationError = computed(() => validateMemoryWriteInput(memoryWrite.value));

const canSend = computed(() =>
  !!selectedType.value &&
  String(draft.value || "").trim().length > 0 &&
  !memoryValidationError.value &&
  !memoryWriteValidationError.value &&
  !sending.value &&
  !loadingTypes.value
);

const sendDisabledReason = computed(() => {
  if (sending.value) return "Send in progress.";
  if (loadingTypes.value) return "Loading job types.";
  if (memoryValidationError.value) return memoryValidationError.value;
  if (memoryWriteValidationError.value) return memoryWriteValidationError.value;
  if (!selectedType.value) return "No enabled chat job type. Enable codex.chat.generate or ai.chat.generate in Settings > Job Types.";
  if (!String(draft.value || "").trim()) return "Write a message first.";
  return "";
});

const suggestedJobDecisions = computed(() => evaluateSuggestedJobDecisions(proposedJobs.value, {
  mode: suggestedApprovalMode.value,
  maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
  maxAttempts: suggestedAutoMaxAttempts.value,
  maxPriority: suggestedAutoMaxPriority.value,
  allowTypes: suggestedAutoAllowTypes.value
}));
const autoSuggestedCount = computed(() => suggestedJobDecisions.value.filter((x) => x.auto).length);
const approvalSuggestedCount = computed(() => suggestedJobDecisions.value.filter((x) => !x.auto).length);

const workspaceHighlightedHtml = computed(() => {
  if (workspaceEditMode.value) return "";
  const raw = String(selectedWorkspaceFile.value?.content || "");
  const filePath = String(selectedWorkspaceFile.value?.path || "");
  if (!raw) return "";
  try {
    return highlightCodeAuto(raw, filePath);
  } catch {
    return raw
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
  }
});

const workspaceDetectedLang = computed(() => {
  const filePath = String(selectedWorkspaceFile.value?.path || "");
  const lang = detectLanguageForFilename(filePath);
  return lang || "plain";
});

function fileIcon(entry) {
  return iconAssetForEntry(entry);
}

function nowTime() {
  return new Date().toLocaleTimeString();
}

async function scrollChatToBottom() {
  await nextTick();
  const el = chatLogEl.value;
  if (!el) return;
  el.scrollTop = el.scrollHeight;
}

function makeTrace() {
  const steps = [];
  return {
    add(text) {
      steps.push({ ts: nowTime(), text: String(text || "") });
    },
    list() {
      return steps.slice();
    }
  };
}

function toggleTrace(index) {
  traceOpen.value = { ...traceOpen.value, [index]: !traceOpen.value[index] };
}

function isTraceOpen(index) {
  return !!traceOpen.value[index];
}

function updateMessage(index, patch) {
  if (index < 0 || index >= messages.value.length) return;
  messages.value[index] = { ...messages.value[index], ...patch };
  void scrollChatToBottom();
}

function clearChat() {
  messages.value = [];
  proposedJobs.value = [];
  trackedJobs.value = [];
  statusMsg.value = "";
  err.value = "";
  traceOpen.value = {};
}

function buildAgentSystemPrompt() {
  const enabled = enabledTypeNames.value;
  if (!enabled.length) return AGENT_SYSTEM_PROMPT;
  return `${AGENT_SYSTEM_PROMPT}\nEnabled job types right now: ${enabled.join(", ")}`;
}

function buildPlannerSystemPrompt() {
  const enabled = enabledTypeNames.value;
  if (!enabled.length) return PLANNER_SYSTEM_PROMPT;
  return `${PLANNER_SYSTEM_PROMPT}\nEnabled job types right now: ${enabled.join(", ")}`;
}

function sanitizeRestoredMessages(rawArr) {
  const out = [];
  for (const item of Array.isArray(rawArr) ? rawArr : []) {
    const role = item?.role === "assistant" ? "assistant" : "user";
    const restored = {
      role,
      content: String(item?.content || ""),
      ts: String(item?.ts || nowTime())
    };
    if (item?.jobId) restored.jobId = String(item.jobId);
    if (item?.memoryWriteStatus && typeof item.memoryWriteStatus === "object") {
      restored.memoryWriteStatus = {
        status: String(item.memoryWriteStatus.status || ""),
        code: item.memoryWriteStatus.code ? String(item.memoryWriteStatus.code) : "",
        message: item.memoryWriteStatus.message ? String(item.memoryWriteStatus.message) : ""
      };
    }
    if (role === "assistant" && Array.isArray(item?.trace)) {
      const trace = item.trace
        .map((t) => ({ ts: String(t?.ts || nowTime()), text: String(t?.text || "") }))
        .filter((t) => t.text);
      if (trace.length) restored.trace = trace;
      restored.pending = item?.pending === true;
    }
    out.push(restored);
  }
  return out;
}

function restoreChatSession() {
  try {
    const raw = sessionStorage.getItem(CHAT_SESSION_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;

    if (typeof parsed.selectedType === "string") selectedType.value = parsed.selectedType;
    if (typeof parsed.draft === "string") draft.value = parsed.draft;
    if (typeof parsed.plannerMode === "boolean") plannerMode.value = parsed.plannerMode;
    if (typeof parsed.autoCreateJobs === "boolean") autoCreateJobs.value = parsed.autoCreateJobs;

    if (parsed.memory && typeof parsed.memory === "object") {
      memory.value = {
        ...memory.value,
        enabled: parsed.memory.enabled === true,
        scope: String(parsed.memory.scope || ""),
        query: String(parsed.memory.query || ""),
        top_k: Number.isInteger(Number(parsed.memory.top_k)) ? Number(parsed.memory.top_k) : 5,
        required: parsed.memory.required === true
      };
    }
    if (parsed.memoryWrite && typeof parsed.memoryWrite === "object") {
      const ttlRaw = parsed.memoryWrite.ttl_sec;
      memoryWrite.value = {
        ...memoryWrite.value,
        enabled: parsed.memoryWrite.enabled === true,
        scope: String(parsed.memoryWrite.scope || ""),
        key: String(parsed.memoryWrite.key || ""),
        ttl_sec: (ttlRaw == null || String(ttlRaw).trim() === "") ? null : Number(ttlRaw),
        required: parsed.memoryWrite.required === true
      };
    }
    if (Array.isArray(parsed.messages)) {
      messages.value = sanitizeRestoredMessages(parsed.messages);
      traceOpen.value = {};
    }
    if (Array.isArray(parsed.proposedJobs)) {
      proposedJobs.value = parsed.proposedJobs;
    }
    if (parsed.pendingChatJob && typeof parsed.pendingChatJob === "object") {
      const jobId = String(parsed.pendingChatJob.jobId || "").trim();
      pendingChatJob.value = jobId ? { jobId } : null;
    }
  } catch {}
}

function persistChatSession() {
  try {
    const payload = {
      selectedType: selectedType.value,
      draft: draft.value,
      plannerMode: plannerMode.value,
      autoCreateJobs: autoCreateJobs.value,
      memory: memory.value,
      memoryWrite: memoryWrite.value,
      messages: messages.value.map((m) => ({
        role: m.role,
        content: m.content,
        ts: m.ts,
        jobId: m.jobId || null,
        pending: m.pending === true,
        trace: Array.isArray(m.trace) ? m.trace : [],
        memoryWriteStatus: m.memoryWriteStatus || null
      })),
      proposedJobs: proposedJobs.value,
      pendingChatJob: pendingChatJob.value
    };
    sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(payload));
  } catch {}
}

function applyUiPrefsDefaults(prefsArg = null) {
  const prefs = prefsArg || getUiPrefs();
  isDevMode.value = prefs.devMode === true;
  suggestedApprovalMode.value = String(prefs.suggestedApprovalMode || "smart");
  suggestedAutoMaxTimeoutSec.value = Number(prefs.suggestedAutoMaxTimeoutSec) || 30;
  suggestedAutoMaxAttempts.value = Number(prefs.suggestedAutoMaxAttempts) || 1;
  suggestedAutoMaxPriority.value = Number(prefs.suggestedAutoMaxPriority);
  if (!Number.isFinite(suggestedAutoMaxPriority.value)) suggestedAutoMaxPriority.value = 5;
  suggestedAutoAllowTypes.value = normalizeTypeList(prefs.suggestedAutoAllowTypes);

  if (prefs.chatMemoryDefaultEnabled === true) {
    memory.value.enabled = true;
    if (!String(memory.value.scope || "").trim()) {
      memory.value.scope = "agent.chat";
    }
  }

  if (prefs.chatMemoryWriteDefaultEnabled === true) {
    memoryWrite.value.enabled = true;
    if (!String(memoryWrite.value.scope || "").trim()) {
      memoryWrite.value.scope = String(memory.value.scope || "agent.chat").trim() || "agent.chat";
    }
  }
}

function pickDefaultType() {
  if (!selectedType.value) {
    const codex = chatTypes.value.find((t) => t.name === "codex.chat.generate");
    const first = codex || chatTypes.value[0];
    if (first) selectedType.value = first.name;
  }
}

async function reloadTypes() {
  loadingTypes.value = true;
  err.value = "";
  try {
    const r = await api.jobTypes();
    types.value = r.types || [];
    pickDefaultType();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loadingTypes.value = false;
  }
}

function parentWorkspacePath(p) {
  const raw = String(p || ".").trim();
  if (!raw || raw === ".") return ".";
  const parts = raw.split("/").filter(Boolean);
  if (parts.length <= 1) return ".";
  return parts.slice(0, -1).join("/");
}

function formatSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

async function loadWorkspace(pathValue = workspacePath.value) {
  workspaceLoading.value = true;
  workspaceError.value = "";
  try {
    const out = await api.workspaceFiles({ path: pathValue, limit: 300 });
    workspacePath.value = out.path || ".";
    workspaceEntries.value = Array.isArray(out.entries) ? out.entries : [];
    workspaceFileError.value = "";
  } catch (e) {
    workspaceError.value = e.message || String(e);
  } finally {
    workspaceLoading.value = false;
  }
}

function onWorkspaceEntryClick(entry) {
  if (!entry || workspaceLoading.value || workspaceFileLoading.value || workspaceSaveLoading.value) return;
  if (entry.is_dir) {
    void loadWorkspace(entry.path);
    return;
  }
  void openWorkspaceFile(entry.path);
}

async function openWorkspaceFile(filePath) {
  workspaceFileLoading.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  try {
    const out = await api.workspaceFile(filePath);
    selectedWorkspaceFile.value = out.file || null;
    workspaceDraft.value = String(out?.file?.content || "");
    workspaceEditMode.value = false;
  } catch (e) {
    selectedWorkspaceFile.value = null;
    workspaceEditMode.value = false;
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceFileLoading.value = false;
  }
}

async function downloadWorkspaceFile(filePath) {
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  try {
    const out = await api.downloadWorkspaceFile(filePath);
    const url = URL.createObjectURL(out.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = out.filename || "download.bin";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  }
}

async function removeWorkspaceFile(filePath) {
  const p = String(filePath || "").trim();
  if (!p) return;
  const ok = window.confirm(`Delete '${p}'?`);
  if (!ok) return;

  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  workspaceSaveLoading.value = true;
  try {
    await api.deleteWorkspaceFile(p);
    selectedWorkspaceFile.value = null;
    workspaceDraft.value = "";
    workspaceEditMode.value = false;
    await loadWorkspace(workspacePath.value);
    workspaceFileStatus.value = `Deleted ${p}.`;
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceSaveLoading.value = false;
  }
}

function buildWorkspacePathInCurrent(name) {
  const clean = String(name || "").trim().replace(/^\/+/, "");
  if (!clean) return "";
  const base = workspacePath.value && workspacePath.value !== "." ? `${workspacePath.value}/` : "";
  return `${base}${clean}`;
}

async function createWorkspaceFile() {
  const name = window.prompt("New file path (relative to current folder):", "");
  const nextPath = buildWorkspacePathInCurrent(name);
  if (!nextPath) return;
  workspaceActionLoading.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  try {
    await api.createWorkspaceEntry({ path: nextPath, kind: "file", content: "" });
    await loadWorkspace(workspacePath.value);
    await openWorkspaceFile(nextPath);
    workspaceFileStatus.value = `Created ${nextPath}.`;
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceActionLoading.value = false;
  }
}

async function createWorkspaceFolder() {
  const name = window.prompt("New folder path (relative to current folder):", "");
  const nextPath = buildWorkspacePathInCurrent(name);
  if (!nextPath) return;
  workspaceActionLoading.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  try {
    await api.createWorkspaceEntry({ path: nextPath, kind: "dir" });
    await loadWorkspace(workspacePath.value);
    workspaceFileStatus.value = `Created folder ${nextPath}.`;
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceActionLoading.value = false;
  }
}

async function renameOrMoveWorkspaceEntry() {
  const from = selectedWorkspaceFile.value?.path || "";
  const source = window.prompt("Move from path:", from);
  const fromPath = String(source || "").trim();
  if (!fromPath) return;
  const targetInput = window.prompt("Move to path:", fromPath);
  const toPath = String(targetInput || "").trim();
  if (!toPath || toPath === fromPath) return;
  workspaceActionLoading.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  try {
    try {
      await api.moveWorkspaceEntry({ from_path: fromPath, to_path: toPath, overwrite: false });
    } catch (e) {
      if (e?.status === 409) {
        const ok = window.confirm(`'${toPath}' exists. Overwrite?`);
        if (!ok) throw e;
        await api.moveWorkspaceEntry({ from_path: fromPath, to_path: toPath, overwrite: true });
      } else {
        throw e;
      }
    }
    await loadWorkspace(workspacePath.value);
    if (selectedWorkspaceFile.value?.path === fromPath) {
      await openWorkspaceFile(toPath);
    }
    workspaceFileStatus.value = `Moved ${fromPath} -> ${toPath}.`;
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceActionLoading.value = false;
  }
}

function openWorkspaceUploadPicker() {
  if (workspaceUploadLoading.value) return;
  workspaceUploadInputEl.value?.click();
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

async function uploadWorkspaceFiles(filesLike) {
  const files = Array.isArray(filesLike) ? filesLike : Array.from(filesLike || []);
  if (!files.length) return;

  workspaceUploadLoading.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";

  let uploaded = 0;
  try {
    for (const file of files) {
      if (!file) continue;
      const base64 = arrayBufferToBase64(await file.arrayBuffer());
      const prefix = workspacePath.value && workspacePath.value !== "." ? `${workspacePath.value}/` : "";
      const targetPath = `${prefix}${file.name}`;

      try {
        await api.uploadWorkspaceFile({
          path: targetPath,
          content_base64: base64,
          overwrite: false
        });
      } catch (e) {
        if (e?.status === 409) {
          const ok = window.confirm(`'${targetPath}' exists. Overwrite?`);
          if (!ok) continue;
          await api.uploadWorkspaceFile({
            path: targetPath,
            content_base64: base64,
            overwrite: true
          });
        } else {
          throw e;
        }
      }
      uploaded += 1;
    }

    await loadWorkspace(workspacePath.value);
    workspaceFileStatus.value = uploaded > 0
      ? `Uploaded ${uploaded} file(s).`
      : "No files uploaded.";
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceUploadLoading.value = false;
  }
}

async function onWorkspaceUploadPicked(event) {
  const input = event?.target;
  await uploadWorkspaceFiles(input?.files);
  if (input) input.value = "";
}

function onWorkspaceDragEnter() {
  workspaceDragDepth.value += 1;
  workspaceDragActive.value = true;
}

function onWorkspaceDragOver() {
  workspaceDragActive.value = true;
}

function onWorkspaceDragLeave() {
  workspaceDragDepth.value = Math.max(0, workspaceDragDepth.value - 1);
  if (workspaceDragDepth.value === 0) workspaceDragActive.value = false;
}

async function onWorkspaceDrop(event) {
  workspaceDragDepth.value = 0;
  workspaceDragActive.value = false;
  await uploadWorkspaceFiles(event?.dataTransfer?.files);
}

function startWorkspaceEdit() {
  if (!selectedWorkspaceFile.value) return;
  workspaceDraft.value = String(selectedWorkspaceFile.value.content || "");
  workspaceEditMode.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
}

function cancelWorkspaceEdit() {
  workspaceEditMode.value = false;
  workspaceDraft.value = String(selectedWorkspaceFile.value?.content || "");
  workspaceFileError.value = "";
}

function onWorkspaceEditorKeydown(event) {
  const e = event;
  if (!e) return;
  const key = String(e.key || "").toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === "s") {
    e.preventDefault();
    if (!workspaceSaveLoading.value) void saveWorkspaceEdit();
    return;
  }
  if (key === "escape") {
    e.preventDefault();
    if (!workspaceSaveLoading.value) cancelWorkspaceEdit();
  }
}

async function saveWorkspaceEdit() {
  const file = selectedWorkspaceFile.value;
  if (!file?.path) return;
  workspaceSaveLoading.value = true;
  workspaceFileError.value = "";
  workspaceFileStatus.value = "";
  try {
    await api.updateWorkspaceFile(file.path, workspaceDraft.value);
    await openWorkspaceFile(file.path);
    await loadWorkspace(workspacePath.value);
    workspaceEditMode.value = false;
    workspaceFileStatus.value = "File saved.";
  } catch (e) {
    workspaceFileError.value = e.message || String(e);
  } finally {
    workspaceSaveLoading.value = false;
  }
}

function toProviderMessages() {
  const items = [];
  for (const m of messages.value) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "assistant" && m.pending) continue;
    const content = String(m.content || "").trim();
    if (!content) continue;
    items.push({ role: m.role, content });
  }
  return items.slice(-20);
}

async function waitForJobDone(jobId, { timeoutMs = 240000, onProgress } = {}) {
  const started = Date.now();
  let lastStatus = "";
  while (Date.now() - started < timeoutMs) {
    const r = await api.job(jobId);
    const job = r.job || null;
    if (job && job.status !== lastStatus) {
      lastStatus = job.status;
      if (typeof onProgress === "function") onProgress(job);
    }
    if (job && TERMINAL_STATUSES.has(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  throw new Error("Chat job timed out while waiting for completion.");
}

function upsertTrackedJob(patch) {
  const id = String(patch?.id || "").trim();
  if (!id) return;
  const idx = trackedJobs.value.findIndex((x) => x.id === id);
  if (idx >= 0) {
    trackedJobs.value[idx] = { ...trackedJobs.value[idx], ...patch };
  } else {
    trackedJobs.value.unshift({
      id,
      type: String(patch?.type || ""),
      status: String(patch?.status || "pending"),
      updatedAt: nowTime()
    });
  }
  if (trackedJobs.value.length > 40) trackedJobs.value = trackedJobs.value.slice(0, 40);
}

function trimBlock(text, maxLen = 1600) {
  const raw = String(text || "");
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}\n...(truncated)`;
}

function formatCreatedJobResultMessage(jobDef, jobDone, jobId) {
  const typeName = String(jobDef?.type || "");
  const status = String(jobDone?.status || "unknown");
  if (status === "succeeded") {
    const output = String(jobDone?.result?.output_text || "").trim() || JSON.stringify(jobDone?.result || {}, null, 2);
    return [
      `Created job ${jobId} (${typeName}) finished: succeeded.`,
      "",
      trimBlock(output)
    ].join("\n");
  }
  const errCode = String(jobDone?.error?.code || "").trim();
  const errMessage = String(jobDone?.error?.message || "Job failed.");
  return [
    `Created job ${jobId} (${typeName}) finished: ${status}.`,
    errCode ? `Error code: ${errCode}` : "",
    errMessage
  ].filter(Boolean).join("\n");
}

function latestUserMessageText() {
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const m = messages.value[i];
    if (m?.role === "user") {
      const s = String(m?.content || "").trim();
      if (s) return s;
    }
  }
  return "";
}

function findPendingAssistantIndex(jobId) {
  const id = String(jobId || "").trim();
  if (!id) return -1;
  for (let i = messages.value.length - 1; i >= 0; i -= 1) {
    const m = messages.value[i];
    if (m?.role === "assistant" && m?.pending === true && String(m?.jobId || "").trim() === id) {
      return i;
    }
  }
  return -1;
}

async function resumePendingChatJob() {
  const jobId = String(pendingChatJob.value?.jobId || "").trim();
  if (!jobId || sending.value) return;

  let assistantIndex = findPendingAssistantIndex(jobId);
  if (assistantIndex < 0) {
    assistantIndex = messages.value.push({
      role: "assistant",
      content: "Processing request (resumed after refresh)...",
      ts: nowTime(),
      jobId,
      pending: true
    }) - 1;
  } else {
    updateMessage(assistantIndex, {
      content: "Processing request (resumed after refresh)...",
      pending: true,
      jobId
    });
  }

  sending.value = true;
  statusMsg.value = `Resuming chat job: ${jobId}`;
  err.value = "";

  try {
    const done = await waitForJobDone(jobId, {
      onProgress(job) {
        updateMessage(assistantIndex, {
          content: `Processing request (${job.status})...`,
          pending: true,
          jobId
        });
      }
    });

    if (done.status !== "succeeded") {
      const failText = done?.error?.message || "Chat job failed";
      updateMessage(assistantIndex, {
        content: `Job failed: ${failText}`,
        pending: false,
        jobId
      });
      err.value = failText;
      return;
    }

    const outText = String(done?.result?.output_text || "").trim() || JSON.stringify(done?.result || {}, null, 2);
    updateMessage(assistantIndex, {
      content: outText,
      pending: false,
      jobId
    });

    const flow = parseFilterAndDecideSuggestedJobs({
      text: outText,
      currentType: selectedType.value,
      userText: latestUserMessageText(),
      policy: {
        mode: suggestedApprovalMode.value,
        maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
        maxAttempts: suggestedAutoMaxAttempts.value,
        maxPriority: suggestedAutoMaxPriority.value,
        allowTypes: suggestedAutoAllowTypes.value
      }
    });
    proposedJobs.value = flow.filtered.kept;
    if (flow.filtered.kept.length > 0) {
      statusMsg.value = `Agent suggested ${flow.filtered.kept.length} job(s).`;
    }
  } catch (e) {
    updateMessage(assistantIndex, {
      content: `Agent error: ${e.message || String(e)}`,
      pending: false,
      jobId
    });
    err.value = e.message || String(e);
  } finally {
    pendingChatJob.value = null;
    sending.value = false;
    persistChatSession();
  }
}

async function trackCreatedJobResult(jobDef, jobId) {
  try {
    upsertTrackedJob({ id: jobId, type: String(jobDef?.type || ""), status: "running", updatedAt: nowTime() });
    const timeoutSec = Math.max(1, Number(jobDef?.timeout_sec) || 120);
    const done = await waitForJobDone(jobId, {
      timeoutMs: Math.max(45_000, timeoutSec * 1000 + 30_000)
      ,
      onProgress(job) {
        upsertTrackedJob({
          id: jobId,
          type: String(jobDef?.type || ""),
          status: String(job?.status || "running"),
          updatedAt: nowTime()
        });
      }
    });
    upsertTrackedJob({
      id: jobId,
      type: String(jobDef?.type || ""),
      status: String(done?.status || "succeeded"),
      updatedAt: nowTime()
    });
    messages.value.push({
      role: "assistant",
      ts: nowTime(),
      jobId,
      content: formatCreatedJobResultMessage(jobDef, done, jobId)
    });
  } catch (waitErr) {
    upsertTrackedJob({
      id: jobId,
      type: String(jobDef?.type || ""),
      status: "failed",
      updatedAt: nowTime()
    });
    messages.value.push({
      role: "assistant",
      ts: nowTime(),
      jobId,
      content: `Created job ${jobId} (${String(jobDef?.type || "")}) status polling failed: ${waitErr?.message || String(waitErr)}`
    });
  } finally {
    await scrollChatToBottom();
  }
}

async function sendMessage() {
  if (!canSend.value) return;
  statusMsg.value = "";
  err.value = "";
  const text = String(draft.value || "").trim();
  const providerHistory = toProviderMessages();
  const trace = makeTrace();
  const plannerEnabled = plannerMode.value === true;
  trace.add("User message received.");
  draft.value = "";
  proposedJobs.value = [];
  messages.value.push({ role: "user", content: text, ts: nowTime() });
  const assistantIndex = messages.value.push({
    role: "assistant",
    content: "Processing request...",
    ts: nowTime(),
    trace: trace.list(),
    pending: true
  }) - 1;
  traceOpen.value = { ...traceOpen.value, [assistantIndex]: true };

  sending.value = true;
  try {
    trace.add(`Creating ${plannerEnabled ? "planner" : "chat"} job for type '${selectedType.value}'.`);
    updateMessage(assistantIndex, { trace: trace.list() });
    const memoryInput = buildMemoryInput(memory.value);
    const memoryWriteInput = plannerEnabled ? null : buildMemoryWriteInput(memoryWrite.value);
    if (memoryInput) {
      trace.add(`Memory context enabled (scope='${memoryInput.scope}', top_k=${memoryInput.top_k}, required=${memoryInput.required}).`);
      updateMessage(assistantIndex, { trace: trace.list() });
    }
    if (memoryWriteInput) {
      trace.add(`Memory write enabled (scope='${memoryWriteInput.scope}', required=${memoryWriteInput.required}).`);
      updateMessage(assistantIndex, { trace: trace.list() });
    }
    const payload = {
      type: selectedType.value,
      input: {
        system: plannerEnabled ? buildPlannerSystemPrompt() : buildAgentSystemPrompt(),
        messages: [...providerHistory, { role: "user", content: text }],
        ...(memoryInput ? { memory: memoryInput } : {}),
        ...(memoryWriteInput ? { memory_write: memoryWriteInput } : {})
      },
      priority: 5,
      timeout_sec: selectedTimeoutSec.value,
      max_attempts: selectedMaxAttempts.value,
      tags: plannerEnabled ? ["chat", "planner"] : ["chat", "agent"]
    };
    const created = await api.createJob(payload);
    const jobId = created?.job?.id || "";
    trace.add(`Job created (${jobId || "unknown id"}).`);
    trace.add("Waiting for job completion.");
    updateMessage(assistantIndex, { trace: trace.list(), jobId, content: "Processing request (job started)..." });
    if (jobId) {
      pendingChatJob.value = { jobId };
      persistChatSession();
    }
    statusMsg.value = `${plannerEnabled ? "Planner" : "Chat"} job created: ${jobId}`;
    const done = await waitForJobDone(jobId, {
      onProgress(job) {
        trace.add(`Job status changed: ${job.status}`);
        updateMessage(assistantIndex, { trace: trace.list() });
      }
    });

    if (done.status !== "succeeded") {
      const failText = done?.error?.message || "Chat job failed";
      trace.add(`Job failed: ${failText}`);
      const memoryWriteStatus = parseMemoryWriteStatus({ done, memoryWriteInput });
      updateMessage(assistantIndex, {
        content: `Job failed: ${failText}`,
        pending: false,
        trace: trace.list(),
        jobId,
        ...(memoryWriteStatus ? { memoryWriteStatus } : {})
      });
      pendingChatJob.value = null;
      err.value = failText;
      return;
    }

    trace.add("Job succeeded, parsing response.");
    const outText = String(done?.result?.output_text || "").trim() || JSON.stringify(done?.result || {}, null, 2);
    const memoryWriteStatus = parseMemoryWriteStatus({ done, memoryWriteInput });
    trace.add("Checking suggested jobs in response.");
    const flow = parseFilterAndDecideSuggestedJobs({
      text: outText,
      currentType: selectedType.value,
      userText: text,
      policy: {
        mode: suggestedApprovalMode.value,
        maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
        maxAttempts: suggestedAutoMaxAttempts.value,
        maxPriority: suggestedAutoMaxPriority.value,
        allowTypes: suggestedAutoAllowTypes.value
      }
    });
    proposedJobs.value = flow.filtered.kept;
    let assistantText = outText;
    if (plannerEnabled && flow.filtered.kept.length > 0) {
      const lines = flow.filtered.kept.map((j, idx) => {
        const queuePart = j.queue ? `, q=${j.queue}` : "";
        return `${idx + 1}. ${j.type} (p${j.priority}, t=${j.timeout_sec}s, a=${j.max_attempts}${queuePart})`;
      });
      assistantText = [
        "Planner phase complete.",
        "",
        `Generated ${flow.filtered.kept.length} subjob(s):`,
        ...lines,
        "",
        "Review and run from suggested jobs."
      ].join("\n");
    }
    updateMessage(assistantIndex, {
      content: assistantText,
      pending: false,
      trace: trace.list(),
      jobId,
      ...(memoryWriteStatus ? { memoryWriteStatus } : {})
    });
    pendingChatJob.value = null;
    if (flow.filtered.dropped > 0) {
      trace.add(`Dropped ${flow.filtered.dropped} duplicate suggested job(s) already covered by this chat run.`);
    }
    if (flow.filtered.kept.length > 0) {
      trace.add(`Found ${flow.filtered.kept.length} suggested job(s).`);
      updateMessage(assistantIndex, { trace: trace.list() });
      statusMsg.value = plannerEnabled
        ? `Planner suggested ${flow.filtered.kept.length} subjob(s).`
        : `Agent suggested ${flow.filtered.kept.length} job(s).`;
      if (autoCreateJobs.value) await createProposedJobs("auto");
    } else {
      trace.add("No suggested jobs found.");
      updateMessage(assistantIndex, { trace: trace.list() });
    }
  } catch (e) {
    trace.add(`Error: ${e.message || String(e)}`);
    const hasPendingJob = !!String(pendingChatJob.value?.jobId || "").trim();
    updateMessage(assistantIndex, {
      content: `Agent error: ${e.message || String(e)}`,
      pending: hasPendingJob,
      trace: trace.list()
    });
    err.value = e.message || String(e);
  } finally {
    sending.value = false;
    persistChatSession();
  }
}

async function createProposedJobs(mode = "all") {
  if (!proposedJobs.value.length) return;
  creatingJobs.value = true;
  err.value = "";
  try {
    const selectedFlow = selectSuggestedJobsForCreation({
      jobs: proposedJobs.value,
      decisions: suggestedJobDecisions.value,
      mode,
      enabledTypes: enabledTypeNames.value
    });
    const { normalizedMode, selected, valid: validJobs, invalidTypes } = selectedFlow;
    if (!selected.length) {
      statusMsg.value = normalizedMode === "auto"
        ? "No auto-allowed suggested jobs to create."
        : (normalizedMode === "approval" ? "No approval-required suggested jobs to create." : "No suggested jobs to create.");
      return;
    }
    if (!validJobs.length) {
      err.value = invalidTypes.length
        ? `Suggested jobs use unknown/disabled type(s): ${Array.from(new Set(invalidTypes)).join(", ")}`
        : "No valid suggested jobs for selected mode.";
      return;
    }

    const ids = [];
    const createdJobs = [];
    const createdIndexes = new Set();
    for (const item of validJobs) {
      const j = item.job;
      const r = await api.createJob(buildCreateJobPayload(j));
      const createdId = String(r?.job?.id || "").trim();
      if (!createdId) continue;
      ids.push(createdId);
      upsertTrackedJob({ id: createdId, type: String(j?.type || ""), status: "queued", updatedAt: nowTime() });
      createdJobs.push({ def: j, id: createdId });
      createdIndexes.add(item.index);
    }
    const modeLabel = normalizedMode === "auto" ? "auto" : (normalizedMode === "approval" ? "approved" : "selected");
    statusMsg.value = invalidTypes.length
      ? `Created ${ids.length} ${modeLabel} job(s). Skipped unknown/disabled type(s): ${Array.from(new Set(invalidTypes)).join(", ")}`
      : `Created ${ids.length} ${modeLabel} job(s): ${ids.join(", ")}`;
    proposedJobs.value = proposedJobs.value.filter((_, index) => !createdIndexes.has(index));
    for (const created of createdJobs) {
      void trackCreatedJobResult(created.def, created.id);
    }
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    creatingJobs.value = false;
  }
}

function removeProposedJob(index) {
  if (!Number.isInteger(index) || index < 0 || index >= proposedJobs.value.length) return;
  const next = proposedJobs.value.slice();
  next.splice(index, 1);
  proposedJobs.value = next;
  statusMsg.value = next.length
    ? `Removed one suggested job. ${next.length} remaining.`
    : "Removed suggested job.";
}

onMounted(async () => {
  restoreChatSession();
  const prefs = await loadUiPrefsFromApi();
  applyUiPrefsDefaults(prefs);
  await reloadTypes();
  await loadWorkspace(".");
  await resumePendingChatJob();
  await scrollChatToBottom();
});

watch(
  () => messages.value.length,
  async () => {
    await nextTick();
    const el = chatLogEl.value;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }
);

watch(
  () => workspacePath.value,
  () => {
    workspaceDragDepth.value = 0;
    workspaceDragActive.value = false;
  }
);

watch(
  [selectedType, draft, plannerMode, autoCreateJobs, memory, memoryWrite, messages, proposedJobs, pendingChatJob],
  () => {
    persistChatSession();
  },
  { deep: true }
);

</script>

<style scoped>
.chat-card {
  height: 100%;
  min-height: 0;
  padding: 12px;
  overflow: hidden;
}

.chat-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px 360px;
  gap: 12px;
  height: 100%;
  min-height: 0;
}

.chat-grid.workspace-wide {
  grid-template-columns: minmax(0, 1fr) 280px 480px;
}

.chat-column {
  min-width: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.jobs-column,
.workspace-column {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px 10px 8px;
  background: rgba(255, 255, 255, 0.03);
  min-height: 0;
  overflow: auto;
  display: flex;
  flex-direction: column;
}

.jobs-column {
  overflow: hidden;
}

.workspace-head {
  font-weight: 700;
}

.workspace-head-row {
  margin-bottom: 8px;
}

.workspace-hidden-input {
  display: none;
}

.workspace-path {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.workspace-dropzone-active {
  border-color: rgba(112, 178, 255, 0.75) !important;
  background: rgba(112, 178, 255, 0.14);
}

.workspace-up {
  padding: 4px 8px;
  font-size: 12px;
}

.workspace-danger {
  border-color: rgba(255, 123, 114, 0.45);
  color: #ff9d97;
}

.workspace-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px;
  padding-right: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.045);
}

.workspace-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border: 0;
  border-radius: 8px;
  padding: 5px 8px;
  transition: background-color 120ms ease, color 120ms ease;
}

.workspace-item:hover {
  background: rgba(112, 178, 255, 0.18);
}

.workspace-item-active {
  background: rgba(112, 178, 255, 0.26);
  box-shadow: inset 0 0 0 1px rgba(112, 178, 255, 0.42);
}

.workspace-item-active .workspace-entry-name {
  color: #eaf2ff;
}

.workspace-item-link {
  color: inherit;
  text-decoration: none;
  cursor: pointer;
}

.workspace-entry-main {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
}

.workspace-entry-icon {
  min-width: 46px;
  text-align: center;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  padding: 1px 6px;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.3px;
  color: #cdd9f5;
  background: rgba(255, 255, 255, 0.05);
  margin-right: 8px;
}

.workspace-entry-icon-img {
  width: 14px;
  height: 14px;
  display: block;
  margin: 0 auto;
}

.workspace-entry-icon-dir {
  color: #8ec7ff;
  border-color: rgba(142, 199, 255, 0.45);
}

.workspace-entry-icon-js,
.workspace-entry-icon-ts,
.workspace-entry-icon-json,
.workspace-entry-icon-yaml {
  color: #facc74;
  border-color: rgba(250, 204, 116, 0.45);
}

.workspace-entry-icon-py,
.workspace-entry-icon-go,
.workspace-entry-icon-rs,
.workspace-entry-icon-java,
.workspace-entry-icon-sql {
  color: #7ee787;
  border-color: rgba(126, 231, 135, 0.45);
}

.workspace-entry-icon-html,
.workspace-entry-icon-xml,
.workspace-entry-icon-css,
.workspace-entry-icon-vue,
.workspace-entry-icon-md {
  color: #9ab7ff;
  border-color: rgba(154, 183, 255, 0.45);
}

.workspace-entry-icon-sh,
.workspace-entry-icon-docker,
.workspace-entry-icon-file {
  color: #b3b3b3;
  border-color: rgba(179, 179, 179, 0.35);
}

.workspace-entry-name {
  color: #dce7ff;
  text-align: left;
  font-size: 13px;
  line-height: 1.3;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-file {
  color: var(--text);
}

.workspace-empty {
  color: var(--muted);
  font-size: 13px;
  padding: 6px 2px;
}

.workspace-error {
  color: #ff7b72;
  font-size: 12px;
  margin-bottom: 8px;
}

.workspace-preview {
  margin-top: 18px;
  padding-top: 4px;
  flex: 2;
  min-height: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.workspace-jobs-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 2px;
}

.workspace-job-item {
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.18);
}

.workspace-job-id {
  min-width: 0;
  flex: 1;
  font-size: 12px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.workspace-job-status {
  border-radius: 999px;
  border: 1px solid var(--border);
  padding: 1px 7px;
  font-size: 11px;
}

.workspace-job-status-queued,
.workspace-job-status-running {
  color: #9fc2ff;
  border-color: rgba(159, 194, 255, 0.45);
}

.workspace-job-status-succeeded {
  color: #7ee787;
  border-color: rgba(126, 231, 135, 0.45);
}

.workspace-job-status-failed,
.workspace-job-status-cancelled {
  color: #ff7b72;
  border-color: rgba(255, 123, 114, 0.45);
}

.workspace-preview-meta {
  display: flex;
  gap: 8px;
  margin-bottom: 6px;
  flex-wrap: wrap;
}

.workspace-preview-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.workspace-pre {
  flex: 1;
  min-height: 0;
  max-height: none;
  overflow: auto;
  padding: 0;
  border: 0;
}

.workspace-code {
  display: block;
  min-height: 100%;
}

.workspace-editor {
  width: 100%;
  flex: 1;
  min-height: 0;
  resize: vertical;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  line-height: 1.4;
  border: 0;
  border-radius: 10px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.22);
}

.workspace-ok {
  color: #7ee787;
  font-size: 12px;
  margin-top: 6px;
}

.chat-main {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: hidden;
}

.chat-log {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  background: rgba(0, 0, 0, 0.15);
}

.chat-composer {
  margin-top: 10px;
  border-top: 1px solid var(--border);
  padding-top: 10px;
}

.composer-row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.composer-input {
  width: 100%;
  resize: none;
}

.composer-send {
  min-width: 86px;
}

.memory-panel {
  border: 1px solid var(--border);
  border-radius: 12px;
  padding: 10px;
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.03);
}

.memory-grid {
  display: grid;
  grid-template-columns: 1.2fr 1.2fr 120px;
  gap: 8px;
}

.memory-error {
  margin-top: 8px;
  color: #ff7b72;
  font-size: 12px;
}

.memory-passive-note {
  margin-bottom: 10px;
  color: var(--muted);
  font-size: 12px;
}

.chat-status {
  margin-top: 8px;
  font-size: 13px;
}

.chat-status.ok {
  color: #7ee787;
}

.chat-status.err {
  color: #ff7b72;
}

.msg {
  margin-bottom: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 12px;
}

.msg-user {
  background: rgba(74, 163, 255, 0.12);
}

.msg-assistant {
  background: rgba(255, 255, 255, 0.03);
}

.msg-suggested {
  margin-bottom: 0;
}

.suggested-job-item {
  margin-top: 8px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(0, 0, 0, 0.18);
}

.suggested-job-pre {
  margin: 0;
}

.suggested-job-reasons {
  margin-bottom: 6px;
  color: var(--muted);
  font-size: 12px;
}

.suggested-auto-badge {
  color: #7ee787;
  border-color: rgba(126, 231, 135, 0.45);
}

.suggested-approval-badge {
  color: #e3b341;
  border-color: rgba(227, 179, 65, 0.45);
}

.suggested-job-remove {
  min-width: 34px;
  padding: 4px 8px;
  line-height: 1;
}

.msg-meta {
  display: flex;
  gap: 10px;
  color: var(--muted);
  font-size: 12px;
  margin-bottom: 6px;
}

.pending-pill {
  color: #9fc2ff;
  border: 1px solid rgba(159, 194, 255, 0.45);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
}

.memory-write-pill {
  border: 1px solid var(--border);
  border-radius: 999px;
  padding: 1px 8px;
  font-size: 11px;
}

.memory-write-pill-ok {
  color: #7ee787;
  border-color: rgba(126, 231, 135, 0.45);
}

.memory-write-pill-fail {
  color: #ff7b72;
  border-color: rgba(255, 123, 114, 0.45);
}

.memory-write-pill-unknown {
  color: #e3b341;
  border-color: rgba(227, 179, 65, 0.45);
}

.trace-toggle {
  margin-left: auto;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.04);
  color: var(--muted);
  border-radius: 999px;
  font-size: 11px;
  padding: 3px 9px;
  cursor: pointer;
}

.trace-toggle:hover {
  color: var(--text);
}

.trace-panel {
  border: 1px dashed var(--border);
  border-radius: 10px;
  padding: 8px;
  margin-bottom: 8px;
  background: rgba(255, 255, 255, 0.03);
}

.trace-line {
  display: flex;
  gap: 8px;
  font-size: 12px;
  color: var(--muted);
  margin-bottom: 4px;
}

.trace-time {
  color: #9fc2ff;
  min-width: 74px;
}

.chat-log::-webkit-scrollbar,
.workspace-column::-webkit-scrollbar,
.workspace-list::-webkit-scrollbar,
.workspace-pre::-webkit-scrollbar,
.workspace-jobs-list::-webkit-scrollbar {
  width: 10px;
}

.chat-log::-webkit-scrollbar-thumb,
.workspace-column::-webkit-scrollbar-thumb,
.workspace-list::-webkit-scrollbar-thumb,
.workspace-pre::-webkit-scrollbar-thumb,
.workspace-jobs-list::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.2);
  border-radius: 8px;
}

.chat-log::-webkit-scrollbar-track,
.workspace-column::-webkit-scrollbar-track,
.workspace-list::-webkit-scrollbar-track,
.workspace-pre::-webkit-scrollbar-track,
.workspace-jobs-list::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.03);
}

@media (max-width: 900px) {
  .chat-card {
    height: 100%;
    min-height: 0;
  }
  .chat-grid {
    grid-template-columns: 1fr;
  }
  .jobs-column,
  .workspace-column {
    max-height: 300px;
  }
  .composer-row {
    flex-direction: column;
  }
  .composer-send {
    width: 100%;
  }
  .memory-grid {
    grid-template-columns: 1fr;
  }
}
</style>
