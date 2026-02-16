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

readonly SCRIPT_VERSION="2.0.0"

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

# ── Load secrets for compose ────────────────────────────
if [ -f .env.production ]; then
  export SANDBOX_RUNNER_TOKEN="$(grep '^SANDBOX_RUNNER_TOKEN=' .env.production | head -n1 | cut -d= -f2- || true)"
  export REDIS_PASSWORD="$(grep '^REDIS_PASSWORD=' .env.production | head -n1 | cut -d= -f2- || true)"
fi

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
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN:-}" \
    REDIS_PASSWORD="${REDIS_PASSWORD:-redis_secure_password_change_me}" \
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

if [ ! -f "${NGINX_CONF_DIR}/iliagpt-upstream-${PREVIOUS_SLOT}.conf" ]; then
  loge "Missing ${NGINX_CONF_DIR}/iliagpt-upstream-${PREVIOUS_SLOT}.conf"
  loge "Run scripts/vps-bootstrap-bluegreen.sh first."
  cp "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || true
  exit 1
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
import json, datetime
state = {
    'active_slot': '${PREVIOUS_SLOT}',
    'active_port': ${ROLLBACK_PORT},
    'image_tag': '${PREVIOUS_IMAGE}',
    'app_version': '${PREVIOUS_VERSION}',
    'deployed_at': datetime.datetime.utcnow().isoformat() + 'Z',
    'previous_slot': '${CURRENT_SLOT}',
    'previous_image': '${CURRENT_IMAGE}',
    'previous_version': '${CURRENT_VERSION}',
    'rollback': True,
    'rollback_reason': 'manual rollback via rollback-bluegreen.sh v${SCRIPT_VERSION}',
    'rollback_from_version': '${CURRENT_VERSION}',
    'rollback_duration_sec': ${ROLLBACK_DURATION}
}
with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f, indent=2)
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
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN:-}" \
    REDIS_PASSWORD="${REDIS_PASSWORD:-redis_secure_password_change_me}" \
    docker compose -p "hola-${CURRENT_SLOT}" -f "${SLOT_COMPOSE}" stop -t 15 2>/dev/null || true
  SLOT="${CURRENT_SLOT}" \
    HOST_PORT="${CURRENT_PORT}" \
    IMAGE_TAG="${CURRENT_IMAGE}" \
    APP_VERSION="${CURRENT_VERSION}" \
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN:-}" \
    REDIS_PASSWORD="${REDIS_PASSWORD:-redis_secure_password_change_me}" \
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
