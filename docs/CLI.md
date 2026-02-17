# CLI Reference

This document defines the machine-readable output contract for `rauskuclaw`.

## Exit Codes
- `0`: success
- `1`: runtime/operation failure
- `2`: usage/argument validation error

## JSON Output Mode
Most operator commands support `--json` and return a single JSON object to stdout.

Rules:
- JSON mode suppresses decorative/non-JSON command prelude output.
- Errors are returned as JSON objects with `ok: false` when command parsing succeeds.
- Usage errors (invalid args) still return exit code `2`.

## Command JSON Shapes

### `rauskuclaw start --json`
```json
{
  "ok": true,
  "command": "start",
  "api_url": "http://127.0.0.1:3001",
  "ui_url": "http://127.0.0.1:3002"
}
```

### `rauskuclaw stop --json`
```json
{
  "ok": true,
  "command": "stop"
}
```

### `rauskuclaw restart --json`
```json
{
  "ok": true,
  "command": "restart",
  "api_url": "http://127.0.0.1:3001",
  "ui_url": "http://127.0.0.1:3002"
}
```

### `rauskuclaw status --json`
Success:
```json
{
  "ok": true,
  "has_issues": false,
  "parse_error": null,
  "services": []
}
```

Failure:
```json
{
  "ok": false,
  "error": "docker compose ps failed"
}
```

### `rauskuclaw smoke --suite m1|m3|m4 [--success] --json`
Success:
```json
{
  "ok": true,
  "command": "smoke",
  "suite": "m1"
}
```

Failure example:
```json
{
  "ok": false,
  "command": "smoke",
  "error": "missing_env_file"
}
```

Notes:
- `--success` is supported only with `--suite m3`.
- `--suite m3 --success` sets `M3_SMOKE_SUCCESS=1` for `scripts/m3-smoke.sh`, enabling provider success-path assertion in addition to failure-contract checks.

### `rauskuclaw memory reset --yes [--scope <scope>] --json`
```json
{
  "ok": true,
  "command": "memory.reset",
  "scope": "agent.chat",
  "deleted_memories": 12,
  "deleted_vectors": 12,
  "remaining_memories": 3,
  "remaining_vectors": 3,
  "api_base": "http://127.0.0.1:3001"
}
```

Notes:
- Destructive operation requires explicit `--yes`.
- `--scope` is optional. If omitted, reset applies to all scopes.
- Endpoint contract requires `confirm=true` in request body.

### `rauskuclaw doctor --json`
```json
{
  "ok": false,
  "checks": [
    {
      "label": "docker_daemon",
      "ok": false,
      "details": "permission denied ...",
      "hint": "Start Docker daemon and verify socket access ..."
    }
  ]
}
```

### `rauskuclaw config show --json`
```json
{
  "ok": true,
  "env_path": "/opt/rauskuclaw/.env",
  "values": {
    "API_KEY": "****",
    "PORT": "3001"
  }
}
```

### `rauskuclaw config validate --json`
```json
{
  "ok": true
}
```

Failure example:
```json
{
  "ok": false,
  "error": "missing_required_keys",
  "missing": ["API_KEY"]
}
```

### `rauskuclaw config path --json`
```json
{
  "ok": true,
  "repo_root": "/opt/rauskuclaw",
  "env_path": "/opt/rauskuclaw/.env",
  "config_path": "/opt/rauskuclaw/rauskuclaw.json"
}
```

### `rauskuclaw logs <target> --security --json`
```json
{
  "ok": true,
  "command": "logs",
  "target": "api",
  "mode": "security",
  "since": "10m",
  "tail": 200,
  "analysis": {
    "total_lines": 1000,
    "matched_lines": 30,
    "counts": {
      "dotfiles": 10,
      "aws": 5
    },
    "samples": []
  }
}
```

Notes:
- `logs --json` requires `--security`.
- `logs --follow` cannot be combined with `--security`.
