#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required}"
APP_IMAGE="${APP_IMAGE:-ghcr.io/carrerajorge/iliagpt-app:${IMAGE_TAG}}"
SANDBOX_IMAGE="${SANDBOX_IMAGE:-ghcr.io/carrerajorge/iliagpt-sandbox:${IMAGE_TAG}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-pgvector/pgvector:pg15}"
REDIS_IMAGE="${REDIS_IMAGE:-redis:alpine}"
APP_VERSION="${APP_VERSION:-${IMAGE_TAG#sha-}}"
APP_SHA="${APP_SHA:-${APP_VERSION}}"
EXPECTED_OPENCLAW_VERSION="${EXPECTED_OPENCLAW_VERSION:-}"
IMAGE_PULL_TIMEOUT_SECONDS="${IMAGE_PULL_TIMEOUT_SECONDS:-600}"
MIGRATION_TIMEOUT_SECONDS="${MIGRATION_TIMEOUT_SECONDS:-300}"

if [ -z "${EXPECTED_OPENCLAW_VERSION}" ] && [ -f "server/openclaw/package.json" ]; then
  EXPECTED_OPENCLAW_VERSION="$(node -p "require('./server/openclaw/package.json').version" 2>/dev/null || true)"
fi

SUFFIX="${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$"
NETWORK="hola-smoke-${SUFFIX}"
POSTGRES_CONTAINER="hola-smoke-postgres-${SUFFIX}"
REDIS_CONTAINER="hola-smoke-redis-${SUFFIX}"
SANDBOX_CONTAINER="hola-smoke-sandbox-${SUFFIX}"
APP_CONTAINER="hola-smoke-app-${SUFFIX}"
WORKER_CONTAINER="hola-smoke-worker-${SUFFIX}"
REDIS_PASSWORD="smoke_redis_password_${SUFFIX}"
SESSION_SECRET="smoke_session_secret_${SUFFIX}_0123456789ABCDEF"
TOKEN_ENCRYPTION_KEY="smoke_token_encryption_key_${SUFFIX}_0123456789ABCDEF"
SANDBOX_RUNNER_TOKEN="smoke_sandbox_runner_token_${SUFFIX}"
ADMIN_EMAIL="smoke-admin@example.com"
ADMIN_PASSWORD="SmokeAdminPassword-${SUFFIX}"
ENV_FILE="$(mktemp "/tmp/ci-container-smoke.env.${SUFFIX}.XXXXXX")"
MIGRATION_LOG="$(mktemp "/tmp/ci-container-migrate.${SUFFIX}.XXXXXX.log")"
FAILED="false"

reserve_host_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

reserve_host_port_excluding() {
  local excluded_port="${1:-}"
  local candidate=""

  while true; do
    candidate="$(reserve_host_port)"
    if [ -z "${candidate}" ]; then
      continue
    fi
    if [ -n "${excluded_port}" ] && [ "${candidate}" = "${excluded_port}" ]; then
      continue
    fi
    printf '%s\n' "${candidate}"
    return 0
  done
}

is_port_bind_error() {
  local output="${1:-}"
  printf '%s' "${output}" | grep -Eqi 'port is already allocated|address already in use|bind for 127\.0\.0\.1:'
}

HOST_PORT="$(reserve_host_port)"
SANDBOX_HOST_PORT="$(reserve_host_port_excluding "${HOST_PORT}")"

log() {
  echo "[ci-container-smoke] $*"
}

cleanup() {
  local exit_code=$?
  if [ "${FAILED}" = "true" ]; then
    log "Recent app container logs:"
    docker logs --tail=500 "${APP_CONTAINER}" 2>/dev/null || true
    log "Recent worker container logs:"
    docker logs --tail=200 "${WORKER_CONTAINER}" 2>/dev/null || true
    log "Recent sandbox container logs:"
    docker logs --tail=200 "${SANDBOX_CONTAINER}" 2>/dev/null || true
    log "Recent postgres container logs:"
    docker logs --tail=120 "${POSTGRES_CONTAINER}" 2>/dev/null || true
    log "Recent redis container logs:"
    docker logs --tail=120 "${REDIS_CONTAINER}" 2>/dev/null || true
    if [ -s "${MIGRATION_LOG}" ]; then
      log "Migration logs:"
      cat "${MIGRATION_LOG}" || true
    fi
  fi

  docker rm -f "${APP_CONTAINER}" "${WORKER_CONTAINER}" "${SANDBOX_CONTAINER}" "${POSTGRES_CONTAINER}" "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
  docker network rm "${NETWORK}" >/dev/null 2>&1 || true
  rm -f "${ENV_FILE}" "${MIGRATION_LOG}"
  exit "${exit_code}"
}
trap cleanup EXIT

fail() {
  FAILED="true"
  log "ERROR: $*"
  exit 1
}

run_with_timeout() {
  local timeout_seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "${timeout_seconds}" "$@"
    return $?
  fi
  "$@"
}

ensure_image_available() {
  local image_ref="$1"
  local attempt
  if docker image inspect "${image_ref}" >/dev/null 2>&1; then
    log "Image already available locally: ${image_ref}"
    return 0
  fi

  for attempt in 1 2 3; do
    log "Pulling image ${image_ref} (attempt ${attempt}/3)..."
    if run_with_timeout "${IMAGE_PULL_TIMEOUT_SECONDS}" docker pull "${image_ref}"; then
      return 0
    fi
    sleep $((attempt * 5))
  done

  fail "Unable to pull required image ${image_ref}."
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

ensure_container_running() {
  local name="$1"
  local label="$2"
  local status=""
  status="$(docker inspect -f '{{.State.Status}}' "${name}" 2>/dev/null || true)"
  if [ "${status}" != "running" ]; then
    fail "${label} is not running (status=${status:-missing})."
  fi
  log "${label} is running."
}

wait_for_http_ready() {
  local url="$1"
  local container_name="$2"
  local expected_code="${3:-200}"
  local attempts="${4:-90}"
  local sleep_seconds="${5:-2}"
  local code=""
  local i

  for i in $(seq 1 "${attempts}"); do
    code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "${url}" || true)"
    if [ "${code}" = "${expected_code}" ]; then
      log "${url} returned HTTP ${expected_code}."
      return 0
    fi

    if ! docker ps --format '{{.Names}}' | grep -Fxq "${container_name}"; then
      fail "${container_name} stopped before ${url} became ready."
    fi

    sleep "${sleep_seconds}"
  done

  fail "${url} did not return HTTP ${expected_code}."
}

write_env_file() {
  cat > "${ENV_FILE}" <<EOF
NODE_ENV=production
PORT=5000
APP_VERSION=${APP_VERSION}
APP_SHA=${APP_SHA}
BASE_URL=http://127.0.0.1:${HOST_PORT}
ALLOWED_HOSTS=127.0.0.1,127.0.0.1:${HOST_PORT},localhost,localhost:${HOST_PORT}
DATABASE_URL=postgres://postgres:postgres@${POSTGRES_CONTAINER}:5432/iliagpt
REDIS_URL=redis://:${REDIS_PASSWORD}@${REDIS_CONTAINER}:6379
SESSION_SECRET=${SESSION_SECRET}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ALLOW_CATALOG_SEEDING=false
ALLOW_STRIPE_PRODUCT_SEEDING=false
METRICS_PUBLIC=true
CHANNEL_INGEST_MODE=queue
REDIS_PASSWORD=${REDIS_PASSWORD}
OCR_SERVICE_URL=http://127.0.0.1:65535
SANDBOX_RUNNER_TOKEN=${SANDBOX_RUNNER_TOKEN}
SHELL_COMMAND_SANDBOX_MODE=runner
SHELL_COMMAND_RUNNER_URL=http://${SANDBOX_CONTAINER}:8080
SHELL_COMMAND_RUNNER_TOKEN=${SANDBOX_RUNNER_TOKEN}
AGENT_WORKSPACE_ROOT=/tmp/sandbox_workspace
ENABLE_OPENCLAW_GATEWAY=true
ENABLE_OPENCLAW_TOOLS=true
ENABLE_OPENCLAW_SKILLS=true
ENABLE_OPENCLAW_STREAMING=true
EOF
}

start_sandbox_container() {
  local attempt=1
  local docker_error=""

  while [ "${attempt}" -le 3 ]; do
    log "Booting the sandbox runner image on host port ${SANDBOX_HOST_PORT} (attempt ${attempt}/3)..."
    if docker_error="$(
      docker run -d \
        --name "${SANDBOX_CONTAINER}" \
        --network "${NETWORK}" \
        -p "127.0.0.1:${SANDBOX_HOST_PORT}:8080" \
        --env-file "${ENV_FILE}" \
        -e SANDBOX_RUNNER_PORT=8080 \
        -e AGENT_WORKSPACE_ROOT=/workspace_root \
        -e SHELL_COMMAND_DOCKER_IMAGE=debian:bookworm-slim \
        -e SHELL_COMMAND_DOCKER_CPUS=1 \
        -e SHELL_COMMAND_DOCKER_MEMORY=512m \
        -e SHELL_COMMAND_DOCKER_PIDS=256 \
        -v /var/run/docker.sock:/var/run/docker.sock:ro \
        "${SANDBOX_IMAGE}" 2>&1 >/dev/null
    )"; then
      return 0
    fi

    if is_port_bind_error "${docker_error}"; then
      log "Sandbox host port ${SANDBOX_HOST_PORT} was already in use; reserving a new port and retrying."
      SANDBOX_HOST_PORT="$(reserve_host_port_excluding "${HOST_PORT}")"
      attempt=$((attempt + 1))
      continue
    fi

    fail "Unable to boot sandbox runner image: ${docker_error}"
  done

  fail "Unable to boot sandbox runner image after exhausting host port retries."
}

start_app_container() {
  local attempt=1
  local docker_error=""

  while [ "${attempt}" -le 3 ]; do
    write_env_file
    log "Booting the production app image on host port ${HOST_PORT} (attempt ${attempt}/3)..."
    if docker_error="$(
      docker run -d \
        --name "${APP_CONTAINER}" \
        --network "${NETWORK}" \
        -p "127.0.0.1:${HOST_PORT}:5000" \
        --env-file "${ENV_FILE}" \
        "${APP_IMAGE}" 2>&1 >/dev/null
    )"; then
      return 0
    fi

    if is_port_bind_error "${docker_error}"; then
      log "App host port ${HOST_PORT} was already in use; reserving a new port and retrying."
      HOST_PORT="$(reserve_host_port_excluding "${SANDBOX_HOST_PORT}")"
      attempt=$((attempt + 1))
      continue
    fi

    fail "Unable to boot production app image: ${docker_error}"
  done

  fail "Unable to boot production app image after exhausting host port retries."
}

assert_openclaw_runtime_health() {
  local json_payload="$1"
  if ! JSON_PAYLOAD="${json_payload}" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ["JSON_PAYLOAD"])
mods = payload.get("modules") or {}
if payload.get("ok") is not True:
    raise SystemExit(1)
for key in ("skills", "tools", "gateway"):
    if mods.get(key) is not True:
        raise SystemExit(1)
PY
  then
    fail "OpenClaw runtime health payload did not report all native modules enabled."
  fi
}

extract_skill_count() {
  local json_payload="$1"
  JSON_PAYLOAD="${json_payload}" python3 - <<'PY'
import json
import os
payload = json.loads(os.environ["JSON_PAYLOAD"])
count = int(payload.get("count") or 0)
if count <= 0:
    raise SystemExit(1)
print(count)
PY
}

log "Creating isolated Docker network ${NETWORK}..."
docker network create "${NETWORK}" >/dev/null

ensure_image_available "${POSTGRES_IMAGE}"
ensure_image_available "${REDIS_IMAGE}"
ensure_image_available "${APP_IMAGE}"
ensure_image_available "${SANDBOX_IMAGE}"

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
  "${POSTGRES_IMAGE}" >/dev/null

log "Starting ephemeral Redis for production boot smoke..."
docker run -d \
  --name "${REDIS_CONTAINER}" \
  --network "${NETWORK}" \
  --health-cmd="redis-cli -a '${REDIS_PASSWORD}' ping" \
  --health-interval=5s \
  --health-timeout=3s \
  --health-retries=20 \
  --health-start-period=5s \
  "${REDIS_IMAGE}" \
  redis-server \
  --requirepass "${REDIS_PASSWORD}" \
  --appendonly no >/dev/null

wait_for_container_health "${POSTGRES_CONTAINER}" 45 2
wait_for_container_health "${REDIS_CONTAINER}" 45 2

write_env_file

log "Running production migrations inside the built image..."
if ! run_with_timeout "${MIGRATION_TIMEOUT_SECONDS}" docker run --rm \
  --network "${NETWORK}" \
  --env-file "${ENV_FILE}" \
  "${APP_IMAGE}" \
  node dist/migrate.cjs >"${MIGRATION_LOG}" 2>&1; then
  FAILED="true"
  fail "Production migrations failed inside the built image."
fi

start_sandbox_container

wait_for_http_ready "http://127.0.0.1:${SANDBOX_HOST_PORT}/health" "${SANDBOX_CONTAINER}" 200 60 2

start_app_container

log "Booting the production worker image..."
docker run -d \
  --name "${WORKER_CONTAINER}" \
  --network "${NETWORK}" \
  --env-file "${ENV_FILE}" \
  "${APP_IMAGE}" \
  node dist/worker.cjs >/dev/null

wait_for_http_ready "http://127.0.0.1:${HOST_PORT}/api/health/ready" "${APP_CONTAINER}" 200 90 2
sleep 10
ensure_container_running "${WORKER_CONTAINER}" "Worker container"

HEALTH_JSON="$(curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/health")"
log "Health payload: ${HEALTH_JSON}"

if ! printf '%s' "${HEALTH_JSON}" | grep -q '"status":"ok"'; then
  fail "/api/health did not report status ok."
fi

if ! printf '%s' "${HEALTH_JSON}" | grep -q "\"version\":\"${APP_VERSION}\""; then
  fail "/api/health version does not match expected app version ${APP_VERSION}."
fi

if ! printf '%s' "${HEALTH_JSON}" | grep -q "\"app_sha\":\"${APP_SHA}\""; then
  fail "/api/health app_sha does not match expected app sha ${APP_SHA}."
fi

OPENCLAW_HEALTH_JSON="$(curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/openclaw/runtime/health")"
log "OpenClaw runtime health payload: ${OPENCLAW_HEALTH_JSON}"
assert_openclaw_runtime_health "${OPENCLAW_HEALTH_JSON}"

RUNTIME_CONTRACT_LOG="$(
  node scripts/verify-public-runtime-contract.mjs \
    --base-url "http://127.0.0.1:${HOST_PORT}" \
    --label "ci-container-smoke" \
    --timeout-ms 5000 2>&1
)" || {
  printf '%s\n' "${RUNTIME_CONTRACT_LOG}"
  fail "Public runtime contract verification failed."
}
log "${RUNTIME_CONTRACT_LOG}"

SKILLS_JSON="$(curl -fsS --max-time 5 "http://127.0.0.1:${HOST_PORT}/api/openclaw/runtime/skills")"
SKILL_COUNT="$(extract_skill_count "${SKILLS_JSON}")" || fail "OpenClaw skills registry came up empty."
log "OpenClaw runtime reported ${SKILL_COUNT} skills."

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

if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  {
    echo "### Runtime Readiness Gate"
    echo ""
    echo "- App image: \`${APP_IMAGE}\`"
    echo "- Sandbox image: \`${SANDBOX_IMAGE}\`"
    echo "- App version: \`${APP_VERSION}\`"
    echo "- OpenClaw skills loaded: \`${SKILL_COUNT}\`"
    echo "- Public runtime contract: \`Kimi-only verified\`"
    echo "- Result: passed"
  } >> "${GITHUB_STEP_SUMMARY}"
fi

log "Runtime readiness gate passed for ${APP_IMAGE}."
