#!/usr/bin/env bash
set -euo pipefail

# Deploy a per-branch/PR preview slot on the VPS.
#
# Requirements on VPS:
# - /opt/hola repo checkout (same as prod deploy)
# - docker compose available
# - nginx installed and able to reload
# - wildcard DNS: *.preview.iliagpt.com -> VPS
# - TLS handled separately (recommended: wildcard cert)
#
# Usage (run on VPS):
#   PREVIEW_SLUG=pr-123 HOST_PORT=6103 IMAGE_TAG=sha-deadbeef APP_VERSION=deadbeef \
#     bash scripts/deploy-preview.sh

: "${PREVIEW_SLUG:?PREVIEW_SLUG is required (e.g. pr-123 or branch-foo)}"
: "${HOST_PORT:?HOST_PORT is required (e.g. 6103)}"
: "${IMAGE_TAG:?IMAGE_TAG is required (e.g. sha-deadbeef)}"

APP_VERSION="${APP_VERSION:-${IMAGE_TAG}}"
DOMAIN_BASE="${DOMAIN_BASE:-preview.iliagpt.com}"
FQDN="${PREVIEW_SLUG}.${DOMAIN_BASE}"
NGINX_PREVIEW_DIR="${NGINX_PREVIEW_DIR:-/etc/nginx/conf.d/previews}"
NGINX_SITE_PATH="${NGINX_PREVIEW_DIR}/${PREVIEW_SLUG}.conf"

PROJECT="hola-${PREVIEW_SLUG}"
SLOT="${PREVIEW_SLUG}"

if ! printf '%s' "${PREVIEW_SLUG}" | grep -Eq '^[a-z0-9][a-z0-9-]{1,62}$'; then
  echo "PREVIEW_SLUG has invalid characters: ${PREVIEW_SLUG}" >&2
  exit 1
fi
if ! printf '%s' "${HOST_PORT}" | grep -Eq '^[0-9]{4,5}$'; then
  echo "HOST_PORT must be a port number (e.g. 6103): ${HOST_PORT}" >&2
  exit 1
fi

echo "[preview] Deploying ${PREVIEW_SLUG} -> 127.0.0.1:${HOST_PORT} (${FQDN})"

# 1) Authenticate to GHCR when credentials are provided by CI.
GHCR_REGISTRY="${GHCR_REGISTRY:-ghcr.io}"
if [[ -n "${GHCR_TOKEN:-}" ]]; then
  if [[ -z "${GHCR_USERNAME:-}" ]]; then
    echo "GHCR_USERNAME is required when GHCR_TOKEN is set" >&2
    exit 1
  fi
  echo "${GHCR_TOKEN}" | docker login "${GHCR_REGISTRY}" -u "${GHCR_USERNAME}" --password-stdin >/dev/null
fi

# 2) Ensure all slot images exist before compose tries to start containers.
for image in app sandbox ocr; do
  docker pull "ghcr.io/carrerajorge/iliagpt-${image}:${IMAGE_TAG}" >/dev/null
done

echo "[preview] Starting docker compose project: ${PROJECT}"
SLOT="${SLOT}" HOST_PORT="${HOST_PORT}" IMAGE_TAG="${IMAGE_TAG}" APP_VERSION="${APP_VERSION}" \
  docker compose -p "${PROJECT}" -f docker-compose.slot.yml up -d --remove-orphans

echo "[preview] Writing nginx vhost: ${NGINX_SITE_PATH}"
sudo mkdir -p "${NGINX_PREVIEW_DIR}"

cat > /tmp/preview-nginx.conf <<EOF
server {
  listen 80;
  server_name ${FQDN};

  # If you terminate TLS elsewhere, keep HTTP. If you terminate on this box,
  # you should add a 443 server block + cert handling.

  location / {
    proxy_pass http://127.0.0.1:${HOST_PORT};
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    proxy_read_timeout 180s;
    proxy_send_timeout 180s;
  }
}
EOF

sudo mv /tmp/preview-nginx.conf "${NGINX_SITE_PATH}"

echo "[preview] Validating nginx config"
sudo nginx -t

echo "[preview] Reloading nginx"
sudo nginx -s reload

echo "[preview] Done: http://${FQDN} -> 127.0.0.1:${HOST_PORT}"
