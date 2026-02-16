#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API_BASE="${API_BASE:-http://127.0.0.1:3001}"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing env file: $ENV_FILE"
  exit 1
fi

API_KEY="${API_KEY:-$(grep '^API_KEY=' "$ENV_FILE" | cut -d= -f2-)}"
CALLBACK_ALLOWLIST="${CALLBACK_ALLOWLIST:-$(grep '^CALLBACK_ALLOWLIST=' "$ENV_FILE" | cut -d= -f2- || true)}"

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
  local idem="${4:-}"
  local out_file
  out_file="$(mktemp)"

  local -a args
  args=(-sS -o "$out_file" -w "%{http_code}" -X "$method" "$API_BASE$path" -H "accept: application/json" -H "x-api-key: $API_KEY")
  if [[ -n "$idem" ]]; then
    args+=(-H "Idempotency-Key: $idem")
  fi
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

echo "[1/5] Health + ping"
health="$(curl -sS "$API_BASE/health")"
printf '%s\n' "$health" | json_get "ok" >/dev/null
mapfile -t ping_lines < <(request GET "/v1/ping")
[[ "${ping_lines[0]}" == "200" ]] || { echo "Ping failed: ${ping_lines[0]}"; exit 1; }

echo "[2/5] Idempotency: same key + same payload"
idem_key="m1-$(date +%s)-$RANDOM"
payload='{"type":"report.generate","input":{"report":"m1-idem"},"priority":7,"timeout_sec":20,"max_attempts":1,"tags":["m1","idempotency"]}'
mapfile -t first_create < <(request POST "/v1/jobs" "$payload" "$idem_key")
[[ "${first_create[0]}" == "201" ]] || { echo "First create failed: ${first_create[0]}"; echo "${first_create[1]}"; exit 1; }
job_id_1="$(printf '%s' "${first_create[1]}" | json_get "job.id")"

mapfile -t second_create < <(request POST "/v1/jobs" "$payload" "$idem_key")
[[ "${second_create[0]}" == "200" ]] || { echo "Second create (idempotent) failed: ${second_create[0]}"; echo "${second_create[1]}"; exit 1; }
job_id_2="$(printf '%s' "${second_create[1]}" | json_get "job.id")"
idempotent="$(printf '%s' "${second_create[1]}" | json_get "idempotent")"
[[ "$job_id_1" == "$job_id_2" && "$idempotent" == "true" ]] || {
  echo "Idempotency mismatch"
  echo "first=$job_id_1 second=$job_id_2 idempotent=$idempotent"
  exit 1
}

echo "[3/5] Idempotency: same key + different payload => conflict"
payload_conflict='{"type":"report.generate","input":{"report":"m1-idem-conflict"},"priority":1,"timeout_sec":20,"max_attempts":1}'
mapfile -t conflict_resp < <(request POST "/v1/jobs" "$payload_conflict" "$idem_key")
[[ "${conflict_resp[0]}" == "409" ]] || { echo "Expected 409 conflict, got ${conflict_resp[0]}"; echo "${conflict_resp[1]}"; exit 1; }
conflict_code="$(printf '%s' "${conflict_resp[1]}" | json_get "error.code")"
[[ "$conflict_code" == "IDEMPOTENCY_CONFLICT" ]] || { echo "Unexpected conflict code: $conflict_code"; exit 1; }

echo "[4/5] Retry behavior (data.fetch should fail and retry)"
retry_payload='{"type":"data.fetch","input":{"url":"https://example.com"},"priority":5,"timeout_sec":5,"max_attempts":2,"tags":["m1","retry"]}'
mapfile -t retry_create < <(request POST "/v1/jobs" "$retry_payload")
[[ "${retry_create[0]}" == "201" ]] || { echo "Retry create failed: ${retry_create[0]}"; echo "${retry_create[1]}"; exit 1; }
retry_job_id="$(printf '%s' "${retry_create[1]}" | json_get "job.id")"
final_retry_job="$(poll_job_until_terminal "$retry_job_id" 40)"
retry_status="$(printf '%s' "$final_retry_job" | json_get "job.status")"
retry_attempts="$(printf '%s' "$final_retry_job" | json_get "job.attempts")"
[[ "$retry_status" == "failed" && "$retry_attempts" == "2" ]] || {
  echo "Unexpected retry terminal state"
  echo "$final_retry_job"
  exit 1
}

mapfile -t retry_logs < <(request GET "/v1/jobs/$retry_job_id/logs?tail=500")
[[ "${retry_logs[0]}" == "200" ]] || { echo "Retry logs fetch failed: ${retry_logs[0]}"; exit 1; }
if ! printf '%s' "${retry_logs[1]}" | grep -q 'Re-queued for retry'; then
  echo "Missing expected retry log marker"
  echo "${retry_logs[1]}"
  exit 1
fi

echo "[5/5] Callback allowlist scenario"
if [[ -n "${CALLBACK_ALLOWLIST// }" ]]; then
  callback_payload='{"type":"report.generate","input":{"report":"m1-callback"},"priority":5,"timeout_sec":20,"max_attempts":1,"callback_url":"https://not-in-allowlist.invalid/hook","tags":["m1","callback"]}'
  mapfile -t callback_create < <(request POST "/v1/jobs" "$callback_payload")
  [[ "${callback_create[0]}" == "201" ]] || { echo "Callback create failed: ${callback_create[0]}"; echo "${callback_create[1]}"; exit 1; }
  callback_job_id="$(printf '%s' "${callback_create[1]}" | json_get "job.id")"
  poll_job_until_terminal "$callback_job_id" 30 >/dev/null
  mapfile -t callback_logs < <(request GET "/v1/jobs/$callback_job_id/logs?tail=500")
  [[ "${callback_logs[0]}" == "200" ]] || { echo "Callback logs fetch failed: ${callback_logs[0]}"; exit 1; }
  if ! printf '%s' "${callback_logs[1]}" | grep -q 'Callback blocked (not allowlisted)'; then
    echo "Expected callback block log missing"
    echo "${callback_logs[1]}"
    exit 1
  fi
  echo "Callback allowlist behavior: PASS"
else
  echo "Callback allowlist test skipped (CALLBACK_ALLOWLIST is empty)."
fi

echo
echo "M1 smoke checks passed."
