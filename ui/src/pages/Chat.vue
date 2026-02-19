<template>
  <div class="card chat-card">
    <div class="chat-grid">
      <section class="chat-column">
        <div class="row" style="margin-bottom: 10px">
          <div style="font-weight: 700">Agent Chat ({{ activeChatModelLabel }})</div>
          <span class="badge">tokens ~{{ providerHistoryTokenEstimate }} / max {{ chatMaxPromptTokens }}</span>
          <span class="badge">mode {{ routedPromptModePreview }} ({{ routedPromptModeSource }})</span>
          <div class="spacer"></div>
          <button class="btn" @click="showOpsMessages = !showOpsMessages" :disabled="sending">
            {{ showOpsMessages ? "Hide system/jobs" : "Show system/jobs" }}
          </button>
          <button v-if="isDevMode" class="btn" @click="reloadTypes" :disabled="loadingTypes || loadingProviders">{{ (loadingTypes || loadingProviders) ? "Loading..." : "Reload" }}</button>
          <button class="btn" @click="clearChat" :disabled="sending">New session</button>
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
            <input type="checkbox" v-model="plannerMode" :disabled="sending || creatingJobs || !plannerFeatureEnabled" />
            <span style="color: var(--muted); font-size: 13px">
              Planner phase (split to subjobs first){{ plannerFeatureEnabled ? "" : " - disabled in Settings" }}
            </span>
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
        <div v-if="providerConfigWarning" class="chat-status err" style="margin-bottom: 10px">
          {{ providerConfigWarning }}
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
            <div v-if="isDevMode && showOpsMessages" class="msg msg-system-debug">
              <div class="msg-meta">
                <span>SYSTEM (debug)</span>
                <span>{{ activeSystemPromptModeLabel }}</span>
                <span>type {{ selectedType || "-" }}</span>
                <span class="badge">{{ activeSystemPromptSourceLabel }}</span>
                <div class="spacer"></div>
                <button class="trace-inline-toggle" type="button" @click="toggleSystemPromptExpanded('active')">
                  {{ systemPromptExpanded.active ? "Collapse" : "Expand" }}
                </button>
                <button class="trace-inline-toggle" type="button" @click="copySystemPrompt(activeSystemPromptPreview)">
                  {{ copyFeedback.active ? "Copied" : "Copy" }}
                </button>
              </div>
              <pre>{{ activeSystemPromptRender }}</pre>
            </div>
            <div v-if="isDevMode && chatNewSessionAutoRun && showOpsMessages" class="msg msg-system-debug msg-system-debug-secondary">
              <div class="msg-meta">
                <span>SYSTEM (clear greeting)</span>
                <span>auto-run on Clear</span>
                <span class="badge">{{ newSessionPromptSourceLabel }}</span>
                <div class="spacer"></div>
                <button class="trace-inline-toggle" type="button" @click="toggleSystemPromptExpanded('newSession')">
                  {{ systemPromptExpanded.newSession ? "Collapse" : "Expand" }}
                </button>
                <button class="trace-inline-toggle" type="button" @click="copySystemPrompt(newSessionGreetingPromptPreview, 'newSession')">
                  {{ copyFeedback.newSession ? "Copied" : "Copy" }}
                </button>
              </div>
              <pre>{{ newSessionGreetingPromptRender }}</pre>
            </div>
            <div
              v-for="(m, i) in messages"
              :key="i"
              v-show="shouldShowChatMessage(m)"
              :class="[
                'msg',
                m.systemStepLabel
                  ? 'msg-system-step'
                  : (m.role === 'user'
                  ? 'msg-user'
                  : (m.role === 'system' ? 'msg-system-debug msg-system-debug-secondary' : 'msg-assistant')
                  )
              ]"
            >
              <div class="msg-meta">
                <span>{{ m.systemStepLabel ? "Ajatus" : (m.role === "user" ? "You" : (m.role === "system" ? "SYSTEM" : "Agent")) }}</span>
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
                  <span>{{ isTraceLineOpen(i, ti) ? (t.fullText || t.text) : t.text }}</span>
                  <button
                    v-if="t.fullText && t.fullText !== t.text"
                    class="trace-inline-toggle"
                    type="button"
                    @click="toggleTraceLine(i, ti)"
                  >
                    {{ isTraceLineOpen(i, ti) ? "Show less" : "Show full" }}
                  </button>
                </div>
              </div>
              <div
                v-if="m.role === 'system' && m.systemStepLabel"
                class="system-step-pill"
                :title="m.content"
              >
                Ajatus: {{ m.systemStepLabel }}
              </div>
              <pre v-if="!(m.role === 'system' && m.systemStepLabel)">{{ m.content }}</pre>
            </div>
            <div v-if="proposedJobs.length" class="msg msg-assistant msg-suggested">
              <div class="msg-meta">
                <span>Agent</span>
                <span>{{ nowTime() }}</span>
                <span>suggested jobs</span>
                <span class="badge">policy {{ suggestedApprovalMode }}</span>
                <div class="spacer"></div>
                <button
                  v-if="autoCreatableCount > 0"
                  class="btn primary"
                  @click="createProposedJobs('auto')"
                  :disabled="isReadOnly || creatingJobs || sending"
                >
                  {{ creatingJobs ? "Creating..." : `Create auto (${autoCreatableCount})` }}
                </button>
                <button
                  v-if="approvalCreatableCount > 0"
                  class="btn"
                  @click="createProposedJobs('approval')"
                  :disabled="isReadOnly || creatingJobs || sending"
                >
                  {{ creatingJobs ? "Creating..." : `Approve (${approvalCreatableCount})` }}
                </button>
                <button class="btn" @click="createProposedJobs('all')" :disabled="isReadOnly || creatingJobs || sending">
                  {{ creatingJobs ? "Creating..." : `Create all (${totalCreatableCount})` }}
                </button>
              </div>
              <div v-if="queueRestrictedSuggestedCount > 0" class="suggested-job-reasons">
                {{ queueRestrictedSuggestedCount }} suggested job(s) blocked by queue policy (allowed: {{ queueAllowlistLabel }}).
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
                  <span
                    v-if="!isSuggestedQueueAllowed(i)"
                    class="badge suggested-approval-badge"
                    :title="`Allowed queues: ${queueAllowlistLabel}`"
                  >
                    queue blocked
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
            <button
              class="btn primary composer-send"
              @click="sending ? stopCurrentThinking() : sendMessage()"
              :disabled="sending ? stoppingThinking : (isReadOnly || !canSend)"
            >
              {{ sending ? (stoppingThinking ? "Stopping..." : "Stop") : "Send" }}
            </button>
          </div>
          <div class="row" style="margin-top: 8px">
            <span style="color: var(--muted); font-size: 13px">Creates provider-backed chat jobs under the hood.</span>
            <span v-if="sendDisabledReason" style="margin-left: 10px; color: #f59e0b; font-size: 13px">{{ sendDisabledReason }}</span>
          </div>
          <div v-if="isReadOnly" style="margin-top: 6px; color: #f59e0b; font-size: 12px">
            Read-only API key active: chat job creation is disabled.
          </div>
        </div>

        <div v-if="isDevMode && statusMsg" class="chat-status ok">{{ statusMsg }}</div>
        <div v-if="err" class="chat-status err">{{ err }}</div>
      </section>

      <aside class="jobs-column">
        <div class="jobs-split-section">
          <div class="row" style="margin-bottom: 6px">
            <div class="workspace-head">Job List</div>
            <div class="spacer"></div>
            <button class="btn workspace-up" @click="retryFailedSubjobs" :disabled="retryingFailedJobs || !trackedFailedCount">
              {{ retryingFailedJobs ? "Retrying..." : `Retry failed (${trackedFailedCount})` }}
            </button>
            <button class="btn workspace-up" @click="trackedJobs = []" :disabled="!trackedJobs.length">
              Clear
            </button>
          </div>
          <div class="row workspace-jobs-toolbar">
            <select class="select workspace-jobs-status" v-model="trackedStatusFilter">
              <option value="">all statuses</option>
              <option value="active">active</option>
              <option value="terminal">terminal</option>
              <option value="queued">queued</option>
              <option value="running">running</option>
              <option value="succeeded">succeeded</option>
              <option value="failed">failed</option>
              <option value="cancelled">cancelled</option>
            </select>
            <select class="select workspace-jobs-queue" v-model="trackedQueueFilter">
              <option value="">all queues</option>
              <option v-for="qName in trackedQueueOptions" :key="`tracked-q-${qName}`" :value="qName">{{ qName }}</option>
            </select>
            <input
              class="input workspace-jobs-search"
              v-model.trim="trackedSearch"
              placeholder="search id/type/queue"
            />
          </div>
          <div class="workspace-jobs-list">
            <div v-if="!trackedJobsFiltered.length" class="workspace-empty">No created jobs yet.</div>
            <div v-for="j in trackedJobsFiltered" :key="j.id" class="workspace-job-item">
              <span class="workspace-job-id">{{ j.id }}</span>
              <span class="badge">{{ j.type || "job" }}</span>
              <span class="badge">q {{ j.queue || "default" }}</span>
              <span :class="['workspace-job-status', `workspace-job-status-${j.status || 'pending'}`]">
                {{ j.status || "pending" }}
              </span>
              <span class="workspace-job-updated">{{ j.updatedAt || "-" }}</span>
            </div>
          </div>
        </div>

        <div class="jobs-split-section">
          <div class="row" style="margin-bottom: 6px">
            <div class="workspace-head">Working Memory</div>
            <div class="spacer"></div>
            <button class="btn workspace-up" @click="loadWorkingMemoryState" :disabled="workingMemoryLoading">
              {{ workingMemoryLoading ? "Loading..." : "Refresh" }}
            </button>
            <button v-if="workingMemoryState" class="btn workspace-up workspace-danger" @click="clearWorkingMemoryState" :disabled="workingMemoryLoading">
              Clear
            </button>
          </div>
          <div class="workspace-jobs-list working-memory-panel">
            <div v-if="workingMemoryLoading" class="workspace-empty">Loading...</div>
            <div v-else-if="!workingMemoryState" class="workspace-empty">
              No active session.
              <button class="btn" @click="startNewWorkingMemorySession" style="margin-top: 6px">Start Session</button>
            </div>
            <div v-else class="working-memory-content">
              <div v-if="workingMemoryState.current_goal" class="wm-item">
                <strong>Goal:</strong>
                <span>{{ workingMemoryState.current_goal }}</span>
              </div>
              <div v-if="workingMemoryState.active_tasks?.length" class="wm-item">
                <strong>Active Tasks:</strong>
                <ul>
                  <li v-for="(task, idx) in workingMemoryState.active_tasks" :key="idx">
                    {{ task.description }}
                    <span :class="['wm-task-status', `wm-task-status-${task.status}`]">{{ task.status }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="workingMemoryState.completed_steps?.length" class="wm-item">
                <strong>Completed:</strong>
                <ul>
                  <li v-for="(step, idx) in workingMemoryState.completed_steps" :key="idx">✓ {{ step }}</li>
                </ul>
              </div>
              <div v-if="workingMemoryState.blockers?.length" class="wm-item wm-blockers">
                <strong>Blockers:</strong>
                <ul>
                  <li v-for="(b, idx) in workingMemoryState.blockers" :key="idx">
                    🚫 {{ b.description }}
                    <span v-if="b.severity" :class="['wm-severity', `wm-severity-${b.severity}`]">{{ b.severity }}</span>
                  </li>
                </ul>
              </div>
              <div v-if="workingMemoryState.open_questions?.length" class="wm-item">
                <strong>Questions:</strong>
                <ul>
                  <li v-for="(q, idx) in workingMemoryState.open_questions" :key="idx">? {{ q }}</li>
                </ul>
              </div>
            </div>
          </div>
        </div>

        <div class="jobs-split-section jobs-split-bottom">
          <div class="row" style="margin-bottom: 6px">
            <div class="workspace-head">Memory Writes</div>
            <div class="spacer"></div>
            <span class="badge">{{ memoryWritesList.length }}</span>
          </div>
          <div class="workspace-jobs-list">
            <div v-if="!memoryWritesList.length" class="workspace-empty">No memory write events yet.</div>
            <div
              v-for="(item, idx) in memoryWritesList"
              :key="`mw-${idx}-${item.ts}-${item.jobId || ''}`"
              class="workspace-job-item memory-write-item"
              @click="toggleMemoryWriteExpanded(idx)"
            >
              <span class="workspace-job-id">{{ item.ts }}</span>
              <span :class="['workspace-job-status', `workspace-job-status-${item.status}`]">
                {{ item.status }}
              </span>
              <span v-if="item.jobId" class="badge">job {{ item.jobId }}</span>
              <span class="workspace-job-updated">{{ item.label }}</span>
              <button class="trace-inline-toggle" type="button">
                {{ isMemoryWriteExpanded(idx) ? "Collapse" : "Expand" }}
              </button>
              <pre v-if="isMemoryWriteExpanded(idx)" class="memory-write-content">{{ item.content }}</pre>
            </div>
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
          <button class="btn" @click="createWorkspaceFile" :disabled="isReadOnly || workspaceActionLoading">
            New File
          </button>
          <button class="btn" @click="createWorkspaceFolder" :disabled="isReadOnly || workspaceActionLoading">
            New Folder
          </button>
          <button class="btn" @click="renameOrMoveWorkspaceEntry" :disabled="isReadOnly || workspaceActionLoading">
            Rename/Move
          </button>
          <button class="btn" @click="openWorkspaceUploadPicker" :disabled="isReadOnly || workspaceUploadLoading">
            {{ workspaceUploadLoading ? "Uploading..." : "Upload" }}
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
              :disabled="isReadOnly || workspaceFileLoading || workspaceSaveLoading"
            >
              Edit
            </button>
            <button
              v-if="selectedWorkspaceFile?.path && workspaceEditMode"
              class="btn workspace-up"
              @click="saveWorkspaceEdit"
              :disabled="isReadOnly || workspaceSaveLoading"
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
              :disabled="isReadOnly || workspaceSaveLoading || workspaceFileLoading || workspaceUploadLoading"
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
import { normalizeTypeList } from "../suggested_job_policy.js";
import { refreshAuthState, useAuthState } from "../auth_state.js";
import {
  AGENT_SYSTEM_PROMPT_DEFAULT,
  PLANNER_SYSTEM_PROMPT_DEFAULT,
  ROUTER_SYSTEM_PROMPT_DEFAULT,
  SUMMARY_SYSTEM_PROMPT_DEFAULT,
  NEW_SESSION_GREETING_PROMPT_DEFAULT
} from "../chat_prompt_defaults.js";

const AGENT_SYSTEM_PROMPT = AGENT_SYSTEM_PROMPT_DEFAULT;
const PLANNER_SYSTEM_PROMPT = PLANNER_SYSTEM_PROMPT_DEFAULT;

const TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);
const CHAT_SESSION_KEY = "rauskuclaw_chat_session_v1";
const WORKSPACE_AUTO_REFRESH_MS = 5000;

const types = ref([]);
const loadingTypes = ref(false);
const loadingProviders = ref(false);
const selectedType = ref("");
const providerRuntime = ref({ codex: null, openai: null });
const messages = ref([]);
const draft = ref("");
const sending = ref(false);
const stoppingThinking = ref(false);
const pendingChatJob = ref(null);
const creatingJobs = ref(false);
const proposedJobs = ref([]);
const plannerMode = ref(true);
const plannerFeatureEnabled = ref(true);
const routerFeatureEnabled = ref(true);
const autoCreateJobs = ref(false);
const statusMsg = ref("");
const err = ref("");
const chatLogEl = ref(null);
const traceOpen = ref({});
const traceLineOpen = ref({});
const memoryWriteExpanded = ref({});
const showOpsMessages = ref(true);
const isDevMode = ref(false);
const workspacePath = ref(".");
const workspaceEntries = ref([]);
const workspaceLoading = ref(false);
const workspaceError = ref("");
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
const workspaceAutoRefreshInFlight = ref(false);
const trackedJobs = ref([]);
const retryingFailedJobs = ref(false);
const trackedStatusFilter = ref("");
const trackedQueueFilter = ref("");
const trackedSearch = ref("");
const toolDocReadCache = new Set();
const suggestedApprovalMode = ref("smart");
const suggestedAutoMaxTimeoutSec = ref(30);
const suggestedAutoMaxAttempts = ref(1);
const suggestedAutoMaxPriority = ref(5);
const chatMaxPromptTokens = ref(12000);
const suggestedAutoAllowTypes = ref(["report.generate", "memory.write"]);
const chatAgentPromptOverride = ref("");
const chatPlannerPromptOverride = ref("");
const chatRouterPromptOverride = ref("");
const chatSummaryPromptOverride = ref("");
const chatNewSessionPromptOverride = ref("");
const chatNewSessionAutoRun = ref(true);
const chatPromptInjections = ref({
  agent: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true },
  planner: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true },
  router: { agents: false, identity: false, soul: false, user: false, tools_readme: false, memory_md: false, workflows_yaml: false, workflow_tool_md: false },
  summary: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true },
  new_session: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true }
});
const systemPromptExpanded = ref({ active: false, newSession: false });
const copyFeedback = ref({ active: false, newSession: false });
const { isReadOnly, queueAllowlist } = useAuthState();
const queueAllowlistLabel = computed(() => {
  if (!Array.isArray(queueAllowlist.value) || queueAllowlist.value.length < 1) return "all";
  return queueAllowlist.value.join(", ");
});
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

// Working Memory state
const workingMemoryState = ref(null);
const workingMemoryLoading = ref(false);
const workingMemorySessionId = ref(null);

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
const fallbackSendType = computed(() => {
  const codexTypeEnabled = chatTypes.value.some((t) => t.name === "codex.chat.generate");
  const openaiTypeEnabled = chatTypes.value.some((t) => t.name === "ai.chat.generate");
  const codexRuntimeEnabled = providerRuntime.value?.codex?.enabled === true;
  const openaiRuntimeEnabled = providerRuntime.value?.openai?.enabled === true;
  const current = String(selectedType.value || "");

  if (current === "codex.chat.generate" && (!codexRuntimeEnabled) && openaiTypeEnabled && openaiRuntimeEnabled) {
    return "ai.chat.generate";
  }
  if (current === "ai.chat.generate" && (!openaiRuntimeEnabled) && codexTypeEnabled && codexRuntimeEnabled) {
    return "codex.chat.generate";
  }
  return "";
});
const providerConfigWarning = computed(() => {
  const codexTypeEnabled = chatTypes.value.some((t) => t.name === "codex.chat.generate");
  const openaiTypeEnabled = chatTypes.value.some((t) => t.name === "ai.chat.generate");
  const codexRuntimeEnabled = providerRuntime.value?.codex?.enabled === true;
  const openaiRuntimeEnabled = providerRuntime.value?.openai?.enabled === true;

  if (openaiRuntimeEnabled && !openaiTypeEnabled) {
    return "OpenAI provider is enabled at runtime, but ai.chat.generate job type is disabled in Settings > Types.";
  }
  if (codexRuntimeEnabled && !codexTypeEnabled) {
    return "Codex provider is enabled at runtime, but codex.chat.generate job type is disabled in Settings > Types.";
  }
  if (!openaiRuntimeEnabled && openaiTypeEnabled && selectedType.value === "ai.chat.generate") {
    return "ai.chat.generate is enabled, but OpenAI provider runtime is disabled.";
  }
  if (!codexRuntimeEnabled && codexTypeEnabled && selectedType.value === "codex.chat.generate") {
    return "codex.chat.generate is enabled, but Codex provider runtime is disabled.";
  }
  return "";
});
const selectedTypeProviderBlocked = computed(() => {
  if (fallbackSendType.value) return "";
  const typeName = String(selectedType.value || "");
  if (!typeName) return "";
  const codexEnabled = providerRuntime.value?.codex?.enabled;
  const openaiEnabled = providerRuntime.value?.openai?.enabled;
  if (typeName === "codex.chat.generate" && codexEnabled === false) {
    return "codex provider runtime is disabled.";
  }
  if (typeName === "ai.chat.generate" && openaiEnabled === false) {
    return "openai provider runtime is disabled.";
  }
  return "";
});

const canSend = computed(() =>
  !!selectedType.value &&
  String(draft.value || "").trim().length > 0 &&
  canCreateInDefaultQueue.value &&
  !selectedTypeProviderBlocked.value &&
  !memoryValidationError.value &&
  !memoryWriteValidationError.value &&
  !sending.value &&
  !loadingTypes.value
);
const canCreateInDefaultQueue = computed(() => {
  if (!Array.isArray(queueAllowlist.value) || queueAllowlist.value.length < 1) return true;
  return queueAllowlist.value.includes("default");
});

const sendDisabledReason = computed(() => {
  if (isReadOnly.value) return "Read-only API key: chat job creation is disabled.";
  if (!canCreateInDefaultQueue.value) return `API key queue policy blocks chat queue 'default' (allowed: ${queueAllowlistLabel.value}).`;
  if (selectedTypeProviderBlocked.value) return selectedTypeProviderBlocked.value;
  if (sending.value) return "Send in progress.";
  if (loadingTypes.value || loadingProviders.value) return "Loading job types/providers.";
  if (memoryValidationError.value) return memoryValidationError.value;
  if (memoryWriteValidationError.value) return memoryWriteValidationError.value;
  if (!selectedType.value) return "No enabled chat job type. Enable codex.chat.generate or ai.chat.generate in Settings > Job Types.";
  if (fallbackSendType.value) return `Selected chat type will auto-fallback to '${fallbackSendType.value}' because provider runtime is disabled.`;
  if (!String(draft.value || "").trim()) return "Write a message first.";
  return "";
});
const plannerModeEffective = computed(() => plannerFeatureEnabled.value && plannerMode.value === true);
const activeSystemPromptModeLabel = computed(() => (plannerModeEffective.value ? "planner mode" : "chat mode"));
const activeSystemPromptPreview = computed(() =>
  plannerModeEffective.value ? buildPlannerSystemPrompt() : buildAgentSystemPrompt()
);
const newSessionGreetingPromptPreview = computed(() => buildNewSessionGreetingPrompt());
const activeSystemPromptRender = computed(() =>
  renderDebugPrompt(activeSystemPromptPreview.value, systemPromptExpanded.value.active)
);
const newSessionGreetingPromptRender = computed(() =>
  renderDebugPrompt(newSessionGreetingPromptPreview.value, systemPromptExpanded.value.newSession)
);
const activeSystemPromptSourceLabel = computed(() => {
  if (plannerModeEffective.value) return String(chatPlannerPromptOverride.value || "").trim() ? "settings override" : "default";
  return String(chatAgentPromptOverride.value || "").trim() ? "settings override" : "default";
});
const newSessionPromptSourceLabel = computed(() =>
  String(chatNewSessionPromptOverride.value || "").trim() ? "settings override" : "default"
);

const suggestedJobDecisions = computed(() => evaluateSuggestedJobDecisions(proposedJobs.value, {
  mode: suggestedApprovalMode.value,
  maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
  maxAttempts: suggestedAutoMaxAttempts.value,
  maxPriority: suggestedAutoMaxPriority.value,
  allowTypes: suggestedAutoAllowTypes.value
}));
const queueAllowedMask = computed(() =>
  proposedJobs.value.map((job) => {
    const queueName = String(job?.queue || "default").trim() || "default";
    if (!Array.isArray(queueAllowlist.value) || queueAllowlist.value.length < 1) return true;
    return queueAllowlist.value.includes(queueName);
  })
);
const queueRestrictedSuggestedCount = computed(() => queueAllowedMask.value.filter((ok) => !ok).length);
const autoCreatableCount = computed(() =>
  suggestedJobDecisions.value.filter((x, i) => x.auto && queueAllowedMask.value[i]).length
);
const approvalCreatableCount = computed(() =>
  suggestedJobDecisions.value.filter((x, i) => !x.auto && queueAllowedMask.value[i]).length
);
const totalCreatableCount = computed(() => queueAllowedMask.value.filter(Boolean).length);
const trackedJobsFiltered = computed(() => {
  const statusFilter = String(trackedStatusFilter.value || "").trim().toLowerCase();
  const queueFilter = String(trackedQueueFilter.value || "").trim().toLowerCase();
  const needle = String(trackedSearch.value || "").trim().toLowerCase();
  return trackedJobs.value.filter((job) => {
    const status = String(job?.status || "").toLowerCase();
    const queueName = String(job?.queue || "default").toLowerCase();
    const statusOk = !statusFilter ||
      (statusFilter === "active" && (status === "queued" || status === "running")) ||
      (statusFilter === "terminal" && TERMINAL_STATUSES.has(status)) ||
      status === statusFilter;
    if (!statusOk) return false;
    if (queueFilter && queueName !== queueFilter) return false;
    if (!needle) return true;
    const haystack = [
      String(job?.id || "").toLowerCase(),
      String(job?.type || "").toLowerCase(),
      queueName
    ];
    return haystack.some((part) => part.includes(needle));
  });
});
const trackedQueueOptions = computed(() => {
  const uniq = Array.from(new Set(trackedJobs.value.map((j) => String(j?.queue || "default").trim() || "default")));
  return uniq.sort((a, b) => a.localeCompare(b));
});
const trackedFailedCount = computed(() =>
  trackedJobs.value.filter((j) => String(j?.status || "").toLowerCase() === "failed").length
);
const activeChatModelLabel = computed(() => {
  const type = String(selectedType.value || "").trim();
  const codexModel = String(providerRuntime.value?.codex?.model || "").trim();
  const openaiModel = String(providerRuntime.value?.openai?.model || "").trim();
  if (type === "codex.chat.generate") return codexModel || "codex";
  if (type === "ai.chat.generate") return openaiModel || "openai";
  if (codexModel) return codexModel;
  if (openaiModel) return openaiModel;
  return type || "unknown";
});
const memoryWritesList = computed(() =>
  messages.value
    .filter((m) => m?.role === "assistant" && m?.memoryWriteStatus && typeof m.memoryWriteStatus === "object")
    .map((m) => {
      const statusRaw = String(m.memoryWriteStatus?.status || "unknown").toLowerCase();
      const status = statusRaw === "ok"
        ? "succeeded"
        : (statusRaw === "fail" ? "failed" : "running");
      return {
        ts: String(m.ts || ""),
        status,
        label: String(m.memoryWriteStatus?.message || m.memoryWriteStatus?.code || "memory write"),
        jobId: m.jobId ? String(m.jobId) : "",
        content: String(m.content || "")
      };
    })
    .reverse()
);
const codexChatTypeEnabled = computed(() => chatTypes.value.some((t) => t.name === "codex.chat.generate"));
const openaiChatTypeEnabled = computed(() => chatTypes.value.some((t) => t.name === "ai.chat.generate"));
const providerHistoryTokenEstimate = computed(() => estimateMessagesTokenCount(toProviderMessages()));
const routedPromptModePreview = computed(() => decidePromptModeForMessage(String(draft.value || "")));
const routedPromptModeSource = computed(() => {
  if (plannerModeEffective.value) return "manual";
  if (!routerFeatureEnabled.value) return "heuristic";
  return "auto";
});

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

function shouldSkipWorkspaceAutoRefresh() {
  return (
    workspaceAutoRefreshInFlight.value ||
    workspaceLoading.value ||
    workspaceFileLoading.value ||
    workspaceUploadLoading.value ||
    workspaceActionLoading.value ||
    workspaceSaveLoading.value ||
    workspaceEditMode.value ||
    workspaceDragActive.value
  );
}

async function refreshWorkspaceAuto() {
  if (shouldSkipWorkspaceAutoRefresh()) return;
  workspaceAutoRefreshInFlight.value = true;
  try {
    await loadWorkspace(workspacePath.value);
  } catch {
    // keep silent here; explicit actions already surface workspace errors
  } finally {
    workspaceAutoRefreshInFlight.value = false;
  }
}

function nowTime() {
  return new Date().toLocaleTimeString();
}

function isSuggestedQueueAllowed(index) {
  if (!Number.isInteger(index) || index < 0 || index >= queueAllowedMask.value.length) return true;
  return queueAllowedMask.value[index] === true;
}

function resolveSuggestedJobTypeForRuntime(typeName) {
  const current = String(typeName || "").trim();
  const codexRuntimeEnabled = providerRuntime.value?.codex?.enabled === true;
  const openaiRuntimeEnabled = providerRuntime.value?.openai?.enabled === true;

  if (current === "codex.chat.generate" && !codexRuntimeEnabled && openaiRuntimeEnabled && openaiChatTypeEnabled.value) {
    return "ai.chat.generate";
  }
  if (current === "ai.chat.generate" && !openaiRuntimeEnabled && codexRuntimeEnabled && codexChatTypeEnabled.value) {
    return "codex.chat.generate";
  }
  return current;
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
    add(text, fullText = "") {
      const shortText = String(text || "");
      const longText = String(fullText || "");
      steps.push({
        ts: nowTime(),
        text: shortText,
        ...(longText && longText !== shortText ? { fullText: longText } : {})
      });
    },
    list() {
      return steps.slice();
    }
  };
}

function traceShort(text, maxLen = 1200) {
  const s = String(text || "");
  if (s.length <= maxLen) return s;
  return `${s.slice(0, maxLen)} ...(truncated)`;
}

function traceAddPrompt(trace, label, inputObj) {
  const input = inputObj && typeof inputObj === "object" ? inputObj : {};
  const system = String(input.system || "");
  const messages = Array.isArray(input.messages) ? input.messages : [];
  const memory = input.memory && typeof input.memory === "object" ? input.memory : null;
  const memoryWrite = input.memory_write && typeof input.memory_write === "object" ? input.memory_write : null;
  const lastUser = (() => {
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const m = messages[i];
      if (String(m?.role || "") === "user") return String(m?.content || "");
    }
    return "";
  })();
  if (system) {
    const short = `Prompt (${label}) system:\n${traceShort(system)}`;
    const full = `Prompt (${label}) system:\n${system}`;
    trace.add(short, full);
  }
  if (lastUser) {
    const short = `Prompt (${label}) last user:\n${traceShort(lastUser, 800)}`;
    const full = `Prompt (${label}) last user:\n${lastUser}`;
    trace.add(short, full);
  }
  if (memory) {
    const scope = String(memory.scope || "").trim() || "-";
    const topK = Number(memory.top_k);
    const required = memory.required === true;
    trace.add(`Prompt (${label}) memory config: scope='${scope}', top_k=${Number.isFinite(topK) ? topK : "-"}, required=${required}.`);
    const query = String(memory.query || "");
    if (query) {
      const short = `Prompt (${label}) memory query:\n${traceShort(query, 1000)}`;
      const full = `Prompt (${label}) memory query:\n${query}`;
      trace.add(short, full);
    }
  }
  if (memoryWrite) {
    const scope = String(memoryWrite.scope || "").trim() || "-";
    const required = memoryWrite.required === true;
    const key = String(memoryWrite.key || "").trim() || "(auto)";
    trace.add(`Prompt (${label}) memory write: scope='${scope}', key='${key}', required=${required}.`);
  }
}

function traceAddResponse(trace, label, text) {
  const out = String(text || "");
  if (!out) return;
  const short = `Response (${label}):\n${traceShort(out)}`;
  const full = `Response (${label}):\n${out}`;
  trace.add(short, full);
}

function toggleTrace(index) {
  traceOpen.value = { ...traceOpen.value, [index]: !traceOpen.value[index] };
}

function renderDebugPrompt(text, expanded, maxLen = 1200) {
  const raw = String(text || "");
  if (expanded || raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}\n...(truncated, expand to view full prompt)`;
}

function toggleSystemPromptExpanded(kind) {
  const key = kind === "newSession" ? "newSession" : "active";
  systemPromptExpanded.value = {
    ...systemPromptExpanded.value,
    [key]: !systemPromptExpanded.value[key]
  };
}

async function copySystemPrompt(text, kind = "active") {
  const key = kind === "newSession" ? "newSession" : "active";
  try {
    await navigator.clipboard.writeText(String(text || ""));
    copyFeedback.value = { ...copyFeedback.value, [key]: true };
    setTimeout(() => {
      copyFeedback.value = { ...copyFeedback.value, [key]: false };
    }, 900);
  } catch {}
}

function isTraceOpen(index) {
  return !!traceOpen.value[index];
}

function traceLineKey(messageIndex, traceIndex) {
  return `${messageIndex}:${traceIndex}`;
}

function toggleTraceLine(messageIndex, traceIndex) {
  const key = traceLineKey(messageIndex, traceIndex);
  traceLineOpen.value = { ...traceLineOpen.value, [key]: !traceLineOpen.value[key] };
}

function isTraceLineOpen(messageIndex, traceIndex) {
  return !!traceLineOpen.value[traceLineKey(messageIndex, traceIndex)];
}

function shouldShowChatMessage(message) {
  if (showOpsMessages.value) return true;
  const m = message && typeof message === "object" ? message : {};
  if (m.hidden === true) return false;
  if (String(m.role || "") === "system") return false;
  const text = String(m.content || "").trim();
  if (/^Created job\s+[a-f0-9-]{8,}\s+\(/i.test(text)) return false;
  if (m.jobId && /^Created job\s+/i.test(text)) return false;
  return true;
}

function toggleMemoryWriteExpanded(index) {
  const key = String(index);
  memoryWriteExpanded.value = { ...memoryWriteExpanded.value, [key]: !memoryWriteExpanded.value[key] };
}

function isMemoryWriteExpanded(index) {
  return !!memoryWriteExpanded.value[String(index)];
}

function updateMessage(index, patch) {
  if (index < 0 || index >= messages.value.length) return;
  messages.value[index] = { ...messages.value[index], ...patch };
  void scrollChatToBottom();
}

function buildNewSessionGreetingPrompt() {
  return String(chatNewSessionPromptOverride.value || "").trim()
    || NEW_SESSION_GREETING_PROMPT_DEFAULT;
}

async function maybeRunNewSessionGreeting() {
  if (chatNewSessionAutoRun.value !== true) return;
  const prompt = buildNewSessionGreetingPrompt();
  if (!prompt) return;
  if (!selectedType.value) {
    pickDefaultType();
  }
  if (isReadOnly.value) {
    statusMsg.value = "New session created. Greeting skipped (read-only API key).";
    return;
  }
  if (!selectedType.value) {
    statusMsg.value = "New session created. Greeting skipped (no enabled chat type).";
    return;
  }
  const prevPlannerMode = plannerMode.value;
  plannerMode.value = false;
  try {
    await sendMessage({ promptMode: "new_session", forceText: prompt, suppressUserEcho: true });
  } finally {
    plannerMode.value = prevPlannerMode;
  }
}

async function maybeRunIdentitySoulWarmupSummary() {
  if (!chatNewSessionAutoRun.value) return;
  if (isReadOnly.value) return;
  if (!selectedType.value) pickDefaultType();
  const sendType = fallbackSendType.value || selectedType.value || "";
  if (!String(sendType).includes("chat.generate")) return;
  try {
    const payload = {
      type: sendType,
      input: {
        system: buildSummarySystemPrompt(),
        messages: [{
          role: "user",
          content: [
            "Tiivistä IDENTITY.md ja SOUL.md tiiviiksi käytännön työohjeeksi tälle sessiolle.",
            "Muoto: 6-10 lyhyttä bulletia suomeksi.",
            "Vain konkreettiset toimintaa ohjaavat kohdat, ei selittelyä."
          ].join("\n")
        }],
        repo_context: {
          agents: false,
          identity: true,
          soul: true,
          user: false,
          tools_readme: false,
          memory_md: false,
          workflows_yaml: false,
          workflow_tool_md: false
        }
      },
      priority: 5,
      timeout_sec: Math.min(90, selectedTimeoutSec.value || 60),
      max_attempts: 1,
      tags: ["chat", "summary", "warmup"]
    };
    const created = await api.createJob(payload);
    const warmupJobId = String(created?.job?.id || "").trim();
    if (!warmupJobId) return;
    const done = await waitForJobDone(warmupJobId, { timeoutMs: 120000 });
    if (done?.status !== "succeeded") return;
    const summaryText = String(done?.result?.output_text || "").trim();
    if (!summaryText) return;
    messages.value.push({
      role: "assistant",
      content: summaryText.slice(0, 4000),
      ts: nowTime(),
      hidden: true,
      warmup: true,
      jobId: warmupJobId
    });
  } catch {}
}

async function clearChat() {
  await persistSessionHandoffBeforeClear();
  messages.value = [];
  proposedJobs.value = [];
  trackedJobs.value = [];
  toolDocReadCache.clear();
  statusMsg.value = "";
  err.value = "";
  pendingChatJob.value = null;
  draft.value = "";
  plannerMode.value = false;
  traceOpen.value = {};
  traceLineOpen.value = {};
  try { sessionStorage.removeItem(CHAT_SESSION_KEY); } catch {}
  persistChatSession();
  
  // Start new working memory session
  if (!isReadOnly.value) {
    await startNewWorkingMemorySession();
  }
  
  await maybeRunIdentitySoulWarmupSummary();
  await maybeRunNewSessionGreeting();
}

async function persistSessionHandoffBeforeClear() {
  const rows = (Array.isArray(messages.value) ? messages.value : [])
    .filter((m) => {
      const role = String(m?.role || "");
      return role === "user" || role === "assistant";
    });
  if (!rows.length) return;

  const recent = rows.slice(-20).map((m) => compactChatLineForMemory(m, 180));
  const lastUser = [...rows].reverse().find((m) => String(m?.role || "") === "user");
  const lastAssistant = [...rows].reverse().find((m) => String(m?.role || "") === "assistant");

  await storeNearMemoryEvent("session_handoff", {
    closed_at: new Date().toISOString(),
    line_count: rows.length,
    excerpt: recent.join(" | ").slice(0, 6000),
    last_user: String(lastUser?.content || "").slice(0, 1200),
    last_assistant: String(lastAssistant?.content || "").slice(0, 1200)
  });
}

function buildAgentSystemPrompt() {
  const base = String(chatAgentPromptOverride.value || "").trim() || AGENT_SYSTEM_PROMPT;
  const enabled = enabledTypeNames.value;
  const toolTypes = enabled.filter((t) => t.startsWith("tool.") || t.startsWith("tools.") || t === "data.fetch" || t === "data.file_read");
  const lines = [base];
  if (enabled.length) lines.push(`Enabled job types right now: ${enabled.join(", ")}`);
  if (toolTypes.length) lines.push(`Enabled tool job types right now: ${toolTypes.join(", ")}`);
  return lines.join("\n");
}

function buildPlannerSystemPrompt() {
  const base = String(chatPlannerPromptOverride.value || "").trim() || PLANNER_SYSTEM_PROMPT;
  const enabled = enabledTypeNames.value;
  const toolTypes = enabled.filter((t) => t.startsWith("tool.") || t.startsWith("tools.") || t === "data.fetch" || t === "data.file_read");
  const lines = [base];
  if (enabled.length) lines.push(`Enabled job types right now: ${enabled.join(", ")}`);
  if (toolTypes.length) lines.push(`Enabled tool job types right now: ${toolTypes.join(", ")}`);
  return lines.join("\n");
}

function buildRouterSystemPrompt() {
  return String(chatRouterPromptOverride.value || "").trim() || ROUTER_SYSTEM_PROMPT_DEFAULT;
}

function buildSummarySystemPrompt() {
  return String(chatSummaryPromptOverride.value || "").trim()
    || SUMMARY_SYSTEM_PROMPT_DEFAULT;
}

function detectIntentToContinue(text) {
  const s = String(text || "").trim();
  if (!s) return { matched: false, reason: "empty" };
  if (s.length > 420) return { matched: false, reason: "too_long" };
  const lower = s.toLowerCase();
  const hasIntent = /(selvitt|yrit|luen|katso|tarkist|aloitan|tutkin|laitan|haetaan|haen|jatkan|next|seuraavaksi)/i.test(lower);
  const hasConcrete = /(stdout:|stderr:|created job|job\s+[a-f0-9-]{8,}|```|result|löysin|onnistui|epäonnistui|virhe)/i.test(lower);
  if (hasIntent && !hasConcrete) return { matched: true, reason: "intent_without_concrete_output" };
  if (!hasIntent) return { matched: false, reason: "no_intent_phrase" };
  return { matched: false, reason: "already_concrete" };
}

function parseIntentToContinueSignal(text) {
  const raw = String(text || "").trim();
  if (!raw) return { matched: false, reason: "empty", action: "" };
  const m = raw.match(/(?:^|\n)\s*(?:SYSTEM:\s*)?INTENT_TO_CONTINUE\s*:?\s*([^\n]*)/i);
  if (!m) return { matched: false, reason: "not_found", action: "" };
  const action = String(m[1] || "").trim();
  return { matched: true, reason: "signal_found", action };
}

function sanitizeAssistantOutput(text) {
  const raw = String(text || "");
  if (!raw) return "";
  const lines = raw.split(/\r?\n/);
  const blockedLinePatterns = [
    /^\s*intent_to_continue\s*:/i,
    /^\s*(?:system:\s*)?intent_to_continue\s*:\s*strict_shutdown/i,
    /^\s*wait,\s*i should not say that\b/i,
    /\bstrict_shutdown\b/i,
    /\bprotection bypass(?:ing)?\b/i
  ];
  const kept = lines.filter((line) => !blockedLinePatterns.some((rx) => rx.test(String(line || ""))));
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function buildAutoContinuePrompt(originalUserText) {
  const base = String(originalUserText || "").trim();
  return [
    "Jatka heti suoritusta ilman välivahvistusta.",
    base ? `Alkuperäinen pyyntö: ${base.slice(0, 500)}` : "",
    "Tee konkreettiset toimet nyt ja raportoi tulokset (komennot, havainnot, virheet).",
    "Älä vastaa pelkällä suunnitelmalla tai lupauksella."
  ].filter(Boolean).join("\n");
}

function isLikelyMultiStepUserRequest(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return false;
  const verbs = /(etsi|hae|lue|tee|luo|kirjoita|tiivistä|yhteenveto|kooste|raportti|html)/i.test(s);
  const joiners = /\sja\s|sekä|sitten|sen jälkeen|after that/i.test(s);
  const hasSourceAndArtifact = (
    /(webhaku|web search|tools\.web_search|haku)/i.test(s)
    && /(html|raportti|report|sivu|kooste|yhteenveto)/i.test(s)
  );
  return (verbs && joiners) || hasSourceAndArtifact;
}

function isLikelyTaskExecutionRequest(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return false;
  const actionVerb = /(luo|tee|kirjoita|etsi|hae|lue|päivitä|poista|korjaa|aja|suorita|listaa|tiivistä|raportoi|koosta)/i.test(s);
  const toolCue = /(tools?\.|data\.|tool\.|rausku_jobs|subjob|jobi|jobs?)/i.test(s);
  const artifactCue = /(html|raportti|report|yhteenveto|kooste|tiedosto|readme|md|json|csv)/i.test(s);
  const looksLikeQuestionOnly = s.endsWith("?") && !actionVerb && !toolCue;
  if (looksLikeQuestionOnly) return false;
  return isLikelyMultiStepUserRequest(s) || toolCue || (actionVerb && artifactCue) || actionVerb;
}

function decidePromptModeForMessage(text, opts = {}) {
  const forcedMode = String(opts?.promptMode || "").trim();
  if (forcedMode) return forcedMode;
  if (plannerModeEffective.value) return "planner";
  if (!plannerFeatureEnabled.value) return "agent";
  if (isLikelyTaskExecutionRequest(text)) return "planner";
  return "agent";
}

function pushRouterSystemMessage(content, stepLabel = "Router") {
  if (!isDevMode.value) return;
  messages.value.push({
    role: "system",
    content: String(content || ""),
    ts: nowTime(),
    systemStepLabel: String(stepLabel || "Router")
  });
}

function parseRouterMode(text) {
  const s = String(text || "").trim().toLowerCase();
  if (!s) return "";
  if (/\broute\s*:\s*planner\b/.test(s)) return "planner";
  if (/\broute\s*:\s*agent\b/.test(s)) return "agent";
  if (/\bplanner\b/.test(s) && !/\bagent\b/.test(s)) return "planner";
  if (/\bagent\b/.test(s) && !/\bplanner\b/.test(s)) return "agent";
  return "";
}

async function decidePromptModeViaRouterAgent({ text, sendType, providerHistory, trace, assistantIndex }) {
  const fallback = decidePromptModeForMessage(text, {});
  if (!routerFeatureEnabled.value) return fallback;
  if (!sendType) return fallback;
  const routerSystem = buildRouterSystemPrompt();
  const routerMessages = [
    ...((Array.isArray(providerHistory) ? providerHistory : []).slice(-4)),
    { role: "user", content: String(text || "") }
  ];
  const payload = {
    type: sendType,
    input: {
      system: routerSystem,
      messages: routerMessages,
      repo_context: getRepoContextForMode("router")
    },
    priority: 5,
    timeout_sec: Math.min(30, selectedTimeoutSec.value || 30),
    max_attempts: 1,
    tags: ["chat", "router"]
  };
  try {
    const created = await api.createJob(payload);
    const routerJobId = String(created?.job?.id || "").trim();
    if (!routerJobId) return fallback;
    const done = await waitForJobDone(routerJobId);
    if (done?.status !== "succeeded") {
      pushRouterSystemMessage("Router failed, using heuristic route.", "Router fallback");
      return fallback;
    }
    const outText = String(done?.result?.output_text || "").trim() || JSON.stringify(done?.result || {}, null, 2);
    const parsed = parseRouterMode(outText) || fallback;
    pushRouterSystemMessage(`Router decision: ${parsed}`, "Router");
    return parsed;
  } catch {
    pushRouterSystemMessage("Router unavailable, using heuristic route.", "Router fallback");
    return fallback;
  }
}

function buildIntentContinuePrompt(originalUserText, intentAction) {
  const base = String(originalUserText || "").trim();
  const action = String(intentAction || "").trim();
  return [
    "Jatka heti suoritusta ilman välivahvistusta.",
    base ? `Alkuperäinen pyyntö: ${base.slice(0, 500)}` : "",
    action ? `Seuraava konkreettinen askel: ${action.slice(0, 400)}` : "",
    "Jos tehtäväketju ei vielä valmistu tämän askeleen jälkeen, vastaa muodossa: SYSTEM: INTENT_TO_CONTINUE: <seuraava konkreettinen askel>.",
    "Tee kyseinen askel nyt ja raportoi konkreettinen tulos."
  ].filter(Boolean).join("\n");
}

function extractSystemStepLabel(text) {
  const s = String(text || "");
  const m = s.match(/Seuraava konkreettinen askel:\s*(.+)/i);
  if (m && String(m[1] || "").trim()) return String(m[1]).trim().slice(0, 220);
  const first = s.split(/\r?\n/).map((x) => String(x || "").trim()).find(Boolean) || "";
  return first.slice(0, 220);
}

function getMemoryQueryMaxChars() {
  const maxTokens = Math.max(512, Number(chatMaxPromptTokens.value) || 12000);
  const halfPromptTokens = Math.max(256, Math.floor(maxTokens / 2));
  const estimatedChars = halfPromptTokens * 4;
  return Math.max(4000, Math.min(40000, estimatedChars));
}

function compactChatLineForMemory(m, maxLen = 260) {
  const ts = String(m?.ts || "").trim();
  const role = String(m?.role || "").trim() || "unknown";
  const content = String(m?.content || "").replace(/\s+/g, " ").trim();
  const trimmed = content.length > maxLen ? `${content.slice(0, maxLen)}…` : content;
  return `${ts ? `[${ts}] ` : ""}${role}: ${trimmed}`;
}

function sampleEvenly(items, count) {
  const src = Array.isArray(items) ? items : [];
  if (src.length <= count) return src.slice();
  if (count <= 1) return [src[Math.floor(src.length / 2)]];
  const out = [];
  for (let i = 0; i < count; i += 1) {
    const idx = Math.floor((i * (src.length - 1)) / (count - 1));
    out.push(src[idx]);
  }
  return out;
}

function dedupeHistoryItems(historyItems) {
  const src = Array.isArray(historyItems) ? historyItems : [];
  const out = [];
  const seen = new Set();
  for (const m of src) {
    const role = String(m?.role || "").trim().toLowerCase();
    const content = String(m?.content || "").replace(/\s+/g, " ").trim();
    if (!content) continue;
    const key = `${role}::${content}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

function buildBacklogMemoryQuery(userText, historyItems, maxChars = null) {
  const current = String(userText || "").trim();
  const limit = Number.isInteger(Number(maxChars)) && Number(maxChars) > 0
    ? Number(maxChars)
    : getMemoryQueryMaxChars();
  const dedupedHistory = dedupeHistoryItems(historyItems);
  const lines = dedupedHistory
    .slice()
    .reverse()
    .map((m) => compactChatLineForMemory(m, 260))
    .filter(Boolean);
  const rawHistory = lines.join(" | ");

  let historyPart = rawHistory;
  if (rawHistory.length > Math.floor(limit * 0.75)) {
    const recentCount = 8;
    const recent = lines.slice(0, recentCount);
    const older = lines.slice(recentCount);
    const olderSample = sampleEvenly(older, Math.min(6, older.length))
      .map((x) => (x.length > 140 ? `${x.slice(0, 140)}…` : x));
    historyPart = [
      recent.length ? `recent:${recent.join(" | ")}` : "",
      older.length ? `older_compacted:${older.length}msgs` : "",
      olderSample.length ? olderSample.join(" | ") : ""
    ].filter(Boolean).join(" || ");
  }

  const query = [current, historyPart].filter(Boolean).join(" || ");
  return query.slice(0, limit);
}

function dynamicMemoryTopK(userText) {
  const s = String(userText || "").trim();
  if (!s) return 5;
  const shortSimple = s.length <= 120 && s.split(/\s+/).length <= 16 && !isLikelyMultiStepUserRequest(s);
  return shortSimple ? 3 : 5;
}

function ensureMemoryQuery(memoryInput, userText, historyItems) {
  if (!memoryInput || typeof memoryInput !== "object") return null;
  const out = { ...memoryInput };
  const currentQuery = String(out.query || "").trim();
  if (currentQuery) return out;
  const fallbackQuery = buildBacklogMemoryQuery(userText, historyItems);
  if (fallbackQuery) out.query = fallbackQuery;
  out.top_k = dynamicMemoryTopK(userText);
  return out;
}

function buildPlannerAutoMemoryInput(userText, historyItems = []) {
  const scope = String(memory.value?.scope || "").trim() || "agent.chat";
  const query = buildBacklogMemoryQuery(userText, historyItems);
  const baseTopK = dynamicMemoryTopK(userText);
  return {
    scope,
    query,
    top_k: Math.min(6, baseTopK + 1),
    required: false
  };
}

async function storeNearMemoryLine(role, text) {
  const content = String(text || "").trim();
  if (!content || isReadOnly.value) return;
  const scope = String(memory.value?.scope || "").trim() || "agent.chat";
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `chat.line.${role}.${now}.${rand}`.slice(0, 120);
  try {
    await api.createMemory({
      scope,
      key,
      value: {
        role: String(role || "assistant"),
        text: content.slice(0, 4000),
        at: new Date(now).toISOString(),
        source: "chat.ui.near_memory"
      },
      tags: ["chat", "recent", String(role || "assistant")],
      ttl_sec: 86400
    });
  } catch {}
}

async function storeNearMemoryEvent(kind, value) {
  const payload = value && typeof value === "object" ? value : null;
  if (!payload || isReadOnly.value) return;
  const scope = String(memory.value?.scope || "").trim() || "agent.chat";
  const now = Date.now();
  const rand = Math.random().toString(36).slice(2, 8);
  const key = `chat.event.${String(kind || "generic").replace(/[^a-z0-9._:-]/gi, "_")}.${now}.${rand}`.slice(0, 120);
  try {
    await api.createMemory({
      scope,
      key,
      value: {
        kind: String(kind || "generic"),
        ...payload,
        at: new Date(now).toISOString(),
        source: "chat.ui.event_memory"
      },
      tags: ["chat", "event", String(kind || "generic")],
      ttl_sec: 86400
    });
  } catch {}
}

function getRepoContextForMode(mode) {
  const key = mode === "planner" || mode === "router" || mode === "summary" || mode === "new_session" ? mode : "agent";
  const fallback = {
    agents: true,
    identity: true,
    soul: true,
    user: true,
    tools_readme: true,
    memory_md: true,
    workflows_yaml: true,
    workflow_tool_md: true
  };
  const fromPrefs = (chatPromptInjections.value && chatPromptInjections.value[key]) || fallback;
  return {
    agents: fromPrefs.agents !== false,
    identity: fromPrefs.identity !== false,
    soul: fromPrefs.soul !== false,
    user: fromPrefs.user !== false,
    tools_readme: fromPrefs.tools_readme !== false,
    memory_md: fromPrefs.memory_md !== false,
    workflows_yaml: fromPrefs.workflows_yaml !== false,
    workflow_tool_md: fromPrefs.workflow_tool_md !== false
  };
}

function sanitizeRestoredMessages(rawArr) {
  const out = [];
  for (const item of Array.isArray(rawArr) ? rawArr : []) {
    const role = item?.role === "assistant"
      ? "assistant"
      : (item?.role === "system" ? "system" : "user");
    const restored = {
      role,
      content: String(item?.content || ""),
      ts: String(item?.ts || nowTime())
    };
    if (item?.jobId) restored.jobId = String(item.jobId);
    if (item?.hidden === true) restored.hidden = true;
    if (item?.warmup === true) restored.warmup = true;
    if (item?.memoryWriteStatus && typeof item.memoryWriteStatus === "object") {
      restored.memoryWriteStatus = {
        status: String(item.memoryWriteStatus.status || ""),
        code: item.memoryWriteStatus.code ? String(item.memoryWriteStatus.code) : "",
        message: item.memoryWriteStatus.message ? String(item.memoryWriteStatus.message) : ""
      };
    }
    if (role === "assistant" && Array.isArray(item?.trace)) {
      const trace = item.trace
        .map((t) => ({
          ts: String(t?.ts || nowTime()),
          text: String(t?.text || ""),
          ...(t?.fullText ? { fullText: String(t.fullText || "") } : {})
        }))
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
      traceLineOpen.value = {};
    }
    if (Array.isArray(parsed.proposedJobs)) {
      proposedJobs.value = parsed.proposedJobs;
    }
    if (parsed.pendingChatJob && typeof parsed.pendingChatJob === "object") {
      const jobId = String(parsed.pendingChatJob.jobId || "").trim();
      pendingChatJob.value = jobId ? { jobId } : null;
    }
    if (typeof parsed.workingMemorySessionId === "string" && parsed.workingMemorySessionId.trim()) {
      workingMemorySessionId.value = parsed.workingMemorySessionId.trim();
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
        hidden: m.hidden === true,
        warmup: m.warmup === true,
        pending: m.pending === true,
        trace: Array.isArray(m.trace) ? m.trace : [],
        memoryWriteStatus: m.memoryWriteStatus || null
      })),
      proposedJobs: proposedJobs.value,
      pendingChatJob: pendingChatJob.value,
      workingMemorySessionId: workingMemorySessionId.value
    };
    sessionStorage.setItem(CHAT_SESSION_KEY, JSON.stringify(payload));
  } catch {}
}

function applyUiPrefsDefaults(prefsArg = null) {
  const prefs = prefsArg || getUiPrefs();
  isDevMode.value = prefs.devMode === true;
  plannerFeatureEnabled.value = prefs.chatPlannerEnabled !== false;
  routerFeatureEnabled.value = prefs.chatRouterEnabled !== false;
  if (!plannerFeatureEnabled.value) plannerMode.value = false;
  suggestedApprovalMode.value = String(prefs.suggestedApprovalMode || "smart");
  suggestedAutoMaxTimeoutSec.value = Number(prefs.suggestedAutoMaxTimeoutSec) || 30;
  suggestedAutoMaxAttempts.value = Number(prefs.suggestedAutoMaxAttempts) || 1;
  suggestedAutoMaxPriority.value = Number(prefs.suggestedAutoMaxPriority);
  if (!Number.isFinite(suggestedAutoMaxPriority.value)) suggestedAutoMaxPriority.value = 5;
  chatMaxPromptTokens.value = Math.max(512, Number(prefs.chatMaxPromptTokens) || 12000);
  suggestedAutoAllowTypes.value = normalizeTypeList(prefs.suggestedAutoAllowTypes);
  chatAgentPromptOverride.value = String(prefs.chatAgentPrompt || "");
  chatPlannerPromptOverride.value = String(prefs.chatPlannerPrompt || "");
  chatRouterPromptOverride.value = String(prefs.chatRouterPrompt || "");
  chatSummaryPromptOverride.value = String(prefs.chatSummaryPrompt || "");
  chatNewSessionPromptOverride.value = String(prefs.chatNewSessionPrompt || "");
  chatNewSessionAutoRun.value = prefs.chatNewSessionAutoRun !== false;
  if (prefs.chatPromptInjections && typeof prefs.chatPromptInjections === "object") {
    chatPromptInjections.value = prefs.chatPromptInjections;
  }

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
  const hasCurrent = chatTypes.value.some((t) => t.name === selectedType.value);
  const codexType = chatTypes.value.find((t) => t.name === "codex.chat.generate");
  const openaiType = chatTypes.value.find((t) => t.name === "ai.chat.generate");
  const codexEnabled = providerRuntime.value?.codex?.enabled === true;
  const openaiEnabled = providerRuntime.value?.openai?.enabled === true;

  if (hasCurrent) {
    if (selectedType.value === "codex.chat.generate" && providerRuntime.value?.codex?.enabled === false && openaiType && openaiEnabled) {
      selectedType.value = openaiType.name;
      return;
    }
    if (selectedType.value === "ai.chat.generate" && providerRuntime.value?.openai?.enabled === false && codexType && codexEnabled) {
      selectedType.value = codexType.name;
      return;
    }
    return;
  }

  if (codexEnabled && !openaiEnabled && codexType) {
    selectedType.value = codexType.name;
    return;
  }
  if (openaiEnabled && !codexEnabled && openaiType) {
    selectedType.value = openaiType.name;
    return;
  }
  if (codexEnabled && codexType) {
    selectedType.value = codexType.name;
    return;
  }
  if (openaiEnabled && openaiType) {
    selectedType.value = openaiType.name;
    return;
  }
  if (codexType) {
    selectedType.value = codexType.name;
    return;
  }
  if (openaiType) {
    selectedType.value = openaiType.name;
    return;
  }
  if (chatTypes.value[0]) selectedType.value = chatTypes.value[0].name;
}

async function reloadTypes() {
  loadingTypes.value = true;
  loadingProviders.value = true;
  err.value = "";
  try {
    const [typesResp, providersResp] = await Promise.all([
      api.jobTypes(),
      api.runtimeProviders().catch(() => ({ providers: { codex: null, openai: null } }))
    ]);
    types.value = typesResp.types || [];
    providerRuntime.value = providersResp.providers || { codex: null, openai: null };
    pickDefaultType();
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    loadingTypes.value = false;
    loadingProviders.value = false;
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
  if (isReadOnly.value) return;
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
  if (isReadOnly.value) return;
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
  if (isReadOnly.value) return;
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
  if (isReadOnly.value) return;
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
  if (isReadOnly.value) return;
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
  if (isReadOnly.value) return;
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

function estimateMessageTokenCost(message) {
  const role = String(message?.role || "");
  const content = String(message?.content || "");
  const roleCost = role ? Math.ceil(role.length / 6) : 0;
  const contentCost = content ? Math.ceil(content.length / 4) : 0;
  return roleCost + contentCost + 8;
}

function estimateMessagesTokenCount(messagesArr) {
  if (!Array.isArray(messagesArr) || messagesArr.length < 1) return 0;
  return messagesArr.reduce((sum, msg) => sum + estimateMessageTokenCost(msg), 0);
}

function toProviderMessages() {
  const items = [];
  const maxTokens = Math.max(512, Number(chatMaxPromptTokens.value) || 12000);
  for (const m of messages.value) {
    if (m.role !== "user" && m.role !== "assistant") continue;
    if (m.role === "assistant" && m.pending) continue;
    const content = String(m.content || "").trim();
    if (!content) continue;
    items.push({ role: m.role, content });
  }
  if (!items.length) return items;

  const trimmed = [];
  let used = 0;
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const candidate = items[i];
    const cost = estimateMessageTokenCost(candidate);
    if (trimmed.length > 0 && (used + cost > maxTokens)) break;
    trimmed.push(candidate);
    used += cost;
  }
  return trimmed.reverse();
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
      queue: String(patch?.queue || "default"),
      status: String(patch?.status || "pending"),
      updatedAt: nowTime(),
      sourceDef: patch?.sourceDef && typeof patch.sourceDef === "object" ? patch.sourceDef : null
    });
  }
  if (trackedJobs.value.length > 40) trackedJobs.value = trackedJobs.value.slice(0, 40);
}

function buildRetrySourceFromJobApi(job) {
  const j = job && typeof job === "object" ? job : {};
  const type = String(j.type || "").trim();
  if (!type) return null;
  const input = j.input && typeof j.input === "object" ? j.input : {};
  return {
    type,
    queue: String(j.queue || "default").trim() || "default",
    input,
    priority: Number(j.priority) || 5,
    timeout_sec: Number(j.timeout_sec) || 120,
    max_attempts: Number(j.max_attempts) || 1,
    tags: Array.isArray(j.tags) ? j.tags.map((x) => String(x || "").trim()).filter(Boolean) : []
  };
}

async function retryFailedSubjobs() {
  if (isReadOnly.value) {
    err.value = "Read-only API key: retry is disabled.";
    return;
  }
  if (retryingFailedJobs.value) return;
  const failed = trackedJobs.value.filter((j) => String(j?.status || "").toLowerCase() === "failed");
  if (!failed.length) return;

  retryingFailedJobs.value = true;
  err.value = "";
  try {
    const recreated = [];
    for (const item of failed) {
      let sourceDef = (item?.sourceDef && typeof item.sourceDef === "object") ? { ...item.sourceDef } : null;
      if (!sourceDef) {
        try {
          const detail = await api.job(String(item.id || ""));
          sourceDef = buildRetrySourceFromJobApi(detail?.job || null);
        } catch {
          sourceDef = null;
        }
      }
      if (!sourceDef) continue;

      const queueName = String(sourceDef.queue || "default").trim() || "default";
      if (Array.isArray(queueAllowlist.value) && queueAllowlist.value.length > 0 && !queueAllowlist.value.includes(queueName)) {
        continue;
      }
      const resolvedType = resolveSuggestedJobTypeForRuntime(sourceDef.type);
      const jobForCreate = { ...sourceDef, type: resolvedType };
      let r;
      try {
        r = await api.createJob(buildCreateJobPayload(jobForCreate));
      } catch (createErr) {
        const repaired = maybeRepairSuggestedJobForValidationError(
          jobForCreate,
          String(createErr?.data?.error?.message || createErr?.message || ""),
          latestUserMessageText()
        );
        if (!repaired) throw createErr;
        statusMsg.value = `Auto-repaired '${jobForCreate.type}' after validation error; retrying job create.`;
        r = await api.createJob(buildCreateJobPayload(repaired));
        jobForCreate.input = repaired.input;
      }
      const createdId = String(r?.job?.id || "").trim();
      if (!createdId) continue;
      upsertTrackedJob({
        id: createdId,
        type: String(jobForCreate.type || ""),
        queue: queueName,
        status: "queued",
        updatedAt: nowTime(),
        sourceDef: jobForCreate
      });
      recreated.push({ def: jobForCreate, id: createdId });
    }

    if (!recreated.length) {
      statusMsg.value = "No failed jobs could be retried.";
      return;
    }
    statusMsg.value = `Retried ${recreated.length} failed job(s).`;
    void createPostJobsSummary(recreated);
  } catch (e) {
    err.value = e?.message || String(e);
  } finally {
    retryingFailedJobs.value = false;
  }
}

function trimBlock(text, maxLen = 1600) {
  const raw = String(text || "");
  if (raw.length <= maxLen) return raw;
  return `${raw.slice(0, maxLen)}\n...(truncated)`;
}

function formatCreatedJobResultMessage(jobDef, jobDone, jobId) {
  const typeName = String(jobDef?.type || "");
  const status = String(jobDone?.status || "unknown");
  const inputObj = (jobDef && typeof jobDef.input === "object" && !Array.isArray(jobDef.input)) ? jobDef.input : {};
  const toolExecRawCommand = String(inputObj.command || inputObj.cmd || inputObj.script || "").trim();
  const toolExecArgs = Array.isArray(inputObj.args)
    ? inputObj.args.map((x) => String(x || "").trim()).filter(Boolean)
    : [];
  const toolExecPreview = toolExecRawCommand
    ? [toolExecRawCommand, ...toolExecArgs].join(" ")
    : "";
  const toolExecStdout = String(jobDone?.result?.stdout || "").trim();
  const toolExecStderr = String(jobDone?.result?.stderr || "").trim();
  if (status === "succeeded") {
    if (typeName === "tool.exec") {
      return [
        `Created job ${jobId} (${typeName}) finished: succeeded.`,
        toolExecPreview ? `command: ${trimBlock(toolExecPreview, 300)}` : "",
        toolExecStdout ? `stdout:\n${trimBlock(toolExecStdout, 1600)}` : "stdout: (empty)",
        toolExecStderr ? `stderr:\n${trimBlock(toolExecStderr, 1200)}` : ""
      ].filter(Boolean).join("\n\n");
    }
    const output = String(jobDone?.result?.output_text || "").trim() || JSON.stringify(jobDone?.result || {}, null, 2);
    return [
      `Created job ${jobId} (${typeName}) finished: succeeded.`,
      "",
      trimBlock(output)
    ].join("\n");
  }
  const errCode = String(jobDone?.error?.code || "").trim();
  const errMessage = String(jobDone?.error?.message || "Job failed.");
  const stdoutTail = String(jobDone?.error?.details?.stdout_tail || "").trim();
  const stderrTail = String(jobDone?.error?.details?.stderr_tail || "").trim();
  return [
    `Created job ${jobId} (${typeName}) finished: ${status}.`,
    errCode ? `Error code: ${errCode}` : "",
    (typeName === "tool.exec" && toolExecPreview) ? `command: ${trimBlock(toolExecPreview, 300)}` : "",
    errMessage,
    stdoutTail ? `stdout:\n${trimBlock(stdoutTail, 1200)}` : "",
    stderrTail ? `stderr:\n${trimBlock(stderrTail, 1200)}` : ""
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
        allowTypes: suggestedAutoAllowTypes.value,
        enabledTypes: enabledTypeNames.value
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

async function stopCurrentThinking() {
  if (!sending.value || stoppingThinking.value) return;
  const jobId = String(pendingChatJob.value?.jobId || "").trim();
  if (!jobId) {
    statusMsg.value = "No active chat job to cancel.";
    return;
  }
  stoppingThinking.value = true;
  err.value = "";
  statusMsg.value = `Cancelling chat job ${jobId}...`;
  try {
    await api.cancelJob(jobId);
    statusMsg.value = `Chat job ${jobId} cancelled.`;
  } catch (e) {
    err.value = e?.message || String(e);
  } finally {
    stoppingThinking.value = false;
  }
}

async function trackCreatedJobResult(jobDef, jobId) {
  try {
    upsertTrackedJob({
      id: jobId,
      type: String(jobDef?.type || ""),
      queue: String(jobDef?.queue || "default"),
      status: "running",
      updatedAt: nowTime()
    });
    const timeoutSec = Math.max(1, Number(jobDef?.timeout_sec) || 120);
    const done = await waitForJobDone(jobId, {
      timeoutMs: Math.max(45_000, timeoutSec * 1000 + 30_000)
      ,
      onProgress(job) {
        upsertTrackedJob({
          id: jobId,
          type: String(jobDef?.type || ""),
          queue: String(job?.queue || jobDef?.queue || "default"),
          status: String(job?.status || "running"),
          updatedAt: nowTime()
        });
      }
    });
    upsertTrackedJob({
      id: jobId,
      type: String(jobDef?.type || ""),
      queue: String(done?.queue || jobDef?.queue || "default"),
      status: String(done?.status || "succeeded"),
      updatedAt: nowTime()
    });
    const doneStatus = String(done?.status || "succeeded").toLowerCase();
    if (doneStatus === "failed" && jobDef?._auto_retry_attempted !== true) {
      const failText = String(done?.error?.message || "Job failed");
      const repaired = maybeRepairFailedCreatedJob(jobDef, failText);
      if (repaired) {
        messages.value.push({
          role: "assistant",
          ts: nowTime(),
          jobId,
          content: [
            formatCreatedJobResultMessage(jobDef, done, jobId),
            "",
            "Auto-retry: korjataan input virheen perusteella ja yritetään uudelleen kerran."
          ].join("\n")
        });
        const retriedDef = { ...repaired, _auto_retry_attempted: true };
        const retriedCreated = await api.createJob(buildCreateJobPayload(retriedDef));
        const retriedId = String(retriedCreated?.job?.id || "").trim();
        if (retriedId) {
          upsertTrackedJob({
            id: retriedId,
            type: String(retriedDef?.type || ""),
            queue: String(retriedDef?.queue || "default"),
            status: "queued",
            updatedAt: nowTime(),
            sourceDef: retriedDef
          });
          return await trackCreatedJobResult(retriedDef, retriedId);
        }
      }
    }
    messages.value.push({
      role: "assistant",
      ts: nowTime(),
      jobId,
      content: formatCreatedJobResultMessage(jobDef, done, jobId)
    });
    void storeNearMemoryEvent("created_job_result", {
      job_id: jobId,
      type: String(jobDef?.type || ""),
      status: String(done?.status || "succeeded"),
      result: done?.result || null,
      error: done?.error || null
    });
    return {
      jobId,
      type: String(jobDef?.type || ""),
      status: doneStatus,
      result: done?.result || null,
      error: done?.error || null
    };
  } catch (waitErr) {
    upsertTrackedJob({
      id: jobId,
      type: String(jobDef?.type || ""),
      queue: String(jobDef?.queue || "default"),
      status: "failed",
      updatedAt: nowTime()
    });
    messages.value.push({
      role: "assistant",
      ts: nowTime(),
      jobId,
      content: `Created job ${jobId} (${String(jobDef?.type || "")}) status polling failed: ${waitErr?.message || String(waitErr)}`
    });
    return {
      jobId,
      type: String(jobDef?.type || ""),
      status: "failed",
      result: null,
      error: { message: waitErr?.message || String(waitErr) }
    };
  } finally {
    await scrollChatToBottom();
  }
}

async function createPostJobsSummary(createdJobs) {
  const source = Array.isArray(createdJobs) ? createdJobs : [];
  if (!source.length) return;

  const summaryType = fallbackSendType.value || selectedType.value;
  if (!String(summaryType || "").includes("chat.generate")) return;

  const outcomes = await Promise.all(source.map((created) => trackCreatedJobResult(created.def, created.id)));
  const latestUserGoal = latestUserMessageText();
  const compact = outcomes.map((x) => {
    const type = String(x?.type || "");
    const result = x?.result && typeof x.result === "object" ? x.result : {};
    const base = {
      job_id: x?.jobId || "",
      type,
      status: x?.status || "",
      stdout: String(result?.stdout || "").slice(0, 320),
      stderr: String(result?.stderr || "").slice(0, 320),
      output_text: String(
        result?.output_text
        || result?.content_text
        || ""
      ).slice(0, 420),
      error: String(x?.error?.message || "").slice(0, 320)
    };
    if (type === "tools.web_search") {
      const topResults = (Array.isArray(result?.results) ? result.results : [])
        .slice(0, 5)
        .map((r) => ({
          title: String(r?.title || "").slice(0, 160),
          url: String(r?.url || "").slice(0, 300),
          snippet: String(r?.snippet || "").slice(0, 300)
        }));
      return {
        ...base,
        provider: String(result?.provider || ""),
        query: String(result?.query || "").slice(0, 300),
        result_count: Number(result?.result_count) || 0,
        top_results: topResults
      };
    }
    if (type === "tools.file_search") {
      const matches = (Array.isArray(result?.matches) ? result.matches : [])
        .slice(0, 10)
        .map((m) => ({
          path: String(m?.path || "").slice(0, 300),
          is_dir: m?.is_dir === true,
          size: Number(m?.size) || 0
        }));
      return {
        ...base,
        base_path: String(result?.base_path || "").slice(0, 200),
        query: String(result?.query || "").slice(0, 300),
        result_count: Number(result?.result_count) || 0,
        matches
      };
    }
    if (type === "tools.find_in_files") {
      const matches = (Array.isArray(result?.matches) ? result.matches : [])
        .slice(0, 10)
        .map((m) => ({
          path: String(m?.path || "").slice(0, 300),
          line: Number(m?.line) || 0,
          column: Number(m?.column) || 0,
          text: String(m?.text || "").slice(0, 240)
        }));
      return {
        ...base,
        base_path: String(result?.base_path || "").slice(0, 200),
        query: String(result?.query || "").slice(0, 300),
        result_count: Number(result?.result_count) || 0,
        matches
      };
    }
    if (type === "data.file_read") {
      return {
        ...base,
        path: String(result?.path || "").slice(0, 300),
        bytes_read: Number(result?.bytes_read) || 0,
        total_bytes: Number(result?.total_bytes) || 0,
        truncated: result?.truncated === true,
        content_preview: String(result?.content_text || "").slice(0, 1400)
      };
    }
    return base;
  });

  const assistantIndex = messages.value.push({
    role: "assistant",
    content: "Building summary of completed jobs...",
    ts: nowTime(),
    pending: true
  }) - 1;
  try {
    const payload = {
      type: summaryType,
      input: {
        system: buildSummarySystemPrompt(),
        messages: [
          {
            role: "user",
            content: `User request context:\n${String(latestUserGoal || "(unknown)").slice(0, 600)}\n\nSummarize what was done across these jobs in plain Finnish. If tools.web_search found relevant content for the request, include concrete examples from results/snippets (not only source names). If user asked concrete content (like jokes), give that content directly now. Avoid boilerplate "next step" unless extra action is truly needed.\n\n${JSON.stringify(compact)}`
          }
        ],
        repo_context: getRepoContextForMode("summary")
      },
      priority: 5,
      timeout_sec: Math.min(180, selectedTimeoutSec.value || 120),
      max_attempts: 1,
      tags: ["chat", "summary"]
    };
    const created = await api.createJob(payload);
    const summaryJobId = String(created?.job?.id || "").trim();
    if (!summaryJobId) {
      updateMessage(assistantIndex, { content: "Summary skipped: could not create summary job.", pending: false });
      return;
    }
    const done = await waitForJobDone(summaryJobId);
    if (done.status !== "succeeded") {
      const msg = String(done?.error?.message || "Summary job failed");
      updateMessage(assistantIndex, { content: `Summary failed: ${msg}`, pending: false, jobId: summaryJobId });
      return;
    }
    const summaryText = String(done?.result?.output_text || "").trim() || JSON.stringify(done?.result || {}, null, 2);
    updateMessage(assistantIndex, { content: summaryText, pending: false, jobId: summaryJobId });
    void storeNearMemoryLine("assistant", summaryText);
    void storeNearMemoryEvent("summary", {
      job_id: summaryJobId,
      text: summaryText.slice(0, 4000)
    });
  } catch (e) {
    updateMessage(assistantIndex, { content: `Summary failed: ${e?.message || String(e)}`, pending: false });
  }
}

async function sendMessage(opts = {}) {
  const forcedText = String(opts?.forceText || "").trim();
  const internalSend = forcedText.length > 0;
  if (isReadOnly.value) {
    err.value = "Read-only API key: chat job creation is disabled.";
    return;
  }
  if (!internalSend && !canSend.value) return;
  if (internalSend && (
    !selectedType.value
    || !canCreateInDefaultQueue.value
    || !!selectedTypeProviderBlocked.value
    || !!memoryValidationError.value
    || !!memoryWriteValidationError.value
    || sending.value
    || loadingTypes.value
  )) return;
  statusMsg.value = "";
  err.value = "";
  const text = forcedText || String(draft.value || "").trim();
  const rootUserText = String(opts?.rootUserText || text).trim();
  const suppressUserEcho = opts?.suppressUserEcho === true;
  const systemEchoText = String(opts?.systemEchoText || "").trim();
  const providerHistory = toProviderMessages();
  const trace = makeTrace();
  const forcedMode = String(opts?.promptMode || "").trim();
  const autoContinueDepth = Number.isInteger(opts?.autoContinueDepth) ? opts.autoContinueDepth : 0;
  trace.add("User message received.");
  if (!forcedText) draft.value = "";
  proposedJobs.value = [];
  if (!suppressUserEcho) {
    messages.value.push({ role: "user", content: text, ts: nowTime() });
    void storeNearMemoryLine("user", text);
  } else if (systemEchoText) {
    messages.value.push({
      role: "system",
      content: systemEchoText,
      ts: nowTime(),
      systemStepLabel: extractSystemStepLabel(systemEchoText)
    });
    void storeNearMemoryLine("system", systemEchoText);
  }
  const assistantIndex = messages.value.push({
    role: "assistant",
    content: "Processing request...",
    ts: nowTime(),
    trace: trace.list(),
    pending: true
  }) - 1;
  traceOpen.value = { ...traceOpen.value, [assistantIndex]: true };

  sending.value = true;
  let thinkingTimer = null;
  let thinkingStartedAt = 0;
  const startThinkingTicker = () => {
    thinkingStartedAt = Date.now();
    const render = () => {
      const sec = Math.max(0, Math.floor((Date.now() - thinkingStartedAt) / 1000));
      updateMessage(assistantIndex, { content: `Thinking... (${sec}s)` });
    };
    render();
    thinkingTimer = setInterval(render, 1000);
  };
  const stopThinkingTicker = () => {
    if (thinkingTimer) {
      clearInterval(thinkingTimer);
      thinkingTimer = null;
    }
  };
  let resumeAfterLocalTimeout = false;
  try {
    const sendType = fallbackSendType.value || selectedType.value;
    let promptMode = forcedMode || "";
    if (!promptMode) {
      if (plannerModeEffective.value) {
        promptMode = "planner";
      } else {
        if (routerFeatureEnabled.value) {
          promptMode = await decidePromptModeViaRouterAgent({
            text,
            sendType,
            providerHistory,
            trace,
            assistantIndex
          });
        } else {
          trace.add("Router disabled in Settings; using heuristic prompt mode.");
          promptMode = decidePromptModeForMessage(text, opts);
        }
      }
    }
    if (!promptMode) promptMode = decidePromptModeForMessage(text, opts);
    const plannerEnabled = promptMode === "planner";
    trace.add(`Routing selected prompt mode: ${promptMode}.`);
    const allowAutoContinue = !plannerEnabled && promptMode !== "new_session";
    updateMessage(assistantIndex, { trace: trace.list() });
    if (fallbackSendType.value) {
      trace.add(`Selected type '${selectedType.value}' is runtime-disabled. Falling back to '${fallbackSendType.value}'.`);
      statusMsg.value = `Auto-fallback: using ${fallbackSendType.value} (selected ${selectedType.value} is runtime-disabled).`;
    }
    trace.add(`Creating ${plannerEnabled ? "planner" : "chat"} job for type '${sendType}'.`);
    updateMessage(assistantIndex, { trace: trace.list() });
    const configuredMemoryInput = buildMemoryInput(memory.value);
    const autoPlannerMemoryInput = plannerEnabled ? buildPlannerAutoMemoryInput(text, providerHistory) : null;
    const rawMemoryInput = configuredMemoryInput || autoPlannerMemoryInput;
    const memoryInput = ensureMemoryQuery(rawMemoryInput, text, providerHistory);
    const memoryWriteInput = plannerEnabled ? null : buildMemoryWriteInput(memoryWrite.value);
    if (memoryInput) {
      const memoryMode = configuredMemoryInput ? "configured" : "planner-auto";
      trace.add(`Memory context enabled (${memoryMode}; scope='${memoryInput.scope}', top_k=${memoryInput.top_k}, required=${memoryInput.required}).`);
      updateMessage(assistantIndex, { trace: trace.list() });
    }
    if (memoryWriteInput) {
      trace.add(`Memory write enabled (scope='${memoryWriteInput.scope}', required=${memoryWriteInput.required}).`);
      updateMessage(assistantIndex, { trace: trace.list() });
    }
    const payload = {
      type: sendType,
      input: {
        system: plannerEnabled ? buildPlannerSystemPrompt() : buildAgentSystemPrompt(),
        messages: [...providerHistory, { role: "user", content: text }],
        repo_context: getRepoContextForMode(promptMode),
        ...(memoryInput ? { memory: memoryInput } : {}),
        ...(memoryWriteInput ? { memory_write: memoryWriteInput } : {})
      },
      priority: 5,
      timeout_sec: selectedTimeoutSec.value,
      max_attempts: selectedMaxAttempts.value,
      tags: plannerEnabled ? ["chat", "planner"] : ["chat", "agent"]
    };
    traceAddPrompt(trace, plannerEnabled ? "planner" : "chat", payload.input);
    updateMessage(assistantIndex, { trace: trace.list() });
    const created = await api.createJob(payload);
    const jobId = created?.job?.id || "";
    trace.add(`Job created (${jobId || "unknown id"}).`);
    trace.add("Waiting for job completion.");
    updateMessage(assistantIndex, { trace: trace.list(), jobId, content: "Thinking... (0s)" });
    startThinkingTicker();
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

    const memoryContextMeta = done?.result?.memory_context && typeof done.result.memory_context === "object"
      ? done.result.memory_context
      : null;
    if (memoryContextMeta) {
      trace.add(
        `Memory lookup result: scope='${String(memoryContextMeta.scope || "-")}', matches=${Number(memoryContextMeta.match_count) || 0}, top_k=${Number(memoryContextMeta.top_k) || "-"}.`
      );
      if (memoryContextMeta.query) {
        trace.add(`Memory lookup query: ${traceShort(String(memoryContextMeta.query || ""), 220)}`);
      }
      updateMessage(assistantIndex, { trace: trace.list() });
    } else if (memoryInput) {
      trace.add("Memory lookup requested, but provider output had no memory_context metadata.");
      updateMessage(assistantIndex, { trace: trace.list() });
    }

    if (done.status !== "succeeded") {
      stopThinkingTicker();
      const failText = done?.error?.message || "Chat job failed";
      if (memoryInput && String(done?.error?.code || "").trim().toUpperCase() === "MEMORY_CONTEXT_UNAVAILABLE") {
        trace.add(`Memory context unavailable: ${failText}`);
      }
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
    stopThinkingTicker();

    trace.add("Job succeeded, parsing response.");
    const outTextRaw = String(done?.result?.output_text || "").trim() || JSON.stringify(done?.result || {}, null, 2);
    const outText = sanitizeAssistantOutput(outTextRaw);
    traceAddResponse(trace, plannerEnabled ? "planner" : "chat", outText);
    const memoryWriteStatus = parseMemoryWriteStatus({ done, memoryWriteInput });
    trace.add("Checking suggested jobs in response.");
    const flow = parseFilterAndDecideSuggestedJobs({
      text: outText,
      currentType: sendType,
      userText: text,
      policy: {
        mode: suggestedApprovalMode.value,
        maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
        maxAttempts: suggestedAutoMaxAttempts.value,
        maxPriority: suggestedAutoMaxPriority.value,
        allowTypes: suggestedAutoAllowTypes.value,
        enabledTypes: enabledTypeNames.value
      }
    });
    let activeOutText = outText;
    let activeFlow = flow;
    let activeMemoryWriteStatus = memoryWriteStatus;
    let activeJobId = jobId;
    let usedOriginalPlannerText = false;
    if (plannerEnabled && flow.filtered.kept.length < 1) {
      trace.add("Planner returned no valid subjobs. Attempting automatic planner retry/repair.");
    }

    if (plannerEnabled && flow.filtered.kept.length < 1 && !usedOriginalPlannerText) {
      trace.add("Planner response rejected: no valid suggested jobs found. Retrying planner with strict format.");
      updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
      const retryPlannerPayload = {
        type: sendType,
        input: {
          system: buildPlannerSystemPrompt(),
          messages: [
            ...providerHistory,
            { role: "user", content: text },
            { role: "assistant", content: outText },
            {
              role: "user",
              content: "Your previous output was invalid. Return ONLY one valid ```rausku_jobs``` JSON block with enabled types."
            }
          ],
          repo_context: getRepoContextForMode("planner"),
          ...(memoryInput ? { memory: memoryInput } : {})
        },
        priority: 5,
        timeout_sec: selectedTimeoutSec.value,
        max_attempts: 1,
        tags: ["chat", "planner", "retry"]
      };
      traceAddPrompt(trace, "planner retry", retryPlannerPayload.input);
      updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
      const retryPlannerCreated = await api.createJob(retryPlannerPayload);
      const retryPlannerJobId = String(retryPlannerCreated?.job?.id || "").trim();
      if (retryPlannerJobId) {
        activeJobId = retryPlannerJobId;
        pendingChatJob.value = { jobId: retryPlannerJobId };
        persistChatSession();
      }
      trace.add(`Planner retry job created (${retryPlannerJobId || "unknown id"}).`);
      trace.add("Waiting for planner retry completion.");
      updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
      const retryPlannerDone = await waitForJobDone(activeJobId, {
        onProgress(job) {
          trace.add(`Planner retry status changed: ${job.status}`);
          updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
        }
      });
      if (retryPlannerDone.status === "succeeded") {
        const retryPlannerTextRaw = String(retryPlannerDone?.result?.output_text || "").trim() || JSON.stringify(retryPlannerDone?.result || {}, null, 2);
        const retryPlannerText = sanitizeAssistantOutput(retryPlannerTextRaw);
        traceAddResponse(trace, "planner retry", retryPlannerText);
        const retryPlannerFlow = parseFilterAndDecideSuggestedJobs({
          text: retryPlannerText,
          currentType: sendType,
          userText: text,
          policy: {
            mode: suggestedApprovalMode.value,
            maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
            maxAttempts: suggestedAutoMaxAttempts.value,
            maxPriority: suggestedAutoMaxPriority.value,
            allowTypes: suggestedAutoAllowTypes.value,
            enabledTypes: enabledTypeNames.value
          }
        });
        if (retryPlannerFlow.filtered.kept.length > 0) {
          trace.add(`Planner retry recovered ${retryPlannerFlow.filtered.kept.length} subjob(s).`);
          activeOutText = retryPlannerText;
          activeFlow = retryPlannerFlow;
        } else {
          trace.add("Planner retry still produced no valid subjobs. Running plain chat fallback job.");
        }
      } else {
        const retryPlannerFail = String(retryPlannerDone?.error?.message || "Planner retry failed");
        trace.add(`Planner retry failed: ${retryPlannerFail}. Running plain chat fallback job.`);
      }
    }

    if (plannerEnabled && activeFlow.filtered.kept.length < 1 && !usedOriginalPlannerText) {
      updateMessage(assistantIndex, {
        content: "Planner did not produce valid subjobs. Running plain chat reply...",
        pending: true,
        trace: trace.list(),
        jobId: activeJobId
      });

      const fallbackMemoryWriteInput = buildMemoryWriteInput(memoryWrite.value);
      if (fallbackMemoryWriteInput) {
        trace.add(`Fallback memory write enabled (scope='${fallbackMemoryWriteInput.scope}', required=${fallbackMemoryWriteInput.required}).`);
        updateMessage(assistantIndex, { trace: trace.list() });
      }
      const fallbackPayload = {
        type: sendType,
        input: {
          system: buildAgentSystemPrompt(),
          messages: [...providerHistory, { role: "user", content: text }],
          repo_context: getRepoContextForMode("agent"),
          ...(memoryInput ? { memory: memoryInput } : {}),
          ...(fallbackMemoryWriteInput ? { memory_write: fallbackMemoryWriteInput } : {})
        },
        priority: 5,
        timeout_sec: selectedTimeoutSec.value,
        max_attempts: selectedMaxAttempts.value,
        tags: ["chat", "agent", "planner-fallback"]
      };
      traceAddPrompt(trace, "fallback chat", fallbackPayload.input);
      updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
      const fallbackCreated = await api.createJob(fallbackPayload);
      const fallbackJobId = String(fallbackCreated?.job?.id || "").trim();
      activeJobId = fallbackJobId || jobId;
      if (fallbackJobId) {
        pendingChatJob.value = { jobId: fallbackJobId };
        persistChatSession();
      }
      trace.add(`Fallback chat job created (${fallbackJobId || "unknown id"}).`);
      trace.add("Waiting for fallback job completion.");
      updateMessage(assistantIndex, {
        trace: trace.list(),
        jobId: activeJobId
      });
      statusMsg.value = `Planner fallback chat job created: ${fallbackJobId || "unknown id"}`;

      const fallbackDone = await waitForJobDone(activeJobId, {
        onProgress(job) {
          trace.add(`Fallback job status changed: ${job.status}`);
          updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
        }
      });
      if (fallbackDone.status !== "succeeded") {
        const failText = fallbackDone?.error?.message || "Fallback chat job failed";
        trace.add(`Fallback job failed: ${failText}`);
        const fallbackWriteStatus = parseMemoryWriteStatus({ done: fallbackDone, memoryWriteInput: fallbackMemoryWriteInput });
        updateMessage(assistantIndex, {
          content: `Fallback job failed: ${failText}`,
          pending: false,
          trace: trace.list(),
          jobId: activeJobId,
          ...(fallbackWriteStatus ? { memoryWriteStatus: fallbackWriteStatus } : {})
        });
        pendingChatJob.value = null;
        err.value = failText;
        return;
      }
      trace.add("Fallback job succeeded, parsing response.");
      const fallbackTextRaw = String(fallbackDone?.result?.output_text || "").trim() || JSON.stringify(fallbackDone?.result || {}, null, 2);
      activeOutText = sanitizeAssistantOutput(fallbackTextRaw);
      traceAddResponse(trace, "fallback chat", activeOutText);
      activeMemoryWriteStatus = parseMemoryWriteStatus({ done: fallbackDone, memoryWriteInput: fallbackMemoryWriteInput });
      activeFlow = parseFilterAndDecideSuggestedJobs({
        text: activeOutText,
        currentType: sendType,
        userText: text,
        policy: {
          mode: suggestedApprovalMode.value,
          maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
          maxAttempts: suggestedAutoMaxAttempts.value,
          maxPriority: suggestedAutoMaxPriority.value,
          allowTypes: suggestedAutoAllowTypes.value,
          enabledTypes: enabledTypeNames.value
        }
      });

      if (activeFlow.filtered.kept.length < 1) {
        trace.add("Fallback response had no valid subjobs. Running planner repair pass.");
        updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
        const repairPayload = {
          type: sendType,
          input: {
            system: buildPlannerSystemPrompt(),
            messages: [
              ...providerHistory,
              { role: "user", content: text },
              { role: "assistant", content: activeOutText },
              {
                role: "user",
                content: "Convert the assistant response into a valid rausku_jobs block only. Use only enabled job types."
              }
            ],
            repo_context: getRepoContextForMode("planner"),
            ...(memoryInput ? { memory: memoryInput } : {})
          },
          priority: 5,
          timeout_sec: selectedTimeoutSec.value,
          max_attempts: selectedMaxAttempts.value,
          tags: ["chat", "planner", "repair"]
        };
        traceAddPrompt(trace, "planner repair", repairPayload.input);
        updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
        const repairCreated = await api.createJob(repairPayload);
        const repairJobId = String(repairCreated?.job?.id || "").trim();
        if (repairJobId) {
          activeJobId = repairJobId;
          pendingChatJob.value = { jobId: repairJobId };
          persistChatSession();
        }
        trace.add(`Planner repair job created (${repairJobId || "unknown id"}).`);
        trace.add("Waiting for planner repair completion.");
        updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
        const repairDone = await waitForJobDone(activeJobId, {
          onProgress(job) {
            trace.add(`Planner repair status changed: ${job.status}`);
            updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
          }
        });
        if (repairDone.status === "succeeded") {
          const repairTextRaw = String(repairDone?.result?.output_text || "").trim() || JSON.stringify(repairDone?.result || {}, null, 2);
          const repairText = sanitizeAssistantOutput(repairTextRaw);
          traceAddResponse(trace, "planner repair", repairText);
          const repairFlow = parseFilterAndDecideSuggestedJobs({
            text: repairText,
            currentType: sendType,
            userText: text,
            policy: {
              mode: suggestedApprovalMode.value,
              maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
              maxAttempts: suggestedAutoMaxAttempts.value,
              maxPriority: suggestedAutoMaxPriority.value,
              allowTypes: suggestedAutoAllowTypes.value,
              enabledTypes: enabledTypeNames.value
            }
          });
          if (repairFlow.filtered.kept.length > 0) {
            trace.add(`Planner repair recovered ${repairFlow.filtered.kept.length} subjob(s).`);
            activeFlow = repairFlow;
          } else {
            trace.add("Planner repair produced no valid subjobs.");
          }
        } else {
          const repairFail = String(repairDone?.error?.message || "Planner repair failed");
          trace.add(`Planner repair failed: ${repairFail}`);
        }
      }
    }

    if (!plannerEnabled && activeFlow.filtered.kept.length === 1 && isLikelyMultiStepUserRequest(text)) {
      trace.add("Single suggested job for likely multi-step request; running planner expansion.");
      updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
      const expansionPayload = {
        type: sendType,
        input: {
          system: buildPlannerSystemPrompt(),
          messages: [
            ...providerHistory,
            { role: "user", content: text },
            { role: "assistant", content: activeOutText },
            {
              role: "user",
              content: "Expand into a complete multi-step rausku_jobs chain for this request. Use depends_on_idx for true dependencies."
            }
          ],
          repo_context: getRepoContextForMode("planner"),
          ...(memoryInput ? { memory: memoryInput } : {})
        },
        priority: 5,
        timeout_sec: selectedTimeoutSec.value,
        max_attempts: 1,
        tags: ["chat", "planner", "expand"]
      };
      traceAddPrompt(trace, "planner expand", expansionPayload.input);
      const expansionCreated = await api.createJob(expansionPayload);
      const expansionJobId = String(expansionCreated?.job?.id || "").trim();
      if (expansionJobId) {
        activeJobId = expansionJobId;
        pendingChatJob.value = { jobId: expansionJobId };
        persistChatSession();
      }
      const expansionDone = await waitForJobDone(activeJobId, {
        onProgress(job) {
          trace.add(`Planner expand status changed: ${job.status}`);
          updateMessage(assistantIndex, { trace: trace.list(), jobId: activeJobId });
        }
      });
      if (expansionDone.status === "succeeded") {
        const expansionTextRaw = String(expansionDone?.result?.output_text || "").trim() || JSON.stringify(expansionDone?.result || {}, null, 2);
        const expansionText = sanitizeAssistantOutput(expansionTextRaw);
        traceAddResponse(trace, "planner expand", expansionText);
        const expansionFlow = parseFilterAndDecideSuggestedJobs({
          text: expansionText,
          currentType: sendType,
          userText: text,
          policy: {
            mode: suggestedApprovalMode.value,
            maxTimeoutSec: suggestedAutoMaxTimeoutSec.value,
            maxAttempts: suggestedAutoMaxAttempts.value,
            maxPriority: suggestedAutoMaxPriority.value,
            allowTypes: suggestedAutoAllowTypes.value,
            enabledTypes: enabledTypeNames.value
          }
        });
        if (expansionFlow.filtered.kept.length > activeFlow.filtered.kept.length) {
          trace.add(`Planner expansion increased suggested jobs: ${activeFlow.filtered.kept.length} -> ${expansionFlow.filtered.kept.length}.`);
          activeFlow = expansionFlow;
          activeOutText = expansionText;
        }
      }
    }

    proposedJobs.value = activeFlow.filtered.kept;
    let assistantText = activeOutText;
    if (plannerEnabled) {
      if (activeFlow.filtered.kept.length > 0) {
        const lines = activeFlow.filtered.kept.map((j, idx) => {
          const queuePart = j.queue ? `, q=${j.queue}` : "";
          return `${idx + 1}. ${j.type} (p${j.priority}, t=${j.timeout_sec}s, a=${j.max_attempts}${queuePart})`;
        });
        assistantText = [
          "Planner phase complete.",
          "",
          `Generated ${activeFlow.filtered.kept.length} subjob(s):`,
          ...lines,
          "",
          "Review and run from suggested jobs."
        ].join("\n");
      }
    }
    const intentSignal = allowAutoContinue
      ? parseIntentToContinueSignal(assistantText)
      : { matched: false, reason: "planner_mode", action: "" };
    if (allowAutoContinue && autoContinueDepth < 2 && intentSignal.matched) {
      const continuePrompt = buildIntentContinuePrompt(rootUserText, intentSignal.action);
      trace.add(`intent_to_continue signal received; auto-continuing (depth ${autoContinueDepth + 1}).`);
      if (intentSignal.action) trace.add(`intent action: ${traceShort(intentSignal.action, 180)}`);
      if (isDevMode.value) {
        updateMessage(assistantIndex, {
          role: "system",
          content: `INTENT_TO_CONTINUE${intentSignal.action ? `: ${intentSignal.action}` : ""}`,
          pending: false,
          trace: trace.list(),
          jobId: activeJobId
        });
      } else {
        messages.value.splice(assistantIndex, 1);
      }
      pendingChatJob.value = null;
      statusMsg.value = "Agent jatkaa automaattisesti seuraavaan vaiheeseen...";
      setTimeout(() => {
        void sendMessage({
          promptMode: "agent",
          forceText: continuePrompt,
          autoContinueDepth: autoContinueDepth + 1,
          suppressUserEcho: true,
          systemEchoText: continuePrompt,
          rootUserText
        });
      }, 150);
      return;
    }
    const isNoReply = String(assistantText || "").trim().toUpperCase() === "NO_REPLY";
    if (isNoReply) {
      if (isDevMode.value) {
        updateMessage(assistantIndex, {
          role: "system",
          content: "NO_REPLY (suppressed assistant output)",
          pending: false,
          trace: trace.list(),
          jobId: activeJobId
        });
      } else {
        messages.value.splice(assistantIndex, 1);
      }
      pendingChatJob.value = null;
      return;
    }
    updateMessage(assistantIndex, {
      content: assistantText,
      pending: false,
      trace: trace.list(),
      jobId: activeJobId,
      ...(activeMemoryWriteStatus ? { memoryWriteStatus: activeMemoryWriteStatus } : {})
    });
    void storeNearMemoryLine("assistant", assistantText);
    pendingChatJob.value = null;
    if (activeFlow.filtered.dropped > 0) {
      trace.add(`Dropped ${activeFlow.filtered.dropped} duplicate suggested job(s) already covered by this chat run.`);
    }
    if (activeFlow.filtered.kept.length > 0) {
      trace.add(`Found ${activeFlow.filtered.kept.length} suggested job(s).`);
      updateMessage(assistantIndex, { trace: trace.list() });
      statusMsg.value = plannerEnabled
        ? `Planner suggested ${activeFlow.filtered.kept.length} subjob(s).`
        : `Agent suggested ${activeFlow.filtered.kept.length} job(s).`;
      if (autoCreateJobs.value) await createProposedJobs("auto");
    } else {
      if (plannerEnabled) {
        if (usedOriginalPlannerText) {
          trace.add("Planner produced chat-only response (no suggested jobs).");
          statusMsg.value = "Planner ei löytänyt tehtäviä; näytetään plannerin tekstivastaus suoraan.";
        } else {
          trace.add("Planner fallback produced chat-only response (no suggested jobs).");
          statusMsg.value = "Planner ei löytänyt tehtäviä; ajettiin normaali AI-chat vastaus.";
        }
      } else {
        trace.add("No suggested jobs found.");
      }
      updateMessage(assistantIndex, { trace: trace.list() });
      const intentToContinue = allowAutoContinue ? detectIntentToContinue(assistantText) : { matched: false, reason: "planner_mode" };
      if (allowAutoContinue && autoContinueDepth < 1 && intentToContinue.matched) {
        const continuePrompt = buildAutoContinuePrompt(rootUserText);
        trace.add(`intent_to_continue detected (${intentToContinue.reason}); auto-continuing with one internal follow-up prompt.`);
        updateMessage(assistantIndex, { trace: trace.list() });
        statusMsg.value = "Agent jatkaa automaattisesti edellisestä vaiheesta...";
        setTimeout(() => {
          void sendMessage({
            promptMode: "agent",
            forceText: continuePrompt,
            autoContinueDepth: autoContinueDepth + 1,
            suppressUserEcho: true,
            systemEchoText: continuePrompt,
            rootUserText
          });
        }, 250);
      }
    }
  } catch (e) {
    stopThinkingTicker();
    const errText = String(e?.message || String(e));
    const allowedQueues = Array.isArray(e?.data?.error?.details?.allowed_queues)
      ? e.data.error.details.allowed_queues
      : null;
    trace.add(`Error: ${errText}`);
    const hasPendingJob = !!String(pendingChatJob.value?.jobId || "").trim();
    const localWaitTimedOut = /timed out while waiting for completion/i.test(errText);
    if (hasPendingJob && localWaitTimedOut) {
      resumeAfterLocalTimeout = true;
    }
    const errorText = (e?.status === 403 && allowedQueues && allowedQueues.length > 0)
      ? `Agent error: queue policy blocked request (allowed queues: ${allowedQueues.join(", ")}).`
      : (localWaitTimedOut && hasPendingJob)
        ? "Agent processing is still running. UI wait timed out, continuing automatically in background..."
        : `Agent error: ${errText}`;
    updateMessage(assistantIndex, {
      content: errorText,
      pending: hasPendingJob,
      trace: trace.list()
    });
    if (!(localWaitTimedOut && hasPendingJob)) {
      err.value = errorText;
    } else {
      statusMsg.value = "Job still running, auto-resuming polling.";
    }
  } finally {
    stopThinkingTicker();
    sending.value = false;
    persistChatSession();
    if (resumeAfterLocalTimeout) {
      setTimeout(() => { void resumePendingChatJob(); }, 1500);
    }
  }
}

async function createProposedJobs(mode = "all") {
  if (isReadOnly.value) {
    err.value = "Read-only API key: suggested job creation is disabled.";
    return;
  }
  if (!proposedJobs.value.length) return;
  creatingJobs.value = true;
  err.value = "";
  let agentAssistPrompt = "";
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
    const queueRejected = [];
    const providerTypeFallbacks = [];
    const providerRejected = [];
    const managerJobs = [];
    for (const item of validJobs) {
      const j = item.job;
      const queueName = String(j?.queue || "default").trim() || "default";
      if (Array.isArray(queueAllowlist.value) && queueAllowlist.value.length > 0 && !queueAllowlist.value.includes(queueName)) {
        queueRejected.push(`${j?.type || "job"}@${queueName}`);
        continue;
      }
      const resolvedType = resolveSuggestedJobTypeForRuntime(j?.type);
      if (resolvedType !== String(j?.type || "")) {
        providerTypeFallbacks.push(`${String(j?.type || "")} -> ${resolvedType}`);
      }
      const runtimeBlocked = (
        (resolvedType === "codex.chat.generate" && providerRuntime.value?.codex?.enabled === false) ||
        (resolvedType === "ai.chat.generate" && providerRuntime.value?.openai?.enabled === false)
      );
      if (runtimeBlocked) {
        providerRejected.push(`${resolvedType}@runtime-disabled`);
        continue;
      }
      managerJobs.push({
        ...j,
        type: resolvedType,
        queue: queueName,
        _source_index: item.index
      });
    }

    let managerOut = null;
    if (managerJobs.length > 0) {
      managerOut = await api.submitJobIntent({
        jobs: managerJobs,
        user_text: latestUserMessageText(),
        options: { inject_tool_docs: true, repair: true }
      });

      const createdItems = Array.isArray(managerOut?.created_jobs) ? managerOut.created_jobs : [];
      for (const item of createdItems) {
        const row = item?.job || null;
        const createdId = String(row?.id || "").trim();
        if (!createdId) continue;
        ids.push(createdId);
        const sourceIdx = Number(item?.source_idx);
        const managerSource = Number.isInteger(sourceIdx) && sourceIdx > 0 ? managerJobs[sourceIdx - 1] : null;
        const sourceDef = managerSource && typeof managerSource === "object"
          ? { ...managerSource, type: String(managerSource.type || "") }
          : null;
        if (sourceDef && Object.prototype.hasOwnProperty.call(sourceDef, "_source_index")) {
          const originalIdx = Number(sourceDef._source_index);
          if (Number.isInteger(originalIdx)) createdIndexes.add(originalIdx);
          delete sourceDef._source_index;
        }
        upsertTrackedJob({
          id: createdId,
          type: String(row?.type || sourceDef?.type || ""),
          queue: String(row?.queue || sourceDef?.queue || "default"),
          status: "queued",
          updatedAt: nowTime(),
          sourceDef: sourceDef || undefined
        });
        if (String(item?.kind || "") === "intent") {
          createdJobs.push({ def: sourceDef || { type: row?.type, queue: row?.queue, input: row?.input }, id: createdId });
        }
        if (String(item?.kind || "") === "tool_doc") {
          const toolType = String(item?.tool_type || "").trim();
          if (toolType) toolDocReadCache.add(toolType);
        }
      }

      const skipped = Array.isArray(managerOut?.skipped) ? managerOut.skipped : [];
      const firstSkippedMsg = String(skipped[0]?.message || "");
      if (!ids.length && /tools\.file_search requires input\.query/i.test(firstSkippedMsg)) {
        agentAssistPrompt = [
          "Korjaa edellinen suggested job -suunnitelma.",
          "Virhe: tools.file_search requires input.query.",
          "Lisää tools.file_search input.query käyttäjän pyynnön perusteella ja anna uusi validi rausku_jobs-blokki."
        ].join("\n");
      } else if (!ids.length && /system\.memory\.embed\.sync requires input\.memory_id/i.test(firstSkippedMsg)) {
        agentAssistPrompt = [
          "Korjaa edellinen suggested job -suunnitelma.",
          "Virhe: system.memory.embed.sync requires input.memory_id.",
          "Älä käytä system.memory.embed.sync ilman memory_id:tä.",
          "Luo uusi validi rausku_jobs-blokki käyttäjän pyynnön perusteella."
        ].join("\n");
      }
    }
    const modeLabel = normalizedMode === "auto" ? "auto" : (normalizedMode === "approval" ? "approved" : "selected");
    const parts = [];
    if (invalidTypes.length) {
      parts.push(`Skipped unknown/disabled type(s): ${Array.from(new Set(invalidTypes)).join(", ")}`);
    }
    if (queueRejected.length) {
      const allowed = Array.isArray(queueAllowlist.value) && queueAllowlist.value.length > 0
        ? queueAllowlist.value.join(", ")
        : "all";
      parts.push(`Skipped queue-restricted job(s): ${queueRejected.join(", ")} (allowed queues: ${allowed})`);
    }
    if (providerTypeFallbacks.length) {
      parts.push(`Provider runtime fallback applied: ${providerTypeFallbacks.join(", ")}`);
    }
    if (providerRejected.length) {
      parts.push(`Skipped provider-runtime disabled job(s): ${providerRejected.join(", ")}`);
    }
    if (Array.isArray(managerOut?.repairs) && managerOut.repairs.length > 0) {
      parts.push(`Job manager repairs: ${managerOut.repairs.length}`);
    }
    if (Array.isArray(managerOut?.skipped) && managerOut.skipped.length > 0) {
      parts.push(`Manager skipped: ${managerOut.skipped.length}`);
    }
    statusMsg.value = parts.length
      ? `Created ${ids.length} ${modeLabel} job(s). ${parts.join(" | ")}`
      : `Created ${ids.length} ${modeLabel} job(s): ${ids.join(", ")}`;
    proposedJobs.value = proposedJobs.value.filter((_, index) => !createdIndexes.has(index));
    if (createdJobs.length > 0) {
      await createPostJobsSummary(createdJobs);
    }
  } catch (e) {
    err.value = e.message || String(e);
  } finally {
    creatingJobs.value = false;
    if (agentAssistPrompt && !sending.value) {
      const prevPlannerMode = plannerMode.value;
      plannerMode.value = false;
      setTimeout(() => {
        void sendMessage({
          promptMode: "agent",
          forceText: agentAssistPrompt,
          suppressUserEcho: true
        }).finally(() => {
          plannerMode.value = prevPlannerMode;
        });
      }, 150);
    }
  }
}

function normalizeDependsOnIndices(raw, maxIndexExclusive) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const n = Number(item);
    if (!Number.isInteger(n)) continue;
    const idx = n - 1;
    if (idx < 0 || idx >= maxIndexExclusive) continue;
    if (!out.includes(idx)) out.push(idx);
    if (out.length >= 50) break;
  }
  return out;
}

function maybeRepairSuggestedJobForValidationError(jobForCreate, errMessage, userText) {
  const msg = String(errMessage || "").toLowerCase();
  const job = jobForCreate && typeof jobForCreate === "object" ? { ...jobForCreate } : null;
  if (!job || !job.input || typeof job.input !== "object" || Array.isArray(job.input)) return null;
  const type = String(job.type || "").trim();
  const user = String(userText || "").trim();
  const userLines = user.split(/\r?\n/).map((x) => String(x || "").trim()).filter(Boolean);
  const firstUserLine = userLines[0] || user;

  if (type === "tools.file_search" && /requires input\.query/.test(msg)) {
    const fallbackQuery = deriveFileSearchQueryFromUserText(user) || "README";
    return {
      ...job,
      input: {
        ...job.input,
        query: fallbackQuery
      }
    };
  }
  if (type === "tools.web_search" && /requires input\.query/.test(msg)) {
    const fallbackQuery = user.slice(0, 200) || "latest release notes";
    return {
      ...job,
      input: {
        ...job.input,
        query: fallbackQuery
      }
    };
  }
  if (type === "data.file_read" && /requires input\.path/.test(msg)) {
    const pathMatch = user.match(/([A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,10})/);
    const fallbackPath = String(pathMatch?.[1] || "").trim() || "README.md";
    return {
      ...job,
      input: {
        ...job.input,
        path: fallbackPath
      }
    };
  }
  if (type === "tool.exec" && /requires input\.command/.test(msg)) {
    const fallbackCommand = firstUserLine || "echo no-command-provided";
    return {
      ...job,
      input: {
        ...job.input,
        command: fallbackCommand
      }
    };
  }
  if (type === "data.fetch" && /requires input\.url/.test(msg)) {
    const urlMatch = user.match(/https:\/\/[^\s)]+/i);
    if (!urlMatch) return null;
    return {
      ...job,
      input: {
        ...job.input,
        url: String(urlMatch[0] || "").trim()
      }
    };
  }
  if (type === "data.write_file" && /input\.content_base64 must be base64 text/.test(msg)) {
    const content = job.input.content;
    const rawB64 = String(job.input.content_base64 || "");
    if (content != null) {
      const nextInput = { ...job.input };
      delete nextInput.content_base64;
      return {
        ...job,
        input: nextInput
      };
    }
    if (rawB64.trim()) {
      const encoded = btoa(unescape(encodeURIComponent(rawB64)));
      return {
        ...job,
        input: {
          ...job.input,
          content_base64: encoded
        }
      };
    }
    return null;
  }
  if (type === "data.write_file" && /input\.content and input\.content_base64 are mutually exclusive/.test(msg)) {
    const nextInput = { ...job.input };
    delete nextInput.content_base64;
    return {
      ...job,
      input: nextInput
    };
  }
  return null;
}

function maybeRepairFailedCreatedJob(jobDef, errMessage) {
  const job = jobDef && typeof jobDef === "object" ? { ...jobDef } : null;
  if (!job || !job.input || typeof job.input !== "object" || Array.isArray(job.input)) return null;
  const type = String(job.type || "").trim();
  const msg = String(errMessage || "").toLowerCase();

  if (type === "data.write_file") {
    if (
      /file not found/.test(msg)
      || /parent directory does not exist/.test(msg)
      || /no such file or directory/.test(msg)
    ) {
      return {
        ...job,
        input: {
          ...job.input,
          create_if_missing: true,
          mkdir_p: true
        }
      };
    }
  }
  return null;
}

function deriveFileSearchQueryFromUserText(userText) {
  const s = String(userText || "").trim();
  if (!s) return "";
  const directPath = s.match(/([A-Za-z0-9._/-]+\.[A-Za-z0-9]{1,10})/);
  if (directPath?.[1]) return String(directPath[1]).trim();
  if (/readme/i.test(s)) return /readme\.md/i.test(s) ? "README.md" : "README";
  if (/agents\.md/i.test(s)) return "AGENTS.md";
  if (/identity\.md/i.test(s)) return "IDENTITY.md";
  if (/soul\.md/i.test(s)) return "SOUL.md";
  if (/user\.md/i.test(s)) return "USER.md";
  if (/memory\.md/i.test(s)) return "rauskuAssets/MEMORY.md";
  if (/plan\.md/i.test(s)) return "PLAN.md";
  const words = s
    .split(/\s+/)
    .map((w) => w.replace(/[^A-Za-z0-9._-]/g, ""))
    .filter(Boolean);
  const short = words.find((w) => w.length >= 3 && w.length <= 40);
  return short || "";
}

function toolDocPathForType(typeName) {
  const type = String(typeName || "").trim();
  if (!type) return "";
  if (!/^(tool|tools|data)\./.test(type)) return "";
  return `tools/${type}/TOOL.md`;
}

function isToolDocReadJob(job) {
  const type = String(job?.type || "").trim();
  if (type !== "data.file_read") return false;
  const path = String(job?.input?.path || "").trim().replace(/^workspace\/+/, "");
  return /(^|\/)tools\/[^/]+\/TOOL\.md$/i.test(path);
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

// Working Memory functions
async function loadWorkingMemoryState() {
  workingMemoryLoading.value = true;
  try {
    // If we have a stored session ID, try to load that specific session first
    if (workingMemorySessionId.value) {
      try {
        const resp = await api.workingMemory({ session_id: workingMemorySessionId.value });
        if (resp?.state) {
          workingMemoryState.value = resp.state;
          return;
        }
      } catch {
        // Fall through to loading latest
      }
    }
    // Fall back to loading the latest session
    const resp = await api.workingMemoryLatest();
    workingMemoryState.value = resp?.state || null;
    if (workingMemoryState.value?.session_id) {
      workingMemorySessionId.value = workingMemoryState.value.session_id;
    }
  } catch {
    workingMemoryState.value = null;
  } finally {
    workingMemoryLoading.value = false;
  }
}

async function startNewWorkingMemorySession() {
  if (isReadOnly.value) {
    err.value = "Read-only API key: working memory is disabled.";
    return;
  }
  workingMemoryLoading.value = true;
  try {
    // Generate session ID: session.<timestamp36>.<random6>
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 8);
    const sessionId = `session.${ts}.${rand}`;
    
    const resp = await api.saveWorkingMemory({
      session_id: sessionId,
      state: {
        current_goal: "",
        active_tasks: [],
        completed_steps: [],
        blockers: [],
        open_questions: [],
        context_summary: ""
      }
    });
    workingMemoryState.value = resp?.state || null;
    workingMemorySessionId.value = sessionId;
    persistChatSession();
    statusMsg.value = "Started new working memory session.";
  } catch (e) {
    err.value = e?.message || "Failed to start working memory session.";
  } finally {
    workingMemoryLoading.value = false;
  }
}

async function clearWorkingMemoryState() {
  if (!workingMemoryState.value?.session_id) return;
  if (!window.confirm("Clear the current working memory session?")) return;
  workingMemoryLoading.value = true;
  try {
    await api.clearWorkingMemory(workingMemoryState.value.session_id);
    workingMemoryState.value = null;
    statusMsg.value = "Working memory session cleared.";
    
    // Auto-start new session after clear
    if (!isReadOnly.value) {
      await startNewWorkingMemorySession();
    }
  } catch (e) {
    err.value = e?.message || "Failed to clear working memory session.";
  } finally {
    workingMemoryLoading.value = false;
  }
}

onMounted(async () => {
  await refreshAuthState();
  restoreChatSession();
  const prefs = await loadUiPrefsFromApi();
  applyUiPrefsDefaults(prefs);
  await reloadTypes();
  await loadWorkspace(".");
  await resumePendingChatJob();
  await scrollChatToBottom();
  
  // Load or create working memory session automatically
  await loadWorkingMemoryState();
  if (!workingMemoryState.value && !isReadOnly.value) {
    await startNewWorkingMemorySession();
  }
});

const workspaceAutoRefreshHandle = setInterval(() => {
  void refreshWorkspaceAuto();
}, WORKSPACE_AUTO_REFRESH_MS);

onUnmounted(() => {
  clearInterval(workspaceAutoRefreshHandle);
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
  grid-template-columns: minmax(0, 50%) minmax(260px, 20%) minmax(320px, 30%);
  gap: 12px;
  height: 100%;
  min-height: 0;
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
  gap: 10px;
}

.jobs-split-section {
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
}

.jobs-split-bottom {
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 8px;
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

.workspace-jobs-toolbar {
  gap: 6px;
  margin-bottom: 8px;
}

.workspace-jobs-status {
  width: 120px;
}

.workspace-jobs-queue {
  width: 120px;
}

.workspace-jobs-search {
  flex: 1;
  min-width: 110px;
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

.memory-write-item {
  flex-wrap: wrap;
  cursor: pointer;
}

.memory-write-content {
  width: 100%;
  margin: 4px 0 0;
  padding: 8px;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
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

.workspace-job-updated {
  color: var(--muted);
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

.msg-system-debug {
  background: rgba(255, 107, 107, 0.1);
  border-color: rgba(255, 107, 107, 0.35);
}

.msg-system-debug-secondary {
  background: rgba(255, 140, 120, 0.08);
  border-color: rgba(255, 140, 120, 0.3);
}

.msg-system-step {
  background: rgba(255, 160, 120, 0.08);
  border-color: rgba(255, 160, 120, 0.28);
}

.system-step-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  font-size: 12px;
  color: #ffd8cf;
  background: rgba(255, 130, 110, 0.14);
  border: 1px solid rgba(255, 130, 110, 0.35);
  border-radius: 999px;
  padding: 4px 10px;
  margin-bottom: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

.trace-inline-toggle {
  margin-left: auto;
  border: 1px solid var(--border);
  background: rgba(255, 255, 255, 0.03);
  color: var(--muted);
  border-radius: 999px;
  font-size: 11px;
  padding: 1px 8px;
  cursor: pointer;
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

/* Working Memory styles */
.working-memory-panel {
  font-size: 12px;
}

.working-memory-content {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wm-item {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 6px 8px;
  background: rgba(0, 0, 0, 0.14);
}

.wm-item strong {
  color: #9fc2ff;
  font-size: 11px;
  margin-bottom: 4px;
  display: block;
}

.wm-item ul {
  list-style: none;
  padding: 0;
  margin: 4px 0 0;
}

.wm-item li {
  padding: 2px 0;
  color: var(--muted);
  font-size: 11px;
}

.wm-blockers {
  border-color: rgba(255, 123, 114, 0.35);
  background: rgba(255, 107, 107, 0.06);
}

.wm-task-status {
  border-radius: 999px;
  border: 1px solid var(--border);
  padding: 0 6px;
  font-size: 10px;
  margin-left: 6px;
}

.wm-task-status-pending {
  color: #e3b341;
  border-color: rgba(227, 179, 65, 0.45);
}

.wm-task-status-in_progress {
  color: #9fc2ff;
  border-color: rgba(159, 194, 255, 0.45);
}

.wm-task-status-completed {
  color: #7ee787;
  border-color: rgba(126, 231, 135, 0.45);
}

.wm-task-status-blocked {
  color: #ff7b72;
  border-color: rgba(255, 123, 114, 0.45);
}

.wm-severity {
  border-radius: 999px;
  border: 1px solid rgba(255, 123, 114, 0.45);
  padding: 0 6px;
  font-size: 10px;
  margin-left: 6px;
  color: #ff9d97;
}

.wm-severity-high {
  color: #ff7b72;
  border-color: rgba(255, 123, 114, 0.65);
}

.wm-severity-medium {
  color: #e3b341;
  border-color: rgba(227, 179, 65, 0.55);
}

.wm-severity-low {
  color: #9fc2ff;
  border-color: rgba(159, 194, 255, 0.45);
}
</style>
