# RauskuClaw

RauskuClaw is an open-source self-hosted job runner and AI-assistant platform. 
  It provides a **Docker-based stack** with a REST API server, a background worker, and a web UI (Vue 3) for managing jobs, schedules, memory contexts, and chat-style AI workflows. 
  Users can enqueue and monitor jobs, store and search “memory” entries, run recurring schedules, and interact via a chat interface with optional semantic memory integration. 
  It supports custom job types (including AI chat via Codex or OpenAI) and secure callback webhooks. 
  The API uses an **X-API-Key** header (single or multi-key mode) to authorize all `/v1/*` requests【7†L263-L272】【49†L311-L320】.

## Architecture Overview

- **rauskuclaw-api** (Node/Express): listens on `127.0.0.1:3001`, serves `/v1/*` endpoints and `/health`【20†L78-L87】. Configured via `rauskuclaw.json`/`.env`. All API routes require `x-api-key` (legacy single key or multi-key JSON with roles)【7†L263-L272】.
- **rauskuclaw-worker** (Node): polls the SQLite DB (`/data/rauskuclaw.sqlite`) for queued jobs and executes built-in or provider-backed handlers. It mounts the same data/workspace volumes as the API.
- **rauskuclaw-ui** (Vue3, legacy): container on port `3002` (host 3002). Serves the old UI under `/ui/`.  
- **rauskuclaw-ui-v2** (Vue3 SPA): container on port `3003` (host 3003). Serves the new UI under `/` (root path) and `/assets/`. This is an experimental rewrite (refer to [ui-refactor-plan](docs/PLAN.md) for details).  
- **rauskuclaw-ollama**: local Ollama container (port 11434) providing embedding APIs for semantic memory. Models stored in Docker volume `ollama_data`【20†L78-L87】.
- **Nginx reverse proxy** (host): routes `https://…/ui/` to the UI container and `https://…/` to UI-v2, and proxies `/v1/` to the API. It enforces **HTTPS** (Certbot certificates), sets strict CSP and security headers, and blocks probing of sensitive files (e.g. `.env`, `.git` paths) with a 444 response【38†L25-L33】. Example location blocks:
  - `location /ui/ { … proxy_pass http://127.0.0.1:3002/; add_header Content-Security-Policy "default-src 'self'; …"}`
  - `location /v1/ { … proxy_pass http://127.0.0.1:3001; add_header Content-Security-Policy "default-src 'none'; …"}`
  - `location / { … proxy_pass http://127.0.0.1:3003/; add_header Content-Security-Policy "default-src 'self'; …"}`
- **Volumes/Networks**: The Docker Compose defines a `default` network and an external `holvi_holvi_net` (for Holvi integration). Shared volumes include `./data` (for SQLite) and `./workspace` (for user files).

```
               +------------+       +------------------+      +-------------+
Browser  --->  | Host Nginx  | --->  | rauskuclaw-UI(-v2)|      | rauskuclaw-API|
   | http(s)   |  (443/80)   |      |  Docker container|      |   container  |
   +------------+       +------------------+      +-------------+
        |                         | /ui/ or /        | /v1/ (API) 
        |                         | (vue SPA)        |
        |                         v                 v
        |                     +-------------+      +--------------+
        |                     | rauskuclaw- |      | rauskuclaw-  |
        |                     | UI container |      | API container|
        |                     +-------------+      +--------------+
        |                                             |
        |<--------------------------------------------|
                   Internal Docker network (127.0.0.1)
```

## Quickstart (Local Development)

1. **Prerequisites:** Install Docker and Docker Compose (plugin v2+), and Node.js/npm (for CLI and building UI). Ensure `docker daemon` is running.  
2. **Clone and configure:**  
   ```bash
   git clone https://github.com/hittoSepi/RauskuClaw.git
   cd RauskuClaw
   cp .env.example .env
   ```  
   Edit `.env` to set at least `API_KEY` (replace `change-me-please`) or define `API_KEYS_JSON` for multi-key auth【6†L185-L193】【28†L0-L9】. Customize other variables as needed (ports, keys, provider flags, etc.)【6†L185-L193】.  
3. **Build and run containers:**  
   ```bash
   docker compose up -d --build
   docker compose ps
   ```  
   This builds and starts all services (API, Worker, UI, UI-v2, Ollama). By default, `rauskuclaw-api` listens on `127.0.0.1:3001`, and UI on 3002/3003 (see Compose file).  
4. **Initialize workspace (optional):** Place user files under `./workspace`. The API has file-browser endpoints (`/v1/workspace/*`) for managing these files.  
5. **UI Access:** In your browser, navigate to `https://your-host/` for the new UI-v2 (root path) or `/ui/` for the legacy UI. The UIs will request API data via the reverse proxy.  
6. **CLI installation (optional):** In another terminal (host machine), install the local operator CLI:  
   ```bash
   cd RauskuClaw/cli
   npm install   # install dependencies
   npm link      # make `rauskuclaw` command available globally
   ```  
   Now you can run commands like `rauskuclaw setup`, `rauskuclaw start`, etc.

## Quickstart (Production/VPS)

1. **Server Setup:** On a Linux server (e.g. Ubuntu), install Docker Engine and Docker Compose. Copy the repository and `.env` as above. Ensure `API_KEY` and any provider secrets are set.  
2. **Environment:** For production, you may bind services to all interfaces or behind a domain. The Compose file binds API/UI to `127.0.0.1` by default (for security).  
3. **Run containers:** Use `docker compose up -d --build`. Ensure ports `3001-3003` are only accessible to localhost or firewall them if using a proxy.  
4. **Reverse Proxy / SSL:** Use the provided Nginx config (`nginx/rauskuclaw.conf`) as a template. Configure your domain to point at the server, and install certificates (Certbot or similar). The example config forces HTTPS and applies strict CSP and security headers【38†L25-L33】.  
5. **Firewall:** Only allow ports 80/443 publicly. All other service ports can stay on localhost.  
6. **Holvi (Infisical) Integration (Optional):** If using Holvi for secrets, set `OPENAI_SECRET_ALIAS` in `.env` and deploy the Holvi stack (`infra/holvi/compose.yml`) alongside. See `infra/holvi/README.md` for details.

## Environment Variables and Config

Required variables and defaults (from `.env.example`):  

| Variable                   | Default               | Service        | Description                                                    |
|----------------------------|-----------------------|----------------|----------------------------------------------------------------|
| `API_KEY`                  | `change-me-please`    | API            | Main admin API key for `/v1/*` (required unless disabled)【6†L185-L193】. |
| `API_KEYS_JSON`            | (empty)               | API            | JSON array for multi-key auth (overrides `API_KEY`)【6†L185-L193】. |
| `API_AUTH_DISABLED`        | `0`                   | API            | Set to `1` (dev only) to bypass auth.                          |
| `PORT`                     | `3001`                | API            | API listen port (inside container).                            |
| `DB_PATH`                  | `/data/rauskuclaw.sqlite` | API/Worker | SQLite file path (inside container).                            |
| `WORKER_QUEUE_ALLOWLIST`   | `default`             | Worker         | Comma-separated queues the worker will poll.                   |
| `OPENAI_ENABLED`           | `0`                   | Worker         | Enable OpenAI (or compatible) chat provider.                  |
| `OPENAI_API_KEY`           | (empty)               | Worker         | Required if OpenAI is enabled.                                 |
| `OPENAI_CHAT_COMPLETIONS_PATH` | `/v1/chat/completions` | Worker | Endpoint path for chat completions (set for custom APIs).      |
| `CODEX_OSS_ENABLED`        | `0`                   | Worker         | Enable local Codex CLI chat provider.                         |
| `CODEX_OSS_MODEL`         | (empty)               | Worker         | Model name for Codex CLI (if enabled).                         |
| `WORKSPACE_ROOT`           | `/workspace`          | API            | Root directory for workspace files (mapped from `./workspace`). |
| `WORKSPACE_FILE_WRITE_MAX_BYTES` | `262144`        | API            | Max bytes for file write API.                                 |
| `MEMORY_VECTOR_ENABLED`    | `0`                   | API/Worker     | Enable vector embeddings (requires SQLite vector extension).    |
| `OLLAMA_BASE_URL`          | `http://rauskuclaw-ollama:11434` | API/Worker | Embedding server URL for Ollama.                           |
| `OLLAMA_EMBED_MODEL`       | `embeddinggemma:300m-qat-q8_0` | API/Worker | Default Ollama embedding model.                                |
| (Several others…)          |                       |                | See `.env.example` for full list and `docs/CONFIG.md` for details. |

Configuration precedence: **Environment (.env) > `rauskuclaw.json` > code defaults**【8†L374-L383】. The shared `rauskuclaw.json` (mounted into containers) also defines defaults and can be used for static config. See `docs/CONFIG.md` for full field reference.

## Operator CLI (`rauskuclaw`)

The CLI wraps common Docker commands and API checks. Key commands:

- `rauskuclaw setup` – Initializes the project: creates `.env` (with defaults) and ensures `rauskuclaw.json` and workspace templates are in place.  
- `rauskuclaw start` – Starts all services (`docker compose up -d --build`).  
- `rauskuclaw stop` – Stops all containers.  
- `rauskuclaw restart` – Restarts the stack (`stop` + `start`).  
- `rauskuclaw status` – Shows container status (`docker compose ps`).  
- `rauskuclaw logs <api|worker|ui>` – Shows real-time logs for the specified service (optional flags like `--since`, `--follow`). Example: `rauskuclaw logs api --tail 200`.  
- `rauskuclaw smoke [--suite m1|m3|m4]` – Runs built-in integration tests (healthcheck, idempotency, provider failure/success, memory flows). Example: `rauskuclaw smoke --suite m3 --success`【18†L66-L75】.  
- `rauskuclaw memory reset --yes [--scope <scope>]` – Clears memory entries (requires `--yes` to confirm). Without `--scope`, all memory is purged【18†L89-L98】.  
- `rauskuclaw auth whoami` – Shows the authenticated API principal (name, role, SSE permission, queue allowlist)【49†L311-L320】【42†L68-L77】. Uses the API key from `.env` or `--api` flag.  
- `rauskuclaw doctor` – Checks local environment dependencies (Docker daemon, Docker Compose, Codex CLI, etc.) and reports issues. Use `--fix-hints` to get remediation tips.  
- `rauskuclaw codex login|logout` – Manages Codex CLI OAuth login. Use `--device-auth` for device flow.  
- `rauskuclaw codex exec …` – Executes a Codex CLI command within the CLI environment (e.g. to test Codex integration).  
- `rauskuclaw config show|validate|path` – Inspect the current config: `show` outputs env values, `validate` checks required keys, `path` shows file paths【18†L139-L147】【18†L151-L160】.  
- `rauskuclaw help`, `rauskuclaw version` – Help and version info.

All commands support `--json` to emit machine-readable JSON output (see [`docs/CLI.md`](docs/CLI.md) for examples【18†L17-L26】).

## Observability & Troubleshooting

- **Logs:** Check container logs (`docker logs`) or use `rauskuclaw logs`. For example: `rauskuclaw logs api --tail 200` or `docker logs -f rauskuclaw-worker`.  
- **Smoke tests:** Use the CLI smoke suites to verify end-to-end functionality (health, auth, idempotency, retry, providers, memory). For example, run `rauskuclaw smoke --suite m1` after startup to catch basic issues.  
- **Common issues:**  
  - *API not reachable:* Verify `rauskuclaw-api` container is running (`docker compose ps`) and bound to `127.0.0.1:3001`【9†L578-L586】. Check if the Nginx proxy is correctly forwarding `/v1/`.  
  - *Jobs stuck queued:* Ensure `rauskuclaw-worker` is running and connected to the same DB. Inspect worker logs for errors.  
  - *Live job logs not streaming:* Confirm `/v1/jobs/:id/stream` works and that the UI’s API key matches backend config【9†L584-L589】. SSE requires getting a token first (`POST /v1/auth/sse-token`) or using `?api_key=` (legacy).  
  - *UI won’t load:* Check Nginx location for `/ui/` and `/` (UI-v2) are correct, and that `rauskuclaw-ui`/`ui-v2` containers are healthy on ports 3002/3003.  
  - *CORS/Content-Security:* The default Nginx adds strict CSP headers【38†L25-L33】. If the UI is served on a sub-path (e.g. `/ui/`), ensure the base href and CSP allow it.  
  - *IPv6/CaCerts (Codex):* The Dockerfile adds `ca-certificates` and forces IPv4 (see `app/Dockerfile`) to ensure `codex exec` can reach OpenAI. If Codex CLI calls hang, confirm network and CA store.

- **Metrics & Alerts:** Runtime metrics can be polled via `GET /v1/runtime/metrics`. Default alerts include queue-stall and failure-rate (configurable via env)【7†L243-L252】.

## Security Notes

- **API Key Auth:** All `/v1/` calls require `x-api-key`. By default, an empty or missing key yields `503 AUTH_NOT_CONFIGURED` (deny-all)【9†L484-L493】. Only in a trusted dev environment set `API_AUTH_DISABLED=1`.  
- **Key Roles:** In multi-key mode, keys have roles (`admin` or `read`) and an optional queue allowlist. Read-only keys cannot perform mutations (`POST`/`PATCH`/`DELETE` return 403)【49†L311-L320】. A queue-allowlisted key only sees/creates jobs in its queues (other queues yield 403 with `allowed_queues` info).  
- **SSE (EventSource):** Browsers can’t send headers. Use `POST /v1/auth/sse-token` with your API key to get a short-lived token, then call `/v1/jobs/:id/stream?token=…`. The legacy `?api_key=` parameter is still supported but discouraged【9†L490-L493】.  
- **Callbacks:** Jobs with a `callback_url` will POST results after completion (if enabled). Use `CALLBACK_ALLOWLIST` to restrict domains. To sign payloads, enable `CALLBACK_SIGNING_ENABLED=1` and set `CALLBACK_SIGNING_SECRET`; if missing, callbacks are skipped and logged.  
- **Providers:** The built-in `codex.chat.generate` and `ai.chat.generate` handlers are **disabled by default**. Enable with `CODEX_OSS_ENABLED=1` or `OPENAI_ENABLED=1` and provide credentials. Codex CLI uses OAuth login (`codex login`). The system auto-selects Codex vs OpenAI based on which is enabled【7†L263-L272】.  
- **Input Validation:** The API validates handler inputs at job creation for risky operations (`tool.exec`, `data.fetch`, etc.) and enforces timeouts, payload limits, and allowlists configured by env or `rauskuclaw.json`.  
- **CSP & Headers:** The sample Nginx config enforces strict Content Security Policies per location【38†L25-L33】. By default, we serve over HTTPS, set `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Referrer-Policy: no-referrer`.  
- **No Env Leaks:** The Nginx drop rules prevent serving sensitive files (paths like `/.env`, `/.git`, AWS credentials, etc.)【38†L40-L45】. The UI stores API keys only in sessionStorage (not in HTML/JS code) to avoid leaks.

## Contributing & Development

- **Workflow:** This is a Docker-first project. To develop, edit code, then rebuild:  
  ```bash
  # from repo root
  docker compose up -d --build rauskuclaw-api rauskuclaw-worker rauskuclaw-ui rauskuclaw-ui-v2
  ```  
  Use `docker logs -f <container>` or the CLI (`rauskuclaw logs`) to inspect output【9†L542-L551】. API tests and smoke scripts live under `scripts/`.  
- **Tests:** Unit tests exist for API, providers, CLI, etc. Run them with `npm test` in the respective directories (`app`, `cli`, etc.).  
- **Formatting:** Follow the existing code conventions (semicolons, linting) – ESLint or Prettier can be added.  
- **CI:** (Not detailed here) Use GitHub Actions or similar to run tests on push.  
- **Docs:** The `docs/` folder contains design docs (CONFIG, CLI, MILESTONES, etc.). Updates to architecture or workflows are welcome.  
- **License:** (Add license here if open-sourced; otherwise note proprietary.)  

## Known Gaps / TODO

- UI-v2 is under active development; consider moving operator flows there fully (currently both UIs exist).  
- A formal **Runbook** or **Architecture diagram** document would help new operators (this README contains much of that, but a separate clean diagram could be added).  
- Integration with external services (OpenAI Holvi, hosted SQL, etc.) may need more docs (see `infra/holvi` for secret management).  
- Multi-tenant or clustering support is not yet implemented (single-instance SQLite only).  
- License and third-party notices: include explicit license file and credit third-party libs per their terms.

**External Resources:** For detailed config reference see `docs/CONFIG.md` (field-by-field) and `docs/CLI.md` (command contracts)【7†L290-L294】【18†L17-L26】. For API routes and behavior, refer to the summaries above and integration tests. 

