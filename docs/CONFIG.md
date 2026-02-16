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

## `rauskuclaw.json` Structure

### Top-level
- `version`: config schema version
- `service`: service metadata
- `api`: API-related settings
- `worker`: worker runtime settings
- `database`: persistence settings
- `callbacks`: callback safety behavior
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
- `api.auth.allow_without_key_when`
  - explicit dev bypass condition (`API_AUTH_DISABLED=1`)
- `api.sse`
  - SSE endpoint metadata and query key name for browser EventSource

### Worker
- `worker.poll_interval_ms`
  - queue polling interval (`WORKER_POLL_MS`)
- `worker.worker_id_source`
  - worker id source strategy (`WORKER_ID`, then hostname)
- `worker.job_defaults`
  - default values used when type-level defaults are not overridden

### Database
- `database.engine`
  - current engine (`sqlite`)
- `database.path`
  - file path used by API + worker (`DB_PATH`)
- `database.mode`
  - operational mode metadata (`wal`)

### Security / Safety
- `callbacks.allowlist_env`
  - env var controlling callback domain allowlist (`CALLBACK_ALLOWLIST`)
- `callbacks.allowlist_behavior_when_empty`
  - current behavior if allowlist is empty (`allow_all`)
- `handlers.deploy.allowlist_env`
  - allowed deploy targets env var (`DEPLOY_TARGET_ALLOWLIST`)

## Environment Variable Mapping
`rauskuclaw.json` includes:
- `PORT -> api.port`
- `API_KEY -> api.auth`
- `API_AUTH_DISABLED -> api.auth.allow_without_key_when`
- `DB_PATH -> database.path`
- `WORKER_POLL_MS -> worker.poll_interval_ms`
- `DEPLOY_TARGET_ALLOWLIST -> handlers.deploy.allowlist_env`
- `CALLBACK_ALLOWLIST -> callbacks.allowlist_env`

## Notes
- Runtime uses both `.env` and `rauskuclaw.json`.
- Precedence is: environment variable > `rauskuclaw.json` > hardcoded fallback.
- If `rauskuclaw.json` is present but invalid, startup fails fast with schema errors.
- Keep `rauskuclaw.json`, `.env.example`, and `README.md` synchronized when changing config behavior.
