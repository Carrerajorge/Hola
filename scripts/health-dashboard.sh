#!/usr/bin/env bash
set -Eeuo pipefail
DEPLOY_PATH="${DEPLOY_PATH:-$(pwd)}"
STATE_FILE="${DEPLOY_PATH}/deploy-state.json"
UPSTREAM_CONF="${NGINX_UPSTREAM_CONF:-/etc/nginx/conf.d/iliagpt-upstream.conf}"

echo "=== DEPLOY STATE ==="
if [[ -f "$STATE_FILE" ]]; then
  cat "$STATE_FILE"
else
  echo "missing: $STATE_FILE"
fi

echo
echo "=== NGINX UPSTREAM ==="
if [[ -f "$UPSTREAM_CONF" ]]; then
  cat "$UPSTREAM_CONF"
else
  echo "missing: $UPSTREAM_CONF"
fi

echo
echo "=== CONTAINERS ==="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' | grep -E 'hola-(blue|green|infra|ocr|postgres|redis)' || true
