# AGENTS.md — RauskuClaw™ Development Protocol

This repo is a standalone coding-project automation platform.
Agents must follow these rules to keep changes safe, reviewable, and CI-friendly.

## Choose right agent for job, ProProgramme, planner, media-viewer

## 0) Golden rules
- Keep changes **small and shippable**. Prefer multiple small commits over one mega-commit.
- Do **not** introduce new frameworks, build tools, or libraries unless explicitly requested.
- Respect existing architecture + style. No “creative refactors”.
- If you’re unsure, **read the docs** in this repo first (below).

## 1) Where to look first (source of truth)
- `README.md` — project overview and run instructions
- `PLAN.md` — milestones and scope
- `ROUTES.md` — routing map and navigation intent
- `VUE_SPA_ARCHITECTURE.md` — UI v2 structure conventions
- `DESIGN_TOKENS.md` — CSS variables and design tokens (must be used)
- `COMPONENTS.md` — canonical component inventory
- `CLAUDE.md` — agent-specific operational guidance (if present)

## 2) Repo layout
- Repo root: `/opt/openclaw`
- UI v2 package: `/opt/openclaw/ui-v2`
- UI v2 source root: `/opt/openclaw/ui-v2/src`

### UI v2 conventions
- Prefer feature-first structure under `ui-v2/src/features/<feature>/...`
- Use `@` alias for `ui-v2/src` (e.g. `@/features/...`)
- Avoid filesystem-root imports like `/src/...` (breaks CI)
- Use design tokens (CSS vars from `DESIGN_TOKENS.md`), do not hardcode random colors/spacings.

## 3) Required workflow for any change
1) **Scan**: Locate impacted files and existing patterns.
2) **Plan**: State what files you will change and why.
3) **Implement**: Minimal diff; no unrelated changes.
4) **Verify locally** (commands below).
5) **Commit** with a clear message.
6) **Ensure CI** remains green.

## Local verification commands (UI v2)

Run from `ui-v2/` unless stated otherwise.

**Recommended local verification (memory-friendly):**
- `cd ui-v2 && npm run build && npm run test:e2e:lite:1`

### Playwright local lite mode (memory-friendly)

Use lite mode locally to reduce RAM/CPU usage (disables trace/video/screenshot and forces 1 worker).

- `npm run test:e2e:lite`
- `npm run test:e2e:lite:1` (1 worker, stops on first failure)

**Important**
- `PW_LITE` is **local-only**. Do not set it in CI.
- CI runs without `PW_LITE` and retains artifacts (trace/video) on failure.

### CI safety checks (must not break)
GitHub Actions runs Playwright smoke tests. Avoid changes that break:
- Vite import resolution (`@/` alias, tsconfig paths)
- Routes/components referenced by router
- Playwright `webServer` startup (`npm run dev` in `ui-v2/`)

5) “Definition of Done” (DoD)

A task is DONE only when:

App builds/starts without Vite import errors

Playwright smoke tests pass locally (or at minimum start reliably if tests are WIP)

No broken imports / missing files referenced by router

Changes are scoped to the requested goal

6) Logs MVP (current priority)

Current phase focuses on UI v2 Logs MVP:

Jobs/Runs list

Run detail

Log viewer

Artifact links

Deliver in milestones:

M1: routes + pages placeholders + scaffolding

M2: store + mock data, list/detail wiring

M3: log viewer MVP (filter/tail/copy, perf-safe)

M4: artifact list & download/open links

M7: Logs API integration with mock fallback (completed)

M8: First Run Path - dev job creation (completed)

**Project Logs API mode:** Uses queue=<projectId> filtering. The dev job creator sets queue to projectId so Project Logs can display runs.

7) Safety rails (common footguns)

.gitignore: never ignore source folders with broad patterns (e.g. logs will ignore src/features/logs/**).

Case sensitivity: CI runs on Linux. ProjectLogs.vue ≠ projectlogs.vue.

Router lazy imports must use @/ or correct relative paths.

Keep artifacts/test-results upload tolerant: use if-no-files-found: ignore if needed.

8) Communication style (agent output)

When you finish work, output:

Summary of changes

Files changed

How to run/verify

Any risks/assumptions