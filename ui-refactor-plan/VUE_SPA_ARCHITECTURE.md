# VUE_SPA_ARCHITECTURE.md

## Stack
- Vue 3 (Composition API, `<script setup>`)
- Vue Router 4 (nested routes per project)
- Pinia (domain stores)
- Vite

## Folder structure (feature-first + shared UI)
```
src/
  app/
    main.ts
    App.vue
    router/
      index.ts
      routes.ts
    layout/
      AppShell.vue
      Topbar.vue
      Sidebar.vue
      InspectorDrawer.vue
      SplitPane.vue
  design/
    tokens.css
    base.css
  shared/
    ui/ (Button, Card, Tabs, Modal, Drawer, Dropdown, Toggle, etc.)
    utils/
    types/
  features/
    projects/ (pages, components, store)
    chat/     (pages, components, store)
    tasks/    (pages, components, store)
    memory/   (pages, components, store)
    logs/     (pages, components, store)
    settings/ (components, store)
```

## Routing (SPA)
- /projects
- /projects/:projectId (redirect → /overview)
- /projects/:projectId/overview
- /projects/:projectId/chat
- /projects/:projectId/tasks
- /projects/:projectId/memory
- /projects/:projectId/repo
- /projects/:projectId/workdir
- /projects/:projectId/logs
- /logs (global)

Default landing:
- /projects/yleischat/chat

## Reactive “Inspector selection bus”
Create a dedicated Pinia store:
- state: `{ open, selection }`
- actions: `select(selection)`, `close()`, `openFor(selection)`
Rationale: selection events come from chat, logs, tasks, memory, repo.

## Domain stores (Pinia)
- projects.store: project entities + current project + repo/branch context + ensure default “yleischat”
- chat.store: sessions per project, messages per session, tool runs per session
- tasks.store: tasks per project + create task from selection + link sources
- memory.store: memory entries per project + pin from selection + export
- logs.store: runs per project + viewer selection + ingest tool run as log
- settings.store: global settings + dev mode toggle + modal open state

## Required workflows
- Create Task from Message/Run (hover action → modal → task created + linked)
- Pin to Project Memory (hover action → modal/editor → entry created + sources)
- ToolRun → Logs ingest (auto; “Open full log” jumps to viewer)

## Component conventions
- All feature components emit selection events upwards or directly call inspector store.
- Avoid cross-feature imports of stores; use small “domain actions” and shared types.
- Keep “shared/ui” dumb: styling + basic behavior only.
