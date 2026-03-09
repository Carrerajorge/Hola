#!/usr/bin/env bash
set -Eeuo pipefail
DEPLOY_PATH="${DEPLOY_PATH:-$(pwd)}"
mkdir -p "${DEPLOY_PATH}/scripts" "${DEPLOY_PATH}/nginx"
mkdir -p /etc/nginx/conf.d
if [[ ! -f /etc/nginx/conf.d/iliagpt-upstream.conf ]]; then
  cat > /etc/nginx/conf.d/iliagpt-upstream.conf <<'EOF'
upstream iliagpt {
    server 127.0.0.1:5000 max_fails=3 fail_timeout=10s;
    keepalive 32;
}
EOF
fi
nginx -t >/dev/null 2>&1 || true
