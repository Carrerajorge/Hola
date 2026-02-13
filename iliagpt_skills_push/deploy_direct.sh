#!/bin/bash
set -e

VPS_HOST="${VPS_HOST:-69.62.98.126}"
VPS_PORT="${VPS_PORT:-22}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/root/ILIACODEX}"
LOCAL_DEPLOY="${LOCAL_DEPLOY:-0}"  # Set to 1 when running directly on target VPS
RUN_SYNC="${RUN_SYNC:-1}"         # Set to 0 when running directly on target and not in /var/www

SSH_OPTS="-p ${VPS_PORT}"

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

run_remote_cmd() {
  ssh ${SSH_OPTS} "${VPS_USER}@${VPS_HOST}" "cd ${VPS_DIR} && npm install && npm run build && npm run db:push && pm2 restart michat --update-env"
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
  # When running directly on VPS, avoid SSH/rsync loop entirely.
  TARGET_DIR="$(pwd)"
  if [[ "$TARGET_DIR" != "${VPS_DIR}" ]]; then
    TARGET_DIR="${VPS_DIR}"
    if [[ ! -d "${TARGET_DIR}" ]]; then
      echo "❌ ERROR: target dir ${VPS_DIR} does not exist on this host. Set VPS_DIR to your actual path." >&2
      exit 1
    fi
  fi
  deploy_on_target "${TARGET_DIR}"
else
  if [[ "${RUN_SYNC}" != "0" ]]; then
    sync_to_vps
  fi
  run_remote_cmd
fi

echo "✅ Deployment complete! Check https://iliagpt.com"
