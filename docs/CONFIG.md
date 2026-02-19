# Configuration Guide

This project uses two config layers:
- environment variables (`.env`) for runtime values and secrets
- `rauskuclaw.json` for shared service-level defaults and config structure

## Files
- `rauskuclaw.json`
  - canonical config structure for API/worker/UI/database/security behavior
  - intended as a stable contract for tooling and docs
  - loaded by API + worker at runtime (`RAUSKUCLAW_CONFIG_PATH`, default `/config/rauskuclaw.json`)
  - validated with Ajv against `app/config.schema.json`
- `.env`
  - actual runtime values consumed by containers/processes
- `.env.example`
  - starter template for `.env`

## Quick Usage
1. Copy env template:
```bash
cp .env.example .env
```
2. Set a real `API_KEY` in `.env`.
3. Start services:
```bash
docker compose up -d --build
```

CLI alternative:
```bash
npm link
rauskuclaw setup
rauskuclaw start
```

## `rauskuclaw.json` Structure

### Top-level
- `version`: config schema version
- `service`: service metadata
- `api`: API-related settings
- `worker`: worker runtime settings
- `database`: persistence settings
- `callbacks`: callback safety behavior
- `observability`: runtime metrics + alert evaluation settings
- `providers`: external provider settings (Codex OSS + OpenAI)
- `memory`: semantic memory/vector embedding and search settings
- `handlers`: handler-specific guardrails
- `ui`: UI routing/port metadata
- `runtime`: container/runtime names
- `env_mapping`: mapping from env vars to config paths

### API
- `api.port`
  - intended API port (`PORT`)
- `api.auth.header`
  - auth header name (`x-api-key`)
- `api.auth.required`
  - whether API auth is required by default
- `api.auth.keys`
  - optional multi-key auth entries (`name`, `key`, `role=admin|read`, `sse`, `queue_allowlist`)
  - `queue_allowlist` can be a JSON array (or comma-separated string) of allowed queue names for that key
  - when set, this model is used instead of legacy single `API_KEY`
- `api.auth.allow_without_key_when`
  - explicit dev bypass condition (`API_AUTH_DISABLED=1`)
- `api.sse`
  - SSE endpoint metadata and query key name for browser EventSource

### Worker
- `worker.poll_interval_ms`
  - queue polling interval (`WORKER_POLL_MS`)
- `worker.queue.allowlist_env`
  - env var controlling worker queue allowlist (`WORKER_QUEUE_ALLOWLIST`)
- `worker.queue.default_allowed`
  - default queue names worker processes when allowlist env is empty
- `worker.worker_id_source`
  - worker id source strategy (`WORKER_ID`, then hostname)
- `worker.job_defaults`
  - default values used when type-level defaults are not overridden
- `worker.scheduler.enabled`
  - enables/disables recurring schedule dispatch (`SCHEDULER_ENABLED`)
- `worker.scheduler.batch_size`
  - max due schedules dispatched per worker tick (`SCHEDULER_BATCH_SIZE`)
- `worker.scheduler.cron_timezone`
  - timezone for cron expression parsing (`SCHEDULER_CRON_TZ`, default `UTC`)

### Database
- `database.engine`
  - current engine (`sqlite`)
- `database.path`
  - file path used by API + worker (`DB_PATH`)
- `database.mode`
  - operational mode metadata (`wal`)

### Security / Safety
- `callbacks.enabled`
  - master on/off switch for callback delivery in worker
- `callbacks.allowlist_env`
  - env var controlling callback domain allowlist (`CALLBACK_ALLOWLIST`)
- `callbacks.allowlist_behavior_when_empty`
  - current behavior if allowlist is empty (`allow_all`)
- `callbacks.signing.enabled`
  - enables callback HMAC signing (default `false`)
- `callbacks.signing.secret_env`
  - env var name containing callback signing secret (default `CALLBACK_SIGNING_SECRET`)
- `callbacks.signing.tolerance_sec`
  - suggested verification window in seconds for receivers (default `300`)
- `observability.metrics.enabled`
  - enables runtime metrics event collection
- `observability.metrics.retention_days`
  - metrics retention window in days
- `observability.metrics.alerts.window_sec`
  - alert evaluation window length
- `observability.metrics.alerts.queue_stalled_sec`
  - threshold for oldest queued job age alert
- `observability.metrics.alerts.failure_rate_pct`
  - failure-rate alert threshold percentage
- `observability.metrics.alerts.failure_rate_min_completed`
  - minimum completed jobs required before failure-rate alerting
- `handlers.deploy.allowlist_env`
  - allowed deploy targets env var (`DEPLOY_TARGET_ALLOWLIST`)
- `handlers.exec.enabled_env`
  - env var that enables command execution handler (`TOOL_EXEC_ENABLED`)
- `handlers.exec.allowlist_env`
  - env var with comma-separated allowed commands for `tool.exec` (`TOOL_EXEC_ALLOWLIST`)
- `handlers.exec.timeout_env`
  - env var for default command timeout ms (`TOOL_EXEC_TIMEOUT_MS`)
- `handlers.exec.default_timeout_ms`
  - fallback timeout for `tool.exec` when env is not set
- `handlers.exec.default_allowed_commands`
  - optional config-level fallback allowlist when env allowlist is empty
- `handlers.data_fetch.enabled_env`
  - env var that enables URL fetch handler (`DATA_FETCH_ENABLED`)
- `handlers.data_fetch.allowlist_env`
  - env var with comma-separated allowed domains for `data.fetch` (`DATA_FETCH_ALLOWLIST`)
- `handlers.data_fetch.timeout_env`
  - env var for default fetch timeout ms (`DATA_FETCH_TIMEOUT_MS`)
- `handlers.data_fetch.max_bytes_env`
  - env var for max fetch payload bytes (`DATA_FETCH_MAX_BYTES`)
- `handlers.data_fetch.default_timeout_ms`
  - fallback timeout for `data.fetch` when env is not set
- `handlers.data_fetch.default_max_bytes`
  - fallback max payload bytes for `data.fetch`
- `handlers.data_fetch.default_allowed_domains`
  - optional config-level fallback domain allowlist when env allowlist is empty
- `handlers.file_read.enabled_env`
  - env var that enables workspace file-read handler (`DATA_FILE_READ_ENABLED`)
- `handlers.file_read.max_bytes_env`
  - env var for max file-read payload bytes (`DATA_FILE_READ_MAX_BYTES`)
- `handlers.file_read.workspace_root`
  - workspace root path used for `data.file_read` path sandboxing
- `handlers.file_read.default_max_bytes`
  - fallback max payload bytes for `data.file_read`
- `handlers.web_search.enabled_env`
  - env var that enables web search handler (`WEB_SEARCH_ENABLED`)
- `handlers.web_search.provider_env`
  - env var for search provider (`WEB_SEARCH_PROVIDER`)
- `handlers.web_search.timeout_env`
  - env var for default search timeout ms (`WEB_SEARCH_TIMEOUT_MS`)
- `handlers.web_search.max_results_env`
  - env var for default max result count (`WEB_SEARCH_MAX_RESULTS`)
- `handlers.web_search.base_url_env`
  - env var for search provider base URL (`WEB_SEARCH_BASE_URL`)
- `handlers.web_search.brave_api_key_env`
  - env var for Brave API key (`WEB_SEARCH_BRAVE_API_KEY`)
- `handlers.web_search.brave_endpoint_env`
  - env var for Brave endpoint (`WEB_SEARCH_BRAVE_ENDPOINT`)
- `handlers.web_search.default_provider`
  - fallback provider (`duckduckgo` or `brave`)
- `handlers.web_search.default_timeout_ms`
  - fallback timeout for `tools.web_search` when env is not set
- `handlers.web_search.default_max_results`
  - fallback max results for `tools.web_search`
- `handlers.web_search.default_base_url`
  - fallback base URL for `tools.web_search`
- `handlers.web_search.default_brave_endpoint`
  - fallback Brave search endpoint for `tools.web_search`

### Providers
- `providers.codex_oss.enabled`
  - provider enable flag (can be overridden by `CODEX_OSS_ENABLED`)
- `providers.codex_oss.model`
  - local model name (`CODEX_OSS_MODEL`, required when enabled)
- `providers.codex_oss.exec_mode`
  - execution mode: `online` (default) or `oss` (`CODEX_EXEC_MODE`)
- `providers.codex_oss.local_provider`
  - local provider mode (`ollama` or `lmstudio`) via `CODEX_OSS_LOCAL_PROVIDER`
- `providers.codex_oss.timeout_ms`
  - Codex command timeout (`CODEX_OSS_TIMEOUT_MS`)
- `providers.codex_oss.working_directory`
  - working directory passed to `codex exec --cd` (`CODEX_OSS_WORKDIR`)
  - recommended: `/workspace` (mounted from repo `./workspace` in Docker Compose)
- `providers.codex_oss.cli_path`
  - Codex CLI binary path (`CODEX_CLI_PATH`)
- `providers.openai.enabled`
  - provider enable flag (can be overridden by `OPENAI_ENABLED`)
- `providers.openai.api_key_env`
  - env variable name that stores API key (`OPENAI_API_KEY`)
- `providers.openai.base_url`
  - OpenAI-compatible base URL (`OPENAI_BASE_URL`)
- `providers.openai.chat_completions_path`
  - OpenAI-compatible chat completions path (`OPENAI_CHAT_COMPLETIONS_PATH`)
  - default: `/v1/chat/completions`
  - may also be a full URL when provider requires it
- `providers.openai.model`
  - default model (`OPENAI_MODEL`)
- `providers.openai.timeout_ms`
  - request timeout (`OPENAI_TIMEOUT_MS`)

### Memory (M4 Phase 1)
- `memory.vector.enabled`
  - enables semantic memory mode (`MEMORY_VECTOR_ENABLED`)
- `memory.vector.sqlite.extension_path`
  - sqlite-vector extension path (`SQLITE_VECTOR_EXTENSION_PATH`)
  - required when vector mode is enabled
- `memory.embedding.queue_type`
  - internal job type for async embedding (`MEMORY_EMBED_QUEUE_TYPE`)
- `memory.embedding.ollama.base_url`
  - Ollama base URL for embeddings (`OLLAMA_BASE_URL`)
  - default Docker Compose runtime: `http://rauskuclaw-ollama:11434`
- `memory.embedding.ollama.model`
  - embedding model name (`OLLAMA_EMBED_MODEL`)
- `memory.embedding.ollama.timeout_ms`
  - request timeout for embed calls (`OLLAMA_EMBED_TIMEOUT_MS`)
- `memory.search.top_k_default`
  - default top-k for `/v1/memory/search` (`MEMORY_SEARCH_TOP_K_DEFAULT`)
- `memory.search.top_k_max`
  - max allowed top-k (`MEMORY_SEARCH_TOP_K_MAX`)

Memory API endpoints:
- `GET /v1/memory`
  - list memory rows (`scope`/`key` filters, optional `include_expired`)
- `GET /v1/memory/scopes`
  - list aggregated scope-level memory stats (counts/status/latest update)
- `POST /v1/memory`
  - upsert memory row (`scope` + `key`)
- `GET /v1/memory/:id`
  - fetch one memory row
- `DELETE /v1/memory/:id`
  - delete one memory row
- `POST /v1/memory/reset`
  - destructive cleanup for one scope or all scopes (requires body `confirm=true`)
- `POST /v1/memory/search`
  - semantic search in scope (vector mode)

### Workspace File Browser (Chat UI)
- `providers.codex_oss.working_directory`
  - workspace root path used by worker/provider and file browser (`WORKSPACE_ROOT`)
- `api.workspace.file_view_max_bytes`
  - max text preview bytes (`WORKSPACE_FILE_VIEW_MAX_BYTES`)
- `api.workspace.file_write_max_bytes`
  - max text write/create bytes (`WORKSPACE_FILE_WRITE_MAX_BYTES`)
- `api.workspace.upload_max_bytes`
  - max upload bytes (`WORKSPACE_UPLOAD_MAX_BYTES`)

Workspace API endpoints:
- `GET /v1/workspace/files`
  - lists directory entries (hidden: `.codex-home`, `.gitkeep`)
- `GET /v1/workspace/file`
  - reads text file preview
- `PUT /v1/workspace/file`
  - saves text file content
- `DELETE /v1/workspace/file`
  - deletes file
- `GET /v1/workspace/download`
  - downloads file bytes
- `POST /v1/workspace/upload`
  - uploads file bytes via `content_base64`
- `POST /v1/workspace/create`
  - creates file/folder (`kind=file|dir`)
- `PATCH /v1/workspace/move`
  - renames/moves file/folder

Chat workspace UI notes:
- upload supports both file picker and drag-and-drop
- multiple files can be uploaded in one action to current folder

### Chat Memory Context (Worker Runtime)
- Chat provider job inputs (`codex.chat.generate`, `ai.chat.generate`) may include optional `input.memory`:
  - `scope` (required when `memory` object is present)
  - `query` (optional; fallback uses prompt/latest user message)
  - `top_k` (optional; bounded by `memory.search.top_k_max`)
  - `required` (boolean; default `false`)
- Runtime behavior:
  - when `memory.vector.enabled=false`, chat memory context is unavailable
  - when scope embeddings are pending/failed/missing, context is unavailable
  - if unavailable and `required=false`, worker logs warning and continues without memory context
  - if unavailable and `required=true`, job fails with `MEMORY_CONTEXT_UNAVAILABLE`

### Chat Memory Write-Back (Worker Runtime)
- Chat provider job inputs (`codex.chat.generate`, `ai.chat.generate`) may include optional `input.memory_write`:
  - `scope` (required)
  - `key` (optional; default `chat.reply.<job_id>`)
  - `ttl_sec` (optional; integer `1..31536000`)
  - `tags` (optional array, max 50 items)
  - `required` (boolean; default `false`)
- Runtime behavior:
  - worker saves provider `output_text` into memory under `scope` + `key`
  - saved row is marked `pending` and queued for embedding when vector mode is enabled
  - if write-back fails and `required=false`, worker logs warning and continues
  - if write-back fails and `required=true`, job fails with `MEMORY_WRITE_UNAVAILABLE`

## Environment Variable Mapping
`rauskuclaw.json` includes:
- `PORT -> api.port`
- `API_KEY -> api.auth`
- `API_KEYS_JSON -> api.auth.keys`
- `API_AUTH_DISABLED -> api.auth.allow_without_key_when`
- `DB_PATH -> database.path`
- `WORKER_POLL_MS -> worker.poll_interval_ms`
- `WORKER_QUEUE_ALLOWLIST -> worker.queue.allowlist_env`
- `SCHEDULER_ENABLED -> worker.scheduler.enabled`
- `SCHEDULER_BATCH_SIZE -> worker.scheduler.batch_size`
- `SCHEDULER_CRON_TZ -> worker.scheduler.cron_timezone`
- `DEPLOY_TARGET_ALLOWLIST -> handlers.deploy.allowlist_env`
- `TOOL_EXEC_ENABLED -> handlers.exec.enabled_env`
- `TOOL_EXEC_ALLOWLIST -> handlers.exec.allowlist_env`
- `TOOL_EXEC_TIMEOUT_MS -> handlers.exec.timeout_env`
- `DATA_FETCH_ENABLED -> handlers.data_fetch.enabled_env`
- `DATA_FETCH_ALLOWLIST -> handlers.data_fetch.allowlist_env`
- `DATA_FETCH_TIMEOUT_MS -> handlers.data_fetch.timeout_env`
- `DATA_FETCH_MAX_BYTES -> handlers.data_fetch.max_bytes_env`
- `DATA_FILE_READ_ENABLED -> handlers.file_read.enabled_env`
- `DATA_FILE_READ_MAX_BYTES -> handlers.file_read.max_bytes_env`
- `WEB_SEARCH_ENABLED -> handlers.web_search.enabled_env`
- `WEB_SEARCH_PROVIDER -> handlers.web_search.provider_env`
- `WEB_SEARCH_TIMEOUT_MS -> handlers.web_search.timeout_env`
- `WEB_SEARCH_MAX_RESULTS -> handlers.web_search.max_results_env`
- `WEB_SEARCH_BASE_URL -> handlers.web_search.base_url_env`
- `WEB_SEARCH_BRAVE_API_KEY -> handlers.web_search.brave_api_key_env`
- `WEB_SEARCH_BRAVE_ENDPOINT -> handlers.web_search.brave_endpoint_env`
- `CALLBACK_ALLOWLIST -> callbacks.allowlist_env`
- `CALLBACK_SIGNING_ENABLED -> callbacks.signing.enabled`
- `CALLBACK_SIGNING_SECRET -> callbacks.signing.secret_env`
- `CALLBACK_SIGNING_TOLERANCE_SEC -> callbacks.signing.tolerance_sec`
- `METRICS_ENABLED -> observability.metrics.enabled`
- `METRICS_RETENTION_DAYS -> observability.metrics.retention_days`
- `ALERT_WINDOW_SEC -> observability.metrics.alerts.window_sec`
- `ALERT_QUEUE_STALLED_SEC -> observability.metrics.alerts.queue_stalled_sec`
- `ALERT_FAILURE_RATE_PCT -> observability.metrics.alerts.failure_rate_pct`
- `ALERT_FAILURE_RATE_MIN_COMPLETED -> observability.metrics.alerts.failure_rate_min_completed`
- `CODEX_OSS_ENABLED -> providers.codex_oss.enabled`
- `CODEX_OSS_MODEL -> providers.codex_oss.model`
- `CODEX_EXEC_MODE -> providers.codex_oss.exec_mode`
- `CODEX_OSS_LOCAL_PROVIDER -> providers.codex_oss.local_provider`
- `CODEX_OSS_TIMEOUT_MS -> providers.codex_oss.timeout_ms`
- `CODEX_OSS_WORKDIR -> providers.codex_oss.working_directory`
- `CODEX_CLI_PATH -> providers.codex_oss.cli_path`
- `MEMORY_VECTOR_ENABLED -> memory.vector.enabled`
- `OLLAMA_BASE_URL -> memory.embedding.ollama.base_url`
- `OLLAMA_EMBED_MODEL -> memory.embedding.ollama.model`
- `OLLAMA_EMBED_TIMEOUT_MS -> memory.embedding.ollama.timeout_ms`
- `SQLITE_VECTOR_EXTENSION_PATH -> memory.vector.sqlite.extension_path`
- `MEMORY_SEARCH_TOP_K_DEFAULT -> memory.search.top_k_default`
- `MEMORY_SEARCH_TOP_K_MAX -> memory.search.top_k_max`
- `MEMORY_EMBED_QUEUE_TYPE -> memory.embedding.queue_type`
- `OPENAI_ENABLED -> providers.openai.enabled`
- `OPENAI_API_KEY -> providers.openai.api_key_env`
- `OPENAI_BASE_URL -> providers.openai.base_url`
- `OPENAI_CHAT_COMPLETIONS_PATH -> providers.openai.chat_completions_path`
- `OPENAI_MODEL -> providers.openai.model`
- `OPENAI_TIMEOUT_MS -> providers.openai.timeout_ms`

## Notes
- Runtime uses both `.env` and `rauskuclaw.json`.
- Precedence is: environment variable > `rauskuclaw.json` > hardcoded fallback.
- If `rauskuclaw.json` is present but invalid, startup fails fast with schema errors.
- Keep `rauskuclaw.json`, `.env.example`, and `README.md` synchronized when changing config behavior.
- `rauskuclaw setup` updates `.env` and syncs key runtime defaults into `rauskuclaw.json` (if present), while preserving unknown `.env` keys when possible.
- Chat memory context uses existing memory settings (`MEMORY_VECTOR_ENABLED`, `OLLAMA_*`, `MEMORY_SEARCH_TOP_K_*`) and does not introduce new env vars.
- Chat memory write-back uses existing memory settings and does not introduce new env vars.
- Docker Compose includes `rauskuclaw-ollama`; default `OLLAMA_BASE_URL` targets that internal service name.
- API auth supports either:
  - legacy single key (`API_KEY`)
  - multi-key JSON (`API_KEYS_JSON`) or config file entries (`api.auth.keys`)
  - `API_KEYS_JSON` takes precedence when present and non-empty.
- Callback signing headers (when enabled):
  - `x-rauskuclaw-timestamp`
  - `x-rauskuclaw-signature` (`v1=<hmac_sha256_hex>` over `timestamp + "." + rawBody`)
- Runtime observability endpoint:
  - `GET /v1/runtime/metrics` returns metric counters and active alert list
- UI preferences endpoint:
  - `GET /v1/ui-prefs?scope=<name>`
  - `PUT /v1/ui-prefs?scope=<name>`
  - values are persisted in SQLite table `ui_prefs`
