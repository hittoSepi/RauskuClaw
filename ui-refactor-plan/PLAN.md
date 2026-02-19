# PLAN.md — Project Dashboard + AI Agent Workspace

Tavoite: tehdä project-keskeinen workspace, jossa repo + workdir + logit + taskit + memory elää projektin alla, ja Chat on yksi näkymä. Lisäksi “default project” toimii yleischattina.

## 0) Päätökset (lukkoon)
- IA: **Project on primary workspace**, Chat on projekti-tab.
- Default project: **“yleischat”** (ei repo-pakkoa).
- Singleuser nyt, mutta **Dev/Admin mode** toggle asetuksissa.
- Workdir ja logit: **sekä project- että chat-tasolla**.
- UI: **Inspector right-drawer** (Unity-henkinen “selected item details”).
- Settings: **modal** (tabit + cards + editor pane), kuten referenssikuva.
- Frontend: **Vue 3 SPA**, reaktiiviset komponentit, erilliset feature-moduulit.

---

## 1) Informaatiarkkitehtuuri

### 1.1 Sidebar (global nav)
- New chat (projektille)
- Chats
- Projects
- Tasks
- Logs
- Settings

### 1.2 Project workspace (subnav)
Projektin sisällä:
- Overview
- Chat
- Tasks
- Memory
- Repo
- Workdir
- Logs
- Settings (project-scoped)

### 1.3 Default project “yleischat”
- Exists always.
- No repo required.
- Used for ad-hoc keskustelut ja testit.
- Taskit ja memory sallittu (mutta kevyt).

---

## 2) Sivut (tavoite-MVP)

### 2.1 Project Overview
Sisältö:
- Project card (name, repo, branch, tags)
- Recent activity timeline (chat runs, tool runs, task runs, git sync)
- Health: last run status, disk usage, last git sync time
Toiminnot:
- Pull repo
- New task
- Open chat
- View logs

### 2.2 Project Chat
- Timeline: assistant messages + tool runs + events
- Markdown render
- Tool/console blocks (collapsible)
- Actions per message/run:
  - Create task from selection
  - Pin to project memory
  - Open in logs
- Input bar:
  - Attach
  - Context toggles (use project memory, use repo, use workdir)
  - Run mode: Plan / Execute

### 2.3 Project Tasks
Default: kanban + list-haku
Columns:
- Backlog
- Next
- In Progress
- Done

Task card:
- Title (big)
- Type icon (bug/feature/chore/research/deploy)
- Priority pill
- Linked chat/run count
- Quick actions: Plan, Execute, Open details

Task detail (modal or center pane):
- Description (markdown)
- Acceptance criteria (checkbox list)
- Context (repo/branch/env/workdir)
- Linked artifacts/logs
- Buttons:
  - Generate plan
  - Execute
  - Save output to memory (toggle)

### 2.4 Project Memory
- Search + filters: type (decision/context/snippet/constraint)
- Entry list (left)
- Editor (right)
Entry fields:
- Title
- Type
- Content (markdown)
- Source links (chat msg / task / run)
- Pin (no prune)
- Scope: project-only (default), global (dev-mode only)
Actions:
- Export (json/md)
- Suggest entries (agent suggests, user accepts)

### 2.5 Repo
- Connect repo (clone/pull)
- Branch selector
- Status: dirty/clean, last fetch
- File tree (optional) + “open workdir” link

### 2.6 Workdir
- Current workdir path/identifier
- Snapshots (optional): “before/after run”
- Browse files (read-only by default)
- Dev-mode: allow write operations / diff viewer

### 2.7 Logs
- Filters (project, agent, status, date)
- Runs list (center)
- Log viewer (right)
Viewer tabs:
- Output
- Errors
- Files
- Metrics
Actions:
- Copy
- Download
- Attach to task
- Pin snippet to memory
- Open inspector

---

## 3) Inspector (right drawer)
Inspector näyttää valitun kohteen metat ja toiminnot.

### 3.1 Selection types
- ChatMessage
- ToolRun / CommandRun
- Task
- MemoryEntry
- LogRun
- RepoOperation (clone/pull)

### 3.2 Common fields
- Project
- Time (start/end)
- Agent profile
- Model
- Duration
- Status (ok/warn/error)
- Links:
  - Open in Logs
  - Open Source (chat/task)
  - Artifacts

### 3.3 Actions
- Create Task from this
- Pin to Memory
- Rerun (if allowed)
- View diff (if files changed)

---

## 4) Modals / Pikku-ikkunat (standardit)
Modal types:
1) Settings (large)
2) Run Task (medium)
3) Command palette (small, Ctrl/Cmd+K)
4) Log details / full log (right sheet)

Rules:
- Esc closes
- Primary action bottom-right
- Secondary action left of primary
- Sticky header with title + context chips

---

## 5) Milestones (toteutusjärjestys)

### M0: Skeleton
- AppShell + Sidebar + Topbar + Project routing
- Default project “yleischat”
- Settings modal stub + Dev toggle UI

### M1: Chat MVP
- Chat session list per project
- Markdown renderer
- ToolRunBlock UI (collapsible, copy)
- Inspector drawer basic (message/toolrun)

### M2: Logs MVP
- Log run list + viewer
- Link log to chat toolruns
- Inspector actions “Open in Logs”

### M3: Tasks MVP
- Task board/list
- Create task from message/toolrun
- Task detail modal + linking
- Basic “Plan/Execute” hooks (UI only if backend not ready)

### M4: Memory MVP
- Memory list + editor
- Pin to memory workflow
- Source links
- Export

### M5: Repo + Workdir
- Repo connect/pull UI
- Branch selector integration
- Workdir viewer (read-only)
- Diff view integration (if available)

### M6: Polish + Dev mode
- Command palette (Ctrl/Cmd+K)
- Better empty states
- Keyboard shortcuts
- Dev-mode advanced panels (raw payloads, metrics)

---

## 6) Definition of Done (MVP)
- User can:
  - create/open projects (incl. default yleischat)
  - chat within a project, see markdown + tool blocks
  - browse logs, link them to sessions
  - create tasks from messages/runs, track status
  - pin important info to project memory
  - view selection details in Inspector
  - toggle dev mode from Settings
