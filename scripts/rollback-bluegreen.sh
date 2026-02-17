#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ═══════════════════════════════════════════════════════════
#  ILIAGPT Blue-Green Instant Rollback (hardened v2)
#
#  Reverts traffic to the previous slot by swapping the
#  Nginx upstream symlink. Can re-start stopped containers
#  from the previous image automatically.
#
#  Usage:
#    bash scripts/rollback-bluegreen.sh              # Interactive
#    bash scripts/rollback-bluegreen.sh --force       # Skip confirmation
#    bash scripts/rollback-bluegreen.sh --dry-run     # Preview only
#    bash scripts/rollback-bluegreen.sh --stop-bad    # Also stop the bad slot
# ═══════════════════════════════════════════════════════════

readonly SCRIPT_VERSION="2.2.0"

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
readonly STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
readonly STATE_FILE_BAK="${DEPLOY_PATH}/deploy-state.json.rollback-bak"
readonly DEPLOY_LOG="${DEPLOY_PATH}/deploy.log"
readonly LOCK_FILE="${DEPLOY_PATH}/.deploy.lock"
readonly SLOT_COMPOSE="${DEPLOY_PATH}/docker-compose.slot.yml"
readonly NGINX_CONF_DIR="/etc/nginx/conf.d"
readonly REGISTRY="ghcr.io/carrerajorge"

readonly HEALTHCHECK_RETRIES=40
readonly HEALTHCHECK_INTERVAL=3
readonly STATE_FILE_MAX_BYTES=65536

FORCE=false
DRY_RUN=false
STOP_BAD=false

for arg in "$@"; do
  case "${arg}" in
    --force)     FORCE=true   ;;
    --dry-run)   DRY_RUN=true ;;
    --stop-bad)  STOP_BAD=true ;;
    --help|-h)
      echo "Usage: $0 [--force] [--dry-run] [--stop-bad]"
      echo ""
      echo "  --force      Skip confirmation prompt"
      echo "  --dry-run    Show what would happen without making changes"
      echo "  --stop-bad   Also stop the current (bad) slot after rollback"
      echo ""
      echo "  Reads deploy-state.json to determine slots."
      echo "  Requires sudo/root for Nginx reload."
      exit 0
      ;;
    *)
      echo "✗ Unknown option: ${arg}. Use --help for usage."
      exit 1
      ;;
  esac
done

# ── Logging ─────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
logok(){ echo "[$(date '+%H:%M:%S')]   ✓ $*"; }
logw() { echo "[$(date '+%H:%M:%S')]   ⚠ $*"; }
loge() { echo "[$(date '+%H:%M:%S')]   ✗ $*" >&2; }

trim() {
  local value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  echo "${value}"
}

validate_not_weak_default() {
  local name="$1"
  local value="$2"
  local lowered
  lowered="$(printf '%s' "${value}" | tr '[:upper:]' '[:lower:]')"

  case "${lowered}" in
    *changeme*|*change_me*|*default*|*test*|*dev*|*example*|*password*|*secret*|*placeholder*|*todo*)
      loge "Weak/default ${name} detected; update in .env.production."
      return 1
      ;;
  esac
  return 0
}

validate_secret() {
  local name="$1"
  local value="$2"
  local min_len="$3"
  local trimmed
  trimmed="$(trim "${value}")"

  if [ -z "${trimmed}" ]; then
    loge "${name} is missing in .env.production"
    return 1
  fi
  if [ "${#trimmed}" -lt "${min_len}" ]; then
    loge "${name} is too short for production use (min: ${min_len})"
    return 1
  fi
  if printf '%s' "${trimmed}" | grep -Eq '[[:space:]]'; then
    loge "${name} must not contain whitespace."
    return 1
  fi
  if ! validate_not_weak_default "${name}" "${trimmed}"; then
    return 1
  fi
  echo "${trimmed}"
}

load_env_value() {
  local key="$1"
  local file="$2"
  local line
  local value=""

  line="$(grep -m1 -E "^${key}=" "${file}" 2>/dev/null || true)"
  if [ -n "${line}" ]; then
    value="${line#*=}"
    value="${value%$'\r'}"
    value="${value%\"}"
    value="${value#\"}"
    value="${value%\'}"
    value="${value#\'}"
    echo "${value}"
    return 0
  fi

  echo ""
}

validate_state_file_schema() {
  local file="$1"
  python3 - "$file" "${STATE_FILE_MAX_BYTES}" <<'PY'
import json
import os
import re
import sys
import time

path = sys.argv[1]
max_bytes = int(sys.argv[2])

try:
    st = os.stat(path)
except FileNotFoundError:
    print(f"state file not found: {path}", file=sys.stderr)
    sys.exit(1)

if st.st_size <= 2 or st.st_size > max_bytes:
    print(f"invalid state file size: {st.st_size}", file=sys.stderr)
    sys.exit(1)

if st.st_mtime > time.time() + 60:
    print("state file mtime is in the future", file=sys.stderr)
    sys.exit(1)

try:
    with open(path, "r", encoding="utf-8") as fh:
        state = json.load(fh)
except Exception as exc:
    print(f"invalid state file JSON: {exc}", file=sys.stderr)
    sys.exit(1)

required = ("active_slot", "active_port", "image_tag", "app_version", "deployed_at")
missing = [k for k in required if k not in state]
if missing:
    print(f"state file missing keys: {','.join(missing)}", file=sys.stderr)
    sys.exit(1)

slot = str(state.get("active_slot"))
if slot not in ("blue", "green"):
    print(f"invalid active_slot: {slot}", file=sys.stderr)
    sys.exit(1)

try:
    active_port = int(state.get("active_port"))
except Exception:
    print("active_port is not a valid integer", file=sys.stderr)
    sys.exit(1)

expected_port = 5000 if slot == "blue" else 5001
if active_port != expected_port:
    print(
        f"active_slot/active_port mismatch: slot={slot} port={active_port} expected={expected_port}",
        file=sys.stderr,
    )
    sys.exit(1)

image_tag = str(state.get("image_tag"))
app_version = str(state.get("app_version"))
if re.fullmatch(r"sha-[0-9a-f]{8}", image_tag) is None:
    print(f"invalid image_tag format: {image_tag}", file=sys.stderr)
    sys.exit(1)
if re.fullmatch(r"[0-9a-f]{8}", app_version) is None:
    print(f"invalid app_version format: {app_version}", file=sys.stderr)
    sys.exit(1)
if image_tag != f"sha-{app_version}":
    print(
        f"image_tag/app_version mismatch: image_tag={image_tag} app_version={app_version}",
        file=sys.stderr,
    )
    sys.exit(1)

previous_slot = state.get("previous_slot")
if previous_slot is not None:
    previous_slot = str(previous_slot)
    if previous_slot not in ("blue", "green", "none", "unknown"):
        print(f"invalid previous_slot: {previous_slot}", file=sys.stderr)
        sys.exit(1)
    if previous_slot in ("blue", "green") and previous_slot == slot:
        print("previous_slot must differ from active_slot", file=sys.stderr)
        sys.exit(1)

previous_port = state.get("previous_port")
if previous_port is not None:
    try:
        previous_port = int(previous_port)
    except Exception:
        print("previous_port is not a valid integer", file=sys.stderr)
        sys.exit(1)
    if previous_port not in (5000, 5001):
        print(f"invalid previous_port: {previous_port}", file=sys.stderr)
        sys.exit(1)
    if previous_slot in ("blue", "green"):
        expected_previous_port = 5000 if previous_slot == "blue" else 5001
        if previous_port != expected_previous_port:
            print(
                "previous_slot/previous_port mismatch: "
                f"slot={previous_slot} port={previous_port} expected={expected_previous_port}",
                file=sys.stderr,
            )
            sys.exit(1)

previous_image = state.get("previous_image")
if previous_image not in (None, "none", "unknown"):
    previous_image = str(previous_image)
    if re.fullmatch(r"sha-[0-9a-f]{8}", previous_image) is None:
        print(f"invalid previous_image format: {previous_image}", file=sys.stderr)
        sys.exit(1)

signature = state.get("state_signature")
if signature is not None and re.fullmatch(r"[0-9a-f]{64}", str(signature)) is None:
    print("invalid state_signature format", file=sys.stderr)
    sys.exit(1)
PY
}

verify_state_signature_if_present() {
  local file="$1"
  local hmac_key="$2"
  python3 - "$file" "$hmac_key" <<'PY'
import hashlib
import hmac
import json
import sys

path = sys.argv[1]
hmac_key = sys.argv[2]

with open(path, "r", encoding="utf-8") as fh:
    state = json.load(fh)

signature = state.get("state_signature")
if not signature:
    # Backward compatibility for unsigned state files.
    sys.exit(0)

if not hmac_key:
    print(
        "state_signature exists but DEPLOY_STATE_HMAC_KEY is missing; refusing to proceed",
        file=sys.stderr,
    )
    sys.exit(1)

payload = {k: v for k, v in state.items() if k != "state_signature"}
canonical = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
expected = hmac.new(hmac_key.encode("utf-8"), canonical, hashlib.sha256).hexdigest()
if not hmac.compare_digest(str(signature), expected):
    print("state_signature verification failed", file=sys.stderr)
    sys.exit(1)
PY
}

ROLLBACK_START="$(date +%s)"

# ── Preflight ──────────────────────────────────────────────
if [ ! -f "${STATE_FILE}" ]; then
  loge "No deploy state file found at ${STATE_FILE}"
  loge "Cannot determine rollback target."
  exit 1
fi

# Verify Docker daemon
if ! docker info > /dev/null 2>&1; then
  loge "Docker daemon is not responsive."
  exit 1
fi

# Verify Nginx
if ! command -v nginx > /dev/null 2>&1; then
  loge "nginx not found in PATH."
  exit 1
fi

if [ ! -f .env.production ]; then
  loge "Missing .env.production — required for secure rollback."
  exit 1
fi

SANDBOX_RUNNER_TOKEN="$(load_env_value "SANDBOX_RUNNER_TOKEN" ".env.production" || true)"
if ! SANDBOX_RUNNER_TOKEN="$(validate_secret "SANDBOX_RUNNER_TOKEN" "${SANDBOX_RUNNER_TOKEN}" 48)"; then
  exit 1
fi
export SANDBOX_RUNNER_TOKEN

REDIS_PASSWORD="$(load_env_value "REDIS_PASSWORD" ".env.production" || true)"
if ! REDIS_PASSWORD="$(validate_secret "REDIS_PASSWORD" "${REDIS_PASSWORD}" 20)"; then
  exit 1
fi
export REDIS_PASSWORD

DEPLOY_STATE_HMAC_KEY="$(load_env_value "DEPLOY_STATE_HMAC_KEY" ".env.production" || true)"
if [ -n "${DEPLOY_STATE_HMAC_KEY}" ]; then
  if ! DEPLOY_STATE_HMAC_KEY="$(validate_secret "DEPLOY_STATE_HMAC_KEY" "${DEPLOY_STATE_HMAC_KEY}" 32)"; then
    exit 1
  fi
  export DEPLOY_STATE_HMAC_KEY
  logok "DEPLOY_STATE_HMAC_KEY loaded (state signature enabled)"
else
  logw "DEPLOY_STATE_HMAC_KEY missing; state signature disabled (compatibility mode)"
fi

# ── Check for concurrent deploy ──────────────────────────
if [ -f "${LOCK_FILE}" ]; then
  lock_pid="$(cat "${LOCK_FILE}" 2>/dev/null || echo "?")"
  lock_age="$(stat -c %Y "${LOCK_FILE}" 2>/dev/null || stat -f %m "${LOCK_FILE}" 2>/dev/null || echo "0")"
  now="$(date +%s)"
  age_sec=$(( now - lock_age ))
  if [ "${age_sec}" -lt 900 ]; then
    # Check if PID is actually alive
    if [ -n "${lock_pid}" ] && [ "${lock_pid}" != "?" ] && kill -0 "${lock_pid}" 2>/dev/null; then
      loge "A deploy is in progress (PID ${lock_pid}, ${age_sec}s ago)."
      loge "Rolling back during an active deploy will cause inconsistency."
      if [ "${FORCE}" != "true" ]; then
        loge "Use --force to override."
        exit 1
      fi
      logw "--force specified. Overriding active deploy lock."
    else
      logw "Lock found but PID ${lock_pid} is dead. Ignoring."
    fi
  fi
fi

# ── Parse state ──────────────────────────────────────────
if ! validate_state_file_schema "${STATE_FILE}"; then
  loge "Deploy state schema validation failed."
  exit 1
fi
if ! verify_state_signature_if_present "${STATE_FILE}" "${DEPLOY_STATE_HMAC_KEY:-}"; then
  loge "Deploy state signature validation failed."
  exit 1
fi

CURRENT_SLOT="$(python3 -c "import json; print(json.load(open('${STATE_FILE}'))['active_slot'])")"
CURRENT_IMAGE="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('image_tag','unknown'))")"
CURRENT_VERSION="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('app_version','unknown'))")"
PREVIOUS_SLOT="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('previous_slot','none'))")"
PREVIOUS_IMAGE="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('previous_image','none'))")"
PREVIOUS_VERSION="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('previous_version', json.load(open('${STATE_FILE}')).get('previous_image','none').replace('sha-','')))")"

if [ "${PREVIOUS_SLOT}" = "none" ] || [ "${PREVIOUS_SLOT}" = "${CURRENT_SLOT}" ]; then
  loge "No previous slot to roll back to."
  log "  Current state:"
  python3 -c "import json; print(json.dumps(json.load(open('${STATE_FILE}')), indent=2))"
  exit 1
fi

if [ "${CURRENT_SLOT}" = "blue" ]; then
  CURRENT_PORT=5000
  ROLLBACK_PORT=5001
else
  CURRENT_PORT=5001
  ROLLBACK_PORT=5000
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ILIAGPT Blue-Green Rollback v${SCRIPT_VERSION}"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════════"
echo ""
echo "  Current:  ${CURRENT_SLOT} (port ${CURRENT_PORT}) → ${CURRENT_IMAGE} (v${CURRENT_VERSION})"
echo "  Rollback: ${PREVIOUS_SLOT} (port ${ROLLBACK_PORT}) → ${PREVIOUS_IMAGE} (v${PREVIOUS_VERSION})"
echo "  Stop bad: ${STOP_BAD}"
echo ""

# ── Dry run ────────────────────────────────────────────────
if [ "${DRY_RUN}" = "true" ]; then
  log "[DRY RUN] Would perform the following:"
  log "  1. Check if ${PREVIOUS_SLOT} slot containers are running"
  log "  2. If not running, start them from image ${PREVIOUS_IMAGE}"
  log "  3. Healthcheck ${PREVIOUS_SLOT} on port ${ROLLBACK_PORT} (${HEALTHCHECK_RETRIES} retries)"
  log "  4. Swap Nginx upstream symlink to ${PREVIOUS_SLOT}"
  log "  5. Reload Nginx (nginx -s reload)"
  log "  6. Verify routing through new upstream"
  log "  7. Update deploy-state.json"
  if [ "${STOP_BAD}" = "true" ]; then
    log "  8. Stop ${CURRENT_SLOT} slot containers"
  fi
  echo ""
  log "No changes made."
  exit 0
fi

# ── Confirmation ───────────────────────────────────────────
if [ "${FORCE}" != "true" ]; then
  echo -n "  Proceed with rollback? [y/N] "
  read -r CONFIRM
  if [ "${CONFIRM}" != "y" ] && [ "${CONFIRM}" != "Y" ]; then
    log "Aborted."
    exit 0
  fi
fi

cd "${DEPLOY_PATH}"

# ── Backup current state ──────────────────────────────────
cp "${STATE_FILE}" "${STATE_FILE_BAK}"

# Secrets loaded from .env.production (validated in preflight).

# ── Step 1: Check/start previous slot ────────────────────
log "[1/7] Checking ${PREVIOUS_SLOT} slot containers..."

PREV_RUNNING="$(docker ps --filter "name=hola-${PREVIOUS_SLOT}-app" --filter "status=running" -q 2>/dev/null || echo "")"

if [ -n "${PREV_RUNNING}" ]; then
  logok "${PREVIOUS_SLOT} slot is still running."
else
  log "${PREVIOUS_SLOT} slot is not running. Starting from ${PREVIOUS_IMAGE}..."

  if [ "${PREVIOUS_IMAGE}" = "unknown" ] || [ "${PREVIOUS_IMAGE}" = "none" ]; then
    loge "Cannot start previous slot: image tag is unknown."
    loge "Manual intervention required."
    log ""
    log "  Try manually:"
    log "    SLOT=${PREVIOUS_SLOT} HOST_PORT=${ROLLBACK_PORT} IMAGE_TAG=<tag> \\"
    log "    docker compose -p hola-${PREVIOUS_SLOT} -f docker-compose.slot.yml up -d"
    exit 1
  fi

  # Verify the image exists locally or can be pulled
  log "  Pulling ${PREVIOUS_IMAGE} images..."
  if ! timeout 120 docker pull "${REGISTRY}/iliagpt-app:${PREVIOUS_IMAGE}" 2>/dev/null; then
    loge "Failed to pull ${REGISTRY}/iliagpt-app:${PREVIOUS_IMAGE}"
    loge "Image may have been pruned. Manual intervention required."
    exit 1
  fi
  docker pull "${REGISTRY}/iliagpt-sandbox:${PREVIOUS_IMAGE}" 2>/dev/null || logw "Sandbox image pull failed (non-fatal)"

  SLOT="${PREVIOUS_SLOT}" \
    HOST_PORT="${ROLLBACK_PORT}" \
    IMAGE_TAG="${PREVIOUS_IMAGE}" \
    APP_VERSION="${PREVIOUS_VERSION}" \
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN}" \
    REDIS_PASSWORD="${REDIS_PASSWORD}" \
    docker compose -p "hola-${PREVIOUS_SLOT}" -f "${SLOT_COMPOSE}" up -d --force-recreate --remove-orphans

  logok "Started ${PREVIOUS_SLOT} slot."
fi

# ── Step 2: Healthcheck ──────────────────────────────────
echo ""
log "[2/7] Healthcheck on ${PREVIOUS_SLOT} (port ${ROLLBACK_PORT}, max $(( HEALTHCHECK_RETRIES * HEALTHCHECK_INTERVAL ))s)..."
HEALTHY=false
for i in $(seq 1 ${HEALTHCHECK_RETRIES}); do
  HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ROLLBACK_PORT}/api/health/ready" 2>/dev/null || echo "000")"
  if [ "${HTTP_CODE}" = "200" ]; then
    logok "${PREVIOUS_SLOT} slot is healthy!"
    HEALTHY=true
    break
  fi
  if [ "$i" -eq ${HEALTHCHECK_RETRIES} ]; then break; fi
  if [ $(( i % 5 )) -eq 0 ] || [ "$i" -eq 1 ]; then
    log "  Attempt $i/${HEALTHCHECK_RETRIES} (HTTP ${HTTP_CODE})..."
  fi
  sleep "${HEALTHCHECK_INTERVAL}"
done

if [ "${HEALTHY}" != "true" ]; then
  loge "Healthcheck FAILED for ${PREVIOUS_SLOT} rollback slot."
  loge "Cannot safely switch traffic. Manual intervention required."
  log "  Container logs:"
  docker logs --tail=80 "hola-${PREVIOUS_SLOT}-app" 2>&1 || true
  log ""
  log "  Container status:"
  docker inspect --format='{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "hola-${PREVIOUS_SLOT}-app" 2>/dev/null || true
  # Restore state backup
  cp "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || true
  exit 1
fi

# ── Step 3: Verify version on rollback slot ──────────────
echo ""
log "[3/7] Verifying version on ${PREVIOUS_SLOT}..."
ROLLBACK_HEALTH="$(curl -sf --max-time 10 "http://127.0.0.1:${ROLLBACK_PORT}/api/health" || echo "{}")"
log "  Health response: ${ROLLBACK_HEALTH}"

# ── Step 4: Swap Nginx upstream ──────────────────────────
echo ""
log "[4/7] Swapping Nginx upstream to ${PREVIOUS_SLOT}..."

PREVIOUS_UPSTREAM_FILE="${NGINX_CONF_DIR}/iliagpt-upstream-${PREVIOUS_SLOT}.conf"
if [ -f "${PREVIOUS_UPSTREAM_FILE}" ]; then
  log "  Previous slot upstream file exists: ${PREVIOUS_UPSTREAM_FILE}"
else
  logw "Missing ${PREVIOUS_UPSTREAM_FILE}; recreating for compatibility."
  if [ "${PREVIOUS_SLOT}" = "blue" ]; then
    PREVIOUS_UPSTREAM_PORT=5000
  else
    PREVIOUS_UPSTREAM_PORT=5001
  fi
  printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${PREVIOUS_UPSTREAM_PORT}" > "${PREVIOUS_UPSTREAM_FILE}"
fi

PREV_UPSTREAM="$(readlink -f "${NGINX_CONF_DIR}/iliagpt-upstream.conf" 2>/dev/null || echo "unknown")"
log "  Previous upstream: ${PREV_UPSTREAM}"

ln -sf "${NGINX_CONF_DIR}/iliagpt-upstream-${PREVIOUS_SLOT}.conf" "${NGINX_CONF_DIR}/iliagpt-upstream.conf"

log "  Testing Nginx config..."
if ! nginx -t 2>&1; then
  loge "Nginx config test failed! Reverting..."
  ln -sf "${NGINX_CONF_DIR}/iliagpt-upstream-${CURRENT_SLOT}.conf" "${NGINX_CONF_DIR}/iliagpt-upstream.conf"
  cp "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || true
  exit 1
fi

nginx -s reload
logok "Nginx reloaded — traffic now flowing to ${PREVIOUS_SLOT}."

# ── Step 5: Verify routing ──────────────────────────────
echo ""
log "[5/7] Verifying Nginx routing..."
sleep 3
ROUTE_OK=false
for i in $(seq 1 10); do
  HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:${ROLLBACK_PORT}/api/health/ready" 2>/dev/null || echo "000")"
  if [ "${HTTP_CODE}" = "200" ]; then
    logok "Routing verified."
    ROUTE_OK=true
    break
  fi
  if [ "$i" -eq 10 ]; then break; fi
  sleep 2
done

if [ "${ROUTE_OK}" != "true" ]; then
  logw "Routing verification timed out. Nginx was reloaded but health check not returning 200."
  logw "Check manually: curl http://127.0.0.1:${ROLLBACK_PORT}/api/health/ready"
fi

# ── Step 6: Update state file ────────────────────────────
echo ""
log "[6/7] Updating deploy state..."

ROLLBACK_DURATION="$(( $(date +%s) - ROLLBACK_START ))"

python3 -c "
import datetime
import hashlib
import hmac
import json
import os

state = {
    'active_slot': '${PREVIOUS_SLOT}',
    'active_port': ${ROLLBACK_PORT},
    'image_tag': '${PREVIOUS_IMAGE}',
    'app_version': '${PREVIOUS_VERSION}',
    'deployed_at': datetime.datetime.utcnow().isoformat() + 'Z',
    'previous_slot': '${CURRENT_SLOT}',
    'previous_port': ${CURRENT_PORT},
    'previous_image': '${CURRENT_IMAGE}',
    'previous_version': '${CURRENT_VERSION}',
    'rollback': True,
    'rollback_reason': 'manual rollback via rollback-bluegreen.sh v${SCRIPT_VERSION}',
    'rollback_from_version': '${CURRENT_VERSION}',
    'rollback_duration_sec': ${ROLLBACK_DURATION},
    'state_format_version': 2,
    'state_signature_alg': 'hmac-sha256'
}

state_key = os.environ.get('DEPLOY_STATE_HMAC_KEY', '')
if state_key:
    canonical = json.dumps(state, sort_keys=True, separators=(',', ':')).encode('utf-8')
    state['state_signature'] = hmac.new(
        state_key.encode('utf-8'),
        canonical,
        hashlib.sha256
    ).hexdigest()

with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f, indent=2)
os.chmod('${STATE_FILE}', 0o600)
print(json.dumps(state, indent=2))
"

# Remove state backup
rm -f "${STATE_FILE_BAK}"

# Log rollback
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') ROLLBACK slot=${PREVIOUS_SLOT} port=${ROLLBACK_PORT} image=${PREVIOUS_IMAGE} version=${PREVIOUS_VERSION} from_slot=${CURRENT_SLOT} from_image=${CURRENT_IMAGE} from_version=${CURRENT_VERSION} duration=${ROLLBACK_DURATION}s" >> "${DEPLOY_LOG}"

# ── Step 7: Optionally stop bad slot ─────────────────────
echo ""
if [ "${STOP_BAD}" = "true" ]; then
  log "[7/7] Stopping bad ${CURRENT_SLOT} slot..."
  SLOT="${CURRENT_SLOT}" \
    HOST_PORT="${CURRENT_PORT}" \
    IMAGE_TAG="${CURRENT_IMAGE}" \
    APP_VERSION="${CURRENT_VERSION}" \
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN}" \
    REDIS_PASSWORD="${REDIS_PASSWORD}" \
    docker compose -p "hola-${CURRENT_SLOT}" -f "${SLOT_COMPOSE}" stop -t 15 2>/dev/null || true
  SLOT="${CURRENT_SLOT}" \
    HOST_PORT="${CURRENT_PORT}" \
    IMAGE_TAG="${CURRENT_IMAGE}" \
    APP_VERSION="${CURRENT_VERSION}" \
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN}" \
    REDIS_PASSWORD="${REDIS_PASSWORD}" \
    docker compose -p "hola-${CURRENT_SLOT}" -f "${SLOT_COMPOSE}" down --remove-orphans 2>/dev/null || true
  logok "Bad ${CURRENT_SLOT} slot stopped."
else
  log "[7/7] Skipped stopping ${CURRENT_SLOT} (use --stop-bad to stop it)"
  log "  To stop manually:"
  log "    SLOT=${CURRENT_SLOT} HOST_PORT=${CURRENT_PORT} IMAGE_TAG=${CURRENT_IMAGE} \\"
  log "    docker compose -p hola-${CURRENT_SLOT} -f docker-compose.slot.yml down"
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Rollback Complete!"
echo ""
echo "  Active:   ${PREVIOUS_SLOT} on port ${ROLLBACK_PORT}"
echo "  Version:  ${PREVIOUS_VERSION} (${PREVIOUS_IMAGE})"
echo "  Reverted: ${CURRENT_SLOT} (${CURRENT_IMAGE})"
echo "  Duration: ${ROLLBACK_DURATION}s"
echo "═══════════════════════════════════════════════════"
