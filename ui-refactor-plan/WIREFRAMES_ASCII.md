# WIREFRAMES_ASCII.md

## 1) Project Workspace Shell (desktop)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Topbar: [Project ▼] [Branch ▼] [Agent ▼] [Model ▼]   [⌘K Search] [DEV●] [⚙]  │
├───────────────┬───────────────────────────────────────────┬──────────────────┤
│ Sidebar       │ Main (Project Tab)                         │ Inspector        │
│ + New chat    │ ┌────────────────────────────────────────┐ │ ┌──────────────┐ │
│ Search chats  │ │ Tab content (Overview/Chat/Tasks/...)   │ │ │ Selection     │ │
│ Chats list    │ │                                        │ │ │ meta + actions│ │
│ Projects list │ │                                        │ │ └──────────────┘ │
│ Logs          │ └────────────────────────────────────────┘ │                  │
│ Settings      │                                             │                  │
└───────────────┴───────────────────────────────────────────┴──────────────────┘
```

## 2) Project Chat
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Header: Thread Title / Context Chips (repo, branch, env, workdir)             │
├──────────────────────────────────────────────────────────────────────────────┤
│ Assistant msg (markdown rendered)                                             │
│  - headings, lists, code blocks                                               │
│  - inline status tags                                                         │
│                                                                              │
│ Tool/Console block (collapsible)                                              │
│  $ docker compose up                                                          │
│  …stdout/stderr…                                                              │
│  [Expand ▾] [Copy] [Full log] [Diff] [Rerun]                                  │
│                                                                              │
├──────────────────────────────────────────────────────────────────────────────┤
│ Input: [ write prompt…                              ] [Send ➤]               │
│        [Attach] [Tooling] [Memory] [Task] [Plan/Execute]                      │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 3) Settings Modal (tabs + cards + editor pane)
```
┌──────────────────────────────────────────────────────────┐
│ Settings                                   [ X ]         │
├──────────────────────────────────────────────────────────┤
│ Tabs: Agent | Models | Skills | External | Memory | Dev   │
├──────────────────────────────────────────────────────────┤
│ [Card] Agent Config   [Card] Chat Model   [Card] Browser  │
│ [Card] Memory         [Card] Speech       [Card] Workdir  │
├──────────────────────────────────────────────────────────┤
│ Panel: Agent Config                                       │
│  - Default agent profile  [ dropdown ]                    │
│  - Sandbox mode           [ toggle ]                      │
│  - Max tool concurrency   [ slider ]                      │
│                                        [Save] [Cancel]    │
└──────────────────────────────────────────────────────────┘
```

## 4) Projects: list + details
```
┌────────────────────────────────────────────────────────────────┐
│ Projects: [ + New ] [Import repo] [Search…]                    │
├────────────────────────────────────────────────────────────────┤
│ List (left)                 │ Project Details (right)          │
│ • yleischat (default)       │ Name, repo, env, tags            │
│ • OpenClaw                  │ ─────────────────────────        │
│ • RauskuDashboard           │ Agents                           │
│                             │  - FE Agent: ● running           │
│                             │  - BE Agent: ○ idle              │
│                             │ Pipelines / Runs                 │
│                             │  - last run, logs link           │
│                             │ Workdir / mounts                 │
│                             │ Secrets (masked)                 │
│                             │ [Open Chat] [Run Task] [View Logs]│
└────────────────────────────────────────────────────────────────┘
```

## 5) Tasks: kanban (list-first, kanban second)
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Tasks: [ + New ] [Filter ▼] [Search…]                                         │
├───────────────┬───────────────┬────────────────┬─────────────────────────────┤
│ Backlog       │ Next          │ In Progress    │ Done                        │
│ [card] ...    │ [card] ...    │ [card] ...     │ [card] ...                 │
│ [card] ...    │               │                │                             │
└───────────────┴───────────────┴────────────────┴─────────────────────────────┘
```

## 6) Logs: list + viewer
```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Logs: [Project ▼] [Status ▼] [Date ▼] [Search…]                               │
├───────────────────────────────────────────────┬──────────────────────────────┤
│ Runs list                                     │ Log viewer                   │
│  ● ok   12s  FE  npm test                     │ Tabs: Output Errors Files    │
│  ● err  03s  BE  migrate                      │ [search in log]              │
│  ● ok   44s  Dev docker compose up            │ stdout/stderr stream         │
│                                               │ [Copy] [Download] [Attach]   │
└───────────────────────────────────────────────┴──────────────────────────────┘
```
