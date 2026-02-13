#!/bin/bash
set -e

VPS_HOST="${VPS_HOST:-69.62.98.126}"
VPS_PORT="${VPS_PORT:-22}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/var/www/michat}"
LOCAL_DEPLOY="${LOCAL_DEPLOY:-0}"  # set LOCAL_DEPLOY=1 when running directly on the VPS host

SSH_OPTS="-p ${VPS_PORT}"
if [[ "${LOCAL_DEPLOY}" == "1" ]]; then
  SSH_OPTS="-p ${VPS_PORT}"
fi

RSYNC_EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.env'
  --exclude 'dist'
)

sync_to_vps() {
  echo "📤 Syncing files to VPS..."
  rsync -avz "${RSYNC_EXCLUDES[@]}" -e "ssh ${SSH_OPTS}" ./ "${VPS_USER}@${VPS_HOST}:${VPS_DIR}"
}

deploy_on_target() {
  local target_dir="$1"
  echo "🔄 Installing dependencies, building, and restarting application on $(hostname)..."
  cd "${target_dir}"
  npm install
  npm run build
  npm run db:push
  pm2 restart michat --update-env
}

if [[ "${LOCAL_DEPLOY}" == "1" ]]; then
  TARGET_DIR="$(pwd)"
  if [[ "${TARGET_DIR}" != "${VPS_DIR}" ]]; then
    sync_to_vps
    TARGET_DIR="${VPS_DIR}"
  fi
  deploy_on_target "${TARGET_DIR}"
else
  sync_to_vps
  ssh ${SSH_OPTS} "${VPS_USER}@${VPS_HOST}" "cd ${VPS_DIR} && npm install && npm run build && npm run db:push && pm2 restart michat --update-env"
fi

echo "✅ Deployment complete! Check https://iliagpt.com"
