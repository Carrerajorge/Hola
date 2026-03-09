#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$(pwd)}"
STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"
SLOT_COMPOSE="${DEPLOY_PATH}/docker-compose.slot.yml"
INFRA_COMPOSE="${DEPLOY_PATH}/docker-compose.infra.yml"
PULL_TIMEOUT="${PULL_TIMEOUT:-7200}"
IMAGE_TAG="${IMAGE_TAG:-}"
APP_VERSION="${APP_VERSION:-}"

if [[ -z "${IMAGE_TAG}" ]]; then
  echo "ERROR: IMAGE_TAG is required"
  exit 1
fi
if [[ -z "${APP_VERSION}" ]]; then
  APP_VERSION="${IMAGE_TAG#sha-}"
fi

require_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing required binary: $1"; exit 1; }
}

require_bin docker
require_bin python3
require_bin curl
require_bin nginx

mkdir -p "$(dirname "$STATE_FILE")" "$(dirname "$UPSTREAM_CONF")"

slot_port() {
  case "$1" in
    blue) echo 5000 ;;
    green) echo 5001 ;;
    *) echo "" ;;
  esac
}

other_slot() {
  case "$1" in
    blue) echo green ;;
    green) echo blue ;;
    *) echo blue ;;
  esac
}

load_state() {
  if [[ -f "$STATE_FILE" ]]; then
    python3 - "$STATE_FILE" <<'PY'
import json, sys
p = sys.argv[1]
with open(p, 'r', encoding='utf-8') as f:
    d = json.load(f)
print((d.get('active_slot') or '').strip())
print(str(d.get('active_port') or '').strip())
print((d.get('app_version') or '').strip())
print((d.get('image_tag') or '').strip())
PY
  fi
}

write_state() {
  local active_slot="$1"
  local active_port="$2"
  local app_version="$3"
  local image_tag="$4"
  local previous_slot="$5"
  local previous_port="$6"
  python3 - "$STATE_FILE" "$active_slot" "$active_port" "$app_version" "$image_tag" "$previous_slot" "$previous_port" <<'PY'
import json, sys, os, tempfile
path, active_slot, active_port, app_version, image_tag, previous_slot, previous_port = sys.argv[1:]
data = {
  'active_slot': active_slot,
  'active_port': int(active_port),
  'app_version': app_version,
  'image_tag': image_tag,
  'previous_slot': previous_slot,
  'previous_port': int(previous_port),
}
fd, tmp = tempfile.mkstemp(prefix='deploy-state-', suffix='.json', dir=os.path.dirname(path) or '.')
os.close(fd)
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
os.replace(tmp, path)
PY
}

write_upstream() {
  local port="$1"
  local tmp
  tmp="$(mktemp)"
  cat > "$tmp" <<EOF
upstream iliagpt {
    server 127.0.0.1:${port} max_fails=3 fail_timeout=10s;
    keepalive 32;
}
EOF
  install -m 644 "$tmp" "$UPSTREAM_CONF"
  rm -f "$tmp"
  nginx -t
  nginx -s reload
}

wait_http_ok() {
  local url="$1"
  local attempts="${2:-60}"
  local sleep_seconds="${3:-5}"
  local expect="${4:-200}"
  local code
  for i in $(seq 1 "$attempts"); do
    code="$(curl -sS -o /tmp/deploy-http.out -w '%{http_code}' --max-time 10 "$url" || true)"
    if [[ "$code" == "$expect" ]]; then
      return 0
    fi
    echo "  wait_http_ok attempt ${i}/${attempts} -> ${url} returned ${code}"
    sleep "$sleep_seconds"
  done
  return 1
}

wait_health_json_version() {
  local url="$1"
  local expected="$2"
  local attempts="${3:-60}"
  local sleep_seconds="${4:-5}"
  local body
  for i in $(seq 1 "$attempts"); do
    body="$(curl -fsS --max-time 10 "$url" 2>/dev/null || true)"
    if [[ -n "$body" ]] && echo "$body" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
      if [[ -z "$expected" ]] || echo "$body" | grep -q '"version"[[:space:]]*:[[:space:]]*"'"$expected"'"'; then
        return 0
      fi
    fi
    echo "  wait_health_json_version attempt ${i}/${attempts} -> ${url} not ready"
    sleep "$sleep_seconds"
  done
  return 1
}

ensure_infra() {
  echo "▸ Ensuring shared infrastructure is up"
  docker compose -p hola-infra -f "$INFRA_COMPOSE" up -d postgres redis ocr >/dev/null
}

pull_target_images() {
  echo "▸ Pulling target images for ${TARGET_SLOT} (${IMAGE_TAG})"
  timeout "$PULL_TIMEOUT" bash -c '
    SLOT="'"$TARGET_SLOT"'" HOST_PORT="'"$TARGET_PORT"'" IMAGE_TAG="'"$IMAGE_TAG"'" APP_VERSION="'"$APP_VERSION"'" \
      docker compose -p "hola-'"$TARGET_SLOT"'" -f "'"$SLOT_COMPOSE"'" pull app worker sandbox-runner
  '
}

bring_up_target() {
  echo "▸ Starting target slot ${TARGET_SLOT} on port ${TARGET_PORT}"
  SLOT="$TARGET_SLOT" HOST_PORT="$TARGET_PORT" IMAGE_TAG="$IMAGE_TAG" APP_VERSION="$APP_VERSION" \
    docker compose -p "hola-${TARGET_SLOT}" -f "$SLOT_COMPOSE" up -d app worker sandbox-runner
}

stop_slot_if_requested() {
  local slot="$1"
  if [[ "${STOP_OLD_SLOT:-false}" == "true" ]]; then
    echo "▸ Stopping old slot ${slot}"
    SLOT="$slot" HOST_PORT="$(slot_port "$slot")" IMAGE_TAG="$IMAGE_TAG" APP_VERSION="$APP_VERSION" \
      docker compose -p "hola-${slot}" -f "$SLOT_COMPOSE" stop app worker sandbox-runner || true
  fi
}

ACTIVE_SLOT="blue"
ACTIVE_PORT="5000"
PREVIOUS_VERSION=""
PREVIOUS_IMAGE_TAG=""
if state="$(load_state 2>/dev/null)" && [[ -n "$state" ]]; then
  mapfile -t STATE_LINES < <(printf '%s\n' "$state")
  if [[ -n "${STATE_LINES[0]:-}" ]]; then ACTIVE_SLOT="${STATE_LINES[0]}"; fi
  if [[ -n "${STATE_LINES[1]:-}" ]]; then ACTIVE_PORT="${STATE_LINES[1]}"; fi
  PREVIOUS_VERSION="${STATE_LINES[2]:-}"
  PREVIOUS_IMAGE_TAG="${STATE_LINES[3]:-}"
fi

if [[ -z "$ACTIVE_SLOT" || -z "$ACTIVE_PORT" ]]; then
  ACTIVE_SLOT="blue"
  ACTIVE_PORT="5000"
fi

TARGET_SLOT="$(other_slot "$ACTIVE_SLOT")"
TARGET_PORT="$(slot_port "$TARGET_SLOT")"
[[ -n "$TARGET_PORT" ]] || { echo "ERROR: invalid target slot"; exit 1; }

ROLLBACK_DONE=false
rollback() {
  local exit_code=$?
  if [[ "$ROLLBACK_DONE" == "true" ]]; then
    exit "$exit_code"
  fi
  ROLLBACK_DONE=true
  echo "✗ Deploy failed; attempting automatic rollback to ${ACTIVE_SLOT}:${ACTIVE_PORT}"
  if [[ -n "${ACTIVE_PORT:-}" ]]; then
    write_upstream "$ACTIVE_PORT" || true
  fi
  exit "$exit_code"
}
trap rollback ERR

echo "▸ Active slot: ${ACTIVE_SLOT}:${ACTIVE_PORT}"
echo "▸ Target slot: ${TARGET_SLOT}:${TARGET_PORT}"

ensure_infra
pull_target_images
bring_up_target

TARGET_READY_URL="http://127.0.0.1:${TARGET_PORT}/api/health/ready"
TARGET_HEALTH_URL="http://127.0.0.1:${TARGET_PORT}/api/health"

wait_http_ok "$TARGET_READY_URL" 72 5 200
wait_health_json_version "$TARGET_HEALTH_URL" "$APP_VERSION" 24 5

echo "▸ Switching nginx upstream to ${TARGET_SLOT}:${TARGET_PORT}"
write_upstream "$TARGET_PORT"

PUBLIC_HEALTH_URL="https://iliagpt.com/api/health"
PUBLIC_READY_URL="https://iliagpt.com/api/health/ready"
wait_health_json_version "$PUBLIC_HEALTH_URL" "$APP_VERSION" 20 3
wait_http_ok "$PUBLIC_READY_URL" 20 3 200 || true

write_state "$TARGET_SLOT" "$TARGET_PORT" "$APP_VERSION" "$IMAGE_TAG" "$ACTIVE_SLOT" "$ACTIVE_PORT"
stop_slot_if_requested "$ACTIVE_SLOT"
ROLLBACK_DONE=true
trap - ERR

echo "✅ Blue-green deploy successful: ${TARGET_SLOT}:${TARGET_PORT} (${APP_VERSION})"
