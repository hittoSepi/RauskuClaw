# RauskuClaw Plan

## Product Goal
Build a reliable, self-hosted, OpenClaw-inspired agent execution platform that starts as a robust job runner and evolves into a provider-integrated, memory-aware automation system.

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
  - API (`openclaw-api`)
  - worker (`openclaw-worker`)
  - UI (`openclaw-ui`)
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

### M3: Provider Integration (OpenAI First)
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
- Advanced authN/authZ model (beyond single API key).
- Full callback signing/verification scheme.
- Structured metrics and alerts pipeline.
- Multi-queue / tenant isolation strategy.
- Richer built-in handlers and external tool ecosystem.

## Definition of Done for Each Milestone
- Objective met with measurable acceptance criteria.
- Core happy path and failure path validated.
- Documentation updated (`README.md`, `PLAN.md`, relevant API notes).
- No unresolved high-severity security regressions introduced.
- Contributor can reproduce milestone outcomes locally.

## Changelog
- 2026-02-16:
  - Initial phase-based roadmap created.
  - Milestones M1-M4 defined with objective/deliverables/acceptance/dependencies/risks/exit criteria.
  - Added SSE live job/log streaming (`/v1/jobs/:id/stream`) and UI integration in Job Detail.
  - Added `scripts/m1-smoke.sh` for reproducible M1 checks (idempotency, retry, callback allowlist).
