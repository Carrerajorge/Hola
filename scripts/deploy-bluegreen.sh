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
KEEP_PREVIOUS_SLOT="${KEEP_PREVIOUS_SLOT:-true}"
NGINX_UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"

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

apply_nginx_site_config() {
    local source_conf="${DEPLOY_PATH}/nginx.conf"
    local source_maintenance="${DEPLOY_PATH}/nginx/maintenance.html"
    local installed="false"

    if [ ! -f "${source_conf}" ]; then
        warn "nginx.conf not found at ${source_conf}; keeping existing site config"
        return 0
    fi

    for target in \
        /etc/nginx/sites-enabled/iliagpt.conf \
        /etc/nginx/sites-enabled/iliagpt \
        /etc/nginx/sites-available/iliagpt \
        /etc/nginx/conf.d/iliagpt.conf; do
        if [ -e "${target}" ] || [ -L "${target}" ]; then
            cp "${source_conf}" "${target}"
            installed="true"
        fi
    done

    if [ "${installed}" != "true" ]; then
        mkdir -p /etc/nginx/sites-available /etc/nginx/sites-enabled
        cp "${source_conf}" /etc/nginx/sites-available/iliagpt
        ln -sf /etc/nginx/sites-available/iliagpt /etc/nginx/sites-enabled/iliagpt
    fi

    if [ -f "${source_maintenance}" ]; then
        mkdir -p /etc/nginx/html
        cp "${source_maintenance}" /etc/nginx/html/maintenance.html
    fi
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

free_slot_port() {
    local port="$1"
    local containers=()
    local listeners=""

    mapfile -t containers < <(docker ps --filter "publish=${port}" --format '{{.Names}}')
    if [ "${#containers[@]}" -gt 0 ]; then
        warn "Port ${port} is occupied by Docker containers: ${containers[*]}. Removing them before deploy."
        docker rm -f "${containers[@]}" >/dev/null 2>&1 || true
    fi

    if command -v ss >/dev/null 2>&1; then
        listeners="$(ss -ltnp "( sport = :${port} )" 2>/dev/null | tail -n +2 || true)"
        if [ -n "${listeners}" ]; then
            error "Port ${port} is still occupied after Docker cleanup:"
            printf '%s\n' "${listeners}" >&2
            return 1
        fi
    fi
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
    python3 -c "import sys, urllib.parse; user, password, host, port, dbname = sys.argv[1:]; print(f\"postgresql://{urllib.parse.quote(user, safe='')}:{urllib.parse.quote(password, safe='')}@{host}:{port}/{urllib.parse.quote(dbname, safe='')}?sslmode=prefer\")" \
        "$1" "$2" "$3" "$4" "$5"
}

# Main deploy logic
main() {
    log "Starting blue-green deployment..."
    log "Image: ${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
    log "App version: ${APP_VERSION}"
    log "Deploy path: ${DEPLOY_PATH}"
    
    cd "${DEPLOY_PATH}"

    # Ensure .env.production exists (docker-compose env_file may reference it)
    touch -a .env.production
    # Source dotenv-style vars so they are available as shell vars
    set -a; source .env.production 2>/dev/null || true; set +a

    apply_nginx_site_config
    
    # Read current state (initialize if missing — first deploy or state was lost)
    STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
    if [ ! -f "${STATE_FILE}" ]; then
        log "State file not found — initializing with blue slot as active"
        cat > "${STATE_FILE}" <<INITSTATE
{"active_slot":"blue","active_port":"3000","last_deploy":"$(date -u +%Y-%m-%dT%H:%M:%SZ)","version":"initial"}
INITSTATE
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
    
    # Get env vars from .env.production (infrastructure)
    SANDBOX_RUNNER_TOKEN="$(extract_env_value .env.production SANDBOX_RUNNER_TOKEN || true)"
    REDIS_PASSWORD="$(extract_env_value .env.production REDIS_PASSWORD || true)"
    POSTGRES_USER="$(extract_env_value .env.production POSTGRES_USER || true)"
    POSTGRES_PASSWORD="$(extract_env_value .env.production POSTGRES_PASSWORD || true)"
    POSTGRES_DB="$(extract_env_value .env.production POSTGRES_DB || true)"
    POSTGRES_USER="${POSTGRES_USER:-postgres}"
    POSTGRES_DB="${POSTGRES_DB:-iliagpt}"
    DATABASE_URL="$(build_database_url "${POSTGRES_USER}" "${POSTGRES_PASSWORD}" "hola-postgres" "5432" "${POSTGRES_DB}")"

    # Auth, session, and OAuth vars (required for app startup)
    SESSION_SECRET="${SESSION_SECRET:-$(extract_env_value .env.production SESSION_SECRET || true)}"
    TOKEN_ENCRYPTION_KEY="${TOKEN_ENCRYPTION_KEY:-$(extract_env_value .env.production TOKEN_ENCRYPTION_KEY || true)}"
    CANONICAL_DOMAIN="${CANONICAL_DOMAIN:-$(extract_env_value .env.production CANONICAL_DOMAIN || echo 'iliagpt.com')}"
    BASE_URL="${BASE_URL:-$(extract_env_value .env.production BASE_URL || echo 'https://iliagpt.com')}"
    GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-$(extract_env_value .env.production GOOGLE_CLIENT_ID || true)}"
    GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-$(extract_env_value .env.production GOOGLE_CLIENT_SECRET || true)}"
    ADMIN_EMAIL="${ADMIN_EMAIL:-$(extract_env_value .env.production ADMIN_EMAIL || true)}"
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(extract_env_value .env.production ADMIN_PASSWORD || true)}"

    # LLM API keys (read from host env first, fall back to .env.production)
    GEMINI_API_KEY="${GEMINI_API_KEY:-$(extract_env_value .env.production GEMINI_API_KEY || true)}"
    GOOGLE_API_KEY="${GOOGLE_API_KEY:-$(extract_env_value .env.production GOOGLE_API_KEY || true)}"
    OPENAI_API_KEY="${OPENAI_API_KEY:-$(extract_env_value .env.production OPENAI_API_KEY || true)}"
    OPENAI_BASE_URL="${OPENAI_BASE_URL:-$(extract_env_value .env.production OPENAI_BASE_URL || true)}"
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:-$(extract_env_value .env.production ANTHROPIC_API_KEY || true)}"
    XAI_API_KEY="${XAI_API_KEY:-$(extract_env_value .env.production XAI_API_KEY || true)}"
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY:-$(extract_env_value .env.production OPENROUTER_API_KEY || true)}"
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY:-$(extract_env_value .env.production DEEPSEEK_API_KEY || true)}"
    DEEPSEEK_BASE_URL="${DEEPSEEK_BASE_URL:-$(extract_env_value .env.production DEEPSEEK_BASE_URL || true)}"
    CEREBRAS_API_KEY="${CEREBRAS_API_KEY:-$(extract_env_value .env.production CEREBRAS_API_KEY || true)}"
    CEREBRAS_BASE_URL="${CEREBRAS_BASE_URL:-$(extract_env_value .env.production CEREBRAS_BASE_URL || true)}"

    export SESSION_SECRET TOKEN_ENCRYPTION_KEY CANONICAL_DOMAIN BASE_URL
    export GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET ADMIN_EMAIL ADMIN_PASSWORD
    export GEMINI_API_KEY GOOGLE_API_KEY OPENAI_API_KEY OPENAI_BASE_URL
    export ANTHROPIC_API_KEY XAI_API_KEY OPENROUTER_API_KEY
    export DEEPSEEK_API_KEY DEEPSEEK_BASE_URL CEREBRAS_API_KEY CEREBRAS_BASE_URL

    # Validate and auto-generate required environment variables.
    # Check both empty AND too-short values (VPS .env.production may have
    # invalid placeholder values that pass the -z check but crash the app).
    if [ -z "${SESSION_SECRET}" ] || [ "${#SESSION_SECRET}" -lt 32 ]; then
        SESSION_SECRET="$(openssl rand -hex 32)"
        export SESSION_SECRET
        warn "SESSION_SECRET was missing/too short — auto-generated a random value."
        warn "Persist it in .env.production to keep sessions stable across deploys."
        sed -i '/^SESSION_SECRET=/d' .env.production 2>/dev/null || true
        echo "SESSION_SECRET=${SESSION_SECRET}" >> .env.production
    fi
    if [ -z "${TOKEN_ENCRYPTION_KEY}" ] || [ "${#TOKEN_ENCRYPTION_KEY}" -lt 32 ]; then
        TOKEN_ENCRYPTION_KEY="$(openssl rand -hex 32)"
        export TOKEN_ENCRYPTION_KEY
        warn "TOKEN_ENCRYPTION_KEY was missing/too short — auto-generated a random value."
        warn "Persist it in .env.production to keep OAuth tokens stable across deploys."
        sed -i '/^TOKEN_ENCRYPTION_KEY=/d' .env.production 2>/dev/null || true
        echo "TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}" >> .env.production
    fi
    if [ -z "${ADMIN_EMAIL}" ] || ! echo "${ADMIN_EMAIL}" | grep -qE '^[^@]+@[^@]+\.[^@]+$'; then
        ADMIN_EMAIL="admin@iliagpt.com"
        export ADMIN_EMAIL
        warn "ADMIN_EMAIL was missing/invalid — using default admin@iliagpt.com."
        sed -i '/^ADMIN_EMAIL=/d' .env.production 2>/dev/null || true
        echo "ADMIN_EMAIL=${ADMIN_EMAIL}" >> .env.production
    fi
    if [ -z "${ADMIN_PASSWORD}" ] || [ "${#ADMIN_PASSWORD}" -lt 8 ]; then
        ADMIN_PASSWORD="$(openssl rand -base64 24)"
        export ADMIN_PASSWORD
        warn "ADMIN_PASSWORD was missing/too short — auto-generated a random value."
        warn "Persist it in .env.production at ${DEPLOY_PATH} to keep admin access."
        sed -i '/^ADMIN_PASSWORD=/d' .env.production 2>/dev/null || true
        echo "ADMIN_PASSWORD=${ADMIN_PASSWORD}" >> .env.production
    fi

    # Stop inactive slot containers FIRST to free their image layers before pulling new ones.
    log "Stopping existing ${INACTIVE_SLOT} containers to free disk..."
    docker rm -f "hola-${INACTIVE_SLOT}-app" "hola-${INACTIVE_SLOT}-worker" "hola-${INACTIVE_SLOT}-sandbox" 2>/dev/null || true
    free_slot_port "${INACTIVE_PORT}"

    # Clean up old docker artifacts to prevent disk exhaustion
    log "Cleaning up old docker containers and images..."
    docker container prune -f || true
    # Truncate container logs aggressively
    find /var/lib/docker/containers -name "*.log" -size +5M -exec truncate -s 0 {} \; 2>/dev/null || true
    # Remove dangling volumes
    docker volume prune -f 2>/dev/null || true
    docker builder prune -af 2>/dev/null || true
    # Clean apt cache, tmp, and systemd journals
    rm -rf /tmp/npm-* /tmp/pnpm-* /var/cache/apt/archives/*.deb 2>/dev/null || true
    apt-get clean 2>/dev/null || true
    journalctl --vacuum-size=50M 2>/dev/null || true
    # Remove ALL unused images (frees old tags from previous deploys)
    docker image prune -af || true
    log "Disk cleanup complete. Available: $(df -h / | awk 'NR==2{print $4}')"

    # Helper: get available disk in MB (integer, no rounding issues)
    get_avail_mb() {
        df --output=avail -BM / | tail -1 | tr -d ' M'
    }

    # Pull new images one at a time, with aggressive disk recovery between pulls
    log "Pulling images..."
    docker pull "${REGISTRY}/iliagpt-app:${IMAGE_TAG}"
    docker image prune -f 2>/dev/null || true

    AVAIL_MB="$(get_avail_mb)"
    log "Disk available after app pull: $((AVAIL_MB / 1024))G (${AVAIL_MB}M)"
    if [ "${AVAIL_MB}" -lt 4096 ] 2>/dev/null && [ -z "${PREDEPLOY_ONLY}" ]; then
        warn "Low disk (${AVAIL_MB}M). Stopping active ${ACTIVE_SLOT} slot to free image layers..."
        docker rm -f "hola-${ACTIVE_SLOT}-app" "hola-${ACTIVE_SLOT}-worker" "hola-${ACTIVE_SLOT}-sandbox" 2>/dev/null || true
        # Remove old slot images by tag, but keep the newly pulled app image
        docker images --format '{{.Repository}}:{{.Tag}}' \
            | grep -E 'iliagpt-(app|sandbox|ocr)' \
            | grep -v "${IMAGE_TAG}" \
            | xargs -r docker rmi 2>/dev/null || true
        docker image prune -f 2>/dev/null || true
        docker volume prune -f 2>/dev/null || true
        log "Disk after active slot cleanup: $(df -h / | awk 'NR==2{print $4}')"
    fi

    docker pull "${REGISTRY}/iliagpt-sandbox:${IMAGE_TAG}"
    docker image prune -f 2>/dev/null || true
    docker pull "${REGISTRY}/iliagpt-ocr:${IMAGE_TAG}" || true
    
    # Create database backup before migrating
    log "Creating pre-migration database backup..."
    BACKUP_DIR="${DEPLOY_PATH}/backups"
    mkdir -p "${BACKUP_DIR}"
    BACKUP_FILE="${BACKUP_DIR}/db_backup_${APP_VERSION}_$(date +%Y%m%d_%H%M%S).sql.gz"
    # We use gzip to save space
    if docker exec hola-postgres pg_dump -U "${POSTGRES_USER}" "${POSTGRES_DB}" | gzip > "${BACKUP_FILE}"; then
        log "Database backup saved to ${BACKUP_FILE}"
        # Keep only the latest 3 backups to conserve disk
        ls -t "${BACKUP_DIR}"/db_backup_*.sql.gz 2>/dev/null | tail -n +4 | xargs -I {} rm -f {} || true
    else
        warn "Failed to create database backup. Proceeding anyway..."
        rm -f "${BACKUP_FILE}"
    fi

    # Run migrations on the new image
    log "Running migrations..."
    docker run --rm \
        --network hola-net \
        -e DATABASE_URL="${DATABASE_URL}" \
        -e NODE_ENV=production \
        -e SESSION_SECRET="migration-only-placeholder" \
        -e ADMIN_EMAIL="migration@placeholder.local" \
        -e ADMIN_PASSWORD="migration-placeholder-pw" \
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
    SESSION_SECRET="${SESSION_SECRET}" \
    TOKEN_ENCRYPTION_KEY="${TOKEN_ENCRYPTION_KEY}" \
    CANONICAL_DOMAIN="${CANONICAL_DOMAIN}" \
    BASE_URL="${BASE_URL}" \
    GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID}" \
    GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET}" \
    ADMIN_EMAIL="${ADMIN_EMAIL}" \
    ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    GEMINI_API_KEY="${GEMINI_API_KEY}" \
    GOOGLE_API_KEY="${GOOGLE_API_KEY}" \
    OPENAI_API_KEY="${OPENAI_API_KEY}" \
    OPENAI_BASE_URL="${OPENAI_BASE_URL}" \
    ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY}" \
    XAI_API_KEY="${XAI_API_KEY}" \
    OPENROUTER_API_KEY="${OPENROUTER_API_KEY}" \
    DEEPSEEK_API_KEY="${DEEPSEEK_API_KEY}" \
    DEEPSEEK_BASE_URL="${DEEPSEEK_BASE_URL}" \
    CEREBRAS_API_KEY="${CEREBRAS_API_KEY}" \
    CEREBRAS_BASE_URL="${CEREBRAS_BASE_URL}" \
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
    BACKUP_UPSTREAM="$(mktemp)"
    if [ -f "${NGINX_UPSTREAM_CONF}" ]; then
        cp "${NGINX_UPSTREAM_CONF}" "${BACKUP_UPSTREAM}"
    else
        : > "${BACKUP_UPSTREAM}"
    fi
    
    # Update upstream to point to new slot
    cat > "${NGINX_UPSTREAM_CONF}" << EOF
upstream iliagpt_backend {
    server 127.0.0.1:${INACTIVE_PORT};
    keepalive 32;
}
EOF
    
    if ! reload_nginx; then
        warn "Failed to reload nginx after switching to ${INACTIVE_SLOT}; restoring previous upstream config"
        if [ -s "${BACKUP_UPSTREAM}" ]; then
            cp "${BACKUP_UPSTREAM}" "${NGINX_UPSTREAM_CONF}"
        else
            rm -f "${NGINX_UPSTREAM_CONF}"
        fi
        reload_nginx || true
        rm -f "${BACKUP_UPSTREAM}"
        exit 1
    fi
    rm -f "${BACKUP_UPSTREAM}"
    
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
    
    if [ "${KEEP_PREVIOUS_SLOT}" = "true" ]; then
        log "Keeping previous ${ACTIVE_SLOT} slot running until post-deploy acceptance passes"
    else
        log "Stopping old ${ACTIVE_SLOT} containers..."
        sleep 5
        docker rm -f "hola-${ACTIVE_SLOT}-app" "hola-${ACTIVE_SLOT}-worker" "hola-${ACTIVE_SLOT}-sandbox" 2>/dev/null || true
    fi
    
    success "Blue-green deployment completed successfully!"
    log "New active slot: ${INACTIVE_SLOT}"
    log "Version: ${APP_VERSION}"
}

# Run main
main "$@"
