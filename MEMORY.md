# MEMORY

Last updated: 2026-02-16

## Current Milestone Status
- M1 (Reliable Core Runner): mostly complete
- M2 (Tooling + Job Type Management UX): in progress
- M3 (Provider Integration): not started
- M4 (Memory + Automation Foundations): not started

## Completed So Far
- Added live SSE stream endpoint usage in UI Job Detail (`/v1/jobs/:id/stream`).
- Added M1 smoke script: `scripts/m1-smoke.sh` (health/auth, idempotency, retry, callback allowlist checks).
- Added job type edit UX on `/types`:
  - enable/disable
  - handler edit
  - default timeout/default attempts edit
  - save/reset, local validation and error states
- Improved `Create Job` validation UX:
  - pre-submit validation list
  - disabled submit when invalid
  - callback URL and JSON validation
- Improved `Job Detail` operability:
  - loading/cancelling button states
  - stream status badge (`live/reconnecting/off`)
- Unified operator feedback in Create/Detail:
  - success/status messages for create/cancel/refresh actions
  - visible "last action/last refresh" timestamps
- Improved `Jobs` list operator UX:
  - auto-refresh on filter changes (debounced)
  - loading state + refresh disable
  - clear filters action
  - stale-request guard to avoid out-of-order updates
- Security hardening:
  - auth no longer fail-open when `API_KEY` is empty
  - default now denies with `503 AUTH_NOT_CONFIGURED`
  - explicit dev bypass via `API_AUTH_DISABLED=1`
- Added shared config contract:
  - `rauskuclaw.json`
  - `docs/CONFIG.md`
  - README references + precedence docs
- Backend now reads shared config with precedence:
  - env > `rauskuclaw.json` > code fallback
  - API/worker/db wired through `app/config.js`
- Added config schema validation:
  - Ajv-based validation at startup
  - schema file: `app/config.schema.json`
  - invalid config fails fast on API/worker startup

## Current Runtime/Infra Notes
- Docker stack builds and runs with:
  - `docker compose up -d --build`
- Compose mounts shared config into API + worker:
  - `/config/rauskuclaw.json` (read-only)
- Config path override supported:
  - `RAUSKUCLAW_CONFIG_PATH`

## Open Items (Next)
- Continue M2 UI polish:
  - Create/Detail views: refine operator feedback consistency
- Add tests for config loader + schema validation behavior:
  - valid config passes
  - invalid config fails fast with clear error output
  - env override precedence cases
- Decide whether `callbacks.enabled` should actively disable callback posts in worker (currently metadata/config contract exists, behavior still driven by allowlist logic).

## Key Files Changed Recently
- Backend:
  - `app/server.js`
  - `app/worker.js`
  - `app/db.js`
  - `app/config.js`
  - `app/config.schema.json`
- Frontend:
  - `ui/src/pages/Types.vue`
  - `ui/src/pages/CreateJob.vue`
  - `ui/src/pages/JobDetail.vue`
  - `ui/src/api.js`
- Docs/config:
  - `README.md`
  - `PLAN.md`
  - `docs/CONFIG.md`
  - `.env.example`
  - `docker-compose.yml`
  - `rauskuclaw.json`
