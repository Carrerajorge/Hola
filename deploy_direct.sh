#!/bin/bash
set -e

VPS_HOST="${VPS_HOST:-69.62.98.126}"
VPS_PORT="${VPS_PORT:-22}"
VPS_USER="${VPS_USER:-root}"
VPS_DIR="${VPS_DIR:-/root/ILIACODEX}"
LOCAL_DEPLOY="${LOCAL_DEPLOY:-0}"  # Set to 1 when running directly on target VPS
RUN_SYNC="${RUN_SYNC:-1}"         # Set to 0 when running directly on target and already in VPS_DIR

SSH_OPTS="-p ${VPS_PORT}"

RSYNC_EXCLUDES=(
  --exclude 'node_modules'
  --exclude '.git'
  --exclude '.env'
  --exclude 'dist'
)

load_env_file() {
  local file="$1"
  if [ -f "$file" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
    return 0
  fi
  return 1
}

ensure_database_url() {
  if [ -n "${DATABASE_URL:-}" ]; then
    return 0
  fi

  if load_env_file ".env.production"; then
    if [ -n "${DATABASE_URL:-}" ]; then
      return 0
    fi
  fi

  if load_env_file ".env"; then
    if [ -n "${DATABASE_URL:-}" ]; then
      return 0
    fi
  fi

  return 1
}

run_db_push() {
  if ! ensure_database_url; then
    echo "❌ DATABASE_URL not set. Add DATABASE_URL to environment or .env.production/.env before deploy." >&2
    return 1
  fi

  npm run db:push
}

sync_to_vps() {
  echo "📤 Syncing files to VPS..."
  rsync -avz "${RSYNC_EXCLUDES[@]}" -e "ssh ${SSH_OPTS}" ./ "${VPS_USER}@${VPS_HOST}:${VPS_DIR}"
}

run_remote_cmd() {
  ssh ${SSH_OPTS} "${VPS_USER}@${VPS_HOST}" "bash -lc 'cd ${VPS_DIR} && npm install && npm run build && ( source .env.production 2>/dev/null || true; source .env 2>/dev/null || true; if [ -z \"\${DATABASE_URL:-}\" ]; then echo \"DATABASE_URL not set. Add DATABASE_URL to environment or .env.production/.env before deploy.\" >&2; exit 1; fi; npm run db:push; ) && pm2 restart michat --update-env'"
}

deploy_on_target() {
  local target_dir="$1"
  echo "🔄 Installing dependencies, building, and restarting application on $(hostname)..."
  cd "${target_dir}"
  npm install
  npm run build
  run_db_push
  pm2 restart michat --update-env
}

if [[ "${LOCAL_DEPLOY}" == "1" ]]; then
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
