# RauskuClaw

## What This Is
RauskuClaw is a self-hosted job runner stack for contributor-driven development.

### `MEMORY.md`: 
  - Remember what you have done previously.
  - Write relevant information what you done in project.
  - Default workspace path: `workspace/rauskuAssets/MEMORY.md`

### `MEMORY.md` Changes (2026-02-18)
- Repository context injection policy was tightened:
  - only `IDENTITY.md` and `SOUL.md` are summarized.
  - other repo-context files are injected as full text (subject to existing max slice limits).
- New session warmup behavior:
  - before clear-greeting, chat runs a hidden warmup summary job for `IDENTITY.md` + `SOUL.md`.
  - warmup output is kept in provider history context but hidden from normal chat view.
- `MEMORY.md` remains long-lived, high-signal memory:
  - store durable decisions/constraints.
  - avoid transient chat noise.

Current implementation:
- API: Node.js + Express (`app/server.js`)
- Worker: separate polling process (`app/worker.js`, `app/worker-only.js`)
- Database: SQLite with WAL mode (`app/db.js`)
- UI: Vue 3 admin panel served under `/ui/` (`ui/`)
- Runtime shape: Docker Compose + host Nginx reverse proxy

## Current Capabilities (Today)
- Health and authenticated API ping endpoints.
- Job creation with:
  - priority
  - timeout
  - max attempts
  - tags
  - callback URL
  - optional idempotency key (`Idempotency-Key` header)
- Job listing and filtering (`status`, `type`, `limit`).
- Job detail fetch, cancellation, and log tailing.
- Memory CRUD foundation (`/v1/memory`) for scoped key/value storage.
- Recurring schedules foundation (`/v1/schedules`) for periodic job dispatch.
- Semantic memory pipeline (M4 phase 1):
  - async embedding jobs (`system.memory.embed.sync`)
  - local Ollama embedding client (`/api/embed`)
  - sqlite-vector storage + vector nearest-neighbor search
  - new search endpoint `POST /v1/memory/search`
- Job type listing and management:
  - create new type
  - patch existing type (enable/disable, handler, defaults)
- Worker lifecycle handling:
  - queue claim/lock
  - execute built-in handlers
  - execute provider-backed handlers:
    - `codex.chat.generate` via Codex CLI (`codex exec`) (disabled by default)
    - `ai.chat.generate` via OpenAI-compatible online API (disabled by default)
    - optional chat memory context injection from semantic memory scope (`input.memory`)
    - chat memory retrieval now includes recent scope-row fallback when vector hits are sparse
      - this surfaces freshly written `pending` memory rows before embedding sync is complete
  - timeout handling
  - retry until `max_attempts`
  - callback delivery with optional domain allowlist
- UI views:
  - jobs list
  - create job
  - job detail/logs
  - chat assistant (`/chat`)
    - top bar token budget indicator (`tokens ~N / max M`) and active model label
    - auto routing with dedicated router-agent (`ROUTE: planner|agent`) before main execution
    - split side panel with `Job List` + `Memory Writes` (expandable content preview)
    - `INTENT_TO_CONTINUE` system-signal support for auto-follow-up execution
    - send button toggles to stop/cancel while job is running
    - pending state shows `Thinking... (Ns)` timer
    - memory query trace now includes injected memory config/query and per-entry timestamps
    - memory query includes dynamic context compaction for older chat history
    - suggested-job auto-repair supports common validation errors (including `data.write_file` base64 fixes)
  - schedules (`/schedules`)
  - job types (edit: enabled/handler/default timeout/default attempts)

## Architecture at a Glance
- `rauskuclaw-api` container:
  - exposes `127.0.0.1:3001`
  - serves all `/v1/*` and `/health`
- `rauskuclaw-worker` container:
  - polls SQLite for queued jobs
  - executes handlers and writes logs/results
- `rauskuclaw-ui` container:
  - serves static UI on `127.0.0.1:3002`
- `rauskuclaw-ollama` container:
  - serves local embedding API on internal Docker network (`http://rauskuclaw-ollama:11434`)
  - stores models in persistent Docker volume `ollama_data`
- Host Nginx routing (sample in `nginx/rauskuclaw.conf`):
  - `/ui/` -> UI container (`localhost:3002`)
  - everything else -> API container (`localhost:3001`)

## Quick Start
1. Prepare environment file.
```bash
cd /opt/rauskuclaw
cp .env.example .env
```

2. Edit `.env` and set at least `API_KEY` (recommended).
```bash
cd /opt/rauskuclaw
sed -n '1,120p' .env
```

3. Build and run the stack.
```bash
cd /opt/rauskuclaw
docker compose up -d --build
docker compose ps
```

4. Inspect logs.
```bash
cd /opt/rauskuclaw
docker logs -f rauskuclaw-api
```
```bash
cd /opt/rauskuclaw
docker logs -f rauskuclaw-worker
```
```bash
cd /opt/rauskuclaw
docker logs -f rauskuclaw-ui
```

5. Pull embedding model into the Ollama container (required for semantic memory).
```bash
cd /opt/rauskuclaw
docker compose exec -T rauskuclaw-ollama ollama pull embeddinggemma:300m-qat-q8_0
docker compose exec -T rauskuclaw-ollama ollama list
```

## Operator CLI (`rauskuclaw`)
Install local CLI command:
```bash
cd /opt/rauskuclaw
npm link
```

Core commands:
- `rauskuclaw setup`
- `rauskuclaw start [--json]`
- `rauskuclaw stop [--json]`
- `rauskuclaw restart [--json]`
- `rauskuclaw status [--json]`
- `rauskuclaw logs <api|worker|ui> --tail 200 --follow`
- `rauskuclaw logs api --since 10m --security`
- `rauskuclaw logs api --since 10m --security --json`
- `rauskuclaw smoke [--suite m1|m3|m4] [--success] [--json]`
- `rauskuclaw memory reset --yes [--scope <scope>] [--api <baseUrl>] [--json]`
- `rauskuclaw auth whoami [--api <baseUrl>] [--json]`
  - includes effective `queue_allowlist` in output
- `rauskuclaw doctor [--json] [--fix-hints]`
- `rauskuclaw codex login [--device-auth]`
- `rauskuclaw codex logout`
- `rauskuclaw codex exec ...`
- `rauskuclaw config [show|validate|path] [--json]`
- `rauskuclaw help`
- `rauskuclaw version`

`rauskuclaw setup` writes `.env` and also syncs matching defaults to `rauskuclaw.json` when the file exists.
It also seeds missing workspace defaults from `fresh_deploy/templates/` (without overwriting existing files).
CLI uses Ink-based colored header UI in interactive terminals (logo + command title). In CI/non-TTY it falls back to plain output automatically.
Force plain mode locally with `RAUSKUCLAW_UI=plain`.
Most operator commands support machine-readable output with `--json`.

Example flow:
```bash
rauskuclaw setup
rauskuclaw start
rauskuclaw status
rauskuclaw logs api --tail 60
rauskuclaw smoke --suite m3
rauskuclaw smoke --suite m3 --success
rauskuclaw smoke --suite m4
```

## Configuration (.env)
Base variables from `.env.example`:

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `PORT` | `3001` | API | API listen port inside container |
| `API_KEY` | `change-me-please` | API | Required by all `/v1/*` routes unless `API_AUTH_DISABLED=1` |
| `API_KEYS_JSON` | (empty) | API | Optional JSON array for multi-key auth (`admin`/`read` roles). Overrides `API_KEY` when set |
| `API_AUTH_DISABLED` | `0` | API | `1` only for local dev to bypass API key auth |
| `DB_PATH` | `/data/rauskuclaw.sqlite` | API + Worker | SQLite file path inside containers |
| `WORKER_POLL_MS` | `300` | Worker | Poll interval in milliseconds |
| `WORKER_QUEUE_ALLOWLIST` | `default` | Worker | Comma-separated queue names this worker processes |
| `SCHEDULER_ENABLED` | `1` | Worker | Enables periodic schedule dispatch loop |
| `SCHEDULER_BATCH_SIZE` | `5` | Worker | Max due schedules dispatched per poll tick |
| `SCHEDULER_CRON_TZ` | `UTC` | API + Worker | Timezone used for cron schedule parsing (IANA TZ, e.g. `Europe/Helsinki`) |
| `CODEX_OSS_ENABLED` | `0` | Worker | Enables Codex OSS-backed handler when set to `1` |
| `CODEX_OSS_MODEL` | (empty) | Worker | Required when `CODEX_OSS_ENABLED=1` |
| `CODEX_EXEC_MODE` | `online` | Worker | `online` uses `codex exec`, `oss` uses local model mode |
| `CODEX_OSS_LOCAL_PROVIDER` | `ollama` | Worker | Local provider (`ollama` or `lmstudio`) |
| `CODEX_OSS_TIMEOUT_MS` | `60000` | Worker | Timeout for Codex OSS command execution |
| `CODEX_OSS_TRANSIENT_RETRIES` | `4` | Worker | Retry count for transient Codex network/stream failures |
| `CODEX_OSS_TRANSIENT_BACKOFF_MS` | `750` | Worker | Base backoff (ms) for transient retry attempts (exponential) |
| `CODEX_OSS_WORKDIR` | `/workspace` | Worker | Working directory passed to `codex exec --cd` (mounted from `./workspace`) |
| `CODEX_CLI_PATH` | `codex` | Worker | Explicit Codex CLI binary path (optional) |
| `WORKSPACE_ROOT` | `/workspace` | API | Workspace root for file browser endpoints |
| `WORKSPACE_FILE_VIEW_MAX_BYTES` | `262144` | API | Max preview size for `GET /v1/workspace/file` |
| `WORKSPACE_FILE_WRITE_MAX_BYTES` | `262144` | API | Max text save/create size for workspace edit endpoints |
| `WORKSPACE_UPLOAD_MAX_BYTES` | `4194304` | API | Max upload size for `POST /v1/workspace/upload` |
| `MEMORY_VECTOR_ENABLED` | `0` | API + Worker | Enables semantic memory embedding/search path |
| `OLLAMA_BASE_URL` | `http://rauskuclaw-ollama:11434` | API + Worker | Base URL for Ollama embedding calls |
| `OLLAMA_EMBED_MODEL` | `embeddinggemma:300m-qat-q8_0` | API + Worker | Ollama embedding model for memory vectors |
| `OLLAMA_EMBED_TIMEOUT_MS` | `15000` | API + Worker | Timeout for Ollama embed requests |
| `SQLITE_VECTOR_EXTENSION_PATH` | (empty) | API + Worker | Required when vectors enabled; path to sqlite-vector extension `.so/.dylib/.dll` |
| `MEMORY_SEARCH_TOP_K_DEFAULT` | `10` | API | Default `top_k` for `/v1/memory/search` |
| `MEMORY_SEARCH_TOP_K_MAX` | `100` | API | Max allowed `top_k` for `/v1/memory/search` |
| `MEMORY_EMBED_QUEUE_TYPE` | `system.memory.embed.sync` | API + Worker | Internal job type used for async memory embedding |
| `OPENAI_ENABLED` | `0` | Worker | Enables OpenAI-backed handler when set to `1` |
| `OPENAI_API_KEY` | (empty) | Worker | Required when `OPENAI_ENABLED=1` |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Worker | Model for OpenAI chat completions |
| `OPENAI_BASE_URL` | `https://api.openai.com` | Worker | OpenAI-compatible API base URL |
| `OPENAI_CHAT_COMPLETIONS_PATH` | `/v1/chat/completions` | Worker | Chat completions path (or full URL) for OpenAI-compatible providers |
| `OPENAI_TIMEOUT_MS` | `30000` | Worker | Timeout for provider API calls |
| `DEPLOY_TARGET_ALLOWLIST` | `staging,prod` | Worker | Allowed targets for `deploy.run` handler |
| `TOOL_EXEC_ENABLED` | `0` | Worker | Enables `tool.exec` built-in handler when set to `1` |
| `TOOL_EXEC_ALLOWLIST` | (empty) | Worker | Comma-separated allowed command names/paths for `tool.exec` |
| `TOOL_EXEC_TIMEOUT_MS` | `10000` | Worker | Default timeout (ms) for `tool.exec` command execution |
| `DATA_FETCH_ENABLED` | `0` | Worker | Enables `data.fetch` built-in handler when set to `1` |
| `DATA_FETCH_ALLOWLIST` | (empty) | Worker | Comma-separated allowed HTTPS domains for `data.fetch` |
| `DATA_FETCH_TIMEOUT_MS` | `8000` | Worker | Default timeout (ms) for `data.fetch` |
| `DATA_FETCH_MAX_BYTES` | `65536` | Worker | Max response bytes returned by `data.fetch` |
| `DATA_FILE_READ_ENABLED` | `1` | Worker | Enables `data.file_read` built-in handler when set to `1` |
| `DATA_FILE_READ_MAX_BYTES` | `65536` | Worker | Max bytes returned by `data.file_read` |
| `WEB_SEARCH_ENABLED` | `0` | Worker | Enables `tools.web_search` built-in handler when set to `1` |
| `WEB_SEARCH_PROVIDER` | `duckduckgo` | Worker | Search provider: `duckduckgo` or `brave` |
| `WEB_SEARCH_TIMEOUT_MS` | `8000` | Worker | Default timeout (ms) for `tools.web_search` |
| `WEB_SEARCH_MAX_RESULTS` | `5` | Worker | Default max result count for `tools.web_search` |
| `WEB_SEARCH_BASE_URL` | `https://api.duckduckgo.com` | Worker | Base URL for web search API |
| `WEB_SEARCH_BRAVE_API_KEY` | (empty) | Worker | Brave Search API key (required when `WEB_SEARCH_PROVIDER=brave`) |
| `WEB_SEARCH_BRAVE_ENDPOINT` | `https://api.search.brave.com/res/v1/web/search` | Worker | Brave Search endpoint override |
| `CALLBACK_ALLOWLIST` | (empty) | Worker | Optional comma-separated callback domains |
| `CALLBACK_SIGNING_ENABLED` | `0` | Worker | Enables HMAC signing for callback requests |
| `CALLBACK_SIGNING_SECRET` | (empty) | Worker | Shared secret used to sign callback payloads |
| `CALLBACK_SIGNING_TOLERANCE_SEC` | `300` | Worker | Suggested verify window for timestamp drift |
| `METRICS_ENABLED` | `1` | API + Worker | Enables runtime metric event collection |
| `METRICS_RETENTION_DAYS` | `7` | API + Worker | Retention window for metric events |
| `ALERT_WINDOW_SEC` | `3600` | API | Runtime alert evaluation window |
| `ALERT_QUEUE_STALLED_SEC` | `900` | API | Alert threshold for oldest queued job age |
| `ALERT_FAILURE_RATE_PCT` | `50` | API | Alert threshold for failed/completed ratio |
| `ALERT_FAILURE_RATE_MIN_COMPLETED` | `20` | API | Minimum completed jobs before failure-rate alerting |

Notes:
- In current code, empty `CALLBACK_ALLOWLIST` means all callback domains are allowed.
- Runtime tool settings can be overridden live from `Settings -> Tools` (`/settings/tools`) via `ui_prefs` scope `runtime_tools` (no restart needed).
- Callback signing:
  - enable with `CALLBACK_SIGNING_ENABLED=1`
  - signed headers: `x-rauskuclaw-timestamp`, `x-rauskuclaw-signature`
  - signature format: `v1=<hex(hmac_sha256(secret, timestamp + "." + rawBody))>`
- Metrics + alerts:
  - metrics are stored in SQLite table `metrics_events`
  - runtime summary endpoint: `GET /v1/runtime/metrics`
  - current alerts:
    - `QUEUE_STALLED`
    - `HIGH_FAILURE_RATE`
- Auth supports two modes:
  - legacy single key via `API_KEY` (full admin access)
  - multi-key via `API_KEYS_JSON` or `api.auth.keys` in `rauskuclaw.json`
- `read` role keys can access read-only routes (`GET/HEAD/OPTIONS`) but cannot run mutating operations.
- Per-key `queue_allowlist` is supported in multi-key mode to restrict which queues that key can enqueue jobs into.
- Queue allowlist also scopes job visibility and actions: keys only see/control jobs in allowed queues (`/v1/jobs`, detail, logs, stream, cancel).
- If `GET /v1/jobs` is called with explicit `?queue=<name>` outside key allowlist, API returns `403 FORBIDDEN` with `allowed_queues` details.
- Queue allowlist also scopes schedule visibility and actions (`/v1/schedules`, detail, create, patch, delete).
- Queue allowlist also scopes runtime metrics (`/v1/runtime/metrics`) job snapshot + alert evaluation, and supports optional `?queue=<name>` filter with allowlist enforcement.
- `codex.chat.generate` is seeded disabled by default; enable from `/types` after Codex CLI login/config is ready.
- `ai.chat.generate` is seeded disabled by default; enable from `/types` only when OpenAI config is ready.
- OpenAI-compatible providers may require a non-default chat path; configure with `OPENAI_CHAT_COMPLETIONS_PATH`.
- Chat UI auto-selects `codex.chat.generate` vs `ai.chat.generate` based on runtime provider enabled-state (`/v1/runtime/providers`) and blocks send when selected provider runtime is disabled.

OpenAI-compatible example (`ai.chat.generate`, e.g. GLM-4.7):
```bash
OPENAI_ENABLED=1
OPENAI_API_KEY=replace-with-provider-key
OPENAI_MODEL=glm-4.7
OPENAI_BASE_URL=https://your-provider-base-url
OPENAI_CHAT_COMPLETIONS_PATH=/v1/chat/completions
```
- Memory vector search is default-off (`MEMORY_VECTOR_ENABLED=0`) and requires `SQLITE_VECTOR_EXTENSION_PATH` when enabled.
- Memory embedding is asynchronous: `POST /v1/memory` marks entry `pending` and enqueues `system.memory.embed.sync`.
- `POST /v1/memory/search` returns `503 MEMORY_EMBEDDING_UNAVAILABLE` if scope has rows not fully embedded/ready.
- Default Compose runtime uses internal Ollama container networking (`rauskuclaw-ollama`) instead of host loopback routing.
- `docker-compose.yml` also applies defaults for several worker/API envs.
- Canonical shared config file is `rauskuclaw.json` (service-level defaults and env mapping).
- Full configuration guide: [`docs/CONFIG.md`](./docs/CONFIG.md).
- CLI JSON/output contract: [`docs/CLI.md`](./docs/CLI.md).
- Milestone progress tracker: [`docs/MILESTONES.md`](./docs/MILESTONES.md).
- Runtime now reads `rauskuclaw.json` in API + worker via `RAUSKUCLAW_CONFIG_PATH`.
- Runtime validates `rauskuclaw.json` with Ajv JSON Schema (`app/config.schema.json`) at startup.

### Codex CLI Setup
1. Set in `.env`:
   - `CODEX_OSS_ENABLED=1`
   - `CODEX_EXEC_MODE=online`
   - `CODEX_OSS_MODEL=gpt-5.3-codex` (or another Codex-capable model)
2. Login once:
```bash
rauskuclaw codex login --device-auth
```
   - CLI stores Codex auth state under `./workspace/.codex-home` so worker jobs use the same login session.
3. Rebuild:
```bash
cd /opt/rauskuclaw
docker compose up -d --build
```
4. Enable `codex.chat.generate` in `/types`.
5. Create a job with type `codex.chat.generate` and input containing either:
   - `prompt` (string), or
   - `messages` (chat array)
   - optional `memory` block:
     - `scope` (required when memory block is present)
     - `query` (optional; fallback uses prompt/latest user message)
     - `top_k` (optional)
     - `required` (`false` default)

### Chat Memory Input Contract
Chat provider job types (`codex.chat.generate`, `ai.chat.generate`) support optional memory context:

```json
{
  "prompt": "Summarize latest release context",
  "memory": {
    "scope": "agent.chat",
    "query": "release notes",
    "top_k": 5,
    "required": false
  }
}
```

Behavior:
- If memory retrieval works, worker injects retrieved context into chat input before provider execution.
- If retrieval fails and `memory.required=false`, job continues without memory context.
- If retrieval fails and `memory.required=true`, job fails with `MEMORY_CONTEXT_UNAVAILABLE`.

Optional provider output write-back is also supported via `memory_write`:

```json
{
  "prompt": "Summarize this deploy and save the assistant answer",
  "memory_write": {
    "scope": "chat.ops",
    "key": "release.latest_summary",
    "ttl_sec": 86400,
    "tags": ["chat", "summary"],
    "required": false
  }
}
```

Write-back behavior:
- Worker stores provider `output_text` into memory as `{ text, source }` under `scope` + `key`.
- If vectors are enabled, worker enqueues async embedding for the saved row.
- If write-back fails and `memory_write.required=false`, job still succeeds (warning logged).
- If write-back fails and `memory_write.required=true`, job fails with `MEMORY_WRITE_UNAVAILABLE`.

## Config Files
- `.env`:
  - runtime secrets and environment-specific overrides.
- `.env.example`:
  - template for required/optional environment variables.
- `rauskuclaw.json`:
  - shared configuration contract for API/worker/UI/security defaults.
  - includes `env_mapping` that documents how env vars map to config keys.
- `docs/CONFIG.md`:
  - detailed field-by-field reference and usage conventions.

## Config Precedence
When the same setting exists in multiple places, precedence is:
1. Environment variable (`.env` / container env)
2. `rauskuclaw.json`
3. hardcoded application fallback

Examples:
- `PORT` overrides `rauskuclaw.json -> api.port`.
- `WORKER_POLL_MS` overrides `rauskuclaw.json -> worker.poll_interval_ms`.
- `DB_PATH` overrides `rauskuclaw.json -> database.path`.
- If `rauskuclaw.json` exists but fails schema validation, API/worker fail fast on startup.

## API Summary
All `/v1/*` routes require header `x-api-key`:
- legacy mode: `x-api-key: <API_KEY>`
- multi-key mode: key from `API_KEYS_JSON` / `api.auth.keys`
If no auth keys are configured and `API_AUTH_DISABLED` is not `1`, API returns `503 AUTH_NOT_CONFIGURED`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Public health check |
| `GET` | `/v1/ping` | Auth check / API liveness |
| `GET` | `/v1/runtime/providers` | Provider runtime status (read role gets redacted shape) |
| `GET` | `/v1/runtime/handlers` | Built-in handler runtime guardrails/status (read role gets redacted shape) |
| `GET` | `/v1/ui-prefs` | Load persisted UI preferences by scope |
| `PUT` | `/v1/ui-prefs` | Save persisted UI preferences by scope |
| `GET` | `/v1/runtime/metrics` | Runtime metric counters + active alerts (`queue` filter optional) |
| `GET` | `/v1/workspace/files` | List workspace directory entries |
| `GET` | `/v1/workspace/file` | Read text file content for preview |
| `PUT` | `/v1/workspace/file` | Save text file content |
| `DELETE` | `/v1/workspace/file` | Delete file |
| `GET` | `/v1/workspace/download` | Download file bytes |
| `POST` | `/v1/workspace/upload` | Upload file bytes (`content_base64`) |
| `POST` | `/v1/workspace/create` | Create file or directory |
| `PATCH` | `/v1/workspace/move` | Rename/move file or directory |
| `GET` | `/v1/memory` | List memory entries (filterable by `scope`/`key`) |
| `GET` | `/v1/memory/scopes` | List memory scope aggregates (counts/status/latest) |
| `POST` | `/v1/memory` | Upsert memory entry (`scope` + `key`) |
| `GET` | `/v1/memory/:id` | Fetch one memory entry |
| `DELETE` | `/v1/memory/:id` | Delete one memory entry |
| `POST` | `/v1/memory/reset` | Destructive memory cleanup (all scopes or one scope) |
| `POST` | `/v1/memory/search` | Semantic top-k search in scope (vector mode) |
| `GET` | `/v1/schedules` | List recurring schedules (filters: `enabled`, `type`, `queue`) |
| `POST` | `/v1/schedules` | Create recurring schedule (`queue` optional, default `default`) |
| `GET` | `/v1/schedules/:id` | Fetch one recurring schedule |
| `PATCH` | `/v1/schedules/:id` | Update recurring schedule |
| `DELETE` | `/v1/schedules/:id` | Delete recurring schedule |
| `GET` | `/v1/job-types` | List job types |
| `POST` | `/v1/job-types` | Create job type |
| `PATCH` | `/v1/job-types/:name` | Update job type settings |
| `POST` | `/v1/jobs` | Create job (`Idempotency-Key` optional, `queue` optional) |
| `GET` | `/v1/jobs` | List jobs with filters (`status`, `type`, `queue`) |
| `GET` | `/v1/jobs/:id` | Fetch one job |
| `POST` | `/v1/jobs/:id/cancel` | Cancel queued/running job |
| `GET` | `/v1/jobs/:id/logs` | Tail logs for a job |
| `GET` | `/v1/jobs/:id/stream` | SSE stream for live job/log updates |

Quick check:
```bash
cd /opt/rauskuclaw
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2)
curl -sS http://127.0.0.1:3001/health
curl -sS -H "x-api-key: $API_KEY" http://127.0.0.1:3001/v1/ping
```

Memory reset safety:
- `POST /v1/memory/reset` requires request body `{"confirm": true}`.
- Optional `scope` limits deletion to one scope; without `scope`, all memory rows are deleted.

Schedule cadence:
- `POST /v1/schedules` supports exactly one of:
  - `interval_sec` (integer 5..86400), or
  - `cron` (cron expression parsed with `SCHEDULER_CRON_TZ`, default `UTC`)
- `POST /v1/schedules` accepts optional `queue` (default `default`).
- `PATCH /v1/schedules/:id` can switch cadence mode by sending either `interval_sec` or `cron`.
- Scheduler dispatch enqueues jobs into each schedule's configured `queue`.

## UI Routes
UI is mounted under `/ui/` and uses these internal routes:

| Route | Description |
|---|---|
| `/chat` | Operator-agent chat with optional memory context and suggested job creation |
| `/settings/jobs` | Job list and filters |
| `/settings/jobs/new` | Create job form |
| `/settings/jobs/:id` | Job detail + live logs (SSE) + cancel |
| `/settings/schedules` | Recurring schedule management |
| `/settings/types` | Job type list |
| `/settings/memory` | Memory scope management + reset scope/reset all |
| `/settings/tools` | Runtime tool handler overrides (tool.exec / data.fetch / tools.web_search) |

Top menu is intentionally simplified:
- `Chat`
- `Settings` (settings hub for jobs/types/schedules)

Settings page includes an operator-facing Memory management route:
- `Settings -> Memory` (`/settings/memory`)
- lists scopes with aggregate counts/status/latest update time
- supports both reset scope and reset all workflows from same page

Workspace panel in `/chat` supports:
- file browse, preview, upload, edit/save, download, delete
- create file/folder and rename/move actions
- editor shortcuts: `Ctrl/Cmd+S` save, `Esc` cancel
- upload helpers: multi-file picker + drag-and-drop to current folder
- compact file list UX with full-row click targets and active-file highlight
- explorer/preview vertical split tuned for browsing + reading (about 1/3 + 2/3)
- width toggle for workspace pane (`Default width` / `Wider pane`)

## Security Notes
- API key:
  - `/v1/*` uses `x-api-key`.
  - secure default: if no auth keys are configured, requests are denied (`503 AUTH_NOT_CONFIGURED`).
  - `read` role keys are read-only; mutating routes return `403 FORBIDDEN`.
  - local dev override: set `API_AUTH_DISABLED=1` only in trusted environments.
- SSE authentication:
  - browser `EventSource` cannot send custom headers.
  - `/v1/jobs/:id/stream` accepts `api_key` query parameter for UI compatibility.
- Callback delivery:
  - controlled by `callbacks.enabled` in `rauskuclaw.json` (default `true`)
  - worker posts to `callback_url` after completion.
  - optional `CALLBACK_ALLOWLIST` can restrict callback domains.
  - optional HMAC signing:
    - set `CALLBACK_SIGNING_ENABLED=1` and `CALLBACK_SIGNING_SECRET`
    - if signing is enabled but secret is missing, callback is skipped and logged as warning
- Provider calls:
  - `codex.chat.generate` uses Codex CLI command execution (`codex exec`).
  - Codex CLI auth flow uses `codex login` / `codex logout` (OAuth).
  - `ai.chat.generate` uses OpenAI-compatible online API handler.
  - OpenAI path requires explicit enable (`OPENAI_ENABLED=1`) and API key.
  - provider job types are disabled by default until operator enables them.
- Built-in `report.generate` now returns structured output (`title`, `summary`, `metrics`, `highlights`, timestamps) from `input.metrics` or derived `input.values` stats.
- Built-in `deploy.run` now returns a structured dry-run deployment plan with validated `target`, `strategy`, and `services`.
- `deploy.run` currently enforces `dry_run=true` and does not execute real deployment actions.
- Built-in `code.component.generate` now supports validated component generation for `vue`/`react` and `ts`/`js` templates.
- Built-in `design.frontpage.layout` now returns structured landing-page section plans with validated tone/audience/action inputs.
- Built-in `tool.exec` provides allowlisted command execution (disabled by default and requires explicit allowlist).
- `tool.exec` safety model:
  - requires `TOOL_EXEC_ENABLED=1`
  - command must exist in `TOOL_EXEC_ALLOWLIST`
  - executes without shell (`spawn(..., { shell: false })`)
  - enforces timeout (`TOOL_EXEC_TIMEOUT_MS`)
- Built-in `data.fetch` supports allowlisted HTTPS fetches (disabled by default).
- `data.fetch` safety model:
  - requires `DATA_FETCH_ENABLED=1`
  - domain must exist in `DATA_FETCH_ALLOWLIST`
  - only `https://` URLs are accepted
  - enforces timeout (`DATA_FETCH_TIMEOUT_MS`) and payload cap (`DATA_FETCH_MAX_BYTES`)
- Built-in `data.file_read` supports workspace file reads (enabled by default).
- `data.file_read` safety model:
  - enabled via `DATA_FILE_READ_ENABLED` (default `1`)
  - path must resolve inside workspace root (`CODEX_OSS_WORKDIR`/configured workspace)
  - only files (not directories) are returned
  - payload is capped by `DATA_FILE_READ_MAX_BYTES`
- Built-in `workflow.run` executes predefined YAML workflows from `workspace/workflows/*.yaml` and enqueues declared step chains.
- Built-in `tools.web_search` supports web search queries (disabled by default).
- `tools.web_search` safety model:
  - requires `WEB_SEARCH_ENABLED=1`
  - provider configured by `WEB_SEARCH_PROVIDER` (`duckduckgo` or `brave`)
  - Brave mode requires `WEB_SEARCH_BRAVE_API_KEY`
  - query is validated and bounded
  - enforces timeout (`WEB_SEARCH_TIMEOUT_MS`) and result cap (`WEB_SEARCH_MAX_RESULTS`)
- API now validates risky handler payloads at `POST /v1/jobs` create time (`tool.exec`, `data.fetch`, `data.file_read`, `tools.web_search`, `workflow.run`) to fail fast before queueing.
- UI stores API key in browser `sessionStorage` only; key is not hardcoded in source.
- Host `nginx/rauskuclaw.conf` drops common scanner probe paths (for `.env`, `.git`, `@fs`, AWS creds paths, terraform secrets) with `444` before API proxying.

## Development Workflow
Docker-first workflow:
1. update code
2. rebuild services
3. verify via logs and API calls

Commands:
```bash
cd /opt/rauskuclaw
docker compose up -d --build
docker compose ps
```
```bash
cd /opt/rauskuclaw
docker logs --tail 200 rauskuclaw-api
docker logs --tail 200 rauskuclaw-worker
docker logs --tail 200 rauskuclaw-ui
```
```bash
cd /opt/rauskuclaw
./scripts/m1-smoke.sh
./scripts/m3-smoke.sh
./scripts/m4-smoke.sh
```

`m1-smoke.sh` covers:
- health + auth ping
- idempotency happy path and conflict path
- retry behavior (`data.fetch` failure with `max_attempts`)
- callback allowlist behavior (if `CALLBACK_ALLOWLIST` is configured)

`m3-smoke.sh` covers provider failure-path contracts (Codex + OpenAI handlers).
With `M3_SMOKE_SUCCESS=1` (or `rauskuclaw smoke --suite m3 --success`) it also asserts one provider success path (`codex.chat.generate` by default).

`m4-smoke.sh` covers semantic memory flow and recurrence dispatch (`/v1/memory/search` + `/v1/schedules` -> scheduled job).

Runbook-lite troubleshooting:
- API not reachable:
  - check `docker compose ps`
  - check host port bind `127.0.0.1:3001`
- Jobs stuck in `queued`:
  - inspect `rauskuclaw-worker` logs
  - verify worker container is running
- Live updates not moving in Job Detail:
  - confirm API stream endpoint `/v1/jobs/:id/stream` is reachable
  - verify `API_KEY` in UI session matches backend config
- UI does not load under `/ui/`:
  - verify Nginx location `/ui/`
  - verify `rauskuclaw-ui` container and port `3002`

## Known Gaps / Non-Goals (Current MVP)
- Built-in handler ecosystem is still intentionally small and security-first for networked capabilities.
- Provider integration is early-stage (Codex/OpenAI handlers only, no multi-provider orchestration yet).
- Semantic search currently has no automatic backfill for old memory rows (new writes are embedded asynchronously).

## MCP Server
RauskuClaw includes a Model Context Protocol (MCP) server for AI assistant integration. See [`mcp-server/README.md`](./mcp-server/README.md) for details.

### Claude Desktop Configuration
```json
{
  "mcpServers": {
    "rauskuclaw": {
      "command": "node",
      "args": ["/opt/openclaw/mcp-server/index.js"],
      "env": {
        "RAUSKUCLAW_API_URL": "http://localhost:3001",
        "RAUSKUCLAW_API_KEY": "your-api-key"
      }
    }
  }
}
```

## Roadmap Link
See [`PLAN.md`](./PLAN.md) for phased implementation milestones and acceptance criteria.

## Inspiration Sources
- https://docs.rauskuclaw.ai/concepts/architecture
- https://docs.rauskuclaw.ai/tools
- https://docs.rauskuclaw.ai/providers
- https://docs.rauskuclaw.ai/reference/AGENTS.default
- https://docs.rauskuclaw.ai/reference/templates/IDENTITY
- https://docs.rauskuclaw.ai/reference/templates/AGENTS
- https://docs.rauskuclaw.ai/reference/templates/BOOTSTRAP
- https://docs.rauskuclaw.ai/reference/templates/SOUL
- https://docs.rauskuclaw.ai/reference/templates/TOOLS
- https://docs.rauskuclaw.ai/reference/templates/USER
- https://docs.rauskuclaw.ai/reference/templates/HEARTBEAT
