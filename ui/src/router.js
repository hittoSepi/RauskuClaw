import { createRouter, createWebHistory } from "vue-router";
import Jobs from "./pages/Jobs.vue";
import JobDetail from "./pages/JobDetail.vue";
import Types from "./pages/Types.vue";
import CreateJob from "./pages/CreateJob.vue";
import Chat from "./pages/Chat.vue";
import Schedules from "./pages/Schedules.vue";
import Settings from "./pages/Settings.vue";
import Memory from "./pages/Memory.vue";

export default createRouter({
  history: createWebHistory("/ui/"),
  routes: [
    { path: "/", redirect: "/chat" },
    { path: "/chat", component: Chat },
    {
      path: "/settings",
      component: Settings,
      children: [
        { path: "", redirect: "/settings/jobs" },
        { path: "jobs", component: Jobs },
        { path: "jobs/new", component: CreateJob },
        { path: "jobs/:id", component: JobDetail, props: true },
        { path: "schedules", component: Schedules },
        { path: "types", component: Types },
        { path: "memory", component: Memory },
        { path: "memory-reset", redirect: "/settings/memory" }
      ]
    },

    // Legacy route compatibility redirects.
    { path: "/jobs", redirect: "/settings/jobs" },
    { path: "/jobs/new", redirect: "/settings/jobs/new" },
    { path: "/jobs/:id", redirect: (to) => `/settings/jobs/${encodeURIComponent(String(to.params.id || ""))}` },
    { path: "/schedules", redirect: "/settings/schedules" },
    { path: "/types", redirect: "/settings/types" }
  ]
});
