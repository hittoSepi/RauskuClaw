# RauskuClaw

## What This Is
RauskuClaw is an OpenClaw-inspired self-hosted job runner stack for contributor-driven development.

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
- Job type listing and management:
  - create new type
  - patch existing type (enable/disable, handler, defaults)
- Worker lifecycle handling:
  - queue claim/lock
  - execute built-in handlers
  - timeout handling
  - retry until `max_attempts`
  - callback delivery with optional domain allowlist
- UI views:
  - jobs list
  - create job
  - job detail/logs
  - job types

## Architecture at a Glance
- `openclaw-api` container:
  - exposes `127.0.0.1:3001`
  - serves all `/v1/*` and `/health`
- `openclaw-worker` container:
  - polls SQLite for queued jobs
  - executes handlers and writes logs/results
- `openclaw-ui` container:
  - serves static UI on `127.0.0.1:3002`
- Host Nginx routing (sample in `nginx/openclaw.conf`):
  - `/ui/` -> UI container (`localhost:3002`)
  - everything else -> API container (`localhost:3001`)

## Quick Start
1. Prepare environment file.
```bash
cd /opt/openclaw
cp .env.example .env
```

2. Edit `.env` and set at least `API_KEY`.
```bash
cd /opt/openclaw
sed -n '1,120p' .env
```

3. Build and run the stack.
```bash
cd /opt/openclaw
docker compose up -d --build
docker compose ps
```

4. Inspect logs.
```bash
cd /opt/openclaw
docker logs -f openclaw-api
```
```bash
cd /opt/openclaw
docker logs -f openclaw-worker
```
```bash
cd /opt/openclaw
docker logs -f openclaw-ui
```

## Configuration (.env)
Base variables from `.env.example`:

| Variable | Default | Used by | Notes |
|---|---|---|---|
| `PORT` | `3001` | API | API listen port inside container |
| `API_KEY` | `change-me-please` | API | Required by all `/v1/*` routes if non-empty |
| `DB_PATH` | `/data/openclaw.sqlite` | API + Worker | SQLite file path inside containers |
| `WORKER_POLL_MS` | `300` | Worker | Poll interval in milliseconds |
| `DEPLOY_TARGET_ALLOWLIST` | `staging,prod` | Worker | Allowed targets for `deploy.run` handler |
| `CALLBACK_ALLOWLIST` | (empty) | Worker | Optional comma-separated callback domains |

Notes:
- In current code, empty `CALLBACK_ALLOWLIST` means all callback domains are allowed.
- `docker-compose.yml` also applies defaults for several worker/API envs.

## API Summary
All `/v1/*` routes require header `x-api-key: <API_KEY>` when `API_KEY` is configured.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/health` | Public health check |
| `GET` | `/v1/ping` | Auth check / API liveness |
| `GET` | `/v1/job-types` | List job types |
| `POST` | `/v1/job-types` | Create job type |
| `PATCH` | `/v1/job-types/:name` | Update job type settings |
| `POST` | `/v1/jobs` | Create job (`Idempotency-Key` optional) |
| `GET` | `/v1/jobs` | List jobs with filters |
| `GET` | `/v1/jobs/:id` | Fetch one job |
| `POST` | `/v1/jobs/:id/cancel` | Cancel queued/running job |
| `GET` | `/v1/jobs/:id/logs` | Tail logs for a job |
| `GET` | `/v1/jobs/:id/stream` | SSE stream for live job/log updates |

Quick check:
```bash
cd /opt/openclaw
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2)
curl -sS http://127.0.0.1:3001/health
curl -sS -H "x-api-key: $API_KEY" http://127.0.0.1:3001/v1/ping
```

## UI Routes
UI is mounted under `/ui/` and uses these internal routes:

| Route | Description |
|---|---|
| `/jobs` | Job list and filters |
| `/jobs/new` | Create job form |
| `/jobs/:id` | Job detail + live logs (SSE) + cancel |
| `/types` | Job type list |

## Security Notes
- API key:
  - `/v1/*` uses `x-api-key`.
  - if `API_KEY` is empty, auth middleware allows all requests.
- SSE authentication:
  - browser `EventSource` cannot send custom headers.
  - `/v1/jobs/:id/stream` accepts `api_key` query parameter for UI compatibility.
- Callback delivery:
  - worker posts to `callback_url` after completion.
  - optional `CALLBACK_ALLOWLIST` can restrict callback domains.
- Built-in `data.fetch` handler is intentionally disabled in current MVP to reduce SSRF risk.
- UI stores API key in browser `sessionStorage` only; key is not hardcoded in source.

## Development Workflow
Docker-first workflow:
1. update code
2. rebuild services
3. verify via logs and API calls

Commands:
```bash
cd /opt/openclaw
docker compose up -d --build
docker compose ps
```
```bash
cd /opt/openclaw
docker logs --tail 200 openclaw-api
docker logs --tail 200 openclaw-worker
docker logs --tail 200 openclaw-ui
```
```bash
cd /opt/openclaw
./scripts/m1-smoke.sh
```

`m1-smoke.sh` covers:
- health + auth ping
- idempotency happy path and conflict path
- retry behavior (`data.fetch` failure with `max_attempts`)
- callback allowlist behavior (if `CALLBACK_ALLOWLIST` is configured)

Runbook-lite troubleshooting:
- API not reachable:
  - check `docker compose ps`
  - check host port bind `127.0.0.1:3001`
- Jobs stuck in `queued`:
  - inspect `openclaw-worker` logs
  - verify worker container is running
- Live updates not moving in Job Detail:
  - confirm API stream endpoint `/v1/jobs/:id/stream` is reachable
  - verify `API_KEY` in UI session matches backend config
- UI does not load under `/ui/`:
  - verify Nginx location `/ui/`
  - verify `openclaw-ui` container and port `3002`

## Known Gaps / Non-Goals (Current MVP)
- Built-in handlers are mostly stubs for controlled behavior testing.
- No provider abstraction implementation yet (OpenAI integration is roadmap work).
- No persistent semantic memory/embeddings layer yet.
- No advanced auth model (single API key only).
- No dedicated metrics/alerting pipeline yet.

## Roadmap Link
See [`PLAN.md`](./PLAN.md) for phased implementation milestones and acceptance criteria.

## Inspiration Sources
- https://docs.openclaw.ai/concepts/architecture
- https://docs.openclaw.ai/tools
- https://docs.openclaw.ai/providers
- https://docs.openclaw.ai/reference/AGENTS.default
- https://docs.openclaw.ai/reference/templates/IDENTITY
- https://docs.openclaw.ai/reference/templates/AGENTS
- https://docs.openclaw.ai/reference/templates/BOOTSTRAP
- https://docs.openclaw.ai/reference/templates/SOUL
- https://docs.openclaw.ai/reference/templates/TOOLS
- https://docs.openclaw.ai/reference/templates/USER
- https://docs.openclaw.ai/reference/templates/HEARTBEAT
