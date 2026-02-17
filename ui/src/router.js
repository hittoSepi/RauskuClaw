import { createRouter, createWebHistory } from "vue-router";

const Jobs = () => import("./pages/Jobs.vue");
const JobDetail = () => import("./pages/JobDetail.vue");
const Types = () => import("./pages/Types.vue");
const CreateJob = () => import("./pages/CreateJob.vue");
const Chat = () => import("./pages/Chat.vue");
const Schedules = () => import("./pages/Schedules.vue");
const Settings = () => import("./pages/Settings.vue");
const Memory = () => import("./pages/Memory.vue");

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
