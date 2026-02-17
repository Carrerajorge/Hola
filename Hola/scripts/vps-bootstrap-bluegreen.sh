#!/usr/bin/env bash
set -euo pipefail
IFS=$'\n\t'

# ═══════════════════════════════════════════════════════════
#  ILIAGPT Blue-Green Bootstrap (hardened v2)
#
#  Run ONCE on the VPS to prepare for blue-green deploys.
#  Safe to re-run (idempotent) — will not overwrite existing
#  configs unless --force is passed.
#
#  Usage:
#    bash scripts/vps-bootstrap-bluegreen.sh
#    bash scripts/vps-bootstrap-bluegreen.sh --force
# ═══════════════════════════════════════════════════════════

readonly SCRIPT_VERSION="2.0.1"

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
NGINX_CONF_DIR="/etc/nginx/conf.d"
STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
FORCE=false

for arg in "$@"; do
  case "${arg}" in
    --force) FORCE=true ;;
    --help|-h)
      echo "Usage: $0 [--force]"
      echo "  --force    Overwrite existing configs"
      exit 0
      ;;
  esac
done

log()  { echo "[$(date '+%H:%M:%S')] $*"; }
logok(){ echo "[$(date '+%H:%M:%S')]   ✓ $*"; }
logw() { echo "[$(date '+%H:%M:%S')]   ⚠ $*"; }
loge() { echo "[$(date '+%H:%M:%S')]   ✗ $*" >&2; }

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ILIAGPT Blue-Green Bootstrap v${SCRIPT_VERSION}"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════════"
echo ""

# ── Preflight ──────────────────────────────────────────────
log "[0/6] Preflight checks..."

if ! command -v nginx > /dev/null 2>&1; then
  loge "nginx not found. Install nginx first."
  exit 1
fi
logok "nginx available"

if ! command -v docker > /dev/null 2>&1; then
  loge "docker not found. Install Docker first."
  exit 1
fi
logok "docker available"

if ! command -v python3 > /dev/null 2>&1; then
  loge "python3 not found. Install Python 3 first."
  exit 1
fi
logok "python3 available"

if [ ! -d "${DEPLOY_PATH}" ]; then
  log "Creating deploy path: ${DEPLOY_PATH}"
  mkdir -p "${DEPLOY_PATH}"
fi
logok "Deploy path exists: ${DEPLOY_PATH}"

if [ ! -d "${NGINX_CONF_DIR}" ]; then
  loge "Nginx conf.d directory not found: ${NGINX_CONF_DIR}"
  exit 1
fi
logok "Nginx conf.d exists"
echo ""

# ── 1. Create Nginx upstream config ───────────────────────
log "[1/6] Creating Nginx upstream config..."

UPSTREAM_CONF="${NGINX_CONF_DIR}/iliagpt-upstream.conf"

# Remove legacy per-slot files that cause "duplicate upstream" errors
# Keep only the canonical /etc/nginx/conf.d/iliagpt-upstream.conf.
for legacy in "${NGINX_CONF_DIR}/iliagpt-upstream-"*.conf; do
  [ "${legacy}" = "${NGINX_CONF_DIR}/iliagpt-upstream-*.conf" ] && continue
  if [ -f "${legacy}" ] || [ -L "${legacy}" ]; then
    logw "Removing legacy upstream file: ${legacy}"
    rm -f "${legacy}"
  fi
done

# Remove symlink if it exists (migrate to direct file)
if [ -L "${UPSTREAM_CONF}" ]; then
  logw "Removing legacy symlink: ${UPSTREAM_CONF}"
  rm -f "${UPSTREAM_CONF}"
fi

# Create single upstream file (blue=5000 is default starting point)
if [ -f "${UPSTREAM_CONF}" ] && [ "${FORCE}" != "true" ]; then
  logw "${UPSTREAM_CONF} already exists (use --force to overwrite)"
else
  printf 'upstream iliagpt {\n    server 127.0.0.1:5000;\n    keepalive 32;\n    keepalive_timeout 60s;\n    keepalive_requests 1000;\n}\n' > "${UPSTREAM_CONF}"
  logok "Created: ${UPSTREAM_CONF} (default port 5000)"
fi
echo ""

# ── 2. Verify upstream config ─────────────────────────────
log "[2/6] Verifying upstream config..."
if [ -f "${UPSTREAM_CONF}" ]; then
  logok "Upstream config exists: ${UPSTREAM_CONF}"
else
  loge "Failed to create upstream config"
  exit 1
fi
echo ""

# ── 3. Create Docker network ─────────────────────────────
log "[3/6] Creating shared Docker network..."
if docker network inspect hola-net > /dev/null 2>&1; then
  logok "Network hola-net already exists."
else
  docker network create \
    --driver bridge \
    --opt com.docker.network.bridge.name=br-hola \
    hola-net
  logok "Created network: hola-net"
fi
echo ""

# ── 4. Create deploy directories ─────────────────────────
log "[4/6] Creating deploy directories..."
mkdir -p "${DEPLOY_PATH}/scripts"
mkdir -p "${DEPLOY_PATH}/backups"
logok "Directories ready: scripts/, backups/"
echo ""

# ── 5. Create initial state file ─────────────────────────
log "[5/6] Creating deploy state file..."
if [ -f "${STATE_FILE}" ] && [ "${FORCE}" != "true" ]; then
  logw "State file already exists (use --force to overwrite):"
  python3 -c "import json; print('  ' + json.dumps(json.load(open('${STATE_FILE}')), indent=2).replace(chr(10), chr(10) + '  '))"
else
  python3 -c "
import json, datetime
state = {
    'active_slot': 'blue',
    'active_port': 5000,
    'image_tag': 'bootstrap',
    'app_version': 'pre-bluegreen',
    'deployed_at': datetime.datetime.utcnow().isoformat() + 'Z',
    'previous_slot': 'none',
    'previous_image': 'none',
    'previous_version': 'none',
    'deploy_script_version': '${SCRIPT_VERSION}',
    'deploy_duration_sec': 0
}
with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f, indent=2)
print('  ' + json.dumps(state, indent=2).replace(chr(10), chr(10) + '  '))
"
  logok "State file created: ${STATE_FILE}"
fi
echo ""

# ── 6. Test Nginx config ─────────────────────────────────
log "[6/6] Testing Nginx config..."
if nginx -t 2>&1; then
  logok "Nginx config is valid."
else
  echo ""
  logw "Nginx config test failed."
  logw "This is expected if nginx.conf still uses 'proxy_pass http://127.0.0.1:5000;'"
  logw "Update it to use 'proxy_pass http://iliagpt;' and re-test."
fi

echo ""
echo "═══════════════════════════════════════════════════"
echo "  ✓ Bootstrap complete."
echo ""
echo "  Checklist:"
echo "  [ ] 1. Update nginx.conf: proxy_pass http://127.0.0.1:5000 → proxy_pass http://iliagpt"
echo "  [ ] 2. nginx -t && nginx -s reload"
echo "  [ ] 3. Log into GHCR on VPS:"
echo "         echo \$GHCR_TOKEN | docker login ghcr.io -u carrerajorge --password-stdin"
echo "  [ ] 4. Copy .env.production to ${DEPLOY_PATH}/"
echo "  [ ] 5. Start infra stack:"
echo "         docker compose -p hola-infra -f docker-compose.infra.yml up -d"
echo "  [ ] 6. Migrate current app to blue slot:"
echo "         SLOT=blue HOST_PORT=5000 IMAGE_TAG=latest docker compose -p hola-blue -f docker-compose.slot.yml up -d"
echo "  [ ] 7. Stop old compose stack:"
echo "         docker compose -p hola -f docker-compose.prod.yml down"
echo "  [ ] 8. Trigger first blue-green deploy from GitHub Actions"
echo "═══════════════════════════════════════════════════"
