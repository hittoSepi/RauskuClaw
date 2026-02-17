#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE="${API_BASE:-http://127.0.0.1:3001}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

read_env_value() {
  local key="$1"
  local file="$2"
  local line value
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n1 || true)"
  value="${line#*=}"
  value="${value//$'\r'/}"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  if [[ "${value:0:1}" == "\"" && "${value: -1}" == "\"" ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

API_KEY="${API_KEY:-$(read_env_value "API_KEY" "$ENV_FILE")}"
M3_SMOKE_SUCCESS="${M3_SMOKE_SUCCESS:-0}"
M3_SMOKE_SUCCESS_TYPE="${M3_SMOKE_SUCCESS_TYPE:-codex.chat.generate}"
M3_SMOKE_SUCCESS_PROMPT="${M3_SMOKE_SUCCESS_PROMPT:-reply exactly: m3-smoke-ok}"
M3_SMOKE_SUCCESS_TIMEOUT_SEC="${M3_SMOKE_SUCCESS_TIMEOUT_SEC:-180}"

if [[ -z "${API_KEY}" ]]; then
  echo "API_KEY is empty. Set API_KEY in $ENV_FILE or export API_KEY."
  exit 1
fi

json_get() {
  local path="$1"
  node -e '
    const fs = require("fs");
    const input = fs.readFileSync(0, "utf8");
    const data = input.trim() ? JSON.parse(input) : {};
    let v = data;
    for (const k of process.argv[1].split(".")) v = v?.[k];
    if (v === undefined || v === null) process.exit(2);
    if (typeof v === "object") process.stdout.write(JSON.stringify(v));
    else process.stdout.write(String(v));
  ' "$path"
}

request() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local out_file
  out_file="$(mktemp)"

  local -a args
  args=(-sS -o "$out_file" -w "%{http_code}" -X "$method" "$API_BASE$path" -H "accept: application/json" -H "x-api-key: $API_KEY")
  if [[ -n "$body" ]]; then
    args+=(-H "content-type: application/json" -d "$body")
  fi

  local code
  code="$(curl "${args[@]}")"
  local resp
  resp="$(cat "$out_file")"
  rm -f "$out_file"
  printf '%s\n%s\n' "$code" "$resp"
}

poll_job_until_terminal() {
  local job_id="$1"
  local max_wait_sec="${2:-30}"
  local i=0
  while (( i < max_wait_sec )); do
    mapfile -t lines < <(request GET "/v1/jobs/$job_id")
    local code="${lines[0]}"
    local resp="${lines[1]}"
    if [[ "$code" != "200" ]]; then
      echo "Polling failed for job $job_id: HTTP $code"
      echo "$resp"
      return 1
    fi

    local status
    status="$(printf '%s' "$resp" | json_get "job.status")"
    if [[ "$status" == "succeeded" || "$status" == "failed" || "$status" == "cancelled" ]]; then
      printf '%s\n' "$resp"
      return 0
    fi
    sleep 1
    ((i+=1))
  done

  echo "Timeout waiting for terminal state: $job_id"
  return 1
}

patch_type_enabled() {
  local type_name="$1"
  local enabled_value="$2"
  mapfile -t patch_resp < <(request PATCH "/v1/job-types/$type_name" "{\"enabled\":$enabled_value}")
  [[ "${patch_resp[0]}" == "200" ]] || {
    echo "Failed to patch type '$type_name': ${patch_resp[0]}"
    echo "${patch_resp[1]}"
    exit 1
  }
}

get_type_enabled() {
  local type_name="$1"
  mapfile -t list_resp < <(request GET "/v1/job-types")
  [[ "${list_resp[0]}" == "200" ]] || {
    echo "Failed to list job types: ${list_resp[0]}"
    echo "${list_resp[1]}"
    exit 1
  }
  printf '%s' "${list_resp[1]}" | node -e '
    const fs = require("fs");
    const typeName = process.argv[1];
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const t = (data.types || []).find(x => x && x.name === typeName);
    if (!t) process.exit(3);
    process.stdout.write(t.enabled ? "true" : "false");
  ' "$type_name"
}

ORIG_CODEX_ENABLED=""
ORIG_OPENAI_ENABLED=""
CLEANUP_DONE=0
cleanup() {
  if [[ "$CLEANUP_DONE" == "1" ]]; then
    return
  fi
  CLEANUP_DONE=1
  if [[ -n "$ORIG_CODEX_ENABLED" ]]; then
    patch_type_enabled "codex.chat.generate" "$ORIG_CODEX_ENABLED" || true
  fi
  if [[ -n "$ORIG_OPENAI_ENABLED" ]]; then
    patch_type_enabled "ai.chat.generate" "$ORIG_OPENAI_ENABLED" || true
  fi
}
trap cleanup EXIT

assert_provider_failure() {
  local type_name="$1"
  local create_payload="$2"
  local label="$3"

  mapfile -t create_resp < <(request POST "/v1/jobs" "$create_payload")
  [[ "${create_resp[0]}" == "201" ]] || {
    echo "Create failed for $label: ${create_resp[0]}"
    echo "${create_resp[1]}"
    exit 1
  }
  local job_id
  job_id="$(printf '%s' "${create_resp[1]}" | json_get "job.id")"

  local final
  final="$(poll_job_until_terminal "$job_id" 40)"
  local status
  status="$(printf '%s' "$final" | json_get "job.status")"
  [[ "$status" == "failed" ]] || {
    echo "Expected failed status for $label, got: $status"
    echo "$final"
    exit 1
  }

  local code
  code="$(printf '%s' "$final" | json_get "job.error.code" || true)"
  if [[ -z "$code" || "$code" != PROVIDER_* ]]; then
    echo "Expected provider error code for $label, got: '${code:-<empty>}'"
    echo "$final"
    exit 1
  fi

  mapfile -t logs_resp < <(request GET "/v1/jobs/$job_id/logs?tail=200")
  [[ "${logs_resp[0]}" == "200" ]] || {
    echo "Failed to fetch logs for $label: ${logs_resp[0]}"
    exit 1
  }
  if ! printf '%s' "${logs_resp[1]}" | grep -q 'Provider-backed handler failed'; then
    echo "Expected provider failure log entry missing for $label"
    echo "${logs_resp[1]}"
    exit 1
  fi

  echo "$label: PASS ($code)"
}

assert_provider_success() {
  local type_name="$1"
  local prompt="$2"
  local timeout_sec="$3"
  local label="$4"
  local expected_provider=""
  if [[ "$type_name" == "codex.chat.generate" ]]; then
    expected_provider="codex-cli"
  elif [[ "$type_name" == "ai.chat.generate" ]]; then
    expected_provider="openai"
  fi

  local payload
  payload="$(node -e '
    const type = String(process.argv[1] || "");
    const prompt = String(process.argv[2] || "");
    const timeoutSec = Math.max(1, Number.parseInt(process.argv[3] || "180", 10) || 180);
    process.stdout.write(JSON.stringify({
      type,
      input: { prompt },
      priority: 5,
      timeout_sec: timeoutSec,
      max_attempts: 1,
      tags: ["m3", "provider", "success"]
    }));
  ' "$type_name" "$prompt" "$timeout_sec")"
  mapfile -t create_resp < <(request POST "/v1/jobs" "$payload")
  [[ "${create_resp[0]}" == "201" ]] || {
    echo "Create failed for $label: ${create_resp[0]}"
    echo "${create_resp[1]}"
    exit 1
  }
  local job_id
  job_id="$(printf '%s' "${create_resp[1]}" | json_get "job.id")"

  local final
  final="$(poll_job_until_terminal "$job_id" "$timeout_sec")"
  local status
  status="$(printf '%s' "$final" | json_get "job.status")"
  [[ "$status" == "succeeded" ]] || {
    echo "Expected succeeded status for $label, got: $status"
    echo "$final"
    exit 1
  }

  local output_text
  output_text="$(printf '%s' "$final" | json_get "job.result.output_text" || true)"
  [[ -n "${output_text:-}" ]] || {
    echo "Expected non-empty output_text for $label"
    echo "$final"
    exit 1
  }

  if [[ -n "$expected_provider" ]]; then
    local provider
    provider="$(printf '%s' "$final" | json_get "job.result.provider" || true)"
    [[ "$provider" == "$expected_provider" ]] || {
      echo "Expected provider '$expected_provider' for $label, got: '${provider:-<empty>}'"
      echo "$final"
      exit 1
    }
  fi

  mapfile -t logs_resp < <(request GET "/v1/jobs/$job_id/logs?tail=200")
  [[ "${logs_resp[0]}" == "200" ]] || {
    echo "Failed to fetch logs for $label: ${logs_resp[0]}"
    exit 1
  }
  if ! printf '%s' "${logs_resp[1]}" | grep -q 'Provider-backed handler completed'; then
    echo "Expected provider completion log entry missing for $label"
    echo "${logs_resp[1]}"
    exit 1
  fi

  echo "$label: PASS (provider success)"
}

echo "[1/5] Health + ping"
health="$(curl -sS "$API_BASE/health")"
printf '%s\n' "$health" | json_get "ok" >/dev/null
mapfile -t ping_lines < <(request GET "/v1/ping")
[[ "${ping_lines[0]}" == "200" ]] || { echo "Ping failed: ${ping_lines[0]}"; exit 1; }

echo "[2/5] Enable provider types"
ORIG_CODEX_ENABLED="$(get_type_enabled "codex.chat.generate")"
ORIG_OPENAI_ENABLED="$(get_type_enabled "ai.chat.generate")"
patch_type_enabled "codex.chat.generate" "true"
patch_type_enabled "ai.chat.generate" "true"

echo "[3/5] Codex provider deterministic failure path (no prompt/messages)"
assert_provider_failure \
  "codex.chat.generate" \
  '{"type":"codex.chat.generate","input":{},"priority":5,"timeout_sec":30,"max_attempts":1,"tags":["m3","provider","codex"]}' \
  "codex.chat.generate"

echo "[4/5] OpenAI provider deterministic failure path (no prompt/messages)"
assert_provider_failure \
  "ai.chat.generate" \
  '{"type":"ai.chat.generate","input":{},"priority":5,"timeout_sec":30,"max_attempts":1,"tags":["m3","provider","openai"]}' \
  "ai.chat.generate"

echo "[5/5] Provider success-path (optional)"
if [[ "$M3_SMOKE_SUCCESS" == "1" ]]; then
  assert_provider_success \
    "$M3_SMOKE_SUCCESS_TYPE" \
    "$M3_SMOKE_SUCCESS_PROMPT" \
    "$M3_SMOKE_SUCCESS_TIMEOUT_SEC" \
    "$M3_SMOKE_SUCCESS_TYPE"
else
  echo "Skipped (set M3_SMOKE_SUCCESS=1 to enforce provider success-path check)"
fi

echo
echo "M3 provider smoke checks passed."
