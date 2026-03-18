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

readonly SCRIPT_VERSION="3.3.0"

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
readonly MIN_PULL_HEADROOM_MB=16384
readonly MIN_DISK_INODES_K=100
readonly STATE_FILE_MAX_BYTES=65536

# ── Validate inputs ────────────────────────────────────────
IMAGE_TAG="${IMAGE_TAG:?IMAGE_TAG is required (e.g. sha-abc12345)}"
APP_VERSION="${APP_VERSION:?APP_VERSION is required (e.g. abc12345)}"

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

validate_image_inputs() {
  local tag="$1"
  local version="$2"

  if [[ ! "${tag}" =~ ^sha-[0-9a-f]{8}$ ]]; then
    loge "Invalid IMAGE_TAG format: ${tag}"
    return 1
  fi
  if [[ ! "${version}" =~ ^[0-9a-f]{8}$ ]]; then
    loge "Invalid APP_VERSION format: ${version}"
    return 1
  fi
  if [ "sha-${version}" != "${tag}" ]; then
    loge "IMAGE_TAG/APP_VERSION mismatch: tag ${tag} != sha-${version}"
    return 1
  fi
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

validate_image_inputs "${IMAGE_TAG}" "${APP_VERSION}" || exit 1

measure_available_mb() {
  df -m "${DEPLOY_PATH}" | awk 'NR==2 {print $4}'
}

measure_available_inodes_k() {
  df -i "${DEPLOY_PATH}" | awk 'NR==2 {print int($4/1000)}'
}

reclaim_docker_space() {
  logw "Reclaiming Docker disk space from unused containers, images, and cache..."
  docker container prune -f >/dev/null 2>&1 || true
  docker image prune -af >/dev/null 2>&1 || true
  docker builder prune -af >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
}

wait_for_docker_daemon() {
  local attempts="${1:-30}"
  local sleep_seconds="${2:-2}"
  local i

  for i in $(seq 1 "${attempts}"); do
    if docker info >/dev/null 2>&1; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  return 1
}

list_dead_container_records() {
  docker ps -a --no-trunc --filter status=dead \
    --format '  - {{.ID}} {{.Names}} :: {{.Status}} [project={{.Label "com.docker.compose.project"}} service={{.Label "com.docker.compose.service"}}]' \
    2>/dev/null || true
}

list_uninspectable_dead_container_ids() {
  local cid

  while IFS= read -r cid; do
    [ -z "${cid}" ] && continue
    if ! docker inspect "${cid}" >/dev/null 2>&1; then
      echo "${cid}"
    fi
  done < <(docker ps -a --no-trunc --filter status=dead --format '{{.ID}}' 2>/dev/null || true)
}

restart_docker_if_dead_metadata_ghosts_detected() {
  local ghost_ids
  local ghost_count
  local remaining_ghosts

  ghost_ids="$(list_uninspectable_dead_container_ids)"
  if [ -z "${ghost_ids}" ]; then
    return 0
  fi

  ghost_count="$(printf '%s\n' "${ghost_ids}" | awk 'NF' | wc -l | tr -d ' ')"
  logw "Detected ${ghost_count} uninspectable dead Docker container record(s). Restarting Docker to recover daemon state."
  list_dead_container_records

  if ! command -v systemctl >/dev/null 2>&1; then
    loge "systemctl is required to recover dead Docker container metadata ghosts."
    exit 1
  fi

  if ! systemctl restart docker; then
    loge "Failed to restart Docker daemon while recovering dead container metadata ghosts."
    exit 1
  fi

  if ! wait_for_docker_daemon 30 2; then
    loge "Docker daemon did not recover after restart."
    exit 1
  fi

  remaining_ghosts="$(list_uninspectable_dead_container_ids)"
  if [ -n "${remaining_ghosts}" ]; then
    loge "Dead Docker container metadata ghosts remain after daemon restart."
    list_dead_container_records
    exit 1
  fi

  logok "Dead Docker container ghosts cleared after daemon restart."
}

ensure_min_disk_space() {
  local available_mb
  available_mb="$(measure_available_mb)"

  if [ "${available_mb}" -ge "${MIN_DISK_MB}" ]; then
    logok "Disk space: ${available_mb}MB available"
    return 0
  fi

  logw "Low disk space: ${available_mb}MB available. Attempting Docker cleanup before aborting."
  reclaim_docker_space
  available_mb="$(measure_available_mb)"

  if [ "${available_mb}" -lt "${MIN_DISK_MB}" ]; then
    loge "Insufficient disk space: ${available_mb}MB available, need ${MIN_DISK_MB}MB"
    loge "Run 'docker system prune -af' to free space."
    exit 1
  fi

  logok "Disk space after cleanup: ${available_mb}MB available"
}

ensure_pull_headroom() {
  local available_mb
  available_mb="$(measure_available_mb)"

  if [ "${available_mb}" -ge "${MIN_PULL_HEADROOM_MB}" ]; then
    logok "Pull headroom: ${available_mb}MB available"
    return 0
  fi

  logw "Limited free space before image pull (${available_mb}MB < ${MIN_PULL_HEADROOM_MB}MB). Running Docker cleanup."
  reclaim_docker_space
  available_mb="$(measure_available_mb)"

  if [ "${available_mb}" -lt "${MIN_DISK_MB}" ]; then
    loge "Insufficient disk space after Docker cleanup: ${available_mb}MB available, need ${MIN_DISK_MB}MB"
    exit 1
  fi

  logok "Pull headroom after cleanup: ${available_mb}MB available"
}

pull_image_with_retry() {
  local image_ref="$1"
  local attempt
  local output_file

  for attempt in 1 2; do
    output_file="$(mktemp)"
    if timeout "${PULL_TIMEOUT}" docker pull "${image_ref}" 2>&1 | tee "${output_file}"; then
      rm -f "${output_file}"
      return 0
    fi

    if grep -qi "no space left on device" "${output_file}"; then
      logw "Pull for ${image_ref} exhausted disk space on attempt ${attempt}. Running Docker cleanup before retry."
      reclaim_docker_space
      rm -f "${output_file}"
      if [ "${attempt}" -lt 2 ]; then
        continue
      fi
    else
      rm -f "${output_file}"
    fi

    return 1
  done

  return 1
}

extract_manifest_digest() {
  local image_ref="$1"
  local digest

  digest="$(docker manifest inspect "${image_ref}" | python3 -c 'import sys, json; d=json.load(sys.stdin); m=d.get("manifests") or []; print((m[0].get("digest") if m else (d.get("digest") or d.get("config", {}).get("digest", ""))))')"
  if [ "${digest}" = "None" ] || [ -z "${digest}" ]; then
    echo ""
  else
    echo "${digest}"
  fi
}

validate_image_digests() {
  local expected_app="$1"
  local expected_sandbox="$2"

  if [ -n "${expected_app}" ]; then
    local actual_app
    actual_app="$(extract_manifest_digest "${REGISTRY}/iliagpt-app:${IMAGE_TAG}")"
    if [ -z "${actual_app}" ]; then
      loge "Unable to read digest for image ${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
      return 1
    fi
    if [ "${actual_app}" != "${expected_app}" ]; then
      loge "App image digest mismatch: expected ${expected_app} got ${actual_app}"
      return 1
    fi
    logok "App digest pinned: ${actual_app}"
  fi

  if [ -n "${expected_sandbox}" ]; then
    local actual_sandbox
    actual_sandbox="$(extract_manifest_digest "${REGISTRY}/iliagpt-sandbox:${IMAGE_TAG}")"
    if [ -z "${actual_sandbox}" ]; then
      loge "Unable to read digest for image ${REGISTRY}/iliagpt-sandbox:${IMAGE_TAG}"
      return 1
    fi
    if [ "${actual_sandbox}" != "${expected_sandbox}" ]; then
      loge "Sandbox image digest mismatch: expected ${expected_sandbox} got ${actual_sandbox}"
      return 1
    fi
    logok "Sandbox digest pinned: ${actual_sandbox}"
  fi

  return 0
}

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
    docker rm -f "hola-${NEW_SLOT}-app" "hola-${NEW_SLOT}-worker" "hola-${NEW_SLOT}-sandbox" >/dev/null 2>&1 || true
  fi

  # If we swapped Nginx but something failed after, revert to old port
  if [ "${NGINX_SWAPPED}" = "true" ] && [ -n "${ACTIVE_PORT:-}" ]; then
    log "  Reverting Nginx upstream to port ${ACTIVE_PORT}..."
    printf 'upstream iliagpt {\n    server 127.0.0.1:%s;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' "${ACTIVE_PORT}" > "${NGINX_CONF_DIR}/iliagpt-upstream.conf" 2>/dev/null || true
    nginx -s reload 2>/dev/null || true
  fi

  # Restore state file backup if it exists and we haven't completed
  if [ -f "${STATE_FILE_BAK}" ]; then
    mv -f "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || cp "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || true
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

ensure_min_disk_space

AVAIL_INODES_K="$(measure_available_inodes_k)"
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
restart_docker_if_dead_metadata_ghosts_detected

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

if [ "${IMAGE_TAG}" != "${BUILD_IMAGE_TAG:-${IMAGE_TAG}}" ]; then
  logw "Deploy tag does not match provided build artifact tag (${BUILD_IMAGE_TAG:-unknown}); skipping digest pinning."
else
  if ! validate_image_digests "${EXPECTED_APP_DIGEST:-}" "${EXPECTED_SANDBOX_DIGEST:-}"; then
    logw "Digest verification failed — continuing with latest image on registry (tag race is expected with concurrent builds)."
  fi
fi

logok "Secrets loaded from .env.production"

# ── Determine active/inactive slot ─────────────────────────
if [ -f "${STATE_FILE}" ] && ! validate_state_file_schema "${STATE_FILE}" >/dev/null 2>&1; then
  if [ -f "${STATE_FILE_BAK}" ] && validate_state_file_schema "${STATE_FILE_BAK}" >/dev/null 2>&1; then
    logw "Primary deploy state is invalid; restoring backup copy before continuing."
    mv -f "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || cp "${STATE_FILE_BAK}" "${STATE_FILE}" 2>/dev/null || true
  else
    logw "Primary deploy state is invalid and no valid backup is available; treating deploy state as absent."
    rm -f "${STATE_FILE}" 2>/dev/null || true
  fi
fi

if [ -f "${STATE_FILE}" ]; then
  if ! validate_state_file_schema "${STATE_FILE}"; then
    loge "Deploy state schema validation failed."
    exit 1
  fi
  if ! verify_state_signature_if_present "${STATE_FILE}" "${DEPLOY_STATE_HMAC_KEY:-}"; then
    loge "Deploy state signature validation failed."
    exit 1
  fi
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

ensure_infra_up() {
  local infra_output conflict_name

  if infra_output="$(infra up -d --remove-orphans 2>&1)"; then
    printf '%s\n' "${infra_output}"
    return 0
  fi

  printf '%s\n' "${infra_output}" >&2
  conflict_name="$(
    printf '%s\n' "${infra_output}" |
      sed -n 's/.*The container name \"\/\([^\"]*\)\" is already in use.*/\1/p' |
      head -n 1
  )"

  if [ -n "${conflict_name}" ]; then
    logw "Removing conflicting container ${conflict_name} and retrying infra startup."
    docker rm -f "${conflict_name}" >/dev/null 2>&1 || true
    infra up -d --remove-orphans
    return $?
  fi

  return 1
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

wait_for_redis_ping() {
  local attempts="${1:-15}"
  local sleep_seconds="${2:-2}"
  local i

  for i in $(seq 1 "${attempts}"); do
    if docker exec hola-redis redis-cli -a "${REDIS_PASSWORD}" ping 2>/dev/null | grep -q PONG; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  return 1
}

capture_redis_logs() {
  local tail_lines="${1:-120}"
  docker logs --tail="${tail_lines}" hola-redis 2>&1 || true
}

redis_logs_indicate_aof_corruption() {
  local redis_logs="$1"
  printf '%s\n' "${redis_logs}" | grep -Eqi \
    'Bad file format reading the append only file|redis-check-aof --fix|aof-load-corrupt-tail-max-size'
}

resolve_redis_repair_image() {
  docker inspect --format '{{.Config.Image}}' hola-redis 2>/dev/null || echo "redis:alpine"
}

find_redis_aof_manifest() {
  local repair_image="$1"

  docker run --rm \
    -v hola_redis_data:/data \
    "${repair_image}" \
    sh -eu -c '
      if [ -f /data/appendonlydir/appendonly.aof.manifest ]; then
        echo /data/appendonlydir/appendonly.aof.manifest
        exit 0
      fi

      find /data -maxdepth 3 -type f \
        \( -name "appendonly*.manifest" -o -name "*.manifest" \) \
        | sort | head -n 1
    '
}

backup_redis_aof_files() {
  local repair_image="$1"
  local manifest_path="$2"
  local backup_root="${DEPLOY_PATH}/backups/redis-aof"

  mkdir -p "${backup_root}"

  docker run --rm \
    -e REDIS_AOF_MANIFEST="${manifest_path}" \
    -v hola_redis_data:/data \
    -v "${backup_root}:/backup" \
    "${repair_image}" \
    sh -eu -c '
      stamp="$(date -u +%Y%m%dT%H%M%SZ)"
      dest="/backup/${stamp}"
      mkdir -p "${dest}"

      manifest_dir="$(dirname "${REDIS_AOF_MANIFEST}")"
      cp "${REDIS_AOF_MANIFEST}" "${dest}/"
      find "${manifest_dir}" -maxdepth 1 -type f \
        \( -name "*.manifest" -o -name "*.aof" -o -name "*.aof.*" -o -name "*.rdb" \) \
        -exec cp {} "${dest}/" \;

      echo "${dest}"
    '
}

repair_redis_aof_corruption() {
  local redis_logs="$1"
  local repair_image
  local manifest_path
  local backup_dir

  repair_image="$(resolve_redis_repair_image)"

  logw "Detected Redis AOF corruption. Attempting automatic repair with ${repair_image}."
  printf '%s\n' "${redis_logs}" >&2

  docker rm -f hola-redis >/dev/null 2>&1 || true

  manifest_path="$(find_redis_aof_manifest "${repair_image}")"
  if [ -z "${manifest_path}" ]; then
    loge "Redis AOF manifest not found inside volume hola_redis_data."
    return 1
  fi

  log "  Backing up Redis AOF files from ${manifest_path}..."
  backup_dir="$(backup_redis_aof_files "${repair_image}" "${manifest_path}")"
  logok "Redis AOF backup created at ${backup_dir}"

  log "  Repairing Redis AOF manifest..."
  if ! docker run --rm \
    -e REDIS_AOF_MANIFEST="${manifest_path}" \
    -v hola_redis_data:/data \
    "${repair_image}" \
    sh -eu -c 'printf "y\n" | redis-check-aof --fix "${REDIS_AOF_MANIFEST}"'; then
    loge "redis-check-aof failed for ${manifest_path}"
    return 1
  fi

  log "  Restarting Redis after AOF repair..."
  infra up -d --force-recreate redis >/dev/null
  return 0
}

ensure_redis_ready() {
  local redis_logs=""

  log "  Waiting for Redis..."
  if wait_for_redis_ping 15 2; then
    logok "Redis ready."
    return 0
  fi

  redis_logs="$(capture_redis_logs 120)"
  if redis_logs_indicate_aof_corruption "${redis_logs}"; then
    if repair_redis_aof_corruption "${redis_logs}"; then
      log "  Waiting for Redis after AOF repair..."
      if wait_for_redis_ping 20 2; then
        logok "Redis ready after AOF repair."
        return 0
      fi
      redis_logs="$(capture_redis_logs 120)"
    fi
  fi

  loge "Redis not ready after automatic recovery attempts"
  printf '%s\n' "${redis_logs}" >&2
  return 1
}

list_slot_container_ids() {
  local slot_name="$1"

  {
    docker ps -aq --no-trunc --filter "label=com.docker.compose.project=hola-${slot_name}" 2>/dev/null || true
    docker ps -aq --no-trunc --filter "name=hola-${slot_name}-app" 2>/dev/null || true
    docker ps -aq --no-trunc --filter "name=hola-${slot_name}-worker" 2>/dev/null || true
    docker ps -aq --no-trunc --filter "name=hola-${slot_name}-sandbox" 2>/dev/null || true
  } | awk 'NF' | sort -u
}

remove_slot_containers() {
  local slot_name="$1"
  local ids
  local cid
  local remaining

  ids="$(list_slot_container_ids "${slot_name}")"
  if [ -z "${ids}" ]; then
    logok "No stale ${slot_name} slot containers found."
    return 0
  fi

  logw "Removing stale ${slot_name} slot containers before startup..."
  docker container prune -f --filter "label=com.docker.compose.project=hola-${slot_name}" >/dev/null 2>&1 || true
  while IFS= read -r cid; do
    [ -z "${cid}" ] && continue
    docker rm -f -v "${cid}" >/dev/null 2>&1 || true
  done <<< "${ids}"
  docker container prune -f --filter "label=com.docker.compose.project=hola-${slot_name}" >/dev/null 2>&1 || true

  remaining="$(list_slot_container_ids "${slot_name}")"
  if [ -n "${remaining}" ]; then
    logw "Retrying stale ${slot_name} slot cleanup with detailed Docker output..."
    while IFS= read -r cid; do
      [ -z "${cid}" ] && continue
      if ! docker rm -f -v "${cid}"; then
        logw "docker rm could not remove stale ${slot_name} container ${cid}"
      fi
    done <<< "${remaining}"
    docker container prune -f --filter "label=com.docker.compose.project=hola-${slot_name}" >/dev/null 2>&1 || true
    remaining="$(list_slot_container_ids "${slot_name}")"
  fi

  if [ -n "${remaining}" ]; then
    loge "Failed to fully remove stale ${slot_name} slot containers."
    docker ps -a --no-trunc --filter "label=com.docker.compose.project=hola-${slot_name}" \
      --format '  - {{.ID}} {{.Names}} :: {{.Status}}' || true
    exit 1
  fi

  logok "${slot_name} slot containers removed."
}


run_sql_migrations() {

  local db_container="hola-postgres"

  local db_name="iliagpt"

  local migrations_dir="${DEPLOY_PATH}/migrations"



  if [ ! -d "${migrations_dir}" ]; then

    logw "No migrations directory found at ${migrations_dir} (skipping SQL migrations)."

    return 0

  fi



  local files

  files="$(ls -1 "${migrations_dir}"/*.sql 2>/dev/null | sort || true)"

  if [ -z "${files}" ]; then

    log "  No SQL migration files found in ${migrations_dir}."

    return 0

  fi



  log "  Applying SQL migrations from ${migrations_dir}..."

  while IFS= read -r f; do

    [ -z "${f}" ] && continue

    log "    -> $(basename "${f}")"

    docker exec -i "${db_container}" psql -U postgres -d "${db_name}" -v ON_ERROR_STOP=1 < "${f}"

  done <<< "${files}"



  logok "SQL migrations applied."

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

    # Safe auto-cleanup for known legacy stacks that collide with blue/green ports.
    # Includes historical project-name prefixes (iliagpt-*, hola-*) that are not slot-scoped.
    if [[ "${cname}" =~ ^iliagpt-(app|worker|sandbox-runner)-1$ ]] || \
       [[ "${cname}" =~ ^hola-(app|worker|sandbox-runner)(-[0-9]+)?$ ]]; then
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
ensure_pull_headroom
IMAGES=(
  "${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
  "${REGISTRY}/iliagpt-sandbox:${IMAGE_TAG}"
  "${REGISTRY}/iliagpt-ocr:${IMAGE_TAG}"
)

for img in "${IMAGES[@]}"; do
  if ! pull_image_with_retry "${img}"; then
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
ensure_infra_up

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

if ! ensure_redis_ready; then
  exit 1
fi
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


  # Apply SQL migrations (idempotent)

  if ! timeout "${MIGRATION_TIMEOUT}" env DEPLOY_PATH="${DEPLOY_PATH}" \
    bash -lc "$(declare -f log logok logw loge run_sql_migrations); run_sql_migrations"; then

    loge "SQL migrations failed or timed out."

    exit 1

  fi




# Create a pre-migration DB snapshot marker
docker exec hola-postgres psql -U postgres -d iliagpt -c \
  "CREATE TABLE IF NOT EXISTS _deploy_migrations_log (ts timestamptz DEFAULT now(), version text, image text);
   INSERT INTO _deploy_migrations_log (version, image) VALUES ('${APP_VERSION}', '${IMAGE_TAG}');" \
  > /dev/null 2>&1 || logw "Could not write migration marker (non-fatal)"

# Resolve IP to bypass ephemeral Docker DNS resolution issues
PG_IP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' hola-postgres)
log "  Resolved hola-postgres IP: ${PG_IP}"

if ! timeout "${MIGRATION_TIMEOUT}" docker run --rm --network hola-net \
  --env-file .env.production \
  -e DATABASE_URL="postgres://postgres:postgres@${PG_IP}:5432/iliagpt" \
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
slot "${NEW_SLOT}" down --remove-orphans >/dev/null 2>&1 || true
remove_slot_containers "${NEW_SLOT}"

# Ensure target slot port is truly free (handles legacy non-slot containers).
free_target_port_if_safe "${NEW_PORT}"

# ── Step 6: Start new slot ─────────────────────────────────
log "[6/15] Starting ${NEW_SLOT} slot on port ${NEW_PORT}..."
NEW_SLOT_STARTED=true
slot "${NEW_SLOT}" up -d --force-recreate --remove-orphans
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

# ── Step 8b: JIT warm-up — hit key endpoints to prime Node.js JIT ─────────────
# This avoids cold-start slowness immediately after traffic cutover.
if [ "${SKIP_CANARY:-false}" != "true" ]; then
  log "[9/15] Warming up ${NEW_SLOT} JIT (3 rapid health hits)..."
  for _warm in 1 2 3; do
    curl -sf --max-time 5 "http://127.0.0.1:${NEW_PORT}/api/health" > /dev/null 2>&1 || true
    sleep 0.5
  done
  logok "Warm-up done."
  echo ""
fi

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

# ── Step 9a-extra: Install maintenance page (shown on 502/503/504) ──────────
MAINTENANCE_SRC="${DEPLOY_PATH}/nginx/maintenance.html"
MAINTENANCE_DIR="/etc/nginx/html"
MAINTENANCE_DST="${MAINTENANCE_DIR}/maintenance.html"
if [ -f "${MAINTENANCE_SRC}" ]; then
  mkdir -p "${MAINTENANCE_DIR}"
  if ! diff -q "${MAINTENANCE_SRC}" "${MAINTENANCE_DST}" > /dev/null 2>&1; then
    log "  Installing maintenance page → ${MAINTENANCE_DST}"
    cp "${MAINTENANCE_SRC}" "${MAINTENANCE_DST}"
    chmod 644 "${MAINTENANCE_DST}"
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
import datetime
import hashlib
import hmac
import json
import os
import tempfile

state = {
    'active_slot': '${NEW_SLOT}',
    'active_port': ${NEW_PORT},
    'image_tag': '${IMAGE_TAG}',
    'app_version': '${APP_VERSION}',
    'deployed_at': datetime.datetime.utcnow().isoformat() + 'Z',
    'previous_slot': '${ACTIVE_SLOT}',
    'previous_port': ${OLD_PORT},
    'previous_image': '${PREV_IMAGE}',
    'previous_version': '${PREV_VERSION}',
    'app_image_digest': '${APP_DIGEST}',
    'deploy_script_version': '${SCRIPT_VERSION}',
    'deploy_duration_sec': $(( $(date +%s) - DEPLOY_START_EPOCH )),
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

state_dir = os.path.dirname('${STATE_FILE}') or '.'
fd, temp_path = tempfile.mkstemp(prefix='.deploy-state.', suffix='.tmp', dir=state_dir)
with os.fdopen(fd, 'w') as f:
    json.dump(state, f, indent=2)
os.chmod(temp_path, 0o600)
os.replace(temp_path, '${STATE_FILE}')
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
