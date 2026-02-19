import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    redirect: '/projects/yleischat/chat',
  },
  {
    path: '/projects',
    name: 'projects',
    component: () => import('@/features/projects/pages/ProjectsList.vue'),
    meta: { title: 'Projects' },
  },
  {
    path: '/projects/:projectId',
    component: () => import('@/layout/ProjectWorkspace.vue'),
    props: true,
    children: [
      {
        path: '',
        redirect: to => ({ path: `/projects/${to.params.projectId}/overview` }),
      },
      {
        path: 'overview',
        name: 'project-overview',
        component: () => import('@/features/projects/pages/ProjectOverview.vue'),
        props: true,
        meta: { title: 'Overview' },
      },
      {
        path: 'chat',
        name: 'project-chat',
        component: () => import('@/features/chat/pages/ProjectChat.vue'),
        props: true,
        meta: { title: 'Chat' },
      },
      {
        path: 'tasks',
        name: 'project-tasks',
        component: () => import('@/features/tasks/pages/ProjectTasks.vue'),
        props: true,
        meta: { title: 'Tasks' },
      },
      {
        path: 'memory',
        name: 'project-memory',
        component: () => import('@/features/memory/pages/ProjectMemory.vue'),
        props: true,
        meta: { title: 'Memory' },
      },
      {
        path: 'repo',
        name: 'project-repo',
        component: () => import('@/features/repo/pages/ProjectRepo.vue'),
        props: true,
        meta: { title: 'Repo' },
      },
      {
        path: 'workdir',
        name: 'project-workdir',
        component: () => import('@/features/workdir/pages/ProjectWorkdir.vue'),
        props: true,
        meta: { title: 'Workdir' },
      },
      {
        path: 'logs',
        name: 'project-logs',
        component: () => import('@/features/logs/pages/ProjectLogs.vue'),
        props: true,
        meta: { title: 'Logs' },
      },
    ],
  },
  {
    path: '/logs',
    name: 'global-logs',
    component: () => import('@/features/logs/pages/GlobalLogs.vue'),
    meta: { title: 'Logs' },
  },
  {
    path: '/settings',
    name: 'settings',
    component: () => import('@/features/settings/pages/Settings.vue'),
    meta: { title: 'Settings' },
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: () => import('@/features/errors/pages/NotFound.vue'),
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

// Navigation guard: ensure project exists
router.beforeEach(async (to, _from, next) => {
  // Update document title
  const title = to.meta?.title as string | undefined
  document.title = title ? `${title} | RauskuClaw` : 'RauskuClaw'

  // Check project existence for project routes
  if (to.params.projectId) {
    const projectId = to.params.projectId as string
    // For 'yleischat', always allow (default project)
    if (projectId === 'yleischat') {
      return next()
    }
    // TODO: Check if project exists in store/API
    // For now, allow all
    return next()
  }

  next()
})

export default router