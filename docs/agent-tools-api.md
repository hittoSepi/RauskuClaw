# Agent Tools API

## Overview

The Agent Tools API provides LLM function-calling tool specifications and a batch execution gateway for invoking tools as jobs through RauskuClaw. This enables external LLM clients (like Claude Desktop via MCP) to discover and execute workspace tools.

## Authentication

All endpoints require API key authentication via the `x-api-key` header.

| Role | GET /v1/agent-tools | POST /v1/agent-tools/invoke-batch |
|------|---------------------|-----------------------------------|
| `read` | ✅ Allowed | ❌ Forbidden (403) |
| `admin` | ✅ Allowed | ✅ Allowed |

**Key difference**: Admin keys have invoke permission (POST), not visibility of disabled tools. Both roles see the same filtered registry list.

---

## Endpoints

### GET /v1/agent-tools

Returns OpenAI-compatible tool specifications for all enabled agent tools.

#### Request

```bash
curl -H "x-api-key: $API_KEY" http://127.0.0.1:3001/v1/agent-tools
```

#### Response (200 OK)

```json
{
  "ok": true,
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "data_file_read",
        "description": "Read a UTF-8 text file from workspace.",
        "parameters": {
          "type": "object",
          "properties": {
            "path": {
              "type": "string",
              "description": "Workspace-relative file path."
            },
            "max_bytes": {
              "type": "integer",
              "minimum": 512,
              "maximum": 1048576
            }
          },
          "required": ["path"],
          "additionalProperties": false
        }
      }
    },
    {
      "type": "function",
      "function": {
        "name": "tools_file_search",
        "description": "Search files by path/name under workspace.",
        "parameters": {
          "type": "object",
          "properties": {
            "query": { "type": "string" },
            "path": { "type": "string" },
            "max_results": { "type": "integer", "minimum": 1, "maximum": 200 },
            "include_hidden": { "type": "boolean" }
          },
          "required": ["query"],
          "additionalProperties": false
        }
      }
    }
  ],
  "count": 2
}
```

#### Filtering Behavior

The registry only includes tools that satisfy **all** of:

1. **Builtin handler**: `handler LIKE 'builtin:%'` in `job_types` table
2. **Job type enabled**: `job_types.enabled = 1`
3. **Runtime policy enabled**: Environment flags or UI prefs (e.g., `TOOL_EXEC_ENABLED`)

Tools are excluded if:
- The underlying `job_type` is disabled in the database
- Runtime policy disables the tool (e.g., `tool.exec` disabled via env or UI)
- The handler is not builtin (provider-backed tools like `codex.chat.generate` are excluded)

---

### POST /v1/agent-tools/invoke-batch

Execute multiple tool calls as jobs with optional synchronous polling.

#### Request

```json
{
  "calls": [
    {
      "call_id": "call-abc-123",
      "name": "data_file_read",
      "arguments": {
        "path": "README.md"
      }
    },
    {
      "call_id": "call-def-456",
      "name": "tools_file_search",
      "arguments": {
        "query": "test"
      }
    }
  ],
  "mode": "sync",
  "wait_ms": 15000,
  "queue": "default"
}
```

**Parameters:**

| Field | Type | Required | Default | Constraints |
|-------|------|----------|---------|-------------|
| `calls` | array | ✅ Yes | - | 1-20 items |
| `calls[].call_id` | string | ✅ Yes | - | max 120 chars |
| `calls[].name` | string | ✅ Yes | - | Must exist in registry |
| `calls[].arguments` | object | ❌ No | `{}` | - |
| `mode` | string | ❌ No | `"sync"` | `"sync"` \| `"async"` |
| `wait_ms` | integer | ❌ No | `15000` | 100-60000 |
| `queue` | string | ❌ No | `"default"` | `^[a-z0-9._:-]{1,80}$` |

#### Response - Sync Mode (200 OK)

```json
{
  "ok": true,
  "results": [
    {
      "call_id": "call-abc-123",
      "name": "data_file_read",
      "ok": true,
      "output": {
        "path": "README.md",
        "content_text": "# My Project\n..."
      }
    },
    {
      "call_id": "call-def-456",
      "name": "tools_file_search",
      "ok": true,
      "output": {
        "results": [
          { "path": "test.txt", "type": "file" }
        ]
      }
    }
  ],
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call-abc-123",
      "name": "data_file_read",
      "content": "{\"ok\":true,\"result\":{\"path\":\"README.md\",\"content_text\":\"# My Project\\n...\"}}"
    },
    {
      "role": "tool",
      "tool_call_id": "call-def-456",
      "name": "tools_file_search",
      "content": "{\"ok\":true,\"result\":{\"results\":[{\"path\":\"test.txt\",\"type\":\"file\"}]}}"
    }
  ],
  "mode": "sync"
}
```

#### Response - Sync Mode with Timeout (200 OK)

```json
{
  "ok": true,
  "results": [
    {
      "call_id": "call-abc-123",
      "name": "data_file_read",
      "ok": false,
      "pending": true,
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "error": {
        "code": "TIMEOUT",
        "message": "Job did not complete within wait_ms"
      }
    }
  ],
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call-abc-123",
      "name": "data_file_read",
      "content": "{\"ok\":false,\"pending\":true,\"job_id\":\"550e8400-e29b-41d4-a716-446655440000\",\"error\":{\"code\":\"TIMEOUT\",\"message\":\"Job did not complete within wait_ms\"}}"
    }
  ],
  "mode": "sync"
}
```

#### Response - Async Mode (200 OK)

```json
{
  "ok": true,
  "results": [
    {
      "call_id": "call-abc-123",
      "name": "data_file_read",
      "ok": true,
      "job_id": "550e8400-e29b-41d4-a716-446655440000",
      "job_type": "data.file_read"
    }
  ],
  "tool_messages": [],
  "mode": "async"
}
```

#### Response - Creation Error (200 OK)

```json
{
  "ok": true,
  "results": [
    {
      "call_id": "call-unknown",
      "name": "nonexistent_tool",
      "ok": false,
      "error": {
        "code": "UNKNOWN_TOOL",
        "message": "Tool 'nonexistent_tool' not found in registry"
      }
    }
  ],
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call-unknown",
      "name": "nonexistent_tool",
      "content": "{\"ok\":false,\"error\":{\"code\":\"UNKNOWN_TOOL\",\"message\":\"Tool 'nonexistent_tool' not found in registry\"}}"
    }
  ],
  "mode": "sync"
}
```

**Note**: Even on creation errors, the response is `200 OK` with error details embedded. This ensures the LLM tool-loop receives a response for every call.

---

## Error Responses

### Validation Error (400 Bad Request)

```json
{
  "ok": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "'calls' must be an array",
    "details": {}
  }
}
```

### Forbidden (403 Forbidden)

```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "This operation requires an admin API key."
  }
}
```

### Unknown Tool (embedded in results)

```json
{
  "ok": true,
  "results": [
    {
      "call_id": "call-x",
      "name": "fake_tool",
      "ok": false,
      "error": {
        "code": "UNKNOWN_TOOL",
        "message": "Tool 'fake_tool' not found in registry"
      }
    }
  ],
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call-x",
      "name": "fake_tool",
      "content": "{\"ok\":false,\"error\":{\"code\":\"UNKNOWN_TOOL\",\"message\":\"Tool 'fake_tool' not found in registry\"}}"
    }
  ]
}
```

### Job Type Disabled (embedded in results)

```json
{
  "ok": true,
  "results": [
    {
      "call_id": "call-y",
      "name": "tool_exec",
      "ok": false,
      "error": {
        "code": "JOB_TYPE_DISABLED",
        "message": "Job type 'tool.exec' is disabled"
      }
    }
  ],
  "tool_messages": [
    {
      "role": "tool",
      "tool_call_id": "call-y",
      "name": "tool_exec",
      "content": "{\"ok\":false,\"error\":{\"code\":\"JOB_TYPE_DISABLED\",\"message\":\"Job type 'tool.exec' is disabled\"}}"
    }
  ]
}
```

---

## Error Codes Reference

| Code | HTTP Status | Description |
|------|-------------|-------------|
| `VALIDATION_ERROR` | 400 | Invalid request structure or parameters |
| `FORBIDDEN` | 403 | Insufficient permissions (read key on POST) |
| `UNKNOWN_TOOL` | - | Tool name not found in registry (embedded in results) |
| `JOB_TYPE_DISABLED` | - | Underlying job type is disabled (embedded in results) |
| `TIMEOUT` | - | Sync mode wait exceeded (embedded in results) |

---

## Limits and Constraints

| Limit | Value |
|-------|-------|
| Max calls per request | 20 |
| `wait_ms` range | 100-60000 (default 15000) |
| `wait_ms` default | 15000 |
| Max payload size | 1MB (server-level `express.json` limit) |
| Output truncation | 12KB per tool result |

---

## Mode Behavior

### `mode: "sync"`

Server polls the database for job completion until `wait_ms` deadline:

- Returns completed results immediately when available
- Returns `pending: true` for jobs that don't complete within `wait_ms`
- Includes `job_id` in pending results for async follow-up via `/v1/jobs/:id`
- Polling is optimized: 200ms for first second, then 500ms

### `mode: "async"`

Returns immediately after creating jobs:

- No waiting for completion
- `results[].job_id` provided for each call
- Caller can poll `/v1/jobs/:id` or use `/v1/jobs/:id/stream` (SSE) for updates
- `tool_messages` is empty (no responses available yet)

---

## Output Truncation

Tool outputs larger than 12KB are automatically truncated:

```json
{
  "ok": true,
  "output": {
    "truncated": true,
    "bytes": 54321,
    "preview": "{...first 12000 characters...}"
  }
}
```

The `tool_messages[].content` field contains the same truncated result as a JSON string.

---

## Call ID Binding

The `call_id` from the request binds to `tool_call_id` in the response:

**Request:**
```json
{
  "calls": [{ "call_id": "my-custom-id-123", "name": "data_file_read", ... }]
}
```

**Response:**
```json
{
  "results": [{ "call_id": "my-custom-id-123", ... }],
  "tool_messages": [{ "tool_call_id": "my-custom-id-123", ... }]
}
```

This binding allows LLMs to correlate their tool calls with the responses.

---

## Example Usage

### List Available Tools

```bash
API_KEY=$(grep '^API_KEY=' .env | cut -d= -f2)
curl -H "x-api-key: $API_KEY" http://127.0.0.1:3001/v1/agent-tools
```

### Execute Tools (Sync Mode)

```bash
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "calls": [
      {
        "call_id": "read-readme",
        "name": "data_file_read",
        "arguments": {"path": "README.md"}
      }
    ],
    "mode": "sync",
    "wait_ms": 5000
  }' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```

### Execute Tools (Async Mode)

```bash
curl -X POST -H "x-api-key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "calls": [
      {
        "call_id": "search-files",
        "name": "tools_file_search",
        "arguments": {"query": "test"}
      }
    ],
    "mode": "async"
  }' \
  http://127.0.0.1:3001/v1/agent-tools/invoke-batch
```
