# RauskuClaw™

## What it is
Standalone automation + agent platform: UI + API gateway + runner + providers.

## Core goals
- Deterministic auth + session bootstrap
- Provider-agnostic LLM + tools
- Repeatable tasks with logs and artifacts
- Minimal moving parts, easy self-host

## Non-goals
- Not a general chat app
- Not a full CI/CD suite
- Not tied to OpenClaw

## Architecture
- UI (SPA)
- API Gateway
- Runner/Workers
- Providers (LLM, tools)
- Storage (config, logs, artifacts)

## Contracts
- Auth: x-key
- API: /ping, /auth/whoami, /tasks/*
