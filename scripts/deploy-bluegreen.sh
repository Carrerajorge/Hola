#!/usr/bin/env bash
# Blue-Green Deploy Script for ILIAGPT
# This script performs a blue-green deployment to production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
REGISTRY="${REGISTRY:-ghcr.io/carrerajorge}"
IMAGE_TAG="${IMAGE_TAG:-latest}"
APP_VERSION="${APP_VERSION:-}"
BUILD_IMAGE_TAG="${BUILD_IMAGE_TAG:-$IMAGE_TAG}"
EXPECTED_APP_DIGEST="${EXPECTED_APP_DIGEST:-}"
EXPECTED_SANDBOX_DIGEST="${EXPECTED_SANDBOX_DIGEST:-}"
EXPECTED_OCR_DIGEST="${EXPECTED_OCR_DIGEST:-}"
PREDEPLOY_ONLY="${PREDEPLOY_ONLY:-}"

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

# Extract env value from file
extract_env_value() {
    local file="$1"
    local key="$2"
    local line
    line="$(grep -m1 -E "^${key}=" "$file" 2>/dev/null || true)"
    if [ -z "$line" ]; then
        return 1
    fi
    line="${line#*=}"
    line="${line%$'\r'}"
    line="${line%\"}"
    line="${line#\"}"
    line="${line%\'}"
    line="${line#\'}"
    echo "$line"
}

# Build database URL
build_database_url() {
    python3 -c "import sys, urllib.parse; user, password, host, port, dbname = sys.argv[1:]; print(f\"postgresql://{urllib.parse.quote(user, safe='')}:{urllib.parse.quote(password, safe='')}@{host}:{port}/{urllib.parse.quote(dbname, safe='')}\")" \
        "$1" "$2" "$3" "$4" "$5"
}

# Main deploy logic
main() {
    log "Starting blue-green deployment..."
    log "Image: ${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
    log "App version: ${APP_VERSION}"
    log "Deploy path: ${DEPLOY_PATH}"
    
    cd "${DEPLOY_PATH}"
    
    # Read current state
    STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
    if [ ! -f "${STATE_FILE}" ]; then
        error "State file not found: ${STATE_FILE}"
        exit 1
    fi
    
    ACTIVE_SLOT="$(python3 -c "import json; d=json.load(open('${STATE_FILE}')); print(d['active_slot'])")"
    ACTIVE_PORT="$(python3 -c "import json; d=json.load(open('${STATE_FILE}')); print(d['active_port'])")"
    
    # Determine inactive slot
    if [ "${ACTIVE_SLOT}" = "blue" ]; then
        INACTIVE_SLOT="green"
        INACTIVE_PORT="3001"
    else
        INACTIVE_SLOT="blue"
        INACTIVE_PORT="3000"
    fi
    
    log "Active slot: ${ACTIVE_SLOT} (port ${ACTIVE_PORT})"
    log "Target slot: ${INACTIVE_SLOT} (port ${INACTIVE_PORT})"
    
    # Get env vars
    SANDBOX_RUNNER_TOKEN="$(extract_env_value .env.production SANDBOX_RUNNER_TOKEN || true)"
    REDIS_PASSWORD="$(extract_env_value .env.production REDIS_PASSWORD || true)"
    POSTGRES_USER="$(extract_env_value .env.production POSTGRES_USER || true)"
    POSTGRES_PASSWORD="$(extract_env_value .env.production POSTGRES_PASSWORD || true)"
    POSTGRES_DB="$(extract_env_value .env.production POSTGRES_DB || true)"
    POSTGRES_USER="${POSTGRES_USER:-postgres}"
    POSTGRES_DB="${POSTGRES_DB:-iliagpt}"
    DATABASE_URL="$(build_database_url "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" "hola-postgres" "5432" "${POSTGRES_DB}")"
    
    # Pull new images
    log "Pulling images..."
    docker pull "${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
    docker pull "${REGISTRY}/iliagpt-sandbox:${IMAGE_TAG}"
    docker pull "${REGISTRY}/iliagpt-ocr:${IMAGE_TAG}" || true
    
    # Stop any existing containers in the inactive slot
    log "Stopping existing ${INACTIVE_SLOT} containers..."
    docker rm -f "hola-${INACTIVE_SLOT}-app" "hola-${INACTIVE_SLOT}-worker" "hola-${INACTIVE_SLOT}-sandbox" 2>/dev/null || true
    
    # Run migrations on the new image
    log "Running migrations..."
    docker run --rm \
        --network hola-net \
        -e DATABASE_URL="${DATABASE_URL}" \
        -e NODE_ENV=production \
        "${REGISTRY}/iliagpt-app:${IMAGE_TAG}" \
        npm run db:migrate:deploy || true
    
    # Start new containers in inactive slot
    log "Starting ${INACTIVE_SLOT} containers..."
    SLOT="${INACTIVE_SLOT}" \
    HOST_PORT="${INACTIVE_PORT}" \
    IMAGE_TAG="${IMAGE_TAG}" \
    APP_VERSION="${APP_VERSION}" \
    SANDBOX_RUNNER_TOKEN="${SANDBOX_RUNNER_TOKEN}" \
    REDIS_PASSWORD="${REDIS_PASSWORD}" \
    DATABASE_URL="${DATABASE_URL}" \
    POSTGRES_USER="${POSTGRES_USER}" \
    POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
    POSTGRES_DB="${POSTGRES_DB}" \
        docker compose -p "hola-${INACTIVE_SLOT}" -f docker-compose.slot.yml up -d app worker sandbox-runner
    
    # Wait for health check
    log "Waiting for ${INACTIVE_SLOT} slot to become healthy..."
    for i in $(seq 1 30); do
        HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:${INACTIVE_PORT}/api/health/ready" 2>/dev/null || echo "000")"
        if [ "${HTTP_CODE}" = "200" ]; then
            log "Slot ${INACTIVE_SLOT} is healthy (attempt ${i})"
            break
        fi
        if [ "${i}" -eq 30 ]; then
            error "Slot ${INACTIVE_SLOT} failed to become healthy"
            docker logs "hola-${INACTIVE_SLOT}-app" --tail=50 2>&1 || true
            exit 1
        fi
        sleep 2
    done
    
    # Skip the rest if PREDEPLOY_ONLY is set
    if [ -n "${PREDEPLOY_ONLY}" ]; then
        log "PREDEPLOY_ONLY mode - skipping traffic switch"
        success "Pre-deploy completed successfully!"
        exit 0
    fi
    
    # Switch nginx to new slot
    log "Switching traffic to ${INACTIVE_SLOT}..."
    NGINX_CONF="/etc/nginx/conf.d/iliagpt-upstream.conf"
    
    # Update upstream to point to new slot
    cat > "${NGINX_CONF}" << EOF
upstream iliagpt_backend {
    server 127.0.0.1:${INACTIVE_PORT};
    keepalive 32;
}
EOF
    
    # Reload nginx
    docker exec hola-nginx nginx -s reload || nginx -s reload || true
    
    # Update state file
    python3 -c "
import json
with open('${STATE_FILE}', 'r') as f:
    state = json.load(f)
state['active_slot'] = '${INACTIVE_SLOT}'
state['active_port'] = '${INACTIVE_PORT}'
state['image_tag'] = '${IMAGE_TAG}'
state['app_version'] = '${APP_VERSION}'
state['deployed_at'] = '$(date -u +%Y-%m-%dT%H:%M:%SZ)'
with open('${STATE_FILE}', 'w') as f:
    json.dump(state, f, indent=2)
"
    
    # Stop old containers
    log "Stopping old ${ACTIVE_SLOT} containers..."
    sleep 5
    docker rm -f "hola-${ACTIVE_SLOT}-app" "hola-${ACTIVE_SLOT}-worker" "hola-${ACTIVE_SLOT}-sandbox" 2>/dev/null || true
    
    success "Blue-green deployment completed successfully!"
    log "New active slot: ${INACTIVE_SLOT}"
    log "Version: ${APP_VERSION}"
}

# Run main
main "$@"
