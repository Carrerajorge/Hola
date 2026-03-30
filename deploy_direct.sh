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

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable >/dev/null 2>&1 || true
    corepack prepare pnpm@10 --activate >/dev/null 2>&1 || true
  fi

  if command -v pnpm >/dev/null 2>&1; then
    return 0
  fi

  npm install -g pnpm@10 >/dev/null 2>&1
  export PATH="$(npm config get prefix)/bin:${PATH}"
  hash -r

  if ! command -v pnpm >/dev/null 2>&1; then
    echo "❌ pnpm is required to build the embedded OpenClaw UI." >&2
    return 1
  fi
}

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

  npm run db:push -- --force
}

restart_app() {
  if command -v pm2 >/dev/null 2>&1; then
    if pm2 describe iliagpt-host >/dev/null 2>&1; then
      pm2 restart iliagpt-host --update-env
      return 0
    fi

    if pm2 describe michat >/dev/null 2>&1; then
      pm2 restart michat --update-env
      return 0
    fi

    pm2 start npm --name iliagpt-host -- start
    return 0
  fi

  echo "❌ pm2 is required on the target host." >&2
  return 1
}

sync_to_vps() {
  echo "📤 Syncing files to VPS..."
  rsync -avz "${RSYNC_EXCLUDES[@]}" -e "ssh ${SSH_OPTS}" ./ "${VPS_USER}@${VPS_HOST}:${VPS_DIR}"
}

run_remote_cmd() {
  ssh ${SSH_OPTS} "${VPS_USER}@${VPS_HOST}" "bash -lc 'cd ${VPS_DIR} && ensure_pnpm() { if command -v pnpm >/dev/null 2>&1; then return 0; fi; if command -v corepack >/dev/null 2>&1; then corepack enable >/dev/null 2>&1 || true; corepack prepare pnpm@10 --activate >/dev/null 2>&1 || true; fi; if command -v pnpm >/dev/null 2>&1; then return 0; fi; npm install -g pnpm@10 >/dev/null 2>&1; export PATH=\"\$(npm config get prefix)/bin:\${PATH}\"; hash -r; command -v pnpm >/dev/null 2>&1; } && ensure_pnpm && npm install --no-package-lock --no-audit --no-fund && (cd server/openclaw && npm install --no-package-lock --no-audit --no-fund) && npm run build && ( source .env.production 2>/dev/null || true; source .env 2>/dev/null || true; if [ -z \"\${DATABASE_URL:-}\" ]; then echo \"DATABASE_URL not set. Add DATABASE_URL to environment or .env.production/.env before deploy.\" >&2; exit 1; fi; npm run db:push -- --force; ) && if pm2 describe iliagpt-host >/dev/null 2>&1; then pm2 restart iliagpt-host --update-env; elif pm2 describe michat >/dev/null 2>&1; then pm2 restart michat --update-env; else pm2 start npm --name iliagpt-host -- start; fi'"
}

deploy_on_target() {
  local target_dir="$1"
  echo "🔄 Installing dependencies, building, and restarting application on $(hostname)..."
  cd "${target_dir}"
  ensure_pnpm
  npm install --no-package-lock --no-audit --no-fund
  npm run build
  run_db_push
  restart_app
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
