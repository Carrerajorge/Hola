#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════
#  ILIAGPT Health Dashboard
#
#  Quick overview of all services, deploy state, resources,
#  and recent deploy history. Run on VPS.
#
#  Usage:
#    bash scripts/health-dashboard.sh
#    bash scripts/health-dashboard.sh --json   # Machine-readable output
# ═══════════════════════════════════════════════════════════

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
DEPLOY_LOG="${DEPLOY_PATH}/deploy.log"
NGINX_CONF_DIR="/etc/nginx/conf.d"

JSON_MODE=false
[ "${1:-}" = "--json" ] && JSON_MODE=true

# ── Colors ────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[0;32m'
  RED='\033[0;31m'
  YELLOW='\033[0;33m'
  CYAN='\033[0;36m'
  BOLD='\033[1m'
  NC='\033[0m'
else
  GREEN='' RED='' YELLOW='' CYAN='' BOLD='' NC=''
fi

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }

# ── Deploy State ──────────────────────────────────────────
echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo -e "${BOLD}  ILIAGPT Health Dashboard${NC}"
echo -e "${BOLD}  $(date '+%Y-%m-%d %H:%M:%S %Z')${NC}"
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
echo ""

echo -e "${CYAN}── Deploy State ────────────────────────────────────${NC}"
if [ -f "${STATE_FILE}" ]; then
  ACTIVE_SLOT="$(python3 -c "import json; print(json.load(open('${STATE_FILE}'))['active_slot'])" 2>/dev/null || echo "?")"
  ACTIVE_PORT="$(python3 -c "import json; print(json.load(open('${STATE_FILE}'))['active_port'])" 2>/dev/null || echo "?")"
  IMAGE_TAG="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('image_tag','?'))" 2>/dev/null || echo "?")"
  APP_VERSION="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('app_version','?'))" 2>/dev/null || echo "?")"
  DEPLOYED_AT="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('deployed_at','?'))" 2>/dev/null || echo "?")"
  IS_ROLLBACK="$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('rollback', False))" 2>/dev/null || echo "False")"

  echo "  Active slot:  ${ACTIVE_SLOT} (port ${ACTIVE_PORT})"
  echo "  Image:        ${IMAGE_TAG}"
  echo "  Version:      ${APP_VERSION}"
  echo "  Deployed at:  ${DEPLOYED_AT}"
  if [ "${IS_ROLLBACK}" = "True" ]; then
    warn "This is a ROLLBACK deployment"
  fi
else
  fail "No deploy state file found"
fi
echo ""

# ── Nginx ─────────────────────────────────────────────────
echo -e "${CYAN}── Nginx ───────────────────────────────────────────${NC}"
UPSTREAM_TARGET="$(readlink -f "${NGINX_CONF_DIR}/iliagpt-upstream.conf" 2>/dev/null || echo "none")"
echo "  Upstream symlink: ${UPSTREAM_TARGET}"

if nginx -t 2>/dev/null; then
  ok "Nginx config valid"
else
  fail "Nginx config INVALID"
fi

if pgrep -x nginx > /dev/null 2>&1; then
  ok "Nginx process running"
else
  fail "Nginx process NOT running"
fi
echo ""

# ── Containers ────────────────────────────────────────────
echo -e "${CYAN}── Containers ──────────────────────────────────────${NC}"

check_container() {
  local name="$1"
  local status health
  status="$(docker inspect --format='{{.State.Status}}' "${name}" 2>/dev/null || echo "missing")"
  health="$(docker inspect --format='{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}' "${name}" 2>/dev/null || echo "?")"
  local mem_usage
  mem_usage="$(docker stats --no-stream --format '{{.MemUsage}}' "${name}" 2>/dev/null || echo "?")"

  if [ "${status}" = "running" ] && [ "${health}" = "healthy" ]; then
    ok "${name}: ${status} (${health}) — ${mem_usage}"
  elif [ "${status}" = "running" ]; then
    warn "${name}: ${status} (${health}) — ${mem_usage}"
  elif [ "${status}" = "missing" ]; then
    fail "${name}: not found"
  else
    fail "${name}: ${status}"
  fi
}

# Infrastructure
echo "  Infrastructure:"
check_container "hola-postgres"
check_container "hola-redis"
check_container "hola-ocr"

# Active slot
echo ""
echo "  Active slot (${ACTIVE_SLOT:-?}):"
check_container "hola-${ACTIVE_SLOT:-blue}-app"
check_container "hola-${ACTIVE_SLOT:-blue}-worker"
check_container "hola-${ACTIVE_SLOT:-blue}-sandbox"

# Inactive slot (may or may not exist)
OTHER_SLOT="$([ "${ACTIVE_SLOT:-blue}" = "blue" ] && echo "green" || echo "blue")"
OTHER_STATUS="$(docker inspect --format='{{.State.Status}}' "hola-${OTHER_SLOT}-app" 2>/dev/null || echo "missing")"
if [ "${OTHER_STATUS}" != "missing" ]; then
  echo ""
  echo "  Inactive slot (${OTHER_SLOT}):"
  check_container "hola-${OTHER_SLOT}-app"
  check_container "hola-${OTHER_SLOT}-worker"
  check_container "hola-${OTHER_SLOT}-sandbox"
fi
echo ""

# ── Health Endpoints ──────────────────────────────────────
echo -e "${CYAN}── Health Endpoints ────────────────────────────────${NC}"
for port in 5000 5001; do
  CODE="$(curl -sf -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${port}/api/health/ready" 2>/dev/null || echo "000")"
  if [ "${CODE}" = "200" ]; then
    HEALTH_JSON="$(curl -sf --max-time 5 "http://127.0.0.1:${port}/api/health" 2>/dev/null || echo "{}")"
    VERSION="$(echo "${HEALTH_JSON}" | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','?'))" 2>/dev/null || echo "?")"
    ok "Port ${port}: HTTP ${CODE} (v${VERSION})"
  elif [ "${CODE}" = "000" ]; then
    echo "  · Port ${port}: not responding"
  else
    fail "Port ${port}: HTTP ${CODE}"
  fi
done
echo ""

# ── Disk & Resources ─────────────────────────────────────
echo -e "${CYAN}── System Resources ────────────────────────────────${NC}"
DISK_AVAIL="$(df -h "${DEPLOY_PATH}" | awk 'NR==2 {print $4}')"
DISK_USE_PCT="$(df -h "${DEPLOY_PATH}" | awk 'NR==2 {print $5}')"
DISK_USE_NUM="${DISK_USE_PCT%%%}"
if [ "${DISK_USE_NUM}" -gt 90 ]; then
  fail "Disk: ${DISK_AVAIL} free (${DISK_USE_PCT} used) — CRITICAL"
elif [ "${DISK_USE_NUM}" -gt 80 ]; then
  warn "Disk: ${DISK_AVAIL} free (${DISK_USE_PCT} used)"
else
  ok "Disk: ${DISK_AVAIL} free (${DISK_USE_PCT} used)"
fi

MEM_AVAIL="$(free -h 2>/dev/null | awk '/Mem:/ {print $7}' || echo "?")"
MEM_TOTAL="$(free -h 2>/dev/null | awk '/Mem:/ {print $2}' || echo "?")"
echo "  Memory: ${MEM_AVAIL} available / ${MEM_TOTAL} total"

LOAD="$(cat /proc/loadavg 2>/dev/null | awk '{print $1, $2, $3}' || echo "?")"
echo "  Load avg: ${LOAD}"

DOCKER_DF="$(docker system df --format 'Images: {{.Size}} | Containers: {{.Active}} | Volumes: {{.TotalCount}}' 2>/dev/null || echo "?")"
echo "  Docker: ${DOCKER_DF}"
echo ""

# ── Deploy Lock ───────────────────────────────────────────
echo -e "${CYAN}── Deploy Lock ─────────────────────────────────────${NC}"
if [ -f "${DEPLOY_PATH}/.deploy.lock" ]; then
  LOCK_PID="$(cat "${DEPLOY_PATH}/.deploy.lock" 2>/dev/null || echo "?")"
  LOCK_AGE="$(stat -c %Y "${DEPLOY_PATH}/.deploy.lock" 2>/dev/null || echo "0")"
  NOW="$(date +%s)"
  AGE="$(( NOW - LOCK_AGE ))"
  if kill -0 "${LOCK_PID}" 2>/dev/null; then
    warn "Deploy lock active (PID ${LOCK_PID}, ${AGE}s ago)"
  else
    warn "Stale deploy lock (PID ${LOCK_PID} dead, ${AGE}s ago)"
  fi
else
  ok "No deploy lock"
fi
echo ""

# ── Recent Deploys ────────────────────────────────────────
echo -e "${CYAN}── Recent Deploys (last 10) ─────────────────────────${NC}"
if [ -f "${DEPLOY_LOG}" ]; then
  tail -n 10 "${DEPLOY_LOG}" | while IFS= read -r line; do
    if echo "${line}" | grep -q "FAILED"; then
      echo -e "  ${RED}${line}${NC}"
    elif echo "${line}" | grep -q "ROLLBACK"; then
      echo -e "  ${YELLOW}${line}${NC}"
    else
      echo "  ${line}"
    fi
  done
else
  echo "  No deploy log found"
fi

echo ""
echo -e "${BOLD}═══════════════════════════════════════════════════${NC}"
