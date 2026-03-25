#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

IMAGE_REF="${1:?Usage: smoke-test-app-image.sh <image-ref> [expected-version]}"
EXPECTED_VERSION="${2:-}"

SMOKE_ID="iliagpt-smoke-${RANDOM}-${RANDOM}"
NETWORK_NAME="${SMOKE_ID}-net"
POSTGRES_CONTAINER="${SMOKE_ID}-postgres"
REDIS_CONTAINER="${SMOKE_ID}-redis"
APP_CONTAINER="${SMOKE_ID}-app"
REDIS_PASSWORD="${SMOKE_REDIS_PASSWORD:-redis_smoke_password}"
SESSION_SECRET="${SMOKE_SESSION_SECRET:-smoke-session-secret-0123456789abcdef}"
TOKEN_ENCRYPTION_KEY="${SMOKE_TOKEN_ENCRYPTION_KEY:-smoke-token-encryption-key-0123456789abcdef}"
APP_VERSION="${EXPECTED_VERSION:-smoke}"
APP_PORT="${SMOKE_APP_PORT:-}"
TMP_DIR="$(mktemp -d /tmp/iliagpt-image-smoke.XXXXXX)"
HEALTH_JSON="${TMP_DIR}/health.json"
READY_JSON="${TMP_DIR}/ready.json"
UI_HTML="${TMP_DIR}/openclaw-ui.html"

log() {
  printf '[smoke] %s\n' "$*"
}

cleanup() {
  set +e
  docker rm -f "${APP_CONTAINER}" "${POSTGRES_CONTAINER}" "${REDIS_CONTAINER}" >/dev/null 2>&1 || true
  docker network rm "${NETWORK_NAME}" >/dev/null 2>&1 || true
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

ensure_cmd() {
  local cmd="$1"
  if ! command -v "${cmd}" >/dev/null 2>&1; then
    echo "Missing required command: ${cmd}" >&2
    exit 1
  fi
}

ensure_cmd docker
ensure_cmd curl
ensure_cmd grep

pick_free_port() {
  if [ -n "${APP_PORT}" ]; then
    printf '%s\n' "${APP_PORT}"
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - <<'PY'
import socket
sock = socket.socket()
sock.bind(("127.0.0.1", 0))
print(sock.getsockname()[1])
sock.close()
PY
    return 0
  fi

  printf '38080\n'
}

APP_PORT="$(pick_free_port)"
BASE_URL="http://127.0.0.1:${APP_PORT}"
ALLOWED_HOSTS="${SMOKE_ALLOWED_HOSTS:-127.0.0.1,127.0.0.1:${APP_PORT},localhost,localhost:${APP_PORT}}"

pull_with_retry() {
  local image_ref="$1"
  local attempt
  for attempt in 1 2 3; do
    if docker pull "${image_ref}" >/dev/null 2>&1; then
      return 0
    fi
    log "Retrying pull for ${image_ref} (${attempt}/3)..."
    sleep $((attempt * 2))
  done
  echo "Unable to pull image: ${image_ref}" >&2
  exit 1
}

container_running() {
  docker inspect --format '{{.State.Running}}' "${APP_CONTAINER}" 2>/dev/null | grep -qx 'true'
}

print_app_diagnostics() {
  set +e
  log "App container status:"
  docker inspect --format '{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "${APP_CONTAINER}" 2>/dev/null || true
  log "App container logs (last 200 lines):"
  docker logs --tail=200 "${APP_CONTAINER}" 2>&1 || true
}

wait_for_postgres() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker exec "${POSTGRES_CONTAINER}" pg_isready -U postgres -d iliagpt >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Postgres did not become ready in time" >&2
  docker logs --tail=100 "${POSTGRES_CONTAINER}" 2>&1 || true
  exit 1
}

wait_for_redis() {
  local attempt
  for attempt in $(seq 1 30); do
    if docker exec "${REDIS_CONTAINER}" redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -qx 'PONG'; then
      return 0
    fi
    sleep 2
  done
  echo "Redis did not become ready in time" >&2
  docker logs --tail=100 "${REDIS_CONTAINER}" 2>&1 || true
  exit 1
}

wait_for_http() {
  local path="$1"
  local output_file="$2"
  local expected_code="${3:-200}"
  local attempts="${4:-60}"
  local code=""
  local attempt

  for attempt in $(seq 1 "${attempts}"); do
    if ! container_running; then
      echo "App container exited while waiting for ${path}" >&2
      print_app_diagnostics
      exit 1
    fi

    code="$(curl -sS --max-time 5 -o "${output_file}" -w '%{http_code}' "${BASE_URL}${path}" || echo '000')"
    if [ "${code}" = "${expected_code}" ]; then
      log "${path} -> HTTP ${code}"
      return 0
    fi

    sleep 2
  done

  echo "Timed out waiting for ${path}; last HTTP code was ${code}" >&2
  if [ -s "${output_file}" ]; then
    echo "--- ${path} response body ---" >&2
    cat "${output_file}" >&2
    echo >&2
  fi
  print_app_diagnostics
  exit 1
}

validate_health_version() {
  if [ -z "${EXPECTED_VERSION}" ]; then
    return 0
  fi

  if command -v python3 >/dev/null 2>&1; then
    python3 - "${HEALTH_JSON}" "${EXPECTED_VERSION}" <<'PY'
import json
import sys

path = sys.argv[1]
expected = sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    payload = json.load(fh)

actual = payload.get("app_version") or payload.get("version") or payload.get("app_sha")
if actual != expected:
    raise SystemExit(f"Expected health version {expected!r}, got {actual!r}")
PY
    return 0
  fi

  if ! grep -Eq "\"(app_version|version|app_sha)\":\"${EXPECTED_VERSION}\"" "${HEALTH_JSON}"; then
    echo "Health payload does not contain expected version ${EXPECTED_VERSION}" >&2
    cat "${HEALTH_JSON}" >&2
    exit 1
  fi
}

log "Creating isolated Docker network ${NETWORK_NAME}"
docker network create "${NETWORK_NAME}" >/dev/null

log "Pulling published app image ${IMAGE_REF}"
pull_with_retry "${IMAGE_REF}"

log "Starting ephemeral Postgres"
docker run -d \
  --name "${POSTGRES_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=iliagpt \
  pgvector/pgvector:pg15 >/dev/null
wait_for_postgres

log "Starting ephemeral Redis"
docker run -d \
  --name "${REDIS_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  redis:alpine \
  redis-server --save '' --appendonly no --requirepass "${REDIS_PASSWORD}" >/dev/null
wait_for_redis

log "Starting app container from ${IMAGE_REF}"
docker run -d \
  --name "${APP_CONTAINER}" \
  --network "${NETWORK_NAME}" \
  -p "127.0.0.1:${APP_PORT}:5000" \
  -e NODE_ENV=production \
  -e PORT=5000 \
  -e BASE_URL="${BASE_URL}" \
  -e APP_URL="${BASE_URL}" \
  -e ALLOWED_HOSTS="${ALLOWED_HOSTS}" \
  -e APP_VERSION="${APP_VERSION}" \
  -e APP_SHA="${APP_VERSION}" \
  -e DATABASE_URL="postgres://postgres:postgres@${POSTGRES_CONTAINER}:5432/iliagpt" \
  -e REDIS_URL="redis://:${REDIS_PASSWORD}@${REDIS_CONTAINER}:6379" \
  -e SESSION_SECRET="${SESSION_SECRET}" \
  -e TOKEN_ENCRYPTION_KEY="${TOKEN_ENCRYPTION_KEY}" \
  -e ADMIN_EMAIL=smoke@example.com \
  -e ADMIN_PASSWORD=SmokePassword123456 \
  -e CHANNEL_INGEST_MODE=inprocess \
  -e AGENT_WORKSPACE_ROOT=/tmp/agent-workspace \
  -e SHELL_COMMAND_SANDBOX_MODE=runner \
  -e SHELL_COMMAND_RUNNER_URL=http://127.0.0.1:65535 \
  -e SHELL_COMMAND_RUNNER_TOKEN=smoke-runner-token \
  -e OCR_SERVICE_URL=http://127.0.0.1:65534 \
  -e METRICS_PUBLIC=false \
  "${IMAGE_REF}" >/dev/null

wait_for_http "/api/health/live" "${TMP_DIR}/live.json" 200 60
wait_for_http "/api/health" "${HEALTH_JSON}" 200 60
validate_health_version
wait_for_http "/api/health/ready" "${READY_JSON}" 200 60
wait_for_http "/openclaw-ui/" "${UI_HTML}" 200 30

log "Published app image passed runtime smoke checks"
