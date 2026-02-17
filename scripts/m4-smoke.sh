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
  if [[ "${value:0:1}" == '"' && "${value: -1}" == '"' ]]; then
    value="${value:1:${#value}-2}"
  fi
  if [[ "${value:0:1}" == "'" && "${value: -1}" == "'" ]]; then
    value="${value:1:${#value}-2}"
  fi
  printf '%s' "$value"
}

API_KEY="${API_KEY:-$(read_env_value "API_KEY" "$ENV_FILE")}"
MEMORY_VECTOR_ENABLED="${MEMORY_VECTOR_ENABLED:-$(read_env_value "MEMORY_VECTOR_ENABLED" "$ENV_FILE")}"
M4_SMOKE_CHAT_WRITEBACK="${M4_SMOKE_CHAT_WRITEBACK:-$(read_env_value "M4_SMOKE_CHAT_WRITEBACK" "$ENV_FILE")}"
if [[ -z "${M4_SMOKE_CHAT_WRITEBACK:-}" ]]; then
  M4_SMOKE_CHAT_WRITEBACK="1"
fi

if [[ -z "$API_KEY" ]]; then
  echo "API_KEY is empty. Set API_KEY in $ENV_FILE or export API_KEY."
  exit 1
fi
if [[ "$MEMORY_VECTOR_ENABLED" != "1" ]]; then
  echo "MEMORY_VECTOR_ENABLED must be 1 for m4 smoke."
  exit 1
fi

json_get() {
  local path="$1"
  node -e '
    const fs = require("fs");
    const input = fs.readFileSync(0, "utf8");
    const data = input.trim() ? JSON.parse(input) : {};
    let v = data;
    for (const k of process.argv[1].split(".")) {
      if (!k) continue;
      v = v?.[k];
    }
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

wait_api_ready() {
  local max_wait_sec="${1:-30}"
  local i=0
  while (( i < max_wait_sec )); do
    if curl -fsS "$API_BASE/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
    ((i+=1))
  done
  echo "API not ready at $API_BASE after ${max_wait_sec}s"
  return 1
}

wait_scope_embeddings_ready() {
  local scope="$1"
  local max_wait_sec="${2:-90}"
  local i=0

  while (( i < max_wait_sec )); do
    mapfile -t lines < <(request GET "/v1/memory?scope=$scope&include_expired=1&limit=100")
    local code="${lines[0]}"
    local resp="${lines[1]}"
    if [[ "$code" != "200" ]]; then
      echo "Failed to poll memory scope '$scope': HTTP $code"
      echo "$resp"
      return 1
    fi

    local stats
    stats="$(printf '%s' "$resp" | node -e '
      const fs = require("fs");
      const data = JSON.parse(fs.readFileSync(0, "utf8"));
      const rows = data.memories || [];
      const out = { total: rows.length, ready: 0, pending: 0, failed: 0 };
      for (const m of rows) {
        if (m.embedding_status === "ready") out.ready += 1;
        else if (m.embedding_status === "failed") out.failed += 1;
        else out.pending += 1;
      }
      process.stdout.write(JSON.stringify(out));
    ')"

    local total ready pending failed
    total="$(printf '%s' "$stats" | json_get "total")"
    ready="$(printf '%s' "$stats" | json_get "ready")"
    pending="$(printf '%s' "$stats" | json_get "pending")"
    failed="$(printf '%s' "$stats" | json_get "failed")"

    if [[ "$failed" != "0" ]]; then
      echo "Embedding failure detected in scope '$scope'"
      echo "$resp"
      return 1
    fi

    if [[ "$total" != "0" && "$ready" == "$total" ]]; then
      return 0
    fi

    sleep 1
    ((i+=1))
  done

  echo "Timeout waiting embeddings to become ready for scope '$scope'"
  return 1
}

wait_schedule_dispatched() {
  local schedule_id="$1"
  local max_wait_sec="${2:-40}"
  local i=0

  while (( i < max_wait_sec )); do
    mapfile -t lines < <(request GET "/v1/schedules/$schedule_id")
    local code="${lines[0]}"
    local resp="${lines[1]}"
    if [[ "$code" != "200" ]]; then
      echo "Failed to poll schedule '$schedule_id': HTTP $code"
      echo "$resp"
      return 1
    fi

    local last_job_id
    last_job_id="$(printf '%s' "$resp" | json_get "schedule.last_job_id" || true)"
    if [[ -n "${last_job_id:-}" ]]; then
      printf '%s\n' "$last_job_id"
      return 0
    fi

    sleep 1
    ((i+=1))
  done

  echo "Timeout waiting schedule dispatch for '$schedule_id'"
  return 1
}

poll_job_until_terminal() {
  local job_id="$1"
  local max_wait_sec="${2:-180}"
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

echo "[1/6] Health + ping"
wait_api_ready 45
health="$(curl -sS "$API_BASE/health")"
printf '%s\n' "$health" | json_get "ok" >/dev/null
mapfile -t ping_lines < <(request GET "/v1/ping")
[[ "${ping_lines[0]}" == "200" ]] || { echo "Ping failed: ${ping_lines[0]}"; exit 1; }

echo "[2/6] Insert memory rows (async embedding)"
SCOPE="m4-smoke-$(date +%s)-$RANDOM"

payload_1='{"scope":"'"$SCOPE"'","key":"doc.target","value":{"text":"rauskuclaw memory target omega-123 apple calm sea"},"tags":["m4","target"]}'
payload_2='{"scope":"'"$SCOPE"'","key":"doc.other","value":{"text":"rauskuclaw unrelated gamma-999 banana storm"},"tags":["m4","noise"]}'

mapfile -t create_1 < <(request POST "/v1/memory" "$payload_1")
[[ "${create_1[0]}" == "201" ]] || { echo "Create memory 1 failed: ${create_1[0]}"; echo "${create_1[1]}"; exit 1; }

mapfile -t create_2 < <(request POST "/v1/memory" "$payload_2")
[[ "${create_2[0]}" == "201" ]] || { echo "Create memory 2 failed: ${create_2[0]}"; echo "${create_2[1]}"; exit 1; }

echo "[3/6] Wait until embedding jobs complete"
wait_scope_embeddings_ready "$SCOPE" 120

echo "[4/6] Semantic search returns expected top hit"
search_payload='{"scope":"'"$SCOPE"'","query":"omega-123 apple","top_k":3}'
mapfile -t search_resp < <(request POST "/v1/memory/search" "$search_payload")
[[ "${search_resp[0]}" == "200" ]] || { echo "Search failed: ${search_resp[0]}"; echo "${search_resp[1]}"; exit 1; }

count="$(printf '%s' "${search_resp[1]}" | json_get "count")"
[[ "$count" -ge 1 ]] || { echo "Expected at least one match"; echo "${search_resp[1]}"; exit 1; }

top_key="$(printf '%s' "${search_resp[1]}" | node -e '
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  process.stdout.write(String(data?.matches?.[0]?.memory?.key || ""));
')"
[[ "$top_key" == "doc.target" ]] || {
  echo "Expected top hit key=doc.target, got: $top_key"
  echo "${search_resp[1]}"
  exit 1
}

echo "[5/6] Schedule dispatch creates recurring job"
mapfile -t types_resp < <(request GET "/v1/job-types")
[[ "${types_resp[0]}" == "200" ]] || { echo "List job types failed: ${types_resp[0]}"; echo "${types_resp[1]}"; exit 1; }

report_state="$(printf '%s' "${types_resp[1]}" | node -e '
  const fs = require("fs");
  const data = JSON.parse(fs.readFileSync(0, "utf8"));
  const rows = Array.isArray(data?.types) ? data.types : [];
  const t = rows.find((x) => x && x.name === "report.generate");
  if (!t) process.stdout.write("missing");
  else process.stdout.write(t.enabled ? "enabled" : "disabled");
')"

if [[ "$report_state" == "missing" ]]; then
  create_type_payload='{"name":"report.generate","handler":"builtin:report.generate","enabled":true,"default_timeout_sec":120,"default_max_attempts":1}'
  mapfile -t create_type_resp < <(request POST "/v1/job-types" "$create_type_payload")
  [[ "${create_type_resp[0]}" == "201" ]] || {
    echo "Create report.generate type failed: ${create_type_resp[0]}"
    echo "${create_type_resp[1]}"
    exit 1
  }
elif [[ "$report_state" == "disabled" ]]; then
  enable_type_payload='{"enabled":true}'
  mapfile -t enable_type_resp < <(request PATCH "/v1/job-types/report.generate" "$enable_type_payload")
  [[ "${enable_type_resp[0]}" == "200" ]] || {
    echo "Enable report.generate type failed: ${enable_type_resp[0]}"
    echo "${enable_type_resp[1]}"
    exit 1
  }
fi

schedule_payload='{"name":"m4-smoke-schedule","type":"report.generate","input":{"report":"m4-scheduler-smoke"},"priority":5,"timeout_sec":60,"max_attempts":1,"tags":["m4","schedule"],"cron":"*/5 * * * * *","start_in_sec":0}'
mapfile -t schedule_create < <(request POST "/v1/schedules" "$schedule_payload")
[[ "${schedule_create[0]}" == "201" ]] || { echo "Create schedule failed: ${schedule_create[0]}"; echo "${schedule_create[1]}"; exit 1; }

schedule_id="$(printf '%s' "${schedule_create[1]}" | json_get "schedule.id")"
job_id="$(wait_schedule_dispatched "$schedule_id" 45)"

mapfile -t job_resp < <(request GET "/v1/jobs/$job_id")
[[ "${job_resp[0]}" == "200" ]] || { echo "Scheduled job fetch failed: ${job_resp[0]}"; echo "${job_resp[1]}"; exit 1; }
job_type="$(printf '%s' "${job_resp[1]}" | json_get "job.type")"
[[ "$job_type" == "report.generate" ]] || {
  echo "Expected scheduled job type report.generate, got: $job_type"
  echo "${job_resp[1]}"
  exit 1
}

mapfile -t sched_delete < <(request DELETE "/v1/schedules/$schedule_id")
[[ "${sched_delete[0]}" == "200" ]] || { echo "Cleanup delete schedule failed: ${sched_delete[0]}"; echo "${sched_delete[1]}"; exit 1; }

echo "[6/6] Chat memory write-back persists a row"
if [[ "$M4_SMOKE_CHAT_WRITEBACK" == "1" ]]; then
  mapfile -t provider_types_resp < <(request GET "/v1/job-types")
  [[ "${provider_types_resp[0]}" == "200" ]] || { echo "List job types failed: ${provider_types_resp[0]}"; echo "${provider_types_resp[1]}"; exit 1; }

  write_chat_type="$(printf '%s' "${provider_types_resp[1]}" | node -e '
    const fs = require("fs");
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const rows = Array.isArray(data?.types) ? data.types : [];
    const pick = (name) => rows.find((t) => t && t.name === name && t.enabled);
    const codex = pick("codex.chat.generate");
    const openai = pick("ai.chat.generate");
    process.stdout.write(codex?.name || openai?.name || "");
  ')"

  [[ -n "$write_chat_type" ]] || {
    echo "No enabled chat provider type found for write-back check (expected codex.chat.generate or ai.chat.generate)."
    exit 1
  }

  WRITE_SCOPE="m4-chat-write-$(date +%s)-$RANDOM"
  WRITE_KEY="chat.reply.smoke"
  write_prompt="reply exactly: m4-writeback-ok"
  write_payload="$(node -e '
    const type = process.argv[1];
    const scope = process.argv[2];
    const key = process.argv[3];
    const prompt = process.argv[4];
    process.stdout.write(JSON.stringify({
      type,
      input: {
        prompt,
        memory_write: { scope, key, required: true }
      },
      priority: 5,
      timeout_sec: 180,
      max_attempts: 1,
      tags: ["m4", "chat", "memory_write"]
    }));
  ' "$write_chat_type" "$WRITE_SCOPE" "$WRITE_KEY" "$write_prompt")"

  mapfile -t create_write_job < <(request POST "/v1/jobs" "$write_payload")
  [[ "${create_write_job[0]}" == "201" ]] || { echo "Create write-back chat job failed: ${create_write_job[0]}"; echo "${create_write_job[1]}"; exit 1; }
  write_job_id="$(printf '%s' "${create_write_job[1]}" | json_get "job.id")"
  write_final="$(poll_job_until_terminal "$write_job_id" 240)"
  write_status="$(printf '%s' "$write_final" | json_get "job.status")"
  [[ "$write_status" == "succeeded" ]] || {
    echo "Expected write-back chat job to succeed, got: $write_status"
    echo "$write_final"
    exit 1
  }

  write_result_scope="$(printf '%s' "$write_final" | json_get "job.result.memory_write.scope" || true)"
  write_result_key="$(printf '%s' "$write_final" | json_get "job.result.memory_write.key" || true)"
  [[ "$write_result_scope" == "$WRITE_SCOPE" ]] || {
    echo "Expected memory_write.scope '$WRITE_SCOPE', got '$write_result_scope'"
    echo "$write_final"
    exit 1
  }
  [[ "$write_result_key" == "$WRITE_KEY" ]] || {
    echo "Expected memory_write.key '$WRITE_KEY', got '$write_result_key'"
    echo "$write_final"
    exit 1
  }

  mapfile -t written_scope_resp < <(request GET "/v1/memory?scope=$WRITE_SCOPE&include_expired=1&limit=100")
  [[ "${written_scope_resp[0]}" == "200" ]] || { echo "List written memory scope failed: ${written_scope_resp[0]}"; echo "${written_scope_resp[1]}"; exit 1; }
  written_key_count="$(printf '%s' "${written_scope_resp[1]}" | node -e '
    const fs = require("fs");
    const expectKey = process.argv[1];
    const data = JSON.parse(fs.readFileSync(0, "utf8"));
    const rows = Array.isArray(data?.memories) ? data.memories : [];
    const n = rows.filter((m) => String(m?.key || "") === expectKey).length;
    process.stdout.write(String(n));
  ' "$WRITE_KEY")"
  [[ "$written_key_count" -ge 1 ]] || {
    echo "Expected at least one memory row for key '$WRITE_KEY' in scope '$WRITE_SCOPE'."
    echo "${written_scope_resp[1]}"
    exit 1
  }
else
  echo "Skipped chat write-back check (M4_SMOKE_CHAT_WRITEBACK=$M4_SMOKE_CHAT_WRITEBACK)."
fi

echo
echo "M4 semantic memory + scheduler + chat write-back smoke checks passed."
