# RauskuClaw - openclaw clone, maybe better, hopeso

## Projecst Idea: Personal AI Assistant

- Runs openai models
  - Implement openai cli? (codex oauth)
- Tool usage
- Persistent memory between sessions
- Local llms for memory search and embeddings
  - Vector sql memory?
- Agent automation
- Heartbeat for routine tasks 
- Security 


### Read for more inspiration:
[https://docs.openclaw.ai/concepts/architecture]
[https://docs.openclaw.ai/tools]
[https://docs.openclaw.ai/providers]

[https://docs.openclaw.ai/reference/AGENTS.default]
[https://docs.openclaw.ai/reference/templates/IDENTITY]
[https://docs.openclaw.ai/reference/templates/AGENTS]
[https://docs.openclaw.ai/reference/templates/BOOTSTRAP]
[https://docs.openclaw.ai/reference/templates/SOUL]
[https://docs.openclaw.ai/reference/templates/TOOLS]
[https://docs.openclaw.ai/reference/templates/USER]
[https://docs.openclaw.ai/reference/templates/HEARTBEAT]


- **API**: Node + Express
- **Worker**: separate service (polls SQLite)
- **DB**: SQLite (persisted on host via volume)
- **UI**: Vue 3 + Vite, served under `/ui/` via its own container

## Quick start

1) Copy this project to your server (e.g. `/opt/openclaw`).

2) Create `.env` (based on `.env.example`):
```bash
cp .env.example .env
# edit API_KEY etc
```

3) Build + run:
```bash
docker compose up -d --build
docker compose ps
docker logs -f openclaw-api
docker logs -f openclaw-worker
docker logs -f openclaw-ui
```

4) Nginx (host) routes:
- `/ui/` -> UI container (localhost:3002)
- everything else -> API container (localhost:3001)

A sample `nginx/openclaw.conf` is included.

## Notes

- The UI does **not** hardcode API keys. You paste the key in the UI once (stored in `sessionStorage`).
- `data.fetch` is disabled by default (SSRF protection). Enable later with allowlists.

