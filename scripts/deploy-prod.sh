#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'
umask 077

# Deploy `main` to the VPS using docker-compose.prod.yml.
#
# Defaults are tuned for this project (ILIAGPT).
# Override with env vars if needed:
#   VPS_HOST, VPS_PORT, VPS_PORT_FALLBACK, VPS_USER, VPS_SSH_KEY, VPS_KNOWN_HOSTS,
#   VPS_HOST_FINGERPRINT, DEPLOY_PATH, COMPOSE_PROJECT, COMPOSE_FILE, VPS_CONNECT_TIMEOUT, DEPLOY_BRANCH

VPS_HOST="${VPS_HOST:-}"
VPS_USER="${VPS_USER:-root}"
VPS_PORT="${VPS_PORT:-}"
VPS_PORT_FALLBACK="${VPS_PORT_FALLBACK:-2222}"
VPS_CONNECT_TIMEOUT="${VPS_CONNECT_TIMEOUT:-5}"
VPS_SSH_KEY="${VPS_SSH_KEY:-$HOME/.ssh/iliagpt_deploy}"
VPS_KNOWN_HOSTS="${VPS_KNOWN_HOSTS:-$HOME/.ssh/known_hosts}"
VPS_HOST_FINGERPRINT="${VPS_HOST_FINGERPRINT:-}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-iliagpt}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

validate_host() {
  local host="$1"
  if [ -z "$host" ] || ! echo "$host" | grep -Eq '^[A-Za-z0-9._:-]+$'; then
    echo "Invalid VPS_HOST: '${host}'"
    return 1
  fi
}

validate_user() {
  local user="$1"
  if [ -z "$user" ] || echo "$user" | grep -Eq '[[:space:]]|[^A-Za-z0-9._-]'; then
    echo "Invalid VPS_USER: '${user}'"
    return 1
  fi
}

validate_port() {
  local port="$1"
  if ! echo "$port" | grep -Eq '^[0-9]+$' || [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    echo "Invalid SSH port: '${port}'"
    return 1
  fi
}

validate_file_path() {
  local path="$1"
  if [ -z "$path" ] || ! echo "$path" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
    echo "Invalid file/path format: '${path}'"
    return 1
  fi
}

validate_timeout() {
  local timeout="$1"
  if ! echo "$timeout" | grep -Eq '^[0-9]+$' || [ "$timeout" -lt 1 ] || [ "$timeout" -gt 60 ]; then
    echo "Invalid timeout: '${timeout}'"
    return 1
  fi
}

require_command() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}"
    return 1
  fi
}

if ! validate_host "$VPS_HOST"; then
  exit 1
fi

if ! validate_user "$VPS_USER"; then
  exit 1
fi

if [ -n "$VPS_PORT" ] && ! validate_port "$VPS_PORT"; then
  exit 1
fi

if ! validate_port "$VPS_PORT_FALLBACK"; then
  exit 1
fi

if ! validate_timeout "$VPS_CONNECT_TIMEOUT"; then
  exit 1
fi

if [ ! -f "$VPS_SSH_KEY" ]; then
  echo "SSH key missing at ${VPS_SSH_KEY}"
  exit 1
fi

if [ ! -r "$VPS_SSH_KEY" ]; then
  echo "SSH key not readable: ${VPS_SSH_KEY}"
  exit 1
fi

if [ -n "$VPS_HOST_FINGERPRINT" ] && ! echo "$VPS_HOST_FINGERPRINT" | grep -Eq '^SHA256:[A-Za-z0-9+/=]+$'; then
  echo "Invalid VPS_HOST_FINGERPRINT format (expected SHA256:...)"
  exit 1
fi

if ! echo "$DEPLOY_BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$'; then
  echo "Invalid DEPLOY_BRANCH: '${DEPLOY_BRANCH}'"
  exit 1
fi

if ! validate_file_path "$COMPOSE_FILE"; then
  echo "Invalid COMPOSE_FILE path: ${COMPOSE_FILE}"
  exit 1
fi

if ! validate_file_path "$COMPOSE_PROJECT"; then
  echo "Invalid COMPOSE_PROJECT: ${COMPOSE_PROJECT}"
  exit 1
fi

if ! validate_file_path "$DEPLOY_PATH"; then
  echo "Invalid DEPLOY_PATH: '${DEPLOY_PATH}'"
  exit 1
fi

TMP_SCANS=()
cleanup_tmp_scans() {
  for path in "${TMP_SCANS[@]-}"; do
    rm -f "$path" || true
  done
}
trap cleanup_tmp_scans EXIT INT TERM HUP

for cmd in ssh ssh-keyscan ssh-keygen git docker curl mktemp; do
  if ! require_command "$cmd"; then
    exit 1
  fi
done

echo "═══════════════════════════════════════════"
echo "  ILIAGPT Production Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════"

PORTS=()
if [ -n "$VPS_PORT" ]; then
  PORTS=("$VPS_PORT")
fi
PORTS+=("22" "$VPS_PORT_FALLBACK")

SELECTED_PORT=""
for p in "${PORTS[@]}"; do
  if ! validate_port "$p"; then
    continue
  fi

  echo "▸ Probing SSH ${VPS_USER}@${VPS_HOST}:$p ..."
  TMP_SCAN="$(mktemp)"
  TMP_SCANS+=("${TMP_SCAN}")
  if ! ssh-keyscan -T "$VPS_CONNECT_TIMEOUT" -p "$p" -H "$VPS_HOST" 2>/dev/null > "$TMP_SCAN"; then
    rm -f "$TMP_SCAN"
    continue
  fi

  if [ ! -s "$TMP_SCAN" ]; then
    rm -f "$TMP_SCAN"
    continue
  fi

  if [ -n "$VPS_HOST_FINGERPRINT" ] && ! ssh-keygen -E sha256 -lf "$TMP_SCAN" 2>/dev/null | awk '{print $2}' | grep -Fxq "$VPS_HOST_FINGERPRINT"; then
    echo "✗ SSH host key fingerprint mismatch for port $p"
    rm -f "$TMP_SCAN"
    continue
  fi

  if ssh -i "$VPS_SSH_KEY" -p "$p" -o BatchMode=yes -o ConnectTimeout="$VPS_CONNECT_TIMEOUT" \
    -o StrictHostKeyChecking=yes -o UserKnownHostsFile="$TMP_SCAN" \
    -o IdentitiesOnly=yes -o ServerAliveInterval=30 -o ServerAliveCountMax=10 \
    "${VPS_USER}@${VPS_HOST}" "true" >/dev/null 2>&1; then
    mkdir -p "$(dirname "$VPS_KNOWN_HOSTS")"
    chmod 700 "$(dirname "$VPS_KNOWN_HOSTS")"
    touch "$VPS_KNOWN_HOSTS"
    if [ ! -s "$VPS_KNOWN_HOSTS" ] || ! grep -Fq "${VPS_HOST}" "$VPS_KNOWN_HOSTS"; then
      cat "$TMP_SCAN" >> "$VPS_KNOWN_HOSTS"
    fi
    chmod 600 "$VPS_KNOWN_HOSTS"
    SELECTED_PORT="$p"
    rm -f "$TMP_SCAN"
    break
  fi

  rm -f "$TMP_SCAN"
done

if [ -z "$SELECTED_PORT" ]; then
  echo "✗ Could not reach VPS via SSH on ports: ${PORTS[*]}"
  exit 1
fi

echo "▸ Using SSH port: $SELECTED_PORT"

SSH_OPTS=(
  -i "$VPS_SSH_KEY"
  -p "$SELECTED_PORT"
  -o BatchMode=yes
  -o ConnectTimeout="$VPS_CONNECT_TIMEOUT"
  -o StrictHostKeyChecking=yes
  -o UserKnownHostsFile="$VPS_KNOWN_HOSTS"
  -o IdentitiesOnly=yes
  -o ServerAliveInterval=30
  -o ServerAliveCountMax=12
  -o ExitOnForwardFailure=yes
)

ssh "${SSH_OPTS[@]}" "${VPS_USER}@${VPS_HOST}" \
  "DEPLOY_PATH='${DEPLOY_PATH}' COMPOSE_PROJECT='${COMPOSE_PROJECT}' COMPOSE_FILE='${COMPOSE_FILE}' DEPLOY_BRANCH='${DEPLOY_BRANCH}' bash -s" <<'DEPLOY'
set -euo pipefail

extract_env_value() {
  local file="$1"
  local key="$2"
  local line
  line="$(grep -m1 -E "^${key}=" "$file" 2>/dev/null || true)"
  if [ -z "$line" ]; then
    return 1
  fi
  line="${line#*=}"
  line="${line%$'\r'}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  echo "$line"
}

for cmd in git docker python3 curl awk; do
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "${cmd} is not available on VPS"
    exit 1
  fi
done

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-iliagpt}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

if [ ! -d "$DEPLOY_PATH" ]; then
  echo "✗ DEPLOY_PATH does not exist on VPS: $DEPLOY_PATH"
  exit 1
fi
if [ -L "$DEPLOY_PATH" ]; then
  echo "✗ DEPLOY_PATH must not be a symlink: $DEPLOY_PATH"
  exit 1
fi
cd "$DEPLOY_PATH"

if ! git diff --quiet --ignore-submodules -- || ! git diff --cached --quiet --ignore-submodules --; then
  echo "✗ VPS repo has local uncommitted changes. Refusing deploy."
  git status --short || true
  exit 1
fi

if [ -f .git/gc.log ]; then
  echo "⚠ Detected stale .git/gc.log on VPS, performing safe git housekeeping..."
  rm -f .git/gc.log || true
  git reflog expire --all --expire=now >/dev/null 2>&1 || true
  git gc --prune=now >/dev/null 2>&1 || true
fi

echo "▸ Pulling latest code (${DEPLOY_BRANCH})..."
if ! git fetch origin "${DEPLOY_BRANCH}"; then
  echo "✗ Failed to fetch ${DEPLOY_BRANCH} from origin"
  exit 1
fi
if git show-ref --verify --quiet "refs/heads/${DEPLOY_BRANCH}"; then
  git checkout "${DEPLOY_BRANCH}"
else
  git checkout -b "${DEPLOY_BRANCH}" "origin/${DEPLOY_BRANCH}"
fi
if ! git pull --ff-only origin "${DEPLOY_BRANCH}"; then
  echo "✗ Failed to fast-forward ${DEPLOY_BRANCH}"
  exit 1
fi
echo "▸ Current commit: $(git rev-parse --short HEAD)"
APP_VERSION="$(git rev-parse --short HEAD)"
export APP_VERSION
echo "▸ APP_VERSION: ${APP_VERSION}"

if [ ! -f "${COMPOSE_FILE}" ]; then
  echo "✗ Compose file missing on VPS: ${COMPOSE_FILE}"
  exit 1
fi

if [ ! -f .env.production ]; then
  echo "✗ Missing .env.production on VPS"
  exit 1
fi

SANDBOX_RUNNER_TOKEN="$(extract_env_value .env.production SANDBOX_RUNNER_TOKEN || true)"
if [ -z "${SANDBOX_RUNNER_TOKEN:-}" ]; then
  echo "✗ SANDBOX_RUNNER_TOKEN missing in .env.production"
  exit 1
fi
if [ "${#SANDBOX_RUNNER_TOKEN}" -lt 32 ] || echo "$SANDBOX_RUNNER_TOKEN" | grep -Eq '[[:space:]]' || \
  ! echo "$SANDBOX_RUNNER_TOKEN" | grep -Eq '^[A-Za-z0-9._/=+-]{32,512}$'; then
  echo "✗ SANDBOX_RUNNER_TOKEN in .env.production is invalid"
  exit 1
fi

REDIS_PASSWORD="$(extract_env_value .env.production REDIS_PASSWORD || true)"
if [ -z "${REDIS_PASSWORD:-}" ]; then
  echo "✗ REDIS_PASSWORD missing in .env.production"
  exit 1
fi

POSTGRES_PASSWORD="$(extract_env_value .env.production POSTGRES_PASSWORD || true)"
if [ -z "${POSTGRES_PASSWORD:-}" ]; then
  echo "✗ POSTGRES_PASSWORD missing in .env.production"
  exit 1
fi

POSTGRES_DB="$(extract_env_value .env.production POSTGRES_DB || true)"
if [ -z "${POSTGRES_DB:-}" ]; then
  POSTGRES_DB="iliagpt"
fi

compose() {
  APP_VERSION="$APP_VERSION" \
  SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN}" \
  REDIS_PASSWORD="${REDIS_PASSWORD}" \
  POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  POSTGRES_DB="${POSTGRES_DB}" \
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" "$@"
}

echo "▸ Validating compose..."
compose config >/dev/null

echo "▸ Building images..."
compose build app worker sandbox-runner ocr

echo "▸ Rolling update: keeping postgres/redis up..."
compose up -d postgres redis

echo "▸ Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker exec "${COMPOSE_PROJECT}-postgres-1" pg_isready -U postgres -d "$POSTGRES_DB" >/dev/null 2>&1; then
    echo "✓ Postgres ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ Postgres readiness failed"
    compose logs --tail=120 postgres
    exit 1
  fi
  sleep 2
done

echo "▸ Waiting for Redis..."
for i in $(seq 1 30); do
  if docker exec "${COMPOSE_PROJECT}-redis-1" redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
    echo "✓ Redis ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ Redis readiness failed"
    compose logs --tail=120 redis
    exit 1
  fi
  sleep 2
done

echo "▸ Running migrations..."
if ! compose --profile ops run --rm migrate; then
  echo "✗ Migration failed"
  exit 1
fi

echo "▸ Starting updated containers..."
compose up -d --remove-orphans app worker sandbox-runner ocr

echo "▸ Waiting for health..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:5000/api/health/ready | grep -q '"status":"ready"'; then
    echo "✓ Healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ Readiness failed"
    compose logs --tail=120 app
    exit 1
  fi
  echo "  Attempt $i/30..."
  sleep 3
done

APP_CONTAINER="${COMPOSE_PROJECT}-app-1"
WORKER_CONTAINER="${COMPOSE_PROJECT}-worker-1"
OCR_CONTAINER="${COMPOSE_PROJECT}-ocr-1"
SANDBOX_CONTAINER="${COMPOSE_PROJECT}-sandbox-runner-1"
PG_CONTAINER="${COMPOSE_PROJECT}-postgres-1"

FAILED=0

check_http() {
  local id="$1"
  local url="$2"
  local expected="$3"
  local body_file="/tmp/deploy-check-${id}.out"
  local code
  code="$(curl -sS -o "${body_file}" -w '%{http_code}' "${url}" || echo "000")"
  if [ "${code}" = "${expected}" ]; then
    echo "✓ [${id}] ${url} -> HTTP ${code}"
    return 0
  fi
  echo "✗ [${id}] ${url} -> HTTP ${code} (expected ${expected})"
  FAILED=$((FAILED + 1))
  return 1
}

check_contains() {
  local id="$1"
  local file="$2"
  local needle="$3"
  local label="$4"
  if grep -q "${needle}" "${file}" 2>/dev/null; then
    echo "✓ [${id}] ${label}"
  else
    echo "✗ [${id}] ${label}"
    FAILED=$((FAILED + 1))
  fi
}

echo "▸ Running rigorous production checks..."
check_http "01" "http://127.0.0.1:5000/api/health" "200"
check_contains "02" "/tmp/deploy-check-01.out" '"status":"ok"' "/api/health returns status ok"
check_http "03" "http://127.0.0.1:5000/api/health/live" "200"
check_contains "04" "/tmp/deploy-check-03.out" '"status":"ok"' "/api/health/live returns status ok"
check_http "05" "http://127.0.0.1:5000/api/health/ready" "200"
check_contains "06" "/tmp/deploy-check-05.out" '"status":"ready"' "/api/health/ready returns status ready"
check_http "07" "http://127.0.0.1:5000/health" "200"
check_http "08" "http://127.0.0.1:5000/api/registry/health" "200"
check_contains "09" "/tmp/deploy-check-08.out" '"healthy":true' "/api/registry/health reports healthy"
check_http "10" "http://127.0.0.1:5000/metrics" "401"
check_http "11" "http://127.0.0.1:5000/api/user/usage" "401"
check_http "12" "http://127.0.0.1:5000/api/auth/google" "302"

if docker inspect --format '{{.State.Health.Status}}' "${APP_CONTAINER}" 2>/dev/null | grep -q '^healthy$'; then
  echo "✓ [13] app container healthy"
else
  echo "✗ [13] app container not healthy"
  FAILED=$((FAILED + 1))
fi

if docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${OCR_CONTAINER}" 2>/dev/null | grep -q '^healthy$'; then
  echo "✓ [14] ocr container healthy"
else
  echo "✗ [14] ocr container not healthy"
  FAILED=$((FAILED + 1))
fi

if docker inspect --format '{{.State.Status}}' "${WORKER_CONTAINER}" 2>/dev/null | grep -q '^running$'; then
  echo "✓ [15] worker container running"
else
  echo "✗ [15] worker container not running"
  FAILED=$((FAILED + 1))
fi

if docker inspect --format '{{.State.Status}}' "${SANDBOX_CONTAINER}" 2>/dev/null | grep -q '^running$'; then
  echo "✓ [16] sandbox-runner container running"
else
  echo "✗ [16] sandbox-runner container not running"
  FAILED=$((FAILED + 1))
fi

if docker exec "${PG_CONTAINER}" psql -U postgres -d "${POSTGRES_DB}" -tAc "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='users';" 2>/dev/null | grep -q '1'; then
  echo "✓ [17] users table exists after migration"
else
  echo "✗ [17] users table check failed"
  FAILED=$((FAILED + 1))
fi

if [ "${FAILED}" -ne 0 ]; then
  echo "✗ Rigorous checks failed: ${FAILED}"
  compose ps
  compose logs --tail=150 app worker ocr sandbox-runner
  exit 1
fi

echo "✓ Rigorous checks passed"
compose ps
curl -s http://127.0.0.1:5000/api/health || true
DEPLOY

echo ""
echo "▸ Verifying public health..."
curl -sS https://iliagpt.com/api/health || true
echo ""
echo "✓ Deploy finished"
