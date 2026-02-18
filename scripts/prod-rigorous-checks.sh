#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

BASE_URL="${PRODUCTION_BASE_URL:-https://iliagpt.com}"
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/iliagpt_deploy}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-10}"
HTTP_TIMEOUT="${HTTP_TIMEOUT:-10}"
EXPECTED_APP_VERSION="${EXPECTED_APP_VERSION:-}"
EXPECTED_APP_SHA="${EXPECTED_APP_SHA:-}"
DEPLOY_STATE_PATH="${DEPLOY_STATE_PATH:-/opt/hola/deploy-state.json}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
NGINX_UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"
POSTGRES_DB="${POSTGRES_DB:-iliagpt}"

if [ -z "$VPS_HOST" ]; then
  echo "VPS_HOST is required (example: VPS_HOST=100.93.79.71)."
  exit 1
fi

for cmd in curl ssh grep awk python3; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

if [ ! -r "$VPS_SSH_KEY" ]; then
  echo "VPS_SSH_KEY not readable: $VPS_SSH_KEY"
  exit 1
fi

if ! printf '%s' "$BASE_URL" | grep -Eq '^https?://'; then
  echo "Invalid BASE_URL: $BASE_URL"
  exit 1
fi

if [ ! "$HTTP_TIMEOUT" -ge 1 ] 2>/dev/null; then
  echo "HTTP_TIMEOUT must be an integer >= 1"
  exit 1
fi

TMP_DIR="$(mktemp -d /tmp/prod-rigorous-checks.XXXXXX)"
trap 'rm -rf "$TMP_DIR"' EXIT

FAILED=0
PASS_COUNT=0
TOTAL_COUNT=0
ACTIVE_SLOT=""
ACTIVE_PORT=""
STATE_APP_VERSION=""
STATE_APP_TAG=""
STATE_SOURCE="unknown"

SSH_OPTS=(
  -i "$VPS_SSH_KEY"
  -p "$VPS_PORT"
  -o BatchMode=yes
  -o ConnectTimeout="$SSH_CONNECT_TIMEOUT"
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
)

pass() {
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  PASS_COUNT=$((PASS_COUNT + 1))
  printf 'PASS [%s] %s\n' "$1" "$2"
}

fail() {
  TOTAL_COUNT=$((TOTAL_COUNT + 1))
  FAILED=$((FAILED + 1))
  printf 'FAIL [%s] %s\n' "$1" "$2"
}

run_ssh() {
  ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" "$@"
}

check_http_code() {
  local id="$1"
  local url="$2"
  local expected="$3"
  local body_file="$TMP_DIR/${id}.out"

  local code
  code="$(curl -sS --max-time "${HTTP_TIMEOUT}" -o "$body_file" -w '%{http_code}' "$url" || echo "000")"
  if [ "$code" = "$expected" ]; then
    pass "$id" "$url -> HTTP $code"
    return 0
  fi
  fail "$id" "$url -> HTTP $code (expected $expected)"
  return 1
}

check_http_code_set() {
  local id="$1"
  local url="$2"
  shift 2
  local body_file="$TMP_DIR/${id}.out"
  local expected=("$@")
  local code
  code="$(curl -sS --max-time "${HTTP_TIMEOUT}" -o "$body_file" -w '%{http_code}' "$url" || echo "000")"
  for e in "${expected[@]}"; do
    if [ "$code" = "$e" ]; then
      pass "$id" "$url -> HTTP $code"
      return 0
    fi
  done
  fail "$id" "$url -> HTTP $code (expected one of: ${expected[*]})"
  return 1
}

check_contains() {
  local id="$1"
  local file="$2"
  local needle="$3"
  local label="$4"
  if grep -Fq "$needle" "$file" 2>/dev/null; then
    pass "$id" "$label"
  else
    fail "$id" "$label"
  fi
}

load_state_from_vps() {
  local state_raw
  if ! state_raw="$(run_ssh "cat '${DEPLOY_STATE_PATH}' 2>/dev/null || true")"; then
    return 1
  fi
  if [ -z "$state_raw" ]; then
    return 1
  fi

  local parsed
  if ! parsed="$(printf '%s' "$state_raw" | python3 -c 'import json,sys; state=json.loads(sys.stdin.read()); print((state.get("active_slot") or "").strip().lower()); print(str(state.get("active_port","")).strip()); print((state.get("app_version") or "").strip()); print((state.get("image_tag") or "").strip())')"; then
    return 1
  fi

  local lines=()
  while IFS= read -r line; do
    lines+=("$line")
  done <<<"$parsed"

  if [ "${#lines[@]}" -ne 4 ]; then
    return 1
  fi

  local slot="${lines[0]}"
  local port="${lines[1]}"
  local version="${lines[2]}"
  local img="${lines[3]}"

  if [ "$slot" != "blue" ] && [ "$slot" != "green" ]; then
    return 1
  fi
  if [ "$port" != "5000" ] && [ "$port" != "5001" ]; then
    return 1
  fi
  if [ -n "$version" ] && ! echo "$version" | grep -Eq '^[0-9a-f]{8}$'; then
    return 1
  fi
  if [ -n "$img" ] && ! echo "$img" | grep -Eq '^sha-[0-9a-f]{8}$'; then
    return 1
  fi

  ACTIVE_SLOT="$slot"
  ACTIVE_PORT="$port"
  STATE_APP_VERSION="$version"
  STATE_APP_TAG="$img"
  STATE_SOURCE="state-file"
  return 0
}

load_active_slot_fallback() {
  local nginx_port=""
  nginx_port="$(run_ssh "grep -Eo 'server[[:space:]]+127\\.0\\.0\\.1:[0-9]+' '${NGINX_UPSTREAM_CONF}' 2>/dev/null | awk -F: '{print \$NF}' | awk 'NF {print; exit}' || true")"

  if [ "$nginx_port" = "5000" ] || [ "$nginx_port" = "5001" ]; then
    ACTIVE_PORT="$nginx_port"
    ACTIVE_SLOT="$( [ "$ACTIVE_PORT" = "5000" ] && echo blue || echo green )"
    STATE_SOURCE="nginx-upstream"
    return 0
  fi

  for candidate_slot in blue green; do
    local candidate_port
    candidate_port="$( [ "$candidate_slot" = "blue" ] && echo 5000 || echo 5001 )"
    local status
    status="$(run_ssh "docker inspect --format '{{.State.Status}}' hola-${candidate_slot}-app 2>/dev/null || true")"
    if [ "$status" = "running" ]; then
      ACTIVE_SLOT="$candidate_slot"
      ACTIVE_PORT="$candidate_port"
      STATE_SOURCE="running-slot"
      return 0
    fi
  done

  ACTIVE_SLOT="blue"
  ACTIVE_PORT="5000"
  STATE_SOURCE="hardcoded-fallback"
}

determine_active_slot() {
  if load_state_from_vps; then
    echo "Info: using deploy-state.json (${ACTIVE_SLOT}:${ACTIVE_PORT}, version=${STATE_APP_VERSION})"
    return 0
  fi

  load_active_slot_fallback
  echo "Warning: deploy state unavailable; fallback slot detection selected ${ACTIVE_SLOT}:${ACTIVE_PORT} from ${STATE_SOURCE}."
}

check_container_status() {
  local id="$1"
  local container="$2"
  local expected="$3"
  local label="$4"
  local status
  status="$(run_ssh "docker inspect --format '{{.State.Status}}' ${container} 2>/dev/null || true")"
  if [ "$status" = "$expected" ]; then
    pass "$id" "$label"
    return 0
  fi
  fail "$id" "$label (got: ${status:-<not found>})"
  return 1
}

check_container_health() {
  local id="$1"
  local container="$2"
  local label="$3"
  local status
  status="$(run_ssh "docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}NO_HEALTHCHECK{{end}}' ${container} 2>/dev/null || true")"
  if [ "$status" = "healthy" ]; then
    pass "$id" "$label"
    return 0
  fi
  if [ "$status" = "NO_HEALTHCHECK" ]; then
    fail "$id" "$label (no healthcheck configured)"
    return 1
  fi
  fail "$id" "$label (got: ${status:-<not found>})"
  return 1
}

check_psql_query() {
  local id="$1"
  local container="$2"
  local query="$3"
  local label="$4"
  local out
  out="$(run_ssh "docker exec ${container} psql -U postgres -d '${POSTGRES_DB}' -tAc \"${query}\" 2>/dev/null || true")"
  if [ "$out" = "1" ] || [ -n "$out" ]; then
    pass "$id" "$label"
  else
    fail "$id" "$label (got: ${out:-<empty>})"
  fi
}

determine_active_slot

APP_CONTAINER="hola-${ACTIVE_SLOT}-app"
WORKER_CONTAINER="hola-${ACTIVE_SLOT}-worker"
OCR_CONTAINER="hola-ocr"
SANDBOX_CONTAINER="hola-${ACTIVE_SLOT}-sandbox"
PG_CONTAINER="hola-postgres"
REDIS_CONTAINER="hola-redis"

set +e

echo "== External production checks (${BASE_URL}) =="
check_http_code "01" "${BASE_URL}/api/health" "200"
check_contains "02" "$TMP_DIR/01.out" '"status":"ok"' "/api/health returns status ok"

if [ -n "$EXPECTED_APP_VERSION" ]; then
  if grep -Fq "\"version\":\"${EXPECTED_APP_VERSION}\"" "$TMP_DIR/01.out" || grep -Fq "\"app_version\":\"${EXPECTED_APP_VERSION}\"" "$TMP_DIR/01.out"; then
    pass "03" "/api/health version matches expected (${EXPECTED_APP_VERSION})"
  else
    fail "03" "/api/health version did not match expected (${EXPECTED_APP_VERSION})"
  fi
else
  check_contains "03" "$TMP_DIR/01.out" '"version":' "/api/health has version field"
fi

check_http_code "04" "${BASE_URL}/api/health/live" "200"
check_contains "05" "$TMP_DIR/04.out" '"status":"ok"' "/api/health/live returns status ok"
check_http_code "06" "${BASE_URL}/api/health/ready" "200"
check_contains "07" "$TMP_DIR/06.out" '"status":"ready"' "/api/health/ready returns status ready"
check_http_code "08" "${BASE_URL}/health" "200"
check_http_code "09" "${BASE_URL}/api/registry/health" "200"
check_contains "10" "$TMP_DIR/09.out" '"healthy":true' "/api/registry/health reports healthy"
check_http_code "11" "${BASE_URL}/metrics" "401"
check_http_code "12" "${BASE_URL}/api/user/usage" "401"
check_http_code_set "13" "${BASE_URL}/api/auth/google" "301" "302" "303" "307" "308" "429"
check_http_code "14" "${BASE_URL}/sw-cleanup.js" "200"
check_contains "15" "$TMP_DIR/14.out" "APP_VERSION" "/sw-cleanup.js present"

echo "== VPS runtime checks (${VPS_USER}@${VPS_HOST}) =="
if run_ssh "echo ok >/dev/null"; then
  pass "16" "SSH connectivity to VPS"
else
  fail "16" "SSH connectivity to VPS"
fi

check_container_status "17" "${APP_CONTAINER}" "running" "${APP_CONTAINER} container is running"
check_container_health "18" "${APP_CONTAINER}" "${APP_CONTAINER} health is healthy"
check_container_status "19" "${WORKER_CONTAINER}" "running" "${WORKER_CONTAINER} container is running"
check_container_status "20" "${SANDBOX_CONTAINER}" "running" "${SANDBOX_CONTAINER} container is running"
check_container_status "21" "${OCR_CONTAINER}" "running" "${OCR_CONTAINER} container is running"
check_container_status "22" "${PG_CONTAINER}" "running" "PostgreSQL container is running"
check_container_status "23" "${REDIS_CONTAINER}" "running" "Redis container is running"
check_psql_query "24" "${PG_CONTAINER}" "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users';" "users table exists"

health_local="$(
  run_ssh "curl -fsS --max-time ${HTTP_TIMEOUT} http://127.0.0.1:${ACTIVE_PORT}/api/health 2>/dev/null || true"
)"
if [ -n "$health_local" ]; then
  if echo "$health_local" | grep -Fq '"status":"ok"'; then
    pass "25" "Direct active slot health is ok (${ACTIVE_SLOT}:${ACTIVE_PORT})"
  else
    fail "25" "Direct active slot health is ok (${ACTIVE_SLOT}:${ACTIVE_PORT})"
  fi
  if [ -n "$EXPECTED_APP_VERSION" ] && echo "$health_local" | grep -Fq "\"version\":\"${EXPECTED_APP_VERSION}\""; then
    pass "26" "Direct active slot health version matches expected (${EXPECTED_APP_VERSION})"
  elif [ -n "$STATE_APP_VERSION" ] && echo "$health_local" | grep -Fq "\"version\":\"${STATE_APP_VERSION}\""; then
    pass "26" "Direct active slot health version matches state (${STATE_APP_VERSION})"
  else
    fail "26" "Direct active slot health version check"
  fi
  if [ -n "$EXPECTED_APP_SHA" ]; then
    if echo "$health_local" | grep -Fq "\"app_sha\":\"${EXPECTED_APP_SHA}\""; then
      pass "27" "Direct active slot health app_sha matches expected (${EXPECTED_APP_SHA})"
    else
      fail "27" "Direct active slot health app_sha expected ${EXPECTED_APP_SHA}"
    fi
  else
    pass "27" "Direct active slot health app_sha skipped (EXPECTED_APP_SHA not set)"
  fi
else
  fail "25" "Direct active slot health endpoint (http://127.0.0.1:${ACTIVE_PORT}/api/health)"
  fail "26" "Direct active slot health version check"
  fail "27" "Direct active slot health app_sha check"
fi

lock_state="$(run_ssh "if [ ! -f '${DEPLOY_PATH}/.deploy.lock' ]; then echo ABSENT; else lock_pid=\"\$(cat '${DEPLOY_PATH}/.deploy.lock' 2>/dev/null || true)\"; if [ -n \"\$lock_pid\" ] && kill -0 \"\$lock_pid\" 2>/dev/null; then echo ACTIVE:\$lock_pid; else echo STALE:\$lock_pid; fi; fi")"
if [ "${lock_state}" = "ABSENT" ]; then
  pass "28" "No active deploy lock file"
elif printf '%s' "${lock_state}" | grep -Eq '^ACTIVE:'; then
  fail "28" "Deploy lock file still present"
elif printf '%s' "${lock_state}" | grep -Eq '^STALE:'; then
  pass "28" "Deploy lock file is stale (${lock_state})"
else
  fail "28" "Deploy lock status unknown (${lock_state})"
fi

upstream_cfg="$(run_ssh "cat '${NGINX_UPSTREAM_CONF}' 2>/dev/null || true")"
if [ -n "$upstream_cfg" ] && echo "$upstream_cfg" | grep -Fq "server 127.0.0.1:${ACTIVE_PORT};"; then
  pass "29" "Nginx upstream points to active slot port (${ACTIVE_PORT})"
else
  fail "29" "Nginx upstream contains expected active port (${ACTIVE_PORT})"
fi

echo "Checks completed: ${PASS_COUNT}/${TOTAL_COUNT} passed"
if [ "${FAILED}" -ne 0 ]; then
  echo "RIGOROUS_CHECKS_FAILED=${FAILED}"
  exit 1
fi

echo "RIGOROUS_CHECKS_PASSED=29"
echo "ACTIVE_SLOT=${ACTIVE_SLOT}"
echo "ACTIVE_PORT=${ACTIVE_PORT}"
echo "STATE_SOURCE=${STATE_SOURCE}"
echo "ACTIVE_STATE_VERSION=${STATE_APP_VERSION:-n/a}"
