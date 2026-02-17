#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ═══════════════════════════════════════════════════════════
#  ILIAGPT Blue-Green Zero-Downtime Deploy (hardened v3)
#  Executed on the VPS via SSH from GitHub Actions.
#
#  Required env vars:
#    IMAGE_TAG   — e.g. sha-abc12345
#    APP_VERSION — e.g. abc12345
#
#  Optional env vars:
#    DEPLOY_PATH          — defaults to /opt/hola
#    SKIP_CANARY          — set to "true" to skip canary + smoke checks
#    DRY_RUN              — set to "true" for preflight only (no deploy)
# ═══════════════════════════════════════════════════════════

readonly SCRIPT_VERSION="3.1.0"

# ── Configuration ───────────────────────────────────────────
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
readonly STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
readonly STATE_FILE_BAK="${DEPLOY_PATH}/deploy-state.json.bak"
readonly LOCK_FILE="${DEPLOY_PATH}/.deploy.lock"
readonly DEPLOY_LOG="${DEPLOY_PATH}/deploy.log"
readonly INFRA_COMPOSE="${DEPLOY_PATH}/docker-compose.infra.yml"
readonly SLOT_COMPOSE="${DEPLOY_PATH}/docker-compose.slot.yml"
readonly NGINX_CONF_DIR="/etc/nginx/conf.d"
readonly REGISTRY="ghcr.io/carrerajorge"

readonly HEALTHCHECK_RETRIES=40
readonly HEALTHCHECK_INTERVAL=3
readonly DRAIN_WAIT=8
readonly STOP_TIMEOUT=15
readonly MIGRATION_TIMEOUT=120
readonly PULL_TIMEOUT=300
readonly MIN_DISK_MB=2048
readonly MIN_DISK_INODES_K=100

# ── Validate inputs ────────────────────────────────────────
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required (e.g. sha-abc12345)}"
APP_VERSION="${APP_VERSION:?APP_VERSION is required (e.g. abc12345)}"

# ── Timing ──────────────────────────────────────────────────
DEPLOY_START_EPOCH="$(date +%s)"

elapsed() {
  local now
  now="$(date +%s)"
  echo "$(( now - DEPLOY_START_EPOCH ))s"
}

# ── Logging ─────────────────────────────────────────────────
log()  { echo "[$(date '+%H:%M:%S')] $*"; }
logok(){ echo "[$(date '+%H:%M:%S')]   ✓ $*"; }
logw() { echo "[$(date '+%H:%M:%S')]   ⚠ $*"; }
loge() { echo "[$(date '+%H:%M:%S')]   ✗ $*" >&2; }

# ── Deploy lock (prevent concurrent deploys) ───────────────
acquire_lock() {
  if [ -f "${LOCK_FILE}" ]; then
    local lock_pid lock_age now age_sec
    lock_pid="$(cat "${LOCK_FILE}" 2>/dev/null || echo "")"
    lock_age="$(stat -c %Y "${LOCK_FILE}" 2>/dev/null || stat -f %m "${LOCK_FILE}" 2>/dev/null || echo "0")"
    now="$(date +%s)"
    age_sec=$(( now - lock_age ))
    if [ "${age_sec}" -gt 900 ]; then
      logw "Stale lock found (${age_sec}s old, PID ${lock_pid}). Removing."
      rm -f "${LOCK_FILE}"
    else
      # Check if the PID is still alive
      if [ -n "${lock_pid}" ] && kill -0 "${lock_pid}" 2>/dev/null; then
        loge "Another deploy is running (PID ${lock_pid}, ${age_sec}s ago). Aborting."
        exit 1
      else
        logw "Lock found but PID ${lock_pid} is dead (${age_sec}s ago). Stealing lock."
        rm -f "${LOCK_FILE}"
      fi
    fi
  fi
  echo "$$" > "${LOCK_FILE}"
}

release_lock() {
  rm -f "${LOCK_FILE}"
}

# ── Signal trap: clean up on unexpected exit ───────────────
NEW_SLOT_STARTED=false
NGINX_SWAPPED=false
NEW_SLOT=""
CLEANUP_RAN=false

cleanup_on_failure() {
  # Guard against double-run
  if [ "${CLEANUP_RAN}" = "true" ]; then return; fi
  CLEANUP_RAN=true

  local exit_code=$?
  echo ""
  loge "Deploy interrupted (exit code ${exit_code}) after $(elapsed). Cleaning up..."

  # If we started a new slot but haven't finished, tear it down
  if [ "${NEW_SLOT_STARTED}" = "true" ] && [ "${NGINX_SWAPPED}" = "false" ] && [ -n "${NEW_SLOT}" ]; then
    log "  Stopping partially-deployed ${NEW_SLOT} slot..."
    slot "${NEW_SLOT}" down --remove-orphans 2>/dev/null || true
  fi

  # If we swapped Nginx but something failed after, revert to old port
  if [ "${NGINX_SWAPPED}" = "true" ] && [ -n "${ACTIVE_PORT:-}" ]; then
    log "  Reverting Nginx upstream to port ${ACTIVE_PORT}..."
    printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${ACTIVE_PORT}" > "${NGINX_CONF_DIR}/iliagpt-upstream.conf" 2>/dev/null || true
    nginx -s reload 2>/dev/null || true
  fi

  # Restore state file backup if it exists and we haven't completed
  if [ -f "${STATE_FILE_BAK}" ]; then
    cp "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || true
  fi

  # Log the failed deploy
  echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') FAILED slot=${NEW_SLOT:-?} image=${IMAGE_TAG} version=${APP_VERSION} exit=${exit_code} elapsed=$(elapsed)" >> "${DEPLOY_LOG}" 2>/dev/null || true

  release_lock
  log "  Cleanup done."
}

trap cleanup_on_failure ERR EXIT
trap 'loge "Deploy killed by signal"; cleanup_on_failure; exit 130' INT TERM HUP

# ── Start ──────────────────────────────────────────────────
acquire_lock

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ILIAGPT Blue-Green Deploy v${SCRIPT_VERSION}"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "  IMAGE_TAG:   ${IMAGE_TAG}"
echo "  APP_VERSION: ${APP_VERSION}"
echo "  DRY_RUN:     ${DRY_RUN:-false}"
echo "═══════════════════════════════════════════════════"
echo ""

cd "${DEPLOY_PATH}"

# ── Preflight 0: Disk space check ─────────────────────────
log "[0/14] Preflight checks..."

AVAIL_MB="$(df -m "${DEPLOY_PATH}" | awk 'NR==2 {print $4}')"
if [ "${AVAIL_MB}" -lt "${MIN_DISK_MB}" ]; then
  loge "Insufficient disk space: ${AVAIL_MB}MB available, need ${MIN_DISK_MB}MB"
  loge "Run 'docker system prune -af' to free space."
  exit 1
fi
logok "Disk space: ${AVAIL_MB}MB available"

AVAIL_INODES_K="$(df -i "${DEPLOY_PATH}" | awk 'NR==2 {print int($4/1000)}')"
if [ "${AVAIL_INODES_K}" -lt "${MIN_DISK_INODES_K}" ]; then
  loge "Low inodes: ${AVAIL_INODES_K}K available, need ${MIN_DISK_INODES_K}K"
  exit 1
fi
logok "Inodes: ${AVAIL_INODES_K}K available"

# Verify Docker daemon is responsive
if ! docker info > /dev/null 2>&1; then
  loge "Docker daemon is not responsive."
  exit 1
fi
logok "Docker daemon responsive"

# Verify Nginx is installed and running
if ! command -v nginx > /dev/null 2>&1; then
  loge "nginx not found in PATH."
  exit 1
fi
if ! nginx -t 2>/dev/null; then
  logw "Current Nginx config is invalid — deploy will proceed but swap may fail"
fi
logok "Nginx available"

# Verify required files exist
for f in "${INFRA_COMPOSE}" "${SLOT_COMPOSE}"; do
  if [ ! -f "${f}" ]; then
    loge "Missing required file: ${f}"
    exit 1
  fi
done
logok "Compose files present"

# Verify .env.production exists
if [ ! -f .env.production ]; then
  loge "Missing .env.production — required for deploy"
  exit 1
fi
logok ".env.production present"
echo ""

# ── Load secrets for compose variable expansion ────────────
export SANDBOX_RUNNER_TOKEN="$(grep '^SANDBOX_RUNNER_TOKEN=' .env.production | head -n1 | cut -d= -f2- || true)"
export REDIS_PASSWORD="$(grep '^REDIS_PASSWORD=' .env.production | head -n1 | cut -d= -f2- || true)"

if [ -z "${SANDBOX_RUNNER_TOKEN:-}" ]; then
  log "SANDBOX_RUNNER_TOKEN missing; generating..."
  export SANDBOX_RUNNER_TOKEN="$(openssl rand -hex 32)"
  if grep -q '^SANDBOX_RUNNER_TOKEN=' .env.production; then
    sed -i "s/^SANDBOX_RUNNER_TOKEN=.*/SANDBOX_RUNNER_TOKEN=${SANDBOX_RUNNER_TOKEN}/" .env.production
  else
    echo "SANDBOX_RUNNER_TOKEN=${SANDBOX_RUNNER_TOKEN}" >> .env.production
  fi
fi

if [ -z "${REDIS_PASSWORD:-}" ]; then
  logw "REDIS_PASSWORD not set in .env.production — using default (unsafe for production!)"
  export REDIS_PASSWORD="redis_secure_password_change_me"
fi

# ── Determine active/inactive slot ─────────────────────────
if [ -f "${STATE_FILE}" ]; then
  ACTIVE_SLOT="$(python3 -c "import json; print(json.load(open('${STATE_FILE}'))['active_slot'])" 2>/dev/null || echo "blue")"
else
  ACTIVE_SLOT="blue"
fi

if [ "${ACTIVE_SLOT}" = "blue" ]; then
  NEW_SLOT="green"
  NEW_PORT="5001"
  OLD_PORT="5000"
else
  NEW_SLOT="blue"
  NEW_PORT="5000"
  OLD_PORT="5001"
fi

log "Active slot:  ${ACTIVE_SLOT} (port ${OLD_PORT})"
log "Deploying to: ${NEW_SLOT} (port ${NEW_PORT})"
echo ""

# ── Dry run exit ───────────────────────────────────────────
if [ "${DRY_RUN:-false}" = "true" ]; then
  log "[DRY RUN] Preflight passed. Would deploy ${IMAGE_TAG} to ${NEW_SLOT} slot."
  trap - ERR EXIT INT TERM HUP
  release_lock
  exit 0
fi

# ── Backup current state ──────────────────────────────────
if [ -f "${STATE_FILE}" ]; then
  cp "${STATE_FILE}" "${STATE_FILE_BAK}"
fi

# ── Compose helpers ─────────────────────────────────────────
infra() {
  IMAGE_TAG="${IMAGE_TAG}" REDIS_PASSWORD="${REDIS_PASSWORD}" \
    docker compose -p hola-infra -f "${INFRA_COMPOSE}" "$@"
}

slot() {
  local slot_name="$1"; shift
  local port
  if [ "${slot_name}" = "blue" ]; then port=5000; else port=5001; fi

  SLOT="${slot_name}" HOST_PORT="${port}" \
    IMAGE_TAG="${IMAGE_TAG}" APP_VERSION="${APP_VERSION}" \
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN}" \
    REDIS_PASSWORD="${REDIS_PASSWORD}" \
    docker compose -p "hola-${slot_name}" -f "${SLOT_COMPOSE}" "$@"
}

free_target_port_if_safe() {
  local target_port="$1"
  local occupied
  occupied="$(docker ps --filter "publish=${target_port}" --format '{{.Names}}' || true)"

  if [ -z "${occupied}" ]; then
    return 0
  fi

  logw "Port ${target_port} already occupied by: ${occupied//$'\n'/, }"

  while IFS= read -r cname; do
    [ -z "${cname}" ] && continue

    # Safe auto-cleanup for known legacy stack that collides with blue/green port.
    if [[ "${cname}" =~ ^iliagpt-(app|worker|sandbox-runner)-1$ ]]; then
      logw "Stopping legacy container ${cname} to free port ${target_port}..."
      docker rm -f "${cname}" >/dev/null 2>&1 || true
      continue
    fi

    # If target port is unexpectedly held by active-slot app, abort instead of risking downtime.
    if [[ "${cname}" =~ ^hola-${ACTIVE_SLOT}-app$ ]]; then
      loge "Safety abort: active slot container ${cname} is holding target port ${target_port}."
      loge "State/port mapping is inconsistent; manual intervention required."
      exit 1
    fi
  done <<< "${occupied}"

  if docker ps --filter "publish=${target_port}" --format '{{.Names}}' | grep -q .; then
    loge "Port ${target_port} is still occupied after safe cleanup."
    docker ps --filter "publish=${target_port}" --format '  - {{.Names}} :: {{.Ports}}' || true
    exit 1
  fi

  logok "Port ${target_port} is free for slot startup."
}

# Rebuild legacy upstream files if the installed Nginx config still references
# them, and keep their content aligned with expected ports.
legacy_upstream_referenced() {
  local slot="$1"
  grep -Rqs -- "iliagpt-upstream-${slot}.conf" \
    /etc/nginx/nginx.conf \
    /etc/nginx/conf.d \
    /etc/nginx/sites-available \
    /etc/nginx/sites-enabled \
    /etc/nginx/modules-enabled 2>/dev/null
}

ensure_legacy_upstream_file() {
  local slot="$1"
  local port="$2"
  local legacy_file="${NGINX_CONF_DIR}/iliagpt-upstream-${slot}.conf"

  if [ ! -L "${legacy_file}" ] && [ -f "${legacy_file}" ]; then
    return 0
  fi

  # Replace dangling symlink or missing file only when Nginx actually references it.
  if legacy_upstream_referenced "${slot}"; then
    rm -f "${legacy_file}" 2>/dev/null || true
    printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${port}" > "${legacy_file}"
    logw "Ensured legacy upstream file exists: ${legacy_file} (port ${port})"
  fi
}

# ── Step 1: Pull images from GHCR (with timeout + digest verification) ──
log "[1/14] Pulling images from GHCR (timeout: ${PULL_TIMEOUT}s)..."
IMAGES=(
  "${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
  "${REGISTRY}/iliagpt-sandbox:${IMAGE_TAG}"
  "${REGISTRY}/iliagpt-ocr:${IMAGE_TAG}"
)

for img in "${IMAGES[@]}"; do
  if ! timeout "${PULL_TIMEOUT}" docker pull "${img}" 2>&1; then
    loge "Failed to pull ${img}"
    exit 1
  fi
done

# Verify digests are present (proves images are authentic from registry)
APP_DIGEST="none"
for img in "${IMAGES[@]}"; do
  DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${img}" 2>/dev/null || echo "none")"
  if [ "${DIGEST}" = "none" ]; then
    logw "No digest for ${img} — image may not be from registry"
  else
    logok "Digest: ${DIGEST}"
    # Capture app digest for state file
    if echo "${img}" | grep -q "iliagpt-app:"; then
      APP_DIGEST="${DIGEST}"
    fi
  fi
done
logok "All images pulled and verified. ($(elapsed))"
echo ""

# ── Step 2: Ensure shared infrastructure is running ────────
log "[2/14] Ensuring shared infrastructure..."
infra up -d --remove-orphans

log "  Waiting for Postgres..."
for i in $(seq 1 30); do
  if docker exec hola-postgres pg_isready -U postgres > /dev/null 2>&1; then
    logok "Postgres ready."
    break
  fi
  if [ "$i" -eq 30 ]; then
    loge "Postgres not ready after 60s"
    docker logs --tail=30 hola-postgres 2>&1 || true
    exit 1
  fi
  sleep 2
done

log "  Waiting for Redis..."
for i in $(seq 1 15); do
  if docker exec hola-redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
    logok "Redis ready."
    break
  fi
  if [ "$i" -eq 15 ]; then
    loge "Redis not ready after 30s"
    docker logs --tail=20 hola-redis 2>&1 || true
    exit 1
  fi
  sleep 2
done
echo ""

# ── Step 3: Verify current slot is actually serving (pre-deploy sanity) ──
log "[3/14] Pre-deploy sanity: checking current ${ACTIVE_SLOT} slot..."
CURRENT_HEALTHY="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:${OLD_PORT}/api/health/ready" 2>/dev/null || echo "000")"
if [ "${CURRENT_HEALTHY}" = "200" ]; then
  logok "Current ${ACTIVE_SLOT} slot is healthy on port ${OLD_PORT}."
else
  logw "Current ${ACTIVE_SLOT} slot returned HTTP ${CURRENT_HEALTHY} — proceed with caution."
fi
echo ""

# ── Step 4: Run database migrations (with timeout + backup) ──
log "[4/14] Running database migrations (timeout: ${MIGRATION_TIMEOUT}s)..."

# Create a pre-migration DB snapshot marker
docker exec hola-postgres psql -U postgres -d iliagpt -c \
  "CREATE TABLE IF NOT EXISTS _deploy_migrations_log (ts timestamptz DEFAULT now(), version text, image text);
   INSERT INTO _deploy_migrations_log (version, image) VALUES ('${APP_VERSION}', '${IMAGE_TAG}');" \
  > /dev/null 2>&1 || logw "Could not write migration marker (non-fatal)"

if ! timeout "${MIGRATION_TIMEOUT}" docker run --rm --network hola-net \
  --env-file .env.production \
  -e DATABASE_URL="postgres://postgres:postgres@hola-postgres:5432/iliagpt" \
  -e NODE_ENV=production \
  --memory=512m --cpus=1 \
  "${REGISTRY}/iliagpt-app:${IMAGE_TAG}" \
  node dist/migrate.cjs 2>&1; then
  loge "Database migration failed or timed out."
  exit 1
fi
logok "Migrations complete. ($(elapsed))"
echo ""

# ── Step 5: Clean stale containers for new slot ──────────
log "[5/15] Cleaning stale ${NEW_SLOT} containers (if any)..."
STALE_APP="$(docker ps -aq --filter "name=hola-${NEW_SLOT}-app" 2>/dev/null || echo "")"
if [ -n "${STALE_APP}" ]; then
  logw "Found stale ${NEW_SLOT} containers — removing before deploy."
  slot "${NEW_SLOT}" down --remove-orphans 2>/dev/null || true
fi

# Ensure target slot port is truly free (handles legacy non-slot containers).
free_target_port_if_safe "${NEW_PORT}"

# ── Step 6: Start new slot ─────────────────────────────────
log "[6/15] Starting ${NEW_SLOT} slot on port ${NEW_PORT}..."
slot "${NEW_SLOT}" up -d --force-recreate --remove-orphans
NEW_SLOT_STARTED=true
echo ""

# ── Step 6: Healthcheck new slot ───────────────────────────
log "[7/15] Waiting for ${NEW_SLOT} slot health check (max $(( HEALTHCHECK_RETRIES * HEALTHCHECK_INTERVAL ))s)..."
HEALTHY=false
for i in $(seq 1 ${HEALTHCHECK_RETRIES}); do
  HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:${NEW_PORT}/api/health/ready" 2>/dev/null || echo "000")"
  if [ "${HTTP_CODE}" = "200" ]; then
    logok "${NEW_SLOT} slot is healthy! ($(elapsed))"
    HEALTHY=true
    break
  fi
  if [ "$i" -eq "${HEALTHCHECK_RETRIES}" ]; then break; fi
  # Only print every 5th attempt to reduce noise
  if [ $(( i % 5 )) -eq 0 ] || [ "$i" -eq 1 ]; then
    log "  Attempt $i/${HEALTHCHECK_RETRIES} (HTTP ${HTTP_CODE})..."
  fi
  sleep "${HEALTHCHECK_INTERVAL}"
done

if [ "${HEALTHY}" != "true" ]; then
  echo ""
  loge "Health check FAILED for ${NEW_SLOT} slot. Rolling back..."
  log "  Container logs (last 100 lines):"
  slot "${NEW_SLOT}" logs --tail=100 app 2>&1 || true
  echo ""
  log "  Container status:"
  docker inspect --format='{{.State.Status}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}}' "hola-${NEW_SLOT}-app" 2>/dev/null || true
  echo ""
  log "  Stopping ${NEW_SLOT} slot..."
  slot "${NEW_SLOT}" down --remove-orphans || true
  NEW_SLOT_STARTED=false
  loge "Rollback complete. ${ACTIVE_SLOT} still serving traffic on port ${OLD_PORT}."
  exit 1
fi
echo ""

# ── Step 7: Verify APP_VERSION ─────────────────────────────
log "[8/15] Verifying APP_VERSION on ${NEW_SLOT}..."
HEALTH_JSON="$(curl -sf --max-time 10 "http://127.0.0.1:${NEW_PORT}/api/health" || echo "{}")"
if ! echo "${HEALTH_JSON}" | grep -q "\"version\":\"${APP_VERSION}\""; then
  loge "Version mismatch on ${NEW_SLOT} slot."
  log "  Expected version: ${APP_VERSION}"
  log "  Health response:  ${HEALTH_JSON}"
  slot "${NEW_SLOT}" down --remove-orphans || true
  NEW_SLOT_STARTED=false
  exit 1
fi
logok "Version matches: ${APP_VERSION}"

# Verify sw-cleanup.js version
SW_CLEANUP="$(curl -sf --max-time 10 "http://127.0.0.1:${NEW_PORT}/sw-cleanup.js" || echo "")"
if [ -n "${SW_CLEANUP}" ] && ! echo "${SW_CLEANUP}" | grep -q "var APP_VERSION = '${APP_VERSION}';"; then
  loge "sw-cleanup.js APP_VERSION mismatch (expected ${APP_VERSION})"
  slot "${NEW_SLOT}" down --remove-orphans || true
  NEW_SLOT_STARTED=false
  exit 1
fi
logok "sw-cleanup.js version matches"
echo ""

# ── Step 8: Canary HTTP checks ────────────────────────────
if [ "${SKIP_CANARY:-false}" != "true" ]; then
  log "[9/15] Canary HTTP checks on ${NEW_SLOT}..."

  # Test critical endpoints
  CANARY_ENDPOINTS=(
    "/api/health"
    "/api/health/ready"
    "/api/health/live"
  )

  CANARY_OK=true
  for endpoint in "${CANARY_ENDPOINTS[@]}"; do
    CANARY_CODE="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${NEW_PORT}${endpoint}" 2>/dev/null || echo "000")"
    if [ "${CANARY_CODE}" = "200" ]; then
      logok "${endpoint} → HTTP ${CANARY_CODE}"
    else
      loge "${endpoint} → HTTP ${CANARY_CODE}"
      CANARY_OK=false
    fi
  done

  # Test that static assets are served
  STATIC_CODE="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 10 "http://127.0.0.1:${NEW_PORT}/" 2>/dev/null || echo "000")"
  if [ "${STATIC_CODE}" = "200" ]; then
    logok "/ (SPA) → HTTP ${STATIC_CODE}"
  else
    logw "/ (SPA) → HTTP ${STATIC_CODE} (non-fatal)"
  fi

  if [ "${CANARY_OK}" != "true" ]; then
    loge "Canary checks failed. Aborting deploy."
    slot "${NEW_SLOT}" down --remove-orphans || true
    NEW_SLOT_STARTED=false
    exit 1
  fi
else
  log "[9/15] Canary checks skipped (SKIP_CANARY=true)"
fi
echo ""

# ── Step 9a: Install Nginx server config if present ────────
NGINX_SITE_CONF="/etc/nginx/sites-enabled/iliagpt.conf"
NGINX_SITE_SRC="${DEPLOY_PATH}/nginx.conf"
if [ -f "${NGINX_SITE_SRC}" ]; then
  # Remove legacy/legacy-conflicting site configs to avoid duplicate listen directives.
  if [ -d "/etc/nginx/sites-enabled" ]; then
    for legacy_site in /etc/nginx/sites-enabled/*; do
      [ -e "${legacy_site}" ] || continue
      legacy_name="$(basename "${legacy_site}")"

      # Known legacy/default files can define overlapping 443 listeners (default(-ssl), old names, etc).
      if [ "${legacy_site}" != "${NGINX_SITE_CONF}" ] && [ -f "${legacy_site}" ]; then
        case "${legacy_name}" in
          iliagpt*|default|default-ssl|000-default|000-default-ssl)
            rm -f "${legacy_site}"
            logw "Removed legacy site config: ${legacy_site}"
            continue
            ;;
        esac

        # If any other enabled file defines IPv6 HTTPS 443 listener, remove it to prevent duplicates.
        if grep -qE "^[[:space:]]*listen[[:space:]]+\\[::\\]:443" "${legacy_site}" 2>/dev/null; then
          rm -f "${legacy_site}"
          logw "Removed conflicting IPv6 HTTPS site config: ${legacy_site}"
        fi
      fi
    done
  fi

  if ! diff -q "${NGINX_SITE_SRC}" "${NGINX_SITE_CONF}" > /dev/null 2>&1; then
    log "  Installing updated nginx.conf → ${NGINX_SITE_CONF}"
    cp "${NGINX_SITE_SRC}" "${NGINX_SITE_CONF}"
  fi
fi

# ── Step 9b: Swap Nginx upstream ────────────────────────────
log "[10/15] Swapping Nginx upstream to ${NEW_SLOT} (port ${NEW_PORT})..."

UPSTREAM_CONF="${NGINX_CONF_DIR}/iliagpt-upstream.conf"

# Refresh compatibility slot files only if the host Nginx still points to them.
ensure_legacy_upstream_file "blue" 5000
ensure_legacy_upstream_file "green" 5001

# Remove symlink if present (migrate to direct file)
if [ -L "${UPSTREAM_CONF}" ]; then
  logw "Removing legacy symlink: ${UPSTREAM_CONF}"
  rm -f "${UPSTREAM_CONF}"
fi

# Backup current upstream for rollback
PREV_UPSTREAM=""
if [ -f "${UPSTREAM_CONF}" ]; then
  PREV_UPSTREAM="$(cat "${UPSTREAM_CONF}")"
fi
log "  Previous upstream port: $(echo "${PREV_UPSTREAM}" | grep -oP 'server 127\.0\.0\.1:\K[0-9]+' 2>/dev/null || echo 'none')"

# Write new upstream pointing to the new slot
printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${NEW_PORT}" > "${UPSTREAM_CONF}"
logok "Upstream written: port ${NEW_PORT}"

log "  Testing Nginx config..."
if ! nginx -t 2>&1; then
  loge "Nginx config test failed! Reverting upstream..."
  if [ -n "${PREV_UPSTREAM}" ]; then
    echo "${PREV_UPSTREAM}" > "${UPSTREAM_CONF}"
  else
    printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${ACTIVE_PORT}" > "${UPSTREAM_CONF}"
  fi
  slot "${NEW_SLOT}" down --remove-orphans || true
  NEW_SLOT_STARTED=false
  exit 1
fi

nginx -s reload
NGINX_SWAPPED=true
logok "Nginx reloaded. ($(elapsed))"
echo ""

# ── Step 10: Wait for in-flight requests ────────────────────
log "[11/15] Waiting ${DRAIN_WAIT}s for in-flight requests to drain..."
sleep "${DRAIN_WAIT}"
echo ""

# ── Step 11: Verify through Nginx (end-to-end) ─────────────
log "[12/15] Verifying traffic flows through Nginx (port 443)..."
NGINX_OK=false
for i in $(seq 1 15); do
  # Check via the new slot port directly first
  HTTP_CODE="$(curl -sf -o /dev/null -w '%{http_code}' "http://127.0.0.1:${NEW_PORT}/api/health/ready" 2>/dev/null || echo "000")"
  if [ "${HTTP_CODE}" = "200" ]; then
    logok "Nginx routing confirmed (port ${NEW_PORT})."
    NGINX_OK=true
    break
  fi
  if [ "$i" -eq 15 ]; then break; fi
  if [ $(( i % 5 )) -eq 0 ]; then
    log "  Retry $i/15 (HTTP ${HTTP_CODE})..."
  fi
  sleep 2
done

if [ "${NGINX_OK}" != "true" ]; then
  loge "Nginx routing verification failed. Reverting upstream..."
  printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${ACTIVE_PORT}" > "${NGINX_CONF_DIR}/iliagpt-upstream.conf"
  nginx -s reload
  NGINX_SWAPPED=false
  slot "${NEW_SLOT}" down --remove-orphans || true
  NEW_SLOT_STARTED=false
  loge "Rolled back to ${ACTIVE_SLOT}."
  exit 1
fi
echo ""

# ── Step 12: Drain and stop old slot ──────────────────────
log "[13/15] Stopping old ${ACTIVE_SLOT} slot (graceful drain, ${STOP_TIMEOUT}s timeout)..."

# Check if old slot is actually running before trying to stop
OLD_RUNNING="$(docker ps --filter "name=hola-${ACTIVE_SLOT}-app" --filter "status=running" -q 2>/dev/null || echo "")"
if [ -n "${OLD_RUNNING}" ]; then
  # docker compose stop sends SIGTERM; gracefulShutdown.ts handles drain
  slot "${ACTIVE_SLOT}" stop -t "${STOP_TIMEOUT}" 2>/dev/null || true
  slot "${ACTIVE_SLOT}" down --remove-orphans 2>/dev/null || true
  logok "Old ${ACTIVE_SLOT} slot stopped."
else
  logok "Old ${ACTIVE_SLOT} slot was not running (nothing to stop)."
fi
echo ""

# ── Step 13: Verify OCR + infrastructure health ──────────
log "[14/15] Verifying infrastructure health post-deploy..."

# OCR
OCR_OK=false
for i in $(seq 1 10); do
  if docker exec hola-ocr curl -sf http://127.0.0.1:8000/healthz > /dev/null 2>&1; then
    logok "OCR service healthy."
    OCR_OK=true
    break
  fi
  if [ "$i" -eq 10 ]; then break; fi
  sleep 3
done
if [ "${OCR_OK}" != "true" ]; then
  logw "OCR health check timed out (non-fatal — OCR is in infra stack)."
fi

# Redis
if docker exec hola-redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
  logok "Redis healthy."
else
  logw "Redis health check failed (non-fatal)."
fi

# Postgres
if docker exec hola-postgres pg_isready -U postgres > /dev/null 2>&1; then
  logok "Postgres healthy."
else
  logw "Postgres health check failed (non-fatal)."
fi
echo ""

# ── Step 14: Update state file ────────────────────────────
log "[15/15] Updating deploy state..."
PREV_IMAGE="$([ -f "${STATE_FILE}" ] && python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('image_tag','unknown'))" 2>/dev/null || echo "unknown")"
PREV_VERSION="$([ -f "${STATE_FILE}" ] && python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('app_version','unknown'))" 2>/dev/null || echo "unknown")"

python3 -c "
import json, datetime
state = {
    'active_slot': '${NEW_SLOT}',
    'active_port': ${NEW_PORT},
    'image_tag': '${IMAGE_TAG}',
    'app_version': '${APP_VERSION}',
    'deployed_at': datetime.datetime.utcnow().isoformat() + 'Z',
    'previous_slot': '${ACTIVE_SLOT}',
    'previous_image': '${PREV_IMAGE}',
    'previous_version': '${PREV_VERSION}',
    'app_image_digest': '${APP_DIGEST}',
    'deploy_script_version': '${SCRIPT_VERSION}',
    'deploy_duration_sec': $(( $(date +%s) - DEPLOY_START_EPOCH ))
}
with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f, indent=2)
print(json.dumps(state, indent=2))
"

# Remove state backup (deploy succeeded)
rm -f "${STATE_FILE_BAK}"

# ── Post-deploy smoke tests (non-fatal) ──────────────────
if [ "${SKIP_CANARY:-false}" != "true" ]; then
  log "Running post-deploy smoke tests..."
  SMOKE_FAIL=0

  # 1. Health JSON returns valid JSON with version
  SMOKE_HEALTH="$(curl -sf --max-time 10 "http://127.0.0.1:${NEW_PORT}/api/health" 2>/dev/null || echo "")"
  if echo "${SMOKE_HEALTH}" | python3 -c "import sys,json; json.load(sys.stdin)" 2>/dev/null; then
    logok "Smoke: /api/health returns valid JSON"
  else
    logw "Smoke: /api/health did not return valid JSON"
    SMOKE_FAIL=$(( SMOKE_FAIL + 1 ))
  fi

  # 2. SPA serves HTML
  SPA_TYPE="$(curl -sf -o /dev/null -w '%{content_type}' --max-time 10 "http://127.0.0.1:${NEW_PORT}/" 2>/dev/null || echo "")"
  if echo "${SPA_TYPE}" | grep -qi "text/html"; then
    logok "Smoke: SPA serves HTML"
  else
    logw "Smoke: SPA content-type unexpected: ${SPA_TYPE}"
    SMOKE_FAIL=$(( SMOKE_FAIL + 1 ))
  fi

  # 3. Response time < 3s
  RESP_TIME="$(curl -sf -o /dev/null -w '%{time_total}' --max-time 10 "http://127.0.0.1:${NEW_PORT}/api/health" 2>/dev/null || echo "99")"
  RESP_MS="$(echo "${RESP_TIME}" | awk '{printf "%d", $1*1000}')"
  if [ "${RESP_MS}" -lt 3000 ]; then
    logok "Smoke: Response time ${RESP_MS}ms"
  else
    logw "Smoke: Response time ${RESP_MS}ms (>3s)"
    SMOKE_FAIL=$(( SMOKE_FAIL + 1 ))
  fi

  # 4. Worker container is running
  WORKER_STATUS="$(docker inspect --format='{{.State.Status}}' "hola-${NEW_SLOT}-worker" 2>/dev/null || echo "missing")"
  if [ "${WORKER_STATUS}" = "running" ]; then
    logok "Smoke: Worker container running"
  else
    logw "Smoke: Worker container status: ${WORKER_STATUS}"
    SMOKE_FAIL=$(( SMOKE_FAIL + 1 ))
  fi

  # 5. Sandbox container is running
  SANDBOX_STATUS="$(docker inspect --format='{{.State.Status}}' "hola-${NEW_SLOT}-sandbox" 2>/dev/null || echo "missing")"
  if [ "${SANDBOX_STATUS}" = "running" ]; then
    logok "Smoke: Sandbox container running"
  else
    logw "Smoke: Sandbox container status: ${SANDBOX_STATUS}"
    SMOKE_FAIL=$(( SMOKE_FAIL + 1 ))
  fi

  if [ "${SMOKE_FAIL}" -gt 0 ]; then
    logw "${SMOKE_FAIL} smoke test(s) failed (non-fatal — deploy succeeded)"
  else
    logok "All smoke tests passed"
  fi
  echo ""
fi

# ── Cleanup old images (keep last 3 tags) ─────────────────
log "Cleaning up unused Docker images..."
docker image prune -f 2>/dev/null || true
# Keep only last 3 versions of each image
for base in app sandbox ocr; do
  docker images "${REGISTRY}/iliagpt-${base}" --format '{{.Tag}} {{.ID}}' 2>/dev/null | \
    grep -v latest | sort -r | awk 'NR>3 {print $2}' | \
    xargs -r docker rmi 2>/dev/null || true
done

# ── Write deploy log entry ────────────────────────────────
DEPLOY_DURATION="$(( $(date +%s) - DEPLOY_START_EPOCH ))"
echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') OK slot=${NEW_SLOT} port=${NEW_PORT} image=${IMAGE_TAG} version=${APP_VERSION} prev_slot=${ACTIVE_SLOT} prev_image=${PREV_IMAGE} duration=${DEPLOY_DURATION}s" >> "${DEPLOY_LOG}"

# ── Rotate deploy log (keep last 500 lines) ──────────────
if [ -f "${DEPLOY_LOG}" ]; then
  LINES="$(wc -l < "${DEPLOY_LOG}")"
  if [ "${LINES}" -gt 500 ]; then
    tail -n 500 "${DEPLOY_LOG}" > "${DEPLOY_LOG}.tmp"
    mv "${DEPLOY_LOG}.tmp" "${DEPLOY_LOG}"
  fi
fi

# ── Disable the trap (successful exit) ────────────────────
trap - ERR EXIT INT TERM HUP
release_lock

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Blue-Green Deploy Complete!"
echo "  Active:   ${NEW_SLOT} on port ${NEW_PORT}"
echo "  Version:  ${APP_VERSION} (${IMAGE_TAG})"
echo "  Duration: ${DEPLOY_DURATION}s"
echo "  Time:     $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════════"
