#!/usr/bin/env bash
# Health Dashboard Script for ILIAGPT
# Provides a health check dashboard for production

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

HEALTH_ENDPOINT="${HEALTH_ENDPOINT:-http://localhost:5050/health}"

log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

check_health() {
    local endpoint="$1"
    local response

    response=$(curl -s -o /dev/null -w "%{http_code}" "${endpoint}" 2>/dev/null || echo "000")

    if [ "${response}" = "200" ]; then
        echo -e "${GREEN}✓${NC} ${endpoint} - HTTP ${response}"
        return 0
    else
        echo -e "${RED}✗${NC} ${endpoint} - HTTP ${response}"
        return 1
    fi
}

main() {
    log "Health Dashboard - $(date)"
    echo "================================"

    check_health "${HEALTH_ENDPOINT}"
    local health_status=$?

    echo "================================"

    if [ ${health_status} -eq 0 ]; then
        echo -e "Overall Status: ${GREEN}HEALTHY${NC}"
        return 0
    else
        echo -e "Overall Status: ${RED}UNHEALTHY${NC}"
        return 1
    fi
}

main "$@"
