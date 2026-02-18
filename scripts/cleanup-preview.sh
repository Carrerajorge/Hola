#!/usr/bin/env bash
set -euo pipefail

# Remove a per-branch/PR preview slot on the VPS.
# Usage (run on VPS):
#   PREVIEW_SLUG=pr-123 bash scripts/cleanup-preview.sh

: "${PREVIEW_SLUG:?PREVIEW_SLUG is required}"
DOMAIN_BASE="${DOMAIN_BASE:-preview.iliagpt.com}"
NGINX_PREVIEW_DIR="${NGINX_PREVIEW_DIR:-/etc/nginx/conf.d/previews}"
NGINX_SITE_PATH="${NGINX_PREVIEW_DIR}/${PREVIEW_SLUG}.conf"
PROJECT="hola-${PREVIEW_SLUG}"

if ! printf '%s' "${PREVIEW_SLUG}" | grep -Eq '^[a-z0-9][a-z0-9-]{1,62}$'; then
  echo "PREVIEW_SLUG has invalid characters: ${PREVIEW_SLUG}" >&2
  exit 1
fi

echo "[preview] Cleaning up ${PREVIEW_SLUG} (${PROJECT})"

if docker compose -p "${PROJECT}" -f docker-compose.slot.yml ps >/dev/null 2>&1; then
  docker compose -p "${PROJECT}" -f docker-compose.slot.yml down --remove-orphans || true
fi

if [ -f "${NGINX_SITE_PATH}" ]; then
  echo "[preview] Removing nginx vhost: ${NGINX_SITE_PATH}"
  sudo rm -f "${NGINX_SITE_PATH}"
  sudo nginx -t
  sudo nginx -s reload
fi

echo "[preview] Done."
