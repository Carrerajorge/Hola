#!/usr/bin/env bash
# VPS Bootstrap Blue-Green Script for ILIAGPT
# Bootstraps a VPS for blue-green deployment

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
REGISTRY="${REGISTRY:-ghcr.io/carrerajorge}"

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

check_dependencies() {
    log "Checking dependencies..."

    local missing=()

    command -v docker >/dev/null 2>&1 || missing+=("docker")
    command -v docker-compose >/dev/null 2>&1 || missing+=("docker-compose")
    command -v curl >/dev/null 2>&1 || missing+=("curl")

    if [ ${#missing[@]} -gt 0 ]; then
        log "Missing dependencies: ${missing[*]}"
        log "Installing missing dependencies..."
        apt-get update -qq
        apt-get install -y -qq "${missing[@]}"
    fi

    success "All dependencies installed."
}

setup_directories() {
    log "Setting up directories..."

    mkdir -p "${DEPLOY_PATH}"/{blue,green,nginx,scripts}
    mkdir -p "${DEPLOY_PATH}"/data/{postgres,redis,uploads}

    success "Directories created."
}

pull_images() {
    log "Pulling Docker images..."

    docker pull "${REGISTRY}/hola-app:latest" || true
    docker pull "${REGISTRY}/hola-sandbox-runner:latest" || true
    docker pull "${REGISTRY}/hola-ocr:latest" || true

    success "Images pulled."
}

main() {
    log "Starting VPS bootstrap for blue-green deployment..."
    log "Deploy path: ${DEPLOY_PATH}"

    check_dependencies
    setup_directories
    pull_images

    success "VPS bootstrap completed successfully!"
    return 0
}

main "$@"
