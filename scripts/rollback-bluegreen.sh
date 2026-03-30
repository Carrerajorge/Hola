#!/usr/bin/env bash
# Rollback Blue-Green Script for ILIAGPT
# Rolls back to the previous deployment slot

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
NGINX_UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"
STOP_BAD_SLOT="false"

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

reload_nginx() {
    local nginx_container=""

    for candidate in hola-nginx hola-infra-nginx-1; do
        if docker ps --format '{{.Names}}' | grep -qx "${candidate}"; then
            nginx_container="${candidate}"
            break
        fi
    done

    if [ -n "${nginx_container}" ]; then
        docker exec "${nginx_container}" nginx -t
        docker exec "${nginx_container}" nginx -s reload
        return 0
    fi

    if ! command -v nginx >/dev/null 2>&1; then
        error "nginx binary not found and no nginx container is running"
        return 1
    fi

    nginx -t
    if command -v systemctl >/dev/null 2>&1; then
        systemctl reload nginx || nginx -s reload
    else
        nginx -s reload
    fi
}

parse_args() {
    for arg in "$@"; do
        case "${arg}" in
            --stop-bad)
                STOP_BAD_SLOT="true"
                ;;
            --force)
                ;;
            *)
                warn "Ignoring unknown rollback flag: ${arg}"
                ;;
        esac
    done
}

main() {
    parse_args "$@"
    log "Starting rollback..."

    cd "${DEPLOY_PATH}"
    STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
    if [ ! -f "${STATE_FILE}" ]; then
        error "State file not found: ${STATE_FILE}"
        exit 1
    fi

    CURRENT_SLOT="$(python3 -c "import json; d=json.load(open('${STATE_FILE}')); print(d['active_slot'])")"
    if [ "${CURRENT_SLOT}" = "blue" ]; then
        PREVIOUS_SLOT="green"
        PREVIOUS_PORT="3001"
    else
        PREVIOUS_SLOT="blue"
        PREVIOUS_PORT="3000"
    fi

    if ! docker ps --format '{{.Names}}' | grep -qx "hola-${PREVIOUS_SLOT}-app"; then
        error "Previous slot ${PREVIOUS_SLOT} is not running; cannot roll back safely"
        exit 1
    fi

    log "Rolling back traffic to ${PREVIOUS_SLOT} (port ${PREVIOUS_PORT})..."
    cat > "${NGINX_UPSTREAM_CONF}" << EOF
upstream iliagpt_backend {
    server 127.0.0.1:${PREVIOUS_PORT};
    keepalive 32;
}
EOF

    reload_nginx

    python3 -c "
import json
with open('${STATE_FILE}', 'r') as f:
    state = json.load(f)
state['active_slot'] = '${PREVIOUS_SLOT}'
state['active_port'] = '${PREVIOUS_PORT}'
state['rolled_back_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f, indent=2)
"

    if [ "${STOP_BAD_SLOT}" = "true" ]; then
        log "Stopping unhealthy slot ${CURRENT_SLOT}..."
        docker rm -f "hola-${CURRENT_SLOT}-app" "hola-${CURRENT_SLOT}-worker" "hola-${CURRENT_SLOT}-sandbox" 2>/dev/null || true
    fi

    success "Rollback completed successfully!"
    return 0
}

main "$@"
