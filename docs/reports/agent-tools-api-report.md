# Agent Tools API Implementation Report

## 1) Executive Summary

Implemented REST API for LLM function-calling tool discovery (`GET /v1/agent-tools`) and batch execution gateway (`POST /v1/agent-tools/invoke-batch`). The API integrates with existing `app/agent_tools/specs.js` and `app/agent_tools/policy.js`, following RauskuClaw's job queue patterns. Two new endpoints added: registry returns OpenAI-formatted tool specs filtered by enabled job types and runtime policy; batch invoke creates jobs and supports sync polling or async fire-and-forget modes.

**Risks:** No per-key `tool_allowlist` implemented (excluded from Phase D). Output truncation at 12KB may lose data for large results. No rate limiting beyond server-level 1MB body limit.

## 2) Change List

### CHANGED FILES

**`docs/agent-tools-api.md`**
change type: CREATE
API contract documentation for endpoints, request/response examples, error codes, limits

**`app/routes/agent_tools.js`**
change type: CREATE
Main route handlers for GET registry and POST batch invoke
Exports: `registerAgentToolsRoutes(app, deps)`

**`app/utils/safePreviewValue.js`**
change type: CREATE
Shared output truncation utility (12KB limit)
Exports: `safePreviewValue(value, maxChars)`, `safeJsonStringify(value)`

**`app/test/agent_tools_api.test.js`**
change type: CREATE
14 tests: registry filtering, validation, authZ, call_id binding, async mode, error handling

**`app/server.js`** (lines 838-840)
change type: MODIFY
Registered agent tools routes: `registerAgentToolsRoutes(app, { auth, db, nowIso, badRequest, recordMetricSafe })`

## 3) API Contract

### Endpoints

**GET /v1/agent-tools**
- Returns OpenAI function tools for enabled builtin handlers
- Auth: read + admin keys
- Filters: `job_types.enabled=1`, `handler LIKE 'builtin:%'`, runtime policy

**POST /v1/agent-tools/invoke-batch**
- Executes tool calls as jobs
- Auth: admin keys only (read keys get 403)
- Modes: `sync` (poll DB) | `async` (return immediately)

### Request Example

```json
POST /v1/agent-tools/invoke-batch
{
  "calls": [
    { "call_id": "call-abc-123", "name": "data_file_read", "arguments": { "path": "README.md" } }
  ],
  "mode": "sync",
  "wait_ms": 15000,
  "queue": "default"
}
```

### Response Example (Success)

```json
{
  "ok": true,
  "results": [
    { "call_id": "call-abc-123", "name": "data_file_read", "ok": true, "output": { "path": "README.md", "content_text": "..." } }
  ],
  "tool_messages": [
    { "role": "tool", "tool_call_id": "call-abc-123", "name": "data_file_read", "content": "{\"ok\":true,\"result\":{...}}" }
  ],
  "mode": "sync"
}
```

### Response Example (Timeout/Pending)

```json
{
  "ok": true,
  "results": [
    { "call_id": "call-abc-123", "ok": false, "pending": true, "job_id": "...", "error": { "code": "TIMEOUT", "message": "..." } }
  ],
  "tool_messages": [
    { "role": "tool", "tool_call_id": "call-abc-123", "name": "data_file_read", "content": "{\"ok\":false,\"pending\":true,\"job_id\":\"...\"}" }
  ]
}
```

### Error Envelope

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR|FORBIDDEN",
    "message": "...",
    "details": {}
  }
}
```

### Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request structure |
| `FORBIDDEN` | 403 | Read key on POST |
| `UNKNOWN_TOOL` | - | Tool not in registry (embedded) |
| `JOB_TYPE_DISABLED` | - | Job type disabled (embedded) |
| `TIMEOUT` | - | Sync wait exceeded (embedded) |

## 4) Verification

### COMMANDS RUN

**Agent Tools API Tests**
```bash
node --test test/agent_tools_api.test.js
exit=0
```

Output:
```
ok 1 - GET /v1/agent-tools returns enabled builtin tools
ok 2 - GET /v1/agent-tools includes data_file_read by default
ok 3 - GET /v1/agent-tools excludes disabled job types
ok 4 - POST /v1/agent-tools/invoke-batch validates calls array
ok 5 - POST /v1/agent-tools/invoke-batch validates call fields
ok 6 - POST /v1/agent-tools/invoke-batch validates mode and wait_ms
ok 7 - POST /v1/agent-tools/invoke-batch validates queue name
ok 8 - POST /v1/agent-tools/invoke-batch enforces admin role
ok 9 - GET /v1/agent-tools works with read key
ok 10 - POST /v1/agent-tools/invoke-batch file_read happy path with call_id binding
ok 11 - POST /v1/agent-tools/invoke-batch async mode returns immediately
ok 12 - POST /v1/agent-tools/invoke-batch unknown tool returns error in results
ok 13 - POST /v1/agent-tools/invoke-batch disabled job type returns error
ok 14 - POST /v1/agent-tools/invoke-batch handles multiple calls

# tests 14
# pass 14
# fail 0
```

**Phase D Proof Tests (see section 8 for details)**
- Call ID binding: `call-proof-binding-123` → `tool_call_id: "call-proof-binding-123"`
- Pending on timeout: `wait_ms: 100` → `pending: true`
- AuthZ mismatch: read key POST → `403 FORBIDDEN`

## 5) Manual Test Steps

### List Available Tools

```bash
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2)
curl -H "x-api-key: $API_KEY" http://127.0.0.1:3001/v1/agent-tools
```

Expected: JSON with `{ ok: true, tools: [...], count: N }`

### Execute Tool (Sync Mode)

```bash
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"calls":[{"call_id":"test-1","name":"data_file_read","arguments":{"path":"README.md"}}],"mode":"sync","wait_ms":5000}' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```

Expected: `{ ok: true, results: [{ call_id: "test-1", ok: true, output: {...} }], tool_messages: [...] }`

### Execute Tool (Async Mode)

```bash
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"calls":[{"call_id":"test-2","name":"data_file_read","arguments":{"path":"README.md"}}],"mode":"async"}' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```

Expected: `{ ok: true, results: [{ call_id: "test-2", job_id: "..." }], tool_messages: [], mode: "async" }`

## 6) Diff Highlights

- **`app/routes/agent_tools.js`** implements `GET /v1/agent-tools` returning `{ tools, count }` where `tools` is array of OpenAI function-formatted specs from `buildAgentFunctionTools({ enabledJobTypes, isEnabledCheck, runtimeTools })`
- **`app/routes/agent_tools.js`** implements `POST /v1/agent-tools/invoke-batch` with explicit `if (req.auth?.role !== "admin")` check returning `403 FORBIDDEN` for read keys
- **`app/routes/agent_tools.js`** uses `pollForCompletion(jobIds, waitMs)` with dynamic polling (200ms first second, then 500ms) and batched `WHERE id IN (...)` SQL query
- **`app/routes/agent_tools.js`** builds `tool_messages` array for **every** call (success/error/pending) with `content` as JSON string containing `{ ok, error?, result?, pending?, job_id? }`
- **`app/utils/safePreviewValue.js`** exports `safePreviewValue(value, maxChars = 12000)` returning `{ truncated: true, bytes, preview }` when JSON string exceeds limit
- **`app/server.js`** line 839: `registerAgentToolsRoutes(app, { auth, db, nowIso, badRequest, recordMetricSafe })` registers new routes after projects routes

## 7) Edge Cases & Limits

| Limit | Value |
|-------|-------|
| Max calls per request | 20 |
| `wait_ms` range | 100-60000 (default 15000) |
| `call_id` max length | 120 chars |
| Max payload size | 1MB (express.json limit) |
| Output truncation | 12KB per result |

**Timeout behavior:** Sync mode returns `200 OK` with `pending: true` and `job_id` when deadline exceeded. Client can poll `/v1/jobs/:id` or use SSE for completion.

**Pending semantics:** `pending: true` indicates job still queued/running. `tool_messages[].content` contains `{ ok: false, pending: true, job_id: "..." }`.

**AuthZ:**
- `read` key: GET only, sees same filtered tools as admin
- `admin` key: GET + POST (invoke permission)

**Rate limiting:** None beyond 1MB body limit. No per-IP or per-key throttling.

## 8) Rollback Plan

**Safe rollback:**
1. Remove lines 838-840 from `app/server.js` (agent tools route registration)
2. Delete `app/routes/agent_tools.js`
3. Delete `app/utils/safePreviewValue.js` (if not used elsewhere)
4. Delete `app/test/agent_tools_api.test.js`
5. Optional: Keep `docs/agent-tools-api.md` as documentation

**Alternative:** Disable endpoints without deletion by commenting out route registration in `app/server.js`.

---

## Phase D Proof Tests

### A) Proof of call_id binding

**Test:**
```bash
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"calls":[{"call_id":"call-proof-binding-123","name":"data_file_read","arguments":{"path":"README.md"}}],"mode":"sync","wait_ms":5000}' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```

**Response:**
```json
{
  "results": [{ "call_id": "call-proof-binding-123", ... }],
  "tool_messages": [{ "tool_call_id": "call-proof-binding-123", ... }]
}
```
✅ Input `call_id` matches output `tool_call_id`

### B) Pending on timeout

**Test:**
```bash
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"calls":[{"call_id":"call-timeout","name":"data_file_read","arguments":{"path":"nonexistent.txt"}}],"mode":"sync","wait_ms":100}' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```

**Response:**
```json
{
  "results": [{ "call_id": "call-timeout", "ok": false, "pending": true, "job_id": "...", "error": { "code": "TIMEOUT" } }],
  "tool_messages": [{ "tool_call_id": "call-timeout", "content": "{\"ok\":false,\"pending\":true,...}" }]
}
```
✅ `pending: true` when `wait_ms` exceeded

### C) AuthZ mismatch

**Test:**
```bash
curl -X POST -H "x-api-key: READ_KEY" \
  -H "Content-Type: application/json" \
  -d '{"calls":[{"call_id":"x","name":"data_file_read","arguments":{}}]}' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```

**Response:**
```json
{
  "ok": false,
  "error": { "code": "FORBIDDEN", "message": "This operation requires an admin API key." }
}
```
✅ `403 FORBIDDEN` for read key on POST
