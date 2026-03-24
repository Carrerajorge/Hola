#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
APP_IMAGE="${APP_IMAGE:-ghcr.io/carrerajorge/iliagpt-app:${IMAGE_TAG}}"
APP_VERSION="${APP_VERSION:-${IMAGE_TAG#sha-}}"
EXPECTED_OPENCLAW_VERSION="${EXPECTED_OPENCLAW_VERSION:-}"

if [ -z "${EXPECTED_OPENCLAW_VERSION}" ] && [ -f "server/openclaw/package.json" ]; then
  EXPECTED_OPENCLAW_VERSION="$(node -p "require('./server/openclaw/package.json').version" 2>/dev/null || true)"
fi

SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
NETWORK="hola-smoke-${SUFFIX}"
POSTGRES_CONTAINER="hola-smoke-postgres-${SUFFIX}"
REDIS_CONTAINER="hola-smoke-redis-${SUFFIX}"
APP_CONTAINER="hola-smoke-app-${SUFFIX}"
REDIS_PASSWORD="smoke_redis_password_${SUFFIX}"
SESSION_SECRET="smoke_session_secret_${SUFFIX}_0123456789ABCDEF"
ADMIN_EMAIL="smoke-admin@example.com"
ADMIN_PASSWORD="SmokeAdminPassword-${SUFFIX}"
FAILED="false"

HOST_PORT="$(
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
)"

log() {
  echo "[ci-container-smoke] $*"
}

cleanup() {
  local exit_code=$?
  if [ "${FAILED}" = "true" ]; then
    log "Recent app container logs:"
    docker logs --tail=200 "${APP_CONTAINER}" 2>/dev/null || true
    log "Recent postgres container logs:"
    docker logs --tail=120 "${POSTGRES_CONTAINER}" 2>/dev/null || true
    log "Recent redis container logs:"
    docker logs --tail=120 "${REDIS_CONTAINER}" 2>/dev/null || true
  fi

  docker rm -f "${APP_CONTAINER}" "${POSTGRES_CONTAINER}" "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
  docker network rm "${NETWORK}" >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap cleanup EXIT

fail() {
  FAILED="true"
  log "ERROR: $*"
  exit 1
}

wait_for_container_health() {
  local name="$1"
  local attempts="${2:-60}"
  local sleep_seconds="${3:-2}"
  local status=""
  local running=""
  local i

  for i in $(seq 1 "${attempts}"); do
    running="$(docker inspect -f '{{.State.Status}}' "${name}" 2>/dev/null || true)"
    status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "${name}" 2>/dev/null || true)"

    if [ "${status}" = "healthy" ]; then
      log "${name} is healthy."
      return 0
    fi

    if [ "${running}" = "exited" ] || [ "${running}" = "dead" ]; then
      fail "${name} exited before becoming healthy."
    fi

    sleep "${sleep_seconds}"
  done

  fail "${name} did not become healthy (last status=${status:-unknown}, running=${running:-unknown})."
}

wait_for_http_ready() {
  local url="$1"
  local expected_code="${2:-200}"
  local attempts="${3:-90}"
  local sleep_seconds="${4:-2}"
  local code=""
  local i

  for i in $(seq 1 "${attempts}"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${url}" || true)"
    if [ "${code}" = "${expected_code}" ]; then
      log "${url} returned HTTP ${expected_code}."
      return 0
    fi

    if ! docker ps --format '{{.Names}}' | grep -Fxq "${APP_CONTAINER}"; then
      log "App container state before readiness failure:"
      docker inspect -f 'status={{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} error={{.State.Error}} startedAt={{.State.StartedAt}} finishedAt={{.State.FinishedAt}}' "${APP_CONTAINER}" 2>/dev/null || true
      docker logs --tail=400 "${APP_CONTAINER}" 2>/dev/null || true
      fail "${APP_CONTAINER} stopped before ${url} became ready."
    fi

    sleep "${sleep_seconds}"
  done

  fail "${url} did not return HTTP ${expected_code}."
}

log "Creating isolated Docker network ${NETWORK}..."
docker network create "${NETWORK}" >/dev/null

log "Starting ephemeral Postgres for production boot smoke..."
docker run -d \
  --name "${POSTGRES_CONTAINER}" \
  --network "${NETWORK}" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=iliagpt \
  --health-cmd="pg_isready -U postgres -d iliagpt" \
  --health-interval=5s \
  --health-timeout=5s \
  --health-retries=20 \
  --health-start-period=10s \
  pgvector/pgvector:pg15 >/dev/null

log "Starting ephemeral Redis for production boot smoke..."
docker run -d \
  --name "${REDIS_CONTAINER}" \
  --network "${NETWORK}" \
  --health-cmd="redis-cli -a '${REDIS_PASSWORD}' ping" \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=20 \
  --health-start-period=5s \
  redis:alpine \
  redis-server \
  --requirepass "${REDIS_PASSWORD}" \
  --appendonly no >/dev/null

wait_for_container_health "${POSTGRES_CONTAINER}" 45 2
wait_for_container_health "${REDIS_CONTAINER}" 45 2

log "Running production migrations inside the built image..."
docker run --rm \
  --network "${NETWORK}" \
  -e NODE_ENV=production \
  -e APP_VERSION="${APP_VERSION}" \
  -e DATABASE_URL="postgres://postgres:postgres@${POSTGRES_CONTAINER}:5432/iliagpt" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_CONTAINER}:6379" \
  -e SESSION_SECRET="${SESSION_SECRET}" \
  -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  "${APP_IMAGE}" \
  node dist/migrate.cjs >/dev/null

log "Booting the production app image..."
docker run -d \
  --name "${APP_CONTAINER}" \
  --network "${NETWORK}" \
  -p "127.0.0.1:${HOST_PORT}:5000" \
  -e NODE_ENV=production \
  -e PORT=5000 \
  -e APP_VERSION="${APP_VERSION}" \
  -e BASE_URL="http://127.0.0.1:${HOST_PORT}" \
  -e DATABASE_URL="postgres://postgres:postgres@${POSTGRES_CONTAINER}:5432/iliagpt" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_CONTAINER}:6379" \
  -e SESSION_SECRET="${SESSION_SECRET}" \
  -e ADMIN_EMAIL="${ADMIN_EMAIL}" \
  -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
  -e OCR_SERVICE_URL="http://127.0.0.1:65535" \
  "${APP_IMAGE}" >/dev/null

wait_for_http_ready "http://127.0.0.1:${HOST_PORT}/api/health/ready" 200 90 2

HEALTH_JSON="$(curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/health")"
log "Health payload: ${HEALTH_JSON}"

if ! printf '%s' "${HEALTH_JSON}" | grep -q '"status":"ok"'; then
  fail "/api/health did not report status ok."
fi

if ! printf '%s' "${HEALTH_JSON}" | grep -q "\"version\":\"${APP_VERSION}\""; then
  fail "/api/health version does not match expected app version ${APP_VERSION}."
fi

APP_LOGS="$(docker logs "${APP_CONTAINER}" 2>&1 || true)"
if printf '%s' "${APP_LOGS}" | grep -Fq "[OpenClaw] initialization skipped after error"; then
  fail "OpenClaw reported an initialization error during boot."
fi

if [ -n "${EXPECTED_OPENCLAW_VERSION}" ]; then
  ACTUAL_OPENCLAW_VERSION="$(
    docker exec "${APP_CONTAINER}" node -p "require('./server/openclaw/package.json').version" 2>/dev/null || true
  )"
  if [ "${ACTUAL_OPENCLAW_VERSION}" != "${EXPECTED_OPENCLAW_VERSION}" ]; then
    fail "Embedded OpenClaw version mismatch: expected ${EXPECTED_OPENCLAW_VERSION}, got ${ACTUAL_OPENCLAW_VERSION:-missing}."
  fi
  log "Embedded OpenClaw version verified: ${ACTUAL_OPENCLAW_VERSION}"
fi

log "Production container boot smoke passed for ${APP_IMAGE}."
