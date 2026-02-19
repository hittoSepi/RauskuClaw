<template>
  <div class="card prompts-shell">
    <div class="row" style="align-items: center; margin-bottom: 8px">
      <div class="settings-flag-title">Chat Prompt Overrides</div>
      <div class="spacer"></div>
      <span class="settings-auth-muted">Fields are prefilled with current built-in defaults.</span>
    </div>

    <div class="settings-flags">
      <label class="settings-flag">
        <div class="row" style="align-items: center; gap: 8px">
          <span class="settings-label">Agent system prompt override</span>
          <div class="spacer"></div>
          <button class="btn" type="button" @click="chatAgentPrompt = AGENT_SYSTEM_PROMPT_DEFAULT">Reset to default</button>
        </div>
        <textarea class="input" v-model="chatAgentPrompt" rows="8" style="width: 100%; resize: vertical"></textarea>
      </label>
      <label class="settings-flag">
        <div class="row" style="align-items: center; gap: 8px">
          <span class="settings-label">Planner system prompt override</span>
          <div class="spacer"></div>
          <button class="btn" type="button" @click="chatPlannerPrompt = PLANNER_SYSTEM_PROMPT_DEFAULT">Reset to default</button>
        </div>
        <textarea class="input" v-model="chatPlannerPrompt" rows="8" style="width: 100%; resize: vertical"></textarea>
      </label>
      <label class="settings-flag">
        <div class="row" style="align-items: center; gap: 8px">
          <span class="settings-label">Router system prompt override</span>
          <div class="spacer"></div>
          <button class="btn" type="button" @click="chatRouterPrompt = ROUTER_SYSTEM_PROMPT_DEFAULT">Reset to default</button>
        </div>
        <textarea class="input" v-model="chatRouterPrompt" rows="6" style="width: 100%; resize: vertical"></textarea>
      </label>
      <label class="settings-flag">
        <div class="row" style="align-items: center; gap: 8px">
          <span class="settings-label">Summary system prompt override</span>
          <div class="spacer"></div>
          <button class="btn" type="button" @click="chatSummaryPrompt = SUMMARY_SYSTEM_PROMPT_DEFAULT">Reset to default</button>
        </div>
        <textarea class="input" v-model="chatSummaryPrompt" rows="6" style="width: 100%; resize: vertical"></textarea>
      </label>
      <label class="settings-flag">
        <div class="row" style="align-items: center; gap: 8px">
          <span class="settings-label">New session greeting prompt (Clear)</span>
          <div class="spacer"></div>
          <button class="btn" type="button" @click="chatNewSessionPrompt = NEW_SESSION_GREETING_PROMPT_DEFAULT">Reset to default</button>
        </div>
        <textarea class="input" v-model="chatNewSessionPrompt" rows="5" style="width: 100%; resize: vertical"></textarea>
        <label class="row" style="align-items: center; gap: 8px; margin-top: 8px">
          <input type="checkbox" v-model="chatNewSessionAutoRun" />
          <span class="settings-auth-muted">Auto-run greeting when pressing Clear in Chat</span>
        </label>
      </label>
      <section class="settings-flag" v-if="!isReadOnly">
        <div class="row" style="align-items: center; gap: 8px; margin-bottom: 6px">
          <span class="settings-label">Repo context injections (admin)</span>
        </div>
        <div class="settings-auth-muted" style="margin-bottom: 8px">
          Choose which context files are injected per prompt mode.
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; margin-bottom: 6px">
          <span class="badge">agent</span>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.agents" /> AGENTS</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.identity" /> IDENTITY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.soul" /> SOUL</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.user" /> USER</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.tools_readme" /> tools README</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.memory_md" /> MEMORY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.workflows_yaml" /> workflows.yaml</label>
          <label><input type="checkbox" v-model="chatPromptInjections.agent.workflow_tool_md" /> workflow.run TOOL</label>
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; margin-bottom: 6px">
          <span class="badge">planner</span>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.agents" /> AGENTS</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.identity" /> IDENTITY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.soul" /> SOUL</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.user" /> USER</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.tools_readme" /> tools README</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.memory_md" /> MEMORY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.workflows_yaml" /> workflows.yaml</label>
          <label><input type="checkbox" v-model="chatPromptInjections.planner.workflow_tool_md" /> workflow.run TOOL</label>
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; margin-bottom: 6px">
          <span class="badge">router</span>
          <label><input type="checkbox" v-model="chatPromptInjections.router.agents" /> AGENTS</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.identity" /> IDENTITY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.soul" /> SOUL</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.user" /> USER</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.tools_readme" /> tools README</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.memory_md" /> MEMORY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.workflows_yaml" /> workflows.yaml</label>
          <label><input type="checkbox" v-model="chatPromptInjections.router.workflow_tool_md" /> workflow.run TOOL</label>
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap; margin-bottom: 6px">
          <span class="badge">summary</span>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.agents" /> AGENTS</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.identity" /> IDENTITY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.soul" /> SOUL</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.user" /> USER</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.tools_readme" /> tools README</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.memory_md" /> MEMORY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.workflows_yaml" /> workflows.yaml</label>
          <label><input type="checkbox" v-model="chatPromptInjections.summary.workflow_tool_md" /> workflow.run TOOL</label>
        </div>
        <div class="row" style="gap: 12px; flex-wrap: wrap">
          <span class="badge">new_session</span>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.agents" /> AGENTS</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.identity" /> IDENTITY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.soul" /> SOUL</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.user" /> USER</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.tools_readme" /> tools README</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.memory_md" /> MEMORY</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.workflows_yaml" /> workflows.yaml</label>
          <label><input type="checkbox" v-model="chatPromptInjections.new_session.workflow_tool_md" /> workflow.run TOOL</label>
        </div>
      </section>
    </div>
  </div>
</template>

<script setup>
import { onMounted, ref, watch } from "vue";
import {
  getUiPrefs,
  loadUiPrefsFromApi,
  setChatAgentPrompt,
  setChatPlannerPrompt,
  setChatRouterPrompt,
  setChatSummaryPrompt,
  setChatNewSessionPrompt,
  setChatNewSessionAutoRun,
  setChatPromptInjections
} from "../ui_prefs.js";
import { refreshAuthState, useAuthState } from "../auth_state.js";
import {
  AGENT_SYSTEM_PROMPT_DEFAULT,
  PLANNER_SYSTEM_PROMPT_DEFAULT,
  ROUTER_SYSTEM_PROMPT_DEFAULT,
  SUMMARY_SYSTEM_PROMPT_DEFAULT,
  NEW_SESSION_GREETING_PROMPT_DEFAULT
} from "../chat_prompt_defaults.js";

const prefs = getUiPrefs();
const chatAgentPrompt = ref(prefs.chatAgentPrompt || AGENT_SYSTEM_PROMPT_DEFAULT);
const chatPlannerPrompt = ref(prefs.chatPlannerPrompt || PLANNER_SYSTEM_PROMPT_DEFAULT);
const chatRouterPrompt = ref(prefs.chatRouterPrompt || ROUTER_SYSTEM_PROMPT_DEFAULT);
const chatSummaryPrompt = ref(prefs.chatSummaryPrompt || SUMMARY_SYSTEM_PROMPT_DEFAULT);
const chatNewSessionPrompt = ref(prefs.chatNewSessionPrompt || NEW_SESSION_GREETING_PROMPT_DEFAULT);
const chatNewSessionAutoRun = ref(prefs.chatNewSessionAutoRun !== false);
const chatPromptInjections = ref(prefs.chatPromptInjections || {
  agent: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true },
  planner: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true },
  router: { agents: false, identity: false, soul: false, user: false, tools_readme: false, memory_md: false, workflows_yaml: false, workflow_tool_md: false },
  summary: { agents: false, identity: false, soul: false, user: false, tools_readme: false, memory_md: false, workflows_yaml: false, workflow_tool_md: false },
  new_session: { agents: true, identity: true, soul: true, user: true, tools_readme: true, memory_md: true, workflows_yaml: true, workflow_tool_md: true }
});
const { isReadOnly } = useAuthState();

onMounted(async () => {
  await refreshAuthState();
  const loaded = await loadUiPrefsFromApi();
  chatAgentPrompt.value = loaded.chatAgentPrompt || AGENT_SYSTEM_PROMPT_DEFAULT;
  chatPlannerPrompt.value = loaded.chatPlannerPrompt || PLANNER_SYSTEM_PROMPT_DEFAULT;
  chatRouterPrompt.value = loaded.chatRouterPrompt || ROUTER_SYSTEM_PROMPT_DEFAULT;
  chatSummaryPrompt.value = loaded.chatSummaryPrompt || SUMMARY_SYSTEM_PROMPT_DEFAULT;
  chatNewSessionPrompt.value = loaded.chatNewSessionPrompt || NEW_SESSION_GREETING_PROMPT_DEFAULT;
  chatNewSessionAutoRun.value = loaded.chatNewSessionAutoRun !== false;
  chatPromptInjections.value = loaded.chatPromptInjections || chatPromptInjections.value;
});

watch(chatAgentPrompt, (v) => setChatAgentPrompt(v));
watch(chatPlannerPrompt, (v) => setChatPlannerPrompt(v));
watch(chatRouterPrompt, (v) => setChatRouterPrompt(v));
watch(chatSummaryPrompt, (v) => setChatSummaryPrompt(v));
watch(chatNewSessionPrompt, (v) => setChatNewSessionPrompt(v));
watch(chatNewSessionAutoRun, (v) => setChatNewSessionAutoRun(v));
watch(chatPromptInjections, (v) => setChatPromptInjections(v), { deep: true });
</script>

<style scoped>
.prompts-shell {
  min-height: 0;
}
</style>
