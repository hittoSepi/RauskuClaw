# RauskuClaw Plan

## Product Goal
Build a reliable, self-hosted, RauskuClaw-inspired agent execution platform that starts as a robust job runner and evolves into a provider-integrated, memory-aware automation system.

## Design Principles
- Clear architecture:
  - API, worker, UI, and storage responsibilities stay explicit.
- Tool-first execution:
  - jobs and handlers are first-class, observable units of work.
- Provider abstraction:
  - provider-specific logic is isolated behind stable interfaces.
- Bootstrapable workflows:
  - contributors can run, inspect, and extend locally with low setup friction.
- Security by default:
  - risky capabilities are disabled or allowlisted until hardened.

## Current Baseline
- Running stack:
  - API (`rauskuclaw-api`)
  - worker (`rauskuclaw-worker`)
  - UI (`rauskuclaw-ui`)
  - SQLite persistence (`./data`)
- Implemented API:
  - health/ping
  - job CRUD-ish operations (create/list/get/cancel/logs)
  - SSE job stream (`/v1/jobs/:id/stream`) for live updates
  - job type list/create/patch
- Worker behavior:
  - queue polling, locking, retries, timeout, callback posting
  - built-in handlers for seeded job types (mostly stubbed)
- UI:
  - jobs list
  - create job
  - job detail + live logs (SSE)
  - job types list

## Current Milestone State (2026-02-17)
- M1: `done`
- M2: `done`
- M3: `done` (provider success-path validated in runtime)
- M4: `done` (memory + scheduler foundations, semantic retrieval, and chat memory read integration validated)

## Milestones
### M1: Reliable Core Runner
Objective:
- Make the existing queue/worker behavior operationally reliable and reproducible.

Deliverables:
- Verified lifecycle behavior documentation:
  - `queued -> running -> succeeded/failed/cancelled`
- Reproducible retry/idempotency scenarios in docs/scripts.
  - `scripts/m1-smoke.sh` as local regression smoke entrypoint
- Callback allowlist behavior documented and testable.
- UI flow validated for list/create/detail/live-log/cancel.
- Runbook-lite troubleshooting guide maintained in README.

Acceptance Criteria:
- Lifecycle transitions are stable and observable via API + logs.
- `Idempotency-Key` behavior is reproducible:
  - same key + same payload returns existing job
  - same key + different payload returns conflict
- Retry behavior matches `max_attempts`.
- Callback allowlist behavior is testable for allowed vs blocked domains.
- Core UI workflow works end-to-end against local stack (including live SSE watch).

Dependencies:
- Docker Compose environment.
- Stable SQLite volume mount.
- Contributor access to `.env` configuration.

Risks:
- Callback security misconfiguration when allowlist is empty.
- Operational confusion without explicit runbook.
- Divergence between docs and implementation.

Exit Criteria:
- New contributors can run and verify the system from README instructions only.

### M2: Tooling + Job Type Management UX
Objective:
- Improve operability and type management from both API and UI perspectives.

Deliverables:
- UI enhancements for job type management actions:
  - enable/disable
  - defaults update
- Better validation/error visibility in create-job and detail views.
- Basic operator UX for filtering and job inspection improvements.

Acceptance Criteria:
- Type management workflows are available without direct DB edits.
- Validation errors are understandable and actionable in UI.
- Operator can complete common actions in UI without API fallback.

Dependencies:
- Stable M1 behavior.
- Existing job type patch/create endpoints.

Risks:
- UI/API mismatch for payload constraints.
- State refresh issues causing stale operator view.

Exit Criteria:
- Primary day-to-day operations are manageable from UI plus minimal CLI checks.

### M3: Provider Integration
Objective:
- Introduce provider-backed execution for non-stub job handlers with a clean abstraction boundary.

Deliverables:
- Provider interface layer and OpenAI implementation.
- New provider-backed job type(s) with explicit input/output contracts.
- Config and secret handling model for provider credentials.
- Safety guardrails for outbound calls and retries.

Acceptance Criteria:
- At least one production-like job type executes through provider abstraction.
- Provider-specific failures are surfaced in logs/results predictably.
- Existing non-provider job flows remain stable.

Dependencies:
- M1 reliability baseline.
- Clear handler interface and error model.

Risks:
- Cost and rate-limit surprises.
- Prompt/response variability causing brittle downstream behavior.
- Secret handling mistakes.

Exit Criteria:
- Provider-backed job execution is deterministic enough for controlled operational use.

### M4: Memory + Automation Foundations
Objective:
- Add memory and recurring automation primitives without breaking core reliability.

Deliverables:
- Memory subsystem design + initial implementation:
  - storage model
  - retrieval API
  - integration points for jobs
- Heartbeat/recurrence orchestration foundation.
- Guardrails for memory scope and retention.

Acceptance Criteria:
- Memory write/read flow works through defined interfaces.
- Recurring automation can trigger jobs safely.
- Operational docs cover lifecycle, limits, and fallback behavior.

Dependencies:
- M1 and M3 stable execution patterns.
- Agreed retention/privacy constraints.

Risks:
- Memory growth and performance degradation.
- Automation loops and runaway execution.
- Unclear ownership boundaries between scheduler and worker.

Exit Criteria:
- Platform can run useful recurring, context-aware automations with controlled risk.

## Cross-Cutting Concerns
- Security:
  - auth model, callback controls, secret management.
- Observability:
  - logs, error taxonomy, operator diagnostics.
- Compatibility:
  - migration-safe DB changes and handler evolution.
- Documentation quality:
  - docs remain executable and version-aligned with implementation.
- Operational discipline:
  - runbooks and rollback guidance grow with new capabilities.

## Risks and Mitigations
- Risk: documentation drift.
  - Mitigation: update docs in same change as behavior changes.
- Risk: route/contract regressions.
  - Mitigation: add API and UI smoke checks per milestone.
- Risk: security regressions as features expand.
  - Mitigation: default-deny posture for new networked capabilities.
- Risk: contributor friction.
  - Mitigation: keep quickstart and troubleshooting minimal, explicit, and tested.

## Backlog Parking Lot
- Multi-queue / tenant isolation strategy.
- Richer built-in handlers and external tool ecosystem.

## Definition of Done for Each Milestone
- Objective met with measurable acceptance criteria.
- Core happy path and failure path validated.
- Documentation updated (`README.md`, `PLAN.md`, relevant API notes).
- No unresolved high-severity security regressions introduced.
- Contributor can reproduce milestone outcomes locally.

## Changelog
- 2026-02-18:
  - MEMORY/context strategy update:
    - repo-context summarization narrowed to `IDENTITY.md` and `SOUL.md` only.
    - other injected repo-context sources now stay full-text (within existing size caps).
    - clear/new-session flow now runs an agent summary warmup for `IDENTITY.md` + `SOUL.md` before greeting.
    - warmup summary is stored as hidden assistant context (not shown in normal chat stream).
  - Chat routing upgrade:
    - replaced pure UI heuristic routing with dedicated router-agent decision (`ROUTE: planner|agent`) in auto mode.
    - manual planner toggle remains hard override.
  - Chat run UX upgrade:
    - pending state now shows `Thinking... (Ns)` timer.
    - composer send button now becomes `Stop` during active run and cancels current chat job.
  - Memory context visibility + continuity upgrades:
    - prompt trace now explicitly shows injected `memory` config/query and `memory_write` config.
    - memory query backlog entries now include per-entry timestamps.
    - memory query length now scales with `chatMaxPromptTokens` (`~max_tokens/2`) and compacts older history automatically when needed.
  - Suggested-job resilience upgrades:
    - parser now supports truncated/unfenced `rausku_jobs` recovery.
    - UI auto-repair and retry extended for `data.write_file` validation errors (`content_base64`, mutually exclusive content fields).
  - Added near-memory retrieval fallback for chat context:
    - `buildChatMemoryContext` now merges vector hits with recent `memories` rows in same scope.
    - fallback allows fresh `embedding_status='pending'` entries to be used before embed sync is finished.
    - duplicates are removed and final context remains capped by `top_k`.
    - chat-context test coverage updated for sparse-vector fallback path.
  - Chat memory continuity + UX updates:
    - internal auto-continue prompts are now echoed as `SYSTEM` messages (instead of `You`) and persisted to near-memory.
    - chat side panel split into `Job List` and `Memory Writes`.
    - `Memory Writes` rows are expandable to inspect written assistant content.
  - Planner/suggested-job hardening:
    - prompt guardrails added to avoid suggesting `system.memory.embed.sync` without explicit `input.memory_id`.
    - suggested-job auto-repair extended for `system.memory.embed.sync requires input.memory_id`.
- 2026-02-17:
  - Chat provider fallback usability hardening:
    - chat send path now auto-falls back to alternative enabled chat type when selected provider runtime is disabled
    - trace/status now explicitly reports automatic fallback decision (`codex.chat.generate` <-> `ai.chat.generate`)
    - prevents avoidable send-block states when one provider runtime is down but the other is operational
  - Chat provider runtime selection hardening:
    - Chat page now reads `/v1/runtime/providers` when loading chat types
    - default chat type selection auto-follows enabled runtime provider (`codex.chat.generate` vs `ai.chat.generate`)
    - send is blocked with explicit reason when selected provider runtime is disabled
  - Added runtime guardrail awareness to Create Job UI:
    - create form now loads runtime handler status (`/v1/runtime/handlers`) alongside types/providers
    - `tool.exec` and `data.fetch` creation now shows runtime enabled/disabled status badge
    - client validation blocks submit when selected runtime handler is disabled
  - Added Settings runtime diagnostics section for built-in handlers:
    - Settings UI now loads and displays `GET /v1/runtime/handlers`
    - includes enabled-state and runtime guardrail values (timeouts/max-bytes) when available
    - added manual "Reload handlers" action for operator refresh
  - Added runtime built-in handler diagnostics endpoint:
    - new `GET /v1/runtime/handlers` shows current guardrail/runtime status for `deploy`, `tool_exec`, `data_fetch`
    - read role gets redacted enabled-only view; admin role gets detailed allowlist/timeout/max-bytes view
    - added API coverage for read/admin response shape (`app/test/auth_api.test.js`)
  - Improved Create Job UX for new tool handlers:
    - added type-specific input templates in UI create form for `tool.exec` and `data.fetch`
    - added client-side type-specific validation mirroring API guardrails for risky inputs
    - extracted template/validation helpers to `ui/src/job_input_templates.js`
    - added UI unit coverage for templates and validation (`ui/test/job_input_templates.test.mjs`)
  - Hardened create-time validation for risky built-in handlers:
    - `POST /v1/jobs` now validates `tool.exec` and `data.fetch` input shape before enqueue
    - prevents malformed high-risk jobs from entering retry loops in worker
    - added API regression coverage for handler-specific validation (`app/test/jobs_queue_api.test.js`)
  - Continued backlog item "Richer built-in handlers and external tool ecosystem":
    - upgraded `builtin:data.fetch` from hard-disabled stub to allowlisted HTTPS fetch tool
    - execution remains disabled by default and requires explicit domain allowlist (`DATA_FETCH_ENABLED`, `DATA_FETCH_ALLOWLIST`)
    - added timeout and payload-size guardrails (`DATA_FETCH_TIMEOUT_MS`, `DATA_FETCH_MAX_BYTES`)
    - added unit coverage for fetch success-path, allowlist enforcement, and payload clipping (`app/test/data_fetch_handler.test.js`)
  - Continued backlog item "Richer built-in handlers and external tool ecosystem":
    - added new built-in command execution handler `builtin:tool.exec` with safe defaults
    - execution is disabled by default and guarded by explicit command allowlist
    - command execution uses non-shell spawn path with bounded output and timeout handling
    - added unit coverage for allowlist, success-path, and timeout behavior (`app/test/tool_exec_handler.test.js`)
  - Continued backlog item "Richer built-in handlers and external tool ecosystem":
    - upgraded `builtin:design.frontpage.layout` from static stub to validated frontpage-layout plan generator
    - output now includes normalized style metadata and section-level structure (`hero`, `features`, `social-proof`, `cta`, `footer`)
    - validates layout intent inputs (`tone`, `audience`, `primary_action`, `feature_count`)
    - added unit coverage for layout handler behavior (`app/test/layout_handler.test.js`)
  - Continued backlog item "Richer built-in handlers and external tool ecosystem":
    - upgraded `builtin:code.component.generate` from static stub to validated template generator
    - supports `vue`/`react` frameworks and `ts`/`js` language modes
    - validates `component_name` with deterministic file naming/output shape
    - added unit coverage for component handler behavior (`app/test/component_handler.test.js`)
  - Continued backlog item "Richer built-in handlers and external tool ecosystem":
    - upgraded `builtin:deploy.run` from static stub to structured dry-run plan builder
    - enforces validated `target`, `strategy`, and `services` inputs with deterministic output shape
    - keeps safe MVP posture by rejecting non-dry-run execution (`dry_run=false`)
    - added unit coverage for deploy handler behavior (`app/test/deploy_handler.test.js`)
  - Started backlog item "Richer built-in handlers and external tool ecosystem":
    - upgraded `builtin:report.generate` from static stub to structured report builder
    - report output now includes `generated_at`, normalized `title/source`, `metrics`, `highlights`, and deterministic summary text
    - supports direct metric map input (`input.metrics`) and fallback numeric-stat derivation from `input.values`
    - added unit coverage for report handler behavior (`app/test/report_handler.test.js`)
  - Advanced auth queue scoping (runtime metrics):
    - `/v1/runtime/metrics` now accepts optional `queue` filter with queue-name validation
    - queue-allowlisted API keys now receive queue-scoped job status + alert evaluation in metrics response
    - queue filter outside key allowlist now returns `403 FORBIDDEN` with `allowed_queues` details
    - added API integration coverage for metrics queue scope (`app/test/runtime_metrics.test.js`)
  - Hardened chat suggested-job parsing maintainability:
    - extracted `parseSuggestedJobs` from `Chat.vue` to `ui/src/suggested_jobs.js`
    - added UI unit tests for fenced-block parsing/normalization (`ui/test/suggested_jobs.test.mjs`)
    - added `npm --prefix ui test` script for parser regression checks
  - Hardened suggested-job deduplication reliability:
    - extracted duplicate-filter logic from `Chat.vue` to `ui/src/suggested_jobs.js`
    - added UI unit tests for duplicate detection and filtering behavior (`ui/test/suggested_jobs.test.mjs`)
  - Hardened chat memory input handling maintainability:
    - extracted memory validation/build/status helpers from `Chat.vue` to `ui/src/chat_memory.js`
    - added UI unit tests for memory validation, payload normalization, and memory write status formatting (`ui/test/chat_memory.test.mjs`)
  - Hardened suggested-job auto-approval policy maintainability:
    - extracted policy decisions from `Chat.vue` to `ui/src/suggested_job_policy.js`
    - added UI unit tests for policy modes, thresholds, allowlist, and normalization (`ui/test/suggested_job_policy.test.mjs`)
  - Added suggested-job end-to-end flow helper + integration coverage:
    - extracted parse+dedupe+policy+creation-selection flow from `Chat.vue` to `ui/src/suggested_jobs_flow.js`
    - added integration-style UI test validating chained behavior from fenced response to create payload (`ui/test/suggested_jobs_flow.test.mjs`)
  - UI bundle split hardening:
    - switched page routes to lazy-loaded imports in `ui/src/router.js`
    - added Vite `manualChunks` split (`vendor` + `highlight`) in `ui/vite.config.js`
    - reduced main entry chunk size; highlight library isolated into dedicated async chunk
  - Optimized syntax-highlighting bundle scope:
    - replaced full `highlight.js` import with `highlight.js/lib/core` + selected dev language registrations (`ui/src/highlight.js`)
    - limited auto-detection to common development file types (js/ts/json/bash/yaml/python/go/rust/java/sql/dockerfile/xml/css/markdown)
    - reduced highlight chunk size from ~940 kB to ~75 kB (minified, before gzip)
  - Improved workspace code-preview accuracy:
    - made highlight selection filename-aware (extension mapping + Dockerfile special case) in `ui/src/highlight.js`
    - kept auto-detection fallback for unknown file types
    - added highlight utility tests (`ui/test/highlight.test.mjs`)
  - Added workspace file-type icon badges:
    - added extension-to-icon-token mapping helper (`ui/src/file_icons.js`)
    - rendered file-type badges in workspace file explorer list (with category color styling) in `ui/src/pages/Chat.vue`
    - added language badge in preview metadata based on filename detection
    - added unit coverage for icon mapping (`ui/test/file_icons.test.mjs`)
  - Switched workspace icons to exported Iconify SVG assets:
    - added Iconify export pipeline script (`ui/scripts/export-file-icons.mjs`) based on `parseIconSet()` + `iconToSVG()`
    - added `ui` command `npm run icons:export` and dependencies `@iconify/utils` + `@iconify-json/vscode-icons`
    - generated selected file icons to `ui/public/file-icons/*` with manifest metadata
    - file explorer now renders SVG icons from exported assets with token fallback
  - Advanced authN/authZ hardening (SSE path):
    - added API test coverage for SSE auth behavior with per-key `sse` flag and query-parameter API key flow
    - verifies `sse: false` key is rejected with `403 FORBIDDEN`
    - verifies allowed SSE query-key path authenticates and reaches route-level `NOT_FOUND` behavior
  - Advanced authN/authZ hardening (provider runtime visibility):
    - `/v1/runtime/providers` now returns redacted response for `read` role keys (enabled-state only)
    - admin role retains full provider runtime detail response
    - added API test coverage verifying read/admin response shape difference
  - Added auth diagnostics endpoint:
    - new `GET /v1/auth/whoami` returns effective API principal (`name`, `role`, `sse`, `can_write`)
    - wired from existing auth middleware principal resolution
    - added API tests for read/admin key behavior on whoami response
  - Added CLI auth diagnostics command:
    - new command `rauskuclaw auth whoami [--api <baseUrl>] [--json]`
    - wired to `/v1/auth/whoami` with env/.env API base and API key resolution
    - added CLI parser + command tests and documentation updates (`README.md`, `docs/CLI.md`)
  - Added UI auth diagnostics in Settings:
    - Settings page now fetches and displays effective auth principal (`name`, `role`, `sse`, `can_write`) via `/v1/auth/whoami`
    - added manual "Reload identity" action and inline auth error handling in settings UI
  - Added top-level auth status indicator in UI shell:
    - app status bar now displays current auth role from `/v1/auth/whoami` (alongside API ping)
    - status refreshes on initial load and when API key is saved
  - Completed backlog item "Multi-queue foundation (phase 1)":
    - added `jobs.queue` column + migration guard for existing databases
    - added queue-aware indexing and safe migration ordering
    - `POST /v1/jobs` now accepts optional `queue` with validation
    - idempotency hash now includes `queue`
    - `GET /v1/jobs` now supports `queue` filter
    - worker queue processing is now scoped by allowlist:
      - `worker.queue.allowlist_env`
      - `worker.queue.default_allowed`
  - Advanced auth queue scoping:
    - added per-key `queue_allowlist` support in API auth entries (`API_KEYS_JSON` / `api.auth.keys`)
    - `POST /v1/jobs` now enforces queue membership for keys with an allowlist
    - job visibility/actions are now queue-scoped for allowlisted keys:
      - `GET /v1/jobs`, `GET /v1/jobs/:id`, `GET /v1/jobs/:id/logs`, `GET /v1/jobs/:id/stream`, `POST /v1/jobs/:id/cancel`
    - `GET /v1/auth/whoami` now includes effective `queue_allowlist`
    - added auth API coverage for queue-allowlist enforcement and whoami shape
  - Extended queue model to schedules:
    - added `job_schedules.queue` column with migration guard for existing DBs
    - scheduler dispatch now enqueues jobs into schedule-defined queue (instead of implicit default)
    - `/v1/schedules` create/list/patch/get/delete now support and enforce queue scoping
    - added API and scheduler test coverage for schedule queue behavior
    - added schedule queue index (`idx_job_schedules_queue_enabled_next_run_at`) for queue-filter and dispatch-adjacent lookups
  - Updated schedules UI for queue-aware operations:
    - added queue filter in `/settings/schedules` (allowlist-aware)
    - added queue field to schedule create/edit flows
    - added read-only and queue-policy error handling for schedule mutations
      - `WORKER_QUEUE_ALLOWLIST`
    - docs/config surfaces updated (`README.md`, `docs/CONFIG.md`, `.env.example`, `rauskuclaw.json`, CLI setup prompts)
    - added queue API regression coverage (`app/test/jobs_queue_api.test.js`)
    - fixed startup regression on old DBs where `jobs.queue` did not exist yet during index creation
  - Completed backlog item "Structured metrics and alerts pipeline":
    - added runtime metrics event store (`metrics_events`) in SQLite
    - added instrumentation in API + worker paths for key events (job lifecycle, callbacks, scheduler dispatch)
    - new runtime endpoint `GET /v1/runtime/metrics` with:
      - counter aggregation window
      - job status snapshot
      - active alert evaluation
    - initial alert set:
      - `QUEUE_STALLED` (oldest queued job age threshold)
      - `HIGH_FAILURE_RATE` (failed/completed ratio threshold)
    - new observability config/env surface:
      - `observability.metrics.*`
      - `METRICS_ENABLED`
      - `METRICS_RETENTION_DAYS`
      - `ALERT_WINDOW_SEC`
      - `ALERT_QUEUE_STALLED_SEC`
      - `ALERT_FAILURE_RATE_PCT`
      - `ALERT_FAILURE_RATE_MIN_COMPLETED`
    - added API integration coverage for metrics endpoint (`app/test/runtime_metrics.test.js`)
  - Completed backlog item "Callback signing/verification scheme":
    - worker callback delivery supports optional HMAC signing
    - new config/env controls:
      - `callbacks.signing.enabled`
      - `callbacks.signing.secret_env`
      - `callbacks.signing.tolerance_sec`
      - `CALLBACK_SIGNING_ENABLED`
      - `CALLBACK_SIGNING_SECRET`
      - `CALLBACK_SIGNING_TOLERANCE_SEC`
    - callback signing headers:
      - `x-rauskuclaw-timestamp`
      - `x-rauskuclaw-signature` (`v1=<hmac_sha256_hex>`)
    - fail-safe behavior:
      - callbacks are skipped when signing is enabled but secret is missing
    - added callback signing unit tests (`app/test/callback_signing.test.js`)
  - Started backlog item "Advanced authN/authZ model":
    - API now supports multi-key auth via `API_KEYS_JSON` or `api.auth.keys`
    - added per-key roles (`admin`, `read`) with write-route protection (`403 FORBIDDEN` for read-only keys on mutating routes)
    - legacy `API_KEY` remains supported as admin fallback when multi-key config is not set
    - added API tests covering legacy auth and role-based access behavior
  - UI navigation consolidation:
    - top bar reduced to `Chat` and `Settings`
    - added `/settings` hub page that groups jobs/create-job/schedules/types views
    - nested settings routes added under `/settings/*`
    - legacy route redirects retained for `/jobs`, `/jobs/new`, `/jobs/:id`, `/schedules`, `/types`
  - Settings operational controls:
    - added dedicated memory management page into settings route tree (`/settings/memory`)
    - page lists memory scopes with aggregate counts/status/latest update
    - added scope detail drill-down (`View`) for per-memory row inspection
    - destructive actions available on same page:
      - reset one scope
      - reset all scopes (explicit confirmation text required)
    - uses:
      - `GET /v1/memory/scopes`
      - `POST /v1/memory/reset`
  - Chat memory usability update:
    - added `memory_write` controls to `/chat` UI so assistant replies can be written to memory directly from chat jobs
  - Chat UX simplification + dev toggle:
    - moved advanced/debug chat controls behind Settings `Dev mode` boolean
    - added Settings defaults for chat memory and chat memory write-back
    - chat now applies these defaults automatically and keeps session state across `/settings` navigation
  - Added operator memory cleanup flow for clean-state maintenance:
    - new API endpoint `POST /v1/memory/reset` (requires `confirm=true`)
    - supports full reset or scoped reset via `scope`
    - new CLI command `rauskuclaw memory reset --yes [--scope <scope>] [--api <baseUrl>] [--json]`
    - added API + CLI test coverage and documentation updates
  - Operational direction update:
    - removed legacy memory test rows (`m4-smoke-*`) from runtime database to continue from clean memory state
    - manual legacy backfill command deferred (not required for current environment)
    - validated post-cleanup with `rauskuclaw smoke --suite m4 --json`
  - Extended Chat workspace tooling from viewer to file-manager MVP:
    - added workspace APIs for create and rename/move:
      - `POST /v1/workspace/create`
      - `PATCH /v1/workspace/move`
    - completed workspace operation set in `/chat` panel:
      - list/read/edit/download/upload/delete/create/rename-move
    - added editor shortcuts in file edit mode:
      - `Ctrl/Cmd+S` save
      - `Esc` cancel
    - hardened workspace list UX:
      - hide `.codex-home` and `.gitkeep`
      - full-row clickable entries + compact list styling
  - Improved chat suggested-job completion visibility:
    - creating suggested jobs now waits for terminal state and posts each job result back into chat
    - failures include status + error details in the generated assistant message
  - Extended `scripts/m4-smoke.sh` with chat memory write-back E2E assertion:
    - creates provider chat job with `memory_write.required=true`
    - validates `job.result.memory_write.scope/key`
    - validates persisted memory row exists in target scope
    - optional skip via `M4_SMOKE_CHAT_WRITEBACK=0`
  - Closed M4 with validated acceptance checks:
    - `npm --prefix app test`
    - `rauskuclaw smoke --suite m4 --json`
  - Closed M3 with production-like success-path validation:
    - `rauskuclaw smoke --suite m3 --success --json` passed in 2 consecutive runs
  - Completed M4 chat memory read integration:
    - chat job input supports optional `memory` block (`scope`, `query`, `top_k`, `required`)
    - worker builds/injects memory context before provider call
    - deterministic required-fail code when memory context is unavailable: `MEMORY_CONTEXT_UNAVAILABLE`
    - UI support added for memory fields in `/chat` and `/jobs/new`
  - Moved Ollama embedding runtime to dedicated Compose service:
    - `rauskuclaw-ollama` container with persistent `ollama_data` volume
    - default runtime URL is internal Docker network address `http://rauskuclaw-ollama:11434`
  - Standardized embedding model identifier to `embeddinggemma:300m-qat-q8_0`.
  - Hardened M4 smoke schedule step to auto-create/enable `report.generate` type when needed.
  - Full acceptance validation pass completed:
    - `npm test`
    - `npm --prefix app test`
    - `rauskuclaw smoke --suite m1 --json`
    - `rauskuclaw smoke --suite m3 --success --json` (2x)
    - `rauskuclaw smoke --suite m4 --json`
  - Upgraded scheduler cadence to support cron expressions (`cron-parser`) in addition to fixed intervals:
    - API supports `interval_sec` or `cron` in `/v1/schedules` create/patch
    - worker dispatch now uses configurable cron timezone (`SCHEDULER_CRON_TZ`)
    - `/ui/schedules` supports cadence mode switch (interval/cron)
    - scheduler/API tests and M4 smoke updated for cron cadence path
  - Added M4 recurrence/scheduler foundation:
    - `job_schedules` table for periodic job definitions
    - schedule management API (`/v1/schedules`)
    - worker-side recurring dispatch loop with configurable batch/enable flags
    - scheduler unit tests (`app/test/scheduler.test.js`)
  - Added `/ui/schedules` operator page for recurring schedule management.
  - Extended `scripts/m4-smoke.sh` to verify recurring dispatch path (`/v1/schedules` -> scheduled job).
- 2026-02-16:
  - Initial phase-based roadmap created.
  - Milestones M1-M4 defined with objective/deliverables/acceptance/dependencies/risks/exit criteria.
  - Added SSE live job/log streaming (`/v1/jobs/:id/stream`) and UI integration in Job Detail.
  - Added `scripts/m1-smoke.sh` for reproducible M1 checks (idempotency, retry, callback allowlist).
  - Added UI job type edit actions on `/types` (enable/disable, handler, default timeout, default attempts).
  - Improved `/jobs` operator UX (auto-refresh on filter change, loading state, stale-request guard, clear-filters action).
  - Unified operator feedback on `/types`, `/jobs/new`, and `/jobs/:id` (success/status messages + last-action timestamps).
  - Added `/jobs` quick search and timed auto-refresh for faster operator inspection loops.
  - Added config regression tests (`app/test/config.test.js`) for Ajv validation fail-fast and env-over-config precedence.
  - M2 acceptance/exit criteria now covered by UI and docs updates (job type management + validation/error visibility + operator UX).
  - Started M3 with provider abstraction scaffold (`app/providers/*`) and OpenAI-backed handler (`builtin:provider.openai.chat`).
  - Seeded `ai.chat.generate` job type (disabled by default) and added OpenAI config/env surface (`rauskuclaw.json`, `.env.example`, docs).
  - Added Codex OSS provider handler (`builtin:provider.codex.oss.chat`) using `codex exec --oss` with deterministic non-interactive flags.
  - Seeded `codex.chat.generate` job type (disabled by default) and added Codex OSS config/env surface (`CODEX_OSS_*`, `CODEX_CLI_PATH`).
  - Added provider-unit test coverage for Codex OSS input normalization, command construction, event parsing, and failure paths.
  - Added RauskuClaw CLI v1 (`rauskuclaw`) with core operator commands: setup/start/stop/restart/status/logs/smoke/config/help/version.
  - Added interactive `.env` setup wizard and root-level npm bin installation path (`npm link`).
  - Added CLI `doctor` command (`rauskuclaw doctor [--json]`) for dependency health checks (docker/codex/local provider/env).
  - Upgraded setup wizard to Ink/React UI with keyboard-selectable boolean toggles and config sync to `rauskuclaw.json`.
  - Hardened host Nginx by dropping common secret/dotfile scanner probe paths with `444` before API proxy.
  - Expanded `rauskuclaw logs` with `--since` and `--security` options for focused security probe analysis from container logs.
  - Expanded machine-readable CLI support with `--json` for lifecycle commands (`start`, `stop`, `restart`, `status`, `smoke`) and `config` subcommands.
  - Added structured `--json` output for `logs` security mode (`logs ... --security --json`).
  - Added provider error taxonomy (`PROVIDER_*` codes) for OpenAI/Codex paths and propagated code/details into worker error logging/state.
  - Added M3 provider smoke automation (`scripts/m3-smoke.sh`) and wired CLI `smoke --suite m1|m3`.
  - Activated `callbacks.enabled` behavior in worker so callback delivery can be explicitly disabled via config.
  - Started M4 implementation by adding scoped memory CRUD foundation (`/v1/memory`) backed by SQLite `memories` table with TTL support.
  - Implemented M4 Phase 1 semantic memory retrieval path:
    - async embedding jobs via `system.memory.embed.sync` (`builtin:memory.embed.sync`)
    - Ollama embedding client (`/api/embed`) with timeout/network/http/response error taxonomy
    - sqlite-vector integration with startup fail-fast when enabled and extension missing
    - new `memory_vectors` table + embedding lifecycle fields on `memories`
    - new API endpoint `POST /v1/memory/search` (vector-only top-k, fail when scope has unembedded/failed rows)
    - Docker connectivity for host Ollama via `extra_hosts: host.docker.internal:host-gateway`
    - M4 smoke suite `scripts/m4-smoke.sh` and CLI support `rauskuclaw smoke --suite m4`
