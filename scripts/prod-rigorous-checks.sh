#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

BASE_URL="${PRODUCTION_BASE_URL:-https://iliagpt.com}"
VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-22}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/iliagpt_deploy}"
SSH_CONNECT_TIMEOUT="${SSH_CONNECT_TIMEOUT:-8}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-iliagpt}"
POSTGRES_DB="${POSTGRES_DB:-iliagpt}"

if [ -z "$VPS_HOST" ]; then
  echo "VPS_HOST is required (example: VPS_HOST=100.93.79.71)."
  exit 1
fi

for cmd in curl ssh grep tr; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: $cmd"
    exit 1
  fi
done

if [ ! -r "$VPS_SSH_KEY" ]; then
  echo "VPS_SSH_KEY not readable: $VPS_SSH_KEY"
  exit 1
fi

FAILED=0

pass() {
  printf 'PASS [%s] %s\n' "$1" "$2"
}

fail() {
  printf 'FAIL [%s] %s\n' "$1" "$2"
  FAILED=$((FAILED + 1))
}

check_http_code() {
  local id="$1"
  local url="$2"
  local expected="$3"
  local body_file="/tmp/prod-rigorous-check-${id}.out"
  local code

  code="$(curl -sS --max-time 10 -o "$body_file" -w '%{http_code}' "$url" || echo "000")"
  if [ "$code" = "$expected" ]; then
    pass "$id" "$url -> HTTP $code"
  else
    fail "$id" "$url -> HTTP $code (expected $expected)"
  fi
}

check_http_code_set() {
  local id="$1"
  local url="$2"
  shift 2
  local body_file="/tmp/prod-rigorous-check-${id}.out"
  local code

  code="$(curl -sS --max-time 10 -o "$body_file" -w '%{http_code}' "$url" || echo "000")"
  for expected in "$@"; do
    if [ "$code" = "$expected" ]; then
      pass "$id" "$url -> HTTP $code"
      return 0
    fi
  done

  fail "$id" "$url -> HTTP $code (expected one of: $*)"
}

check_contains() {
  local id="$1"
  local file="$2"
  local needle="$3"
  local label="$4"

  if grep -q "$needle" "$file" 2>/dev/null; then
    pass "$id" "$label"
  else
    fail "$id" "$label"
  fi
}

SSH_OPTS=(
  -i "$VPS_SSH_KEY"
  -p "$VPS_PORT"
  -o BatchMode=yes
  -o ConnectTimeout="$SSH_CONNECT_TIMEOUT"
  -o StrictHostKeyChecking=accept-new
  -o IdentitiesOnly=yes
)

check_ssh_regex() {
  local id="$1"
  local label="$2"
  local cmd="$3"
  local regex="$4"
  local out

  out="$(ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" "$cmd" 2>/dev/null | tr -d '\r' || true)"
  if echo "$out" | grep -Eq "$regex"; then
    pass "$id" "$label"
  else
    fail "$id" "$label (got: ${out:-<empty>})"
  fi
}

APP_CONTAINER="${COMPOSE_PROJECT}-app-1"
WORKER_CONTAINER="${COMPOSE_PROJECT}-worker-1"
OCR_CONTAINER="${COMPOSE_PROJECT}-ocr-1"
SANDBOX_CONTAINER="${COMPOSE_PROJECT}-sandbox-runner-1"
PG_CONTAINER="${COMPOSE_PROJECT}-postgres-1"

echo "== External production checks (${BASE_URL}) =="
check_http_code "01" "${BASE_URL}/api/health" "200"
check_contains "02" "/tmp/prod-rigorous-check-01.out" '"status":"ok"' "/api/health returns status ok"
check_http_code "03" "${BASE_URL}/api/health/live" "200"
check_contains "04" "/tmp/prod-rigorous-check-03.out" '"status":"ok"' "/api/health/live returns status ok"
check_http_code "05" "${BASE_URL}/api/health/ready" "200"
check_contains "06" "/tmp/prod-rigorous-check-05.out" '"status":"ready"' "/api/health/ready returns status ready"
check_http_code "07" "${BASE_URL}/health" "200"
check_http_code "08" "${BASE_URL}/api/registry/health" "200"
check_contains "09" "/tmp/prod-rigorous-check-08.out" '"healthy":true' "/api/registry/health reports healthy"
check_http_code "10" "${BASE_URL}/metrics" "401"
check_http_code "11" "${BASE_URL}/api/user/usage" "401"
check_http_code_set "12" "${BASE_URL}/api/auth/google" "301" "302" "303" "307" "308"

echo "== VPS runtime checks (${VPS_USER}@${VPS_HOST}) =="
check_ssh_regex "13" "app container healthy" "docker inspect --format '{{.State.Health.Status}}' ${APP_CONTAINER}" '^healthy$'
check_ssh_regex "14" "ocr container healthy" "docker inspect --format '{{.State.Health.Status}}' ${OCR_CONTAINER}" '^healthy$'
check_ssh_regex "15" "worker container running" "docker inspect --format '{{.State.Status}}' ${WORKER_CONTAINER}" '^running$'
check_ssh_regex "16" "sandbox-runner container running" "docker inspect --format '{{.State.Status}}' ${SANDBOX_CONTAINER}" '^running$'
check_ssh_regex "17" "users table exists" "docker exec ${PG_CONTAINER} psql -U postgres -d '${POSTGRES_DB}' -tAc \"SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users';\"" '^1$'

if [ "$FAILED" -ne 0 ]; then
  echo "RIGOROUS_CHECKS_FAILED=$FAILED"
  exit 1
fi

echo "RIGOROUS_CHECKS_PASSED=17"
