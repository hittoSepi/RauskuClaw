import { createRouter, createWebHistory } from "vue-router";
import Jobs from "./pages/Jobs.vue";
import JobDetail from "./pages/JobDetail.vue";
import Types from "./pages/Types.vue";
import CreateJob from "./pages/CreateJob.vue";

export default createRouter({
  history: createWebHistory("/ui/"),
  routes: [
    { path: "/", redirect: "/jobs" },
    { path: "/jobs", component: Jobs },
    { path: "/jobs/new", component: CreateJob },
    { path: "/jobs/:id", component: JobDetail, props: true },
    { path: "/types", component: Types }
  ]
});
