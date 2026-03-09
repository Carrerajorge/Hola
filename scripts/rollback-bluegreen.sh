#!/usr/bin/env bash
set -Eeuo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-$(pwd)}"
STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"
SLOT_COMPOSE="${DEPLOY_PATH}/docker-compose.slot.yml"
FORCE=false
STOP_BAD=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    --stop-bad) STOP_BAD=true ;;
  esac
done

if [[ ! -f "$STATE_FILE" ]]; then
  echo "ERROR: state file not found: $STATE_FILE"
  exit 1
fi

require_bin() {
  command -v "$1" >/dev/null 2>&1 || { echo "ERROR: missing required binary: $1"; exit 1; }
}
require_bin docker
require_bin python3
require_bin nginx
require_bin curl

mapfile -t STATE_LINES < <(python3 - "$STATE_FILE" <<'PY'
import json, sys
with open(sys.argv[1], 'r', encoding='utf-8') as f:
    d = json.load(f)
print((d.get('active_slot') or '').strip())
print(str(d.get('active_port') or '').strip())
print((d.get('previous_slot') or '').strip())
print(str(d.get('previous_port') or '').strip())
print((d.get('app_version') or '').strip())
print((d.get('image_tag') or '').strip())
PY
)

ACTIVE_SLOT="${STATE_LINES[0]:-}"
ACTIVE_PORT="${STATE_LINES[1]:-}"
PREVIOUS_SLOT="${STATE_LINES[2]:-}"
PREVIOUS_PORT="${STATE_LINES[3]:-}"
APP_VERSION="${STATE_LINES[4]:-}"
IMAGE_TAG="${STATE_LINES[5]:-latest}"

if [[ -z "$PREVIOUS_SLOT" || -z "$PREVIOUS_PORT" ]]; then
  echo "ERROR: previous slot not recorded in state file"
  exit 1
fi

if [[ "$FORCE" != true ]]; then
  echo "Refusing rollback without --force"
  exit 1
fi

echo "▸ Rolling back from ${ACTIVE_SLOT}:${ACTIVE_PORT} to ${PREVIOUS_SLOT}:${PREVIOUS_PORT}"

HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 8 "http://127.0.0.1:${PREVIOUS_PORT}/api/health/ready" || true)"
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "ERROR: previous slot is not healthy on ${PREVIOUS_PORT} (HTTP ${HTTP_CODE})"
  exit 1
fi

TMP_UPSTREAM="$(mktemp)"
cat > "$TMP_UPSTREAM" <<EOF
upstream iliagpt {
    server 127.0.0.1:${PREVIOUS_PORT} max_fails=3 fail_timeout=10s;
    keepalive 32;
}
EOF
install -m 644 "$TMP_UPSTREAM" "$UPSTREAM_CONF"
rm -f "$TMP_UPSTREAM"
nginx -t
nginx -s reload

python3 - "$STATE_FILE" "$PREVIOUS_SLOT" "$PREVIOUS_PORT" "$APP_VERSION" "$IMAGE_TAG" "$ACTIVE_SLOT" "$ACTIVE_PORT" <<'PY'
import json, os, sys, tempfile
path, active_slot, active_port, app_version, image_tag, previous_slot, previous_port = sys.argv[1:]
fd, tmp = tempfile.mkstemp(prefix='deploy-state-', suffix='.json', dir=os.path.dirname(path) or '.')
os.close(fd)
with open(tmp, 'w', encoding='utf-8') as f:
    json.dump({
        'active_slot': active_slot,
        'active_port': int(active_port),
        'app_version': app_version,
        'image_tag': image_tag,
        'previous_slot': previous_slot,
        'previous_port': int(previous_port),
    }, f, indent=2)
    f.write('\n')
os.replace(tmp, path)
PY

if [[ "$STOP_BAD" == true ]]; then
  echo "▸ Stopping bad slot ${ACTIVE_SLOT}"
  SLOT="$ACTIVE_SLOT" HOST_PORT="$ACTIVE_PORT" IMAGE_TAG="$IMAGE_TAG" APP_VERSION="$APP_VERSION" \
    docker compose -p "hola-${ACTIVE_SLOT}" -f "$SLOT_COMPOSE" stop app worker sandbox-runner || true
fi

echo "✅ Rollback complete. Active slot: ${PREVIOUS_SLOT}:${PREVIOUS_PORT}"
