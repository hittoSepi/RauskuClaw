# Milestone Status

Last updated: 2026-02-17

## M1: Reliable Core Runner
Status: `done` (operational baseline in place)

Completed:
- Job lifecycle works (`queued -> running -> succeeded/failed/cancelled`).
- Idempotency behavior implemented and smoke-tested.
- Retry flow with `max_attempts` implemented and smoke-tested.
- Callback allowlist behavior covered in smoke script.
- UI baseline operational for job/type management.

Reference:
- `scripts/m1-smoke.sh`

## M2: Tooling + Job Type Management UX
Status: `done`

Completed:
- Type management flows in UI.
- Improved validation and feedback loops in UI.
- Operator-focused enhancements for filtering and refresh.

## M3: Provider Integration
Status: `done`

Completed:
- Provider abstraction layer.
- `codex.chat.generate` and `ai.chat.generate` provider-backed paths.
- Config surface and schema validation.
- Deterministic provider execution flags (Codex OSS path).
- Provider error taxonomy (`PROVIDER_*`) and worker propagation to logs/job error JSON.
- Unit tests for Codex + OpenAI provider behavior.
- M3 smoke suite scaffold with deterministic failure-path checks.
- M3 smoke suite success-path mode (`rauskuclaw smoke --suite m3 --success`) for provider runtime verification.
- Provider success-path validated in runtime with repeatable smoke checks (`rauskuclaw smoke --suite m3 --success`).

Reference:
- `scripts/m3-smoke.sh`
- `app/providers/*`
- `app/test/codex_oss.test.js`
- `app/test/openai.test.js`

## M4: Memory + Automation Foundations
Status: `done`

Completed:
- Memory storage table + indexes in SQLite (`memories`).
- Memory API foundation:
  - `GET /v1/memory`
  - `POST /v1/memory` (upsert by `scope` + `key`)
  - `GET /v1/memory/:id`
  - `DELETE /v1/memory/:id`
- TTL support via `ttl_sec` and `expires_at`.
- Added API test coverage for memory endpoints:
  - CRUD + TTL visibility behavior
  - `POST /v1/memory/search` disabled/unavailable/success paths
- Added recurrence/scheduler foundation:
  - `job_schedules` table + worker dispatch loop
  - schedule API endpoints: `GET/POST/PATCH/DELETE /v1/schedules` and `GET /v1/schedules/:id`
  - cadence supports both interval (`interval_sec`) and cron (`cron`) via `cron-parser`
  - scheduler controls via config/env (`SCHEDULER_ENABLED`, `SCHEDULER_BATCH_SIZE`, `SCHEDULER_CRON_TZ`)
  - scheduler unit tests (`app/test/scheduler.test.js`)
  - M4 smoke coverage extended to include `/v1/schedules` recurring dispatch check
- Added first handler/workflow integration for memory:
  - provider chat jobs now support optional input memory context block:
    - `memory.scope` (required when enabled)
    - `memory.query` (optional, falls back to prompt/latest user message)
    - `memory.top_k`
    - `memory.required`
  - worker builds memory context before provider call and injects it into chat input
  - when memory is unavailable:
    - `required=false` -> continues without memory context
    - `required=true` -> deterministic failure code `MEMORY_CONTEXT_UNAVAILABLE`
  - UI support added in `/chat` and `/jobs/new` for memory context fields
- Runtime validation completed end-to-end:
  - `npm test`
  - `npm --prefix app test`
  - `rauskuclaw smoke --suite m1 --json`
  - `rauskuclaw smoke --suite m3 --success --json` (2 consecutive runs)
  - `rauskuclaw smoke --suite m4 --json`
- Ollama runtime moved to dedicated Compose service (`rauskuclaw-ollama`) with persistent model volume.
- Embedding model contract standardized to `embeddinggemma:300m-qat-q8_0` across config/docs/tests.

Deferred (post-M4 backlog):
- Expand memory write-back behavior from provider outputs into concrete workflows.
- Evaluate optional manual backfill command for legacy pre-vector rows.
