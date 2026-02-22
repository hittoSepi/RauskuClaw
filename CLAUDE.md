# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

**Read `AGENTS.md` first**
**Read `CLAUDE-REPORT-FORMAT-V1.md`** 
**Read `CLAUDE-PLAN-FORMAT-V1.md`** 

## Quick Start Commands

```bash
# Initial setup
cp .env.example .env
# Edit .env and set API_KEY

# Build and run Docker stack
docker compose up -d --build
docker compose ps

# Install operator CLI
npm link

# Common CLI operations
rauskuclaw setup              # Interactive setup wizard
rauskuclaw start              # Start services
rauskuclaw status             # Check service status
rauskuclaw logs api --tail 100
rauskuclaw smoke --suite m1   # Run core tests
rauskuclaw smoke --suite m3 --success  # Test providers
rauskuclaw smoke --suite m4   # Test memory/scheduler

# Pull embedding model (required for semantic memory)
docker compose exec -T rauskuclaw-ollama ollama pull embeddinggemma:300m-qat-q8_0
```

## Running Tests

```bash
# Backend unit tests
npm --prefix app test

# E2E UI tests (ui-v2)
cd ui-v2 && npm run test:e2e

# Smoke test scripts
./scripts/m1-smoke.sh
./scripts/m3-smoke.sh
./scripts/m4-smoke.sh
```

## High-Level Architecture

RauskuClaw is a containerized microservices automation platform with the following components:

### Core Services

1. **rauskuclaw-api** (`app/server.js`) - REST API gateway on port 3001
2. **rauskuclaw-worker** (`app/worker.js`) - Job execution engine that polls SQLite
3. **rauskuclaw-ui** (`ui/`) - Vue 3 admin panel on port 3002 (original)
4. **rauskuclaw-ui-v2** (`ui-v2/`) - Vue 3 + TypeScript + Tailwind admin panel (newer)
5. **rauskuclaw-ollama** - Local embedding service for semantic memory

### Key Directories

- `app/` - Backend API, worker, database, handlers, providers, memory system
- `cli/` - Operator CLI tool (`rauskuclaw` command) built with Ink (React for CLI)
- `mcp-server/` - Model Context Protocol server for Claude Desktop integration
- `ui/` and `ui-v2/` - Two Vue 3 admin UI implementations
- `scripts/` - Smoke test scripts (m1-smoke.sh, m3-smoke.sh, m4-smoke.sh)

## Configuration System

Configuration follows this precedence:
1. Environment variables (`.env`)
2. `rauskuclaw.json` (shared config validated by `app/config.schema.json`)
3. Hardcoded application defaults

Key files:
- `.env.example` - Template for environment variables
- `rauskuclaw.json` - Service-level defaults with JSON Schema validation
- `app/config.js` - Config loader with precedence handling
- `app/config.schema.json` - Ajv schema for validation

The `rauskuclaw setup` CLI command writes both `.env` and syncs values to `rauskuclaw.json`.

## Job Processing Pattern

Jobs are SQLite-backed with queue-based processing:

1. **Creation**: `POST /v1/jobs` with optional `queue` (default: "default"), `priority`, `timeout_sec`, `max_attempts`, `callback_url`
2. **Idempotency**: Use `Idempotency-Key` header to prevent duplicate jobs
3. **Execution**: Worker polls for queued jobs, claims by lock, executes handlers
4. **Callbacks**: Worker POSTs to `callback_url` on completion (optional domain allowlist, optional HMAC signing)
5. **Streaming**: UI uses SSE endpoint `/v1/jobs/:id/stream` for live updates

## Job Types and Handlers

### Built-in Handlers (in `app/handlers/`)
- `data.fetch` - HTTPS fetch to allowlisted domains (disabled by default)
- `tool.exec` - Shell command execution with allowlist (disabled by default)
- `data.file_read` - Read workspace files (enabled by default)
- `tools.web_search` - Web search via DuckDuckGo or Brave (disabled by default)
- `report.generate` - Generate structured reports
- `deploy.run` - Dry-run deployment plans
- `workflow.run` - Execute YAML workflows from `workspace/workflows/*.yaml`

### Provider-Backed Handlers (in `app/providers/`)
- `codex.chat.generate` - Uses Codex CLI (`codex exec`) - disabled by default
- `ai.chat.generate` - Uses OpenAI-compatible API - disabled by default

Both provider types support:
- Memory context injection via `input.memory`
- Memory write-back via `input.memory_write`

## Memory System (M4 Phase 1)

Two-tier memory system:

### Key-Value Memory
- Scoped storage (`scope` + `key` pairs)
- Optional TTL via `ttl_sec`
- API: `/v1/memory` CRUD endpoints

### Semantic Vector Memory (optional, requires setup)
- Async embedding via `system.memory.embed.sync` job type
- Uses Ollama for embeddings (`embeddinggemma:300m-qat-q8_0`)
- sqlite-vector for storage and nearest-neighbor search
- Search via `POST /v1/memory/search`

Enable with:
- `MEMORY_VECTOR_ENABLED=1`
- `SQLITE_VECTOR_EXTENSION_PATH` set to extension `.so` path
- Ollama service running with model pulled

## Scheduler System

Recurring job schedules stored in `job_schedules` table:
- Supports `interval_sec` (fixed intervals) or `cron` expressions
- Timezone configurable via `SCHEDULER_CRON_TZ` (default: UTC)
- API: `/v1/schedules` CRUD endpoints
- Worker dispatches due schedules every poll tick

## Security Model

### Authentication
- API key required for all `/v1/*` routes (`x-api-key` header)
- Two modes:
  - Legacy single key: `API_KEY`
  - Multi-key: `API_KEYS_JSON` or `api.auth.keys` in config with `role` (admin/read) and optional `queue_allowlist`
- Per-key queue allowlist restricts which queues a key can access for jobs/schedules/metrics
- `read` role keys can only access GET/HEAD/OPTIONS routes
- SSE authentication uses `api_key` query parameter (browser EventSource limitation)

### Authorization
- Queue allowlist enforces job/schedule/metrics visibility and actions
- Write-route guards prevent `read` keys from mutating operations
- Handler-specific allowlists:
  - `TOOL_EXEC_ALLOWLIST` for commands
  - `DATA_FETCH_ALLOWLIST` for HTTPS domains
  - `DEPLOY_TARGET_ALLOWLIST` for deploy targets

### Callbacks
- Optional domain allowlist via `CALLBACK_ALLOWLIST`
- Optional HMAC signing via `CALLBACK_SIGNING_ENABLED` + `CALLBACK_SIGNING_SECRET`
- Signed headers: `x-rauskuclaw-timestamp`, `x-rauskuclaw-signature`

## API Key Quick Check

```bash
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2)
curl -sS http://127.0.0.1:3001/health
curl -sS -H "x-api-key: $API_KEY" http://127.0.0.1:3001/v1/ping
```

## Chat UI Features

The `/chat` route provides operator-agent conversation with:
- Auto-routing via router-agent (`ROUTE: planner|agent`)
- Memory context injection and write-back
- Suggested job creation from fenced `rausku_jobs` JSON blocks
- Workspace file browser (list/read/edit/upload/download)
- Live job creation feedback

## Important Implementation Details

1. **Database migrations**: Run automatically in `app/db.js` - check `_migrations` table
2. **Queue allowlist**: When `WORKER_QUEUE_ALLOWLIST` is set, worker only processes those queues
3. **Idempotency hash**: Now includes `queue` field to prevent cross-queue duplicates
4. **SSE streaming**: UI requires `api_key` query parameter for EventSource compatibility
5. **Ollama networking**: Uses internal Docker network (`http://rauskuclaw-ollama:11434`)
6. **Workspace mount**: `./workspace` is mounted into containers at `/workspace`
7. **Codex auth state**: Stored in `./workspace/.codex-home` for shared OAuth session

## Provider Testing

Enable and test providers:
```bash
# After Codex login
rauskuclaw codex login --device-auth
# Enable in UI: /settings/types -> enable codex.chat.generate

# Test provider success path
rauskuclaw smoke --suite m3 --success
```

## Documentation References

- `README.md` - Main documentation with quick start, API reference, security notes
- `PLATFORM.md` - High-level platform overview
- `MEMORY.md` - Runtime memory and evolution tracking
- `docs/CONFIG.md` - Detailed configuration reference
- `docs/CLI.md` - CLI usage and JSON output contracts
- `docs/MILESTONES.md` - Implementation milestone tracking
- `PLAN.md` - Product roadmap

## UI v2 Refactoring (In Progress)

**Important**: The UI is undergoing a major refactor to a project-centric workspace model. See `ui-refactor-plan/` for full details.

### New Architecture: Project-First Workspace

- **Project is primary workspace** - Chat, Tasks, Memory, Repo, Workdir, Logs all live under a project
- **Default project**: "yleischat" (general-purpose chat, no repo required)
- **Tech stack**: Vue 3 + TypeScript + Vite + Tailwind CSS + Pinia

### UI v2 Structure

```
ui-v2/src/
  features/        # Feature modules (projects, chat, tasks, memory, logs, repo, workdir, settings)
  layout/          # App shell (AppShell, Topbar, Sidebar, InspectorDrawer, ProjectWorkspace)
  shared/          # Shared utilities, API client, types
  stores/          # Pinia stores (auth, inspector)
  router/          # Vue Router configuration
```

### Key Design Decisions (from `ui-refactor-plan/`)

1. **Inspector Selection Bus**: Dedicated Pinia store for item selection (messages, tasks, logs, etc.)
2. **Domain Stores**: One store per feature (projects, chat, tasks, memory, logs, settings)
3. **Settings Modal**: Tab-based modal (not separate page)
4. **Dev/Admin Mode Toggle**: Settings control for advanced features
5. **Component Conventions**:
   - Feature components emit selection events or call inspector store directly
   - Avoid cross-feature store imports
   - Keep shared/ui components dumb (styling + basic behavior only)

### Project Routes

```
/                              → redirect to /projects/yleischat/chat
/projects                      → Project list
/projects/:projectId           → redirect to /overview
/projects/:projectId/overview  → Project dashboard
/projects/:projectId/chat      → Chat within project
/projects/:projectId/tasks     → Task board (Kanban + list)
/projects/:projectId/memory    → Project memory (search + editor)
/projects/:projectId/repo      → Repo connect/pull, branch selector
/projects/:projectId/workdir   → Workdir viewer (read-only, dev-mode writes)
/projects/:projectId/logs      → Project-scoped logs
/logs                          → Global logs (all projects)
/settings                      → Settings modal
```

### Implementation Milestones

- **M0: Skeleton** - AppShell + routing + default project (DONE)
- **M1: Chat MVP** - Timeline, markdown, tool blocks, inspector (DONE - with streaming, see MS25)
- **M2: Logs MVP** - Run list + viewer + linking
- **M3: Tasks MVP** - Board/list + create from selection + detail modal
- **M4: Memory MVP** - List + editor + pin workflow
- **M5: Repo + Workdir** - Connect/pull + branch selector + file viewer
- **M6: Polish + Dev mode** - Command palette, shortcuts, advanced panels

### Completed Enhancements

- **MS25: Chat Streaming** - SSE streaming with polling fallback
  - Native EventSource API with api_key query parameter auth
  - First-event timeout (3s default) with configurable SendOptions.streamFirstEventTimeout
  - Graceful fallback to polling on stream failure
  - Smart status preservation: 'streaming' if job_update received, otherwise 'pending'
  - Throttled localStorage persist (250ms) during streaming
  - Streaming caret animation (▍) in ChatTimeline
  - Optimized auto-scroll: watches message count + last content length
  - Stream cleanup on navigation (cancelActiveStream/cancelAllStreams)
  - Security: no URL logging with api_key, sanitized error messages
  - E2E tests: 13/13 passed (chat-stream.spec.ts + chat.spec.ts + smoke.spec.ts)

### UI Development Commands

```bash
cd ui-v2
npm run dev          # Start dev server (http://localhost:5173)
npm run build        # Production build
npm run test:e2e     # Run Playwright E2E tests
npm run test:e2e:ui  # Run E2E tests with UI
```

### Key Workflows to Implement

1. **Create Task from Message/Run** - Hover action → modal → task created + linked
2. **Pin to Project Memory** - Hover action → modal → entry created + sources
3. **ToolRun → Logs ingest** - Auto-link with "Open full log" action
4. **Inspector Selection** - Click any item to show details + actions in right drawer

### Refactoring Notes

- **ui/** - Legacy Vue 3 UI (being replaced)
- **ui-v2/** - New Vue 3 + TypeScript implementation (active development)
- Focus on feature-first architecture under `ui-v2/src/features/`
- Use TypeScript for type safety (define shared types in `shared/`)
- Leverage Pinia for state management (one store per domain)

## Backend Milestone Status

- M1 (Reliable Core Runner): complete
- M2 (Tooling + Job Type Management UX): complete
- M3 (Provider Integration): complete
- M4 (Memory + Automation Foundations): complete
