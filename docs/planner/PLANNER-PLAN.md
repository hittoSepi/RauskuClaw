# Planner Plan (YAML-first, UI v2 compatible)

## Goal
Build a lightweight project planner using the same status vocabulary as milestones:

`done / current / next / review / blocked / planned / unplanned / paused / dropped`

The planner should be:
- **YAML-first** (source-of-truth in repo)
- **Auto-renderable** (generate a human-readable MD summary + optional JSON for UI)
- **Low-maintenance** (no Markdown parsing, minimal schema)
- **Merge-friendly** (avoid single huge files)

> Rule: Planner statuses must match `docs/milestones.yml` status vocabulary.

---

## Data Model

### Index (small + stable)
File: `docs/planner/index.yml`

- Lists projects and points to per-project detail files.
- Keeps only top-level metadata.

Example:
```yaml
projects:
  - id: rauskuclaw-ui
    title: RauskuClaw UI v2
    spec: docs/planner/projects/rauskuclaw-ui.yml
```

---

### Per-project details (can grow)
File: `docs/planner/projects/<projectId>.yml`

Schema (v1):
- `project`: `{ id, title }`
- `items`: list of items
  - `id`: string (e.g. `M24`, `T24.1`)
  - `type`: `milestone` | `task`
  - `title`: short
  - `status`: one of the shared statuses
  - optional:
    - `priority`: `low` | `med` | `high`
    - `estimate`: free string (e.g. `20m`, `2h`, `1d`)
    - `deps`: list of item ids
    - `links`: list of strings (paths/urls)
    - `notes`: list of short bullets
    - `summary`: block scalar for completion notes
    - `commits`: list of SHAs (always YAML list)

---

## Generator

Command: `docs:planner:gen`

Create: `scripts/planner-gen.mjs`

Reads:
- `docs/planner/index.yml`
- each project spec file

Generates:
1) `docs/PLANNER.md` (human summary)
   - Per project: Current, Next, Planned/Unplanned breakdown
   - Optional warnings: missing deps, cycles
2) Optional JSON for UI:
   - `ui-v2/src/assets/planner.json` (or `public/planner.json`)

Constraints:
- Use existing `yaml` package (already in repo)
- No new dependencies

---

## UI v2 Integration (later)
Optional route: `/planner` (read-only first)

- Load `planner.json` (static asset)
- Render:
  - Filters: `status`, `type`, `priority`
  - Views: “Now” (current), “Next”, “Backlog”
- No editing in UI at first

---

## Workflow
1) Update YAML (`index.yml` + per-project file)
2) Run generator:
   - `node scripts/planner-gen.mjs`
3) Commit:
   - YAML + generated `docs/PLANNER.md`
   - optional generated JSON

---

## Guardrails
- Avoid a single huge file: keep per-project specs.
- Keep `next` small (max ~3 per project ideally).
- Do not store comma-separated commits: always YAML lists.
- Exactly one `current` per project (recommended rule).

---

## Roadmap (mini milestones)
- v1: YAML schema + generator -> `docs/PLANNER.md`
- v2: generate JSON + add read-only UI page
- v3: task templates + validation (deps, duplicates, invalid status)

---

## Status definitions

| status     | meaning |
|------------|---------|
| done       | completed |
| current    | actively being worked on |
| next       | immediate queue (keep short) |
| review     | waiting for review/merge/approval |
| blocked    | cannot progress due to external dependency |
| planned    | committed backlog |
| unplanned  | idea/parking lot (not committed) |
| paused     | intentionally stopped for now |
| dropped    | abandoned |

Rules to avoid chaos:
- Use `blocked` when you know the blocker (record it in `notes`)
- Use `paused` when it’s just “not now” without a concrete blocker
- Use `review` when work is done but waiting on someone/something to accept it

Example:
```yaml
- id: T24.5
  title: Playwright deterministic chat test
  status: review
  notes:
    - Waiting for CI green on PR

- id: T24.3
  title: Implement chat.store.ts polling
  status: blocked
  notes:
    - Need confirmed job result schema from backend
```
