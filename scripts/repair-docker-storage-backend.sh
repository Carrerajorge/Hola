#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# Repairs Docker hosts that still use the containerd snapshotter-backed
# overlayfs storage path. Production deploys in this repo expect overlay2.

readonly SCRIPT_VERSION="1.0.0"

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
readonly DAEMON_JSON="/etc/docker/daemon.json"

CHECK_ONLY=false
FORCE=false
SKIP_INFRA_RESTORE=false

for arg in "$@"; do
  case "${arg}" in
    --check)
      CHECK_ONLY=true
      ;;
    --force)
      FORCE=true
      ;;
    --skip-infra-restore)
      SKIP_INFRA_RESTORE=true
      ;;
    --help|-h)
      cat <<'EOF'
Usage: bash scripts/repair-docker-storage-backend.sh [options]

Options:
  --check               Report the current backend and exit.
  --force               Allow disruptive backend migration even if slot
                        containers are running.
  --skip-infra-restore  Do not restart docker-compose.infra.yml after repair.
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: ${arg}" >&2
      exit 1
      ;;
  esac
done

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
logok(){ echo "[$(date '+%H:%M:%S')]   ✓ $*"; }
logw() { echo "[$(date '+%H:%M:%S')]   ⚠ $*"; }
loge() { echo "[$(date '+%H:%M:%S')]   ✗ $*" >&2; }

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    loge "This script must run as root."
    exit 1
  fi
}

require_tools() {
  local tool
  for tool in docker python3 systemctl; do
    if ! command -v "${tool}" >/dev/null 2>&1; then
      loge "Missing required command: ${tool}"
      exit 1
    fi
  done
}

docker_driver() {
  docker info --format '{{.Driver}}' 2>/dev/null || echo ""
}

docker_driver_type() {
  docker info --format '{{json .DriverStatus}}' 2>/dev/null | python3 -c '
import json
import sys

raw = sys.stdin.read().strip()
if not raw:
    print("")
    raise SystemExit(0)

try:
    status = json.loads(raw)
except Exception:
    print("")
    raise SystemExit(0)

value = ""
for item in status or []:
    if isinstance(item, list) and len(item) >= 2 and str(item[0]) == "driver-type":
        value = str(item[1])
        break
print(value)
'
}

docker_backend_summary() {
  local driver driver_type
  driver="$(docker_driver)"
  driver_type="$(docker_driver_type)"
  if [ -n "${driver_type}" ]; then
    echo "driver=${driver:-unknown}, driver-type=${driver_type}"
  else
    echo "driver=${driver:-unknown}"
  fi
}

backend_is_supported() {
  [ "$(docker_driver)" = "overlay2" ]
}

running_slot_container_count() {
  docker ps --format '{{.Names}}' 2>/dev/null | \
    grep -E '^hola-(blue|green)-(app|worker|sandbox)$' | \
    wc -l | tr -d ' '
}

wait_for_docker() {
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

backup_daemon_json() {
  if [ ! -f "${DAEMON_JSON}" ]; then
    return 0
  fi

  local backup_path
  backup_path="${DAEMON_JSON}.bak.$(date +%Y%m%d%H%M%S)"
  cp "${DAEMON_JSON}" "${backup_path}"
  logok "Backed up Docker daemon config to ${backup_path}"
}

write_overlay2_daemon_config() {
  python3 - "${DAEMON_JSON}" <<'PY'
import json
import os
import sys

path = sys.argv[1]
data = {}

if os.path.exists(path):
    with open(path, "r", encoding="utf-8") as fh:
        raw = fh.read().strip()
    if raw:
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise SystemExit(f"{path} must contain a JSON object")
        data = parsed

features = data.get("features")
if features is None:
    features = {}
elif not isinstance(features, dict):
    raise SystemExit("'features' in daemon.json must be an object when present")

features["containerd-snapshotter"] = False
data["features"] = features
data["storage-driver"] = "overlay2"

with open(path, "w", encoding="utf-8") as fh:
    json.dump(data, fh, indent=2, sort_keys=True)
    fh.write("\n")
PY
}

restore_infra_stack() {
  local compose_file
  compose_file="${DEPLOY_PATH}/docker-compose.infra.yml"

  if [ "${SKIP_INFRA_RESTORE}" = "true" ]; then
    logw "Skipping infra restore by request."
    return 0
  fi

  if [ ! -f "${compose_file}" ]; then
    logw "Infra compose file not found at ${compose_file}; skipping infra restore."
    return 0
  fi

  log "Restoring infra stack on overlay2 backend..."
  (
    cd "${DEPLOY_PATH}"
    docker compose -f docker-compose.infra.yml up -d
  )
  logok "Infra stack restored."
}

require_root
require_tools

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ILIAGPT Docker Backend Repair v${SCRIPT_VERSION}"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "  DEPLOY_PATH: ${DEPLOY_PATH}"
echo "═══════════════════════════════════════════════════"
echo ""

if ! docker info >/dev/null 2>&1; then
  loge "Docker daemon is not responsive."
  exit 1
fi

CURRENT_SUMMARY="$(docker_backend_summary)"
log "Current Docker backend: ${CURRENT_SUMMARY}"

if [ "${CHECK_ONLY}" = "true" ]; then
  if backend_is_supported; then
    logok "Docker backend is already supported for production deploys."
    exit 0
  fi

  logw "Docker backend needs repair. Expected driver=overlay2."
  exit 2
fi

if backend_is_supported; then
  logok "Docker backend already uses overlay2. No repair needed."
  exit 0
fi

SLOT_CONTAINER_COUNT="$(running_slot_container_count)"
if [ "${SLOT_CONTAINER_COUNT}" -gt 0 ] && [ "${FORCE}" != "true" ]; then
  loge "Detected ${SLOT_CONTAINER_COUNT} running blue/green slot containers."
  loge "Repair would restart Docker and hide containers from the old backend."
  loge "Retry with --force during a maintenance window."
  exit 1
fi

if [ "${SLOT_CONTAINER_COUNT}" -gt 0 ]; then
  logw "Proceeding with forced backend migration while slot containers are running."
fi

backup_daemon_json
write_overlay2_daemon_config
logok "Pinned Docker daemon config to overlay2 with containerd snapshotter disabled."

log "Restarting Docker daemon..."
systemctl restart docker

if ! wait_for_docker 30 2; then
  loge "Docker daemon did not come back after restart."
  exit 1
fi

UPDATED_SUMMARY="$(docker_backend_summary)"
log "Docker backend after restart: ${UPDATED_SUMMARY}"

if ! backend_is_supported; then
  loge "Docker backend repair did not converge to overlay2."
  exit 1
fi

restore_infra_stack

logok "Docker backend repair complete."
