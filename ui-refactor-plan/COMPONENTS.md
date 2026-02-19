# COMPONENTS.md

## App shell
- AppShell.vue
  - Sidebar.vue
  - Topbar.vue
  - InspectorDrawer.vue
  - RouterView (project tab content)

## Navigation
- ProjectSwitcher.vue (dropdown + search)
- ContextChips.vue (repo/branch/workdir/agent/model)
- SidebarNavItem.vue (icon + label + badge)

## Chat
- ChatTimeline.vue
- ChatMessage.vue (markdown)
- ToolRunBlock.vue (console style, collapsible)
- EventRow.vue
- ChatComposer.vue (input + toggles)
- MessageActions.vue (hover actions)

## Tasks
- TaskBoard.vue (kanban)
- TaskList.vue (search/filter)
- TaskCard.vue
- TaskDetailModal.vue
- TaskCreateModal.vue

## Memory
- MemoryList.vue
- MemoryEditor.vue
- MemoryCreateModal.vue

## Logs
- LogRunList.vue
- LogRunRow.vue
- LogViewer.vue (tabs: output/errors/files/metrics)
- LogSearchBar.vue

## Settings
- SettingsModal.vue (tabs + cards + editor pane)
- DevModeToggle.vue

## Shared UI atoms (shared/ui)
- Button, Card, Badge, Tabs, Modal, Drawer, Dropdown, Toggle, SearchInput, EmptyState, Icon
