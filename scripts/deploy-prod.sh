#!/usr/bin/env bash
set -euo pipefail

# Deploy `main` to the VPS using docker-compose.prod.yml.
#
# Defaults are tuned for this project (ILIAGPT).
# Override with env vars if needed:
#   VPS_HOST, VPS_PORT, VPS_USER, DEPLOY_PATH, COMPOSE_PROJECT, COMPOSE_FILE

VPS_HOST="${VPS_HOST:-100.93.79.71}"     # Tailscale IP (preferred)
VPS_PORT="${VPS_PORT:-22}"
VPS_USER="${VPS_USER:-root}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-iliagpt}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

echo "═══════════════════════════════════════════"
echo "  ILIAGPT Production Deploy"
echo "  $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════"

ssh -p "$VPS_PORT" "${VPS_USER}@${VPS_HOST}" <<'DEPLOY'
set -euo pipefail

DEPLOY_PATH="${DEPLOY_PATH:-/opt/hola}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-iliagpt}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"

cd "$DEPLOY_PATH"

echo "▸ Pulling latest code (main)..."
git fetch origin main
if git show-ref --verify --quiet refs/heads/main; then
  git checkout main
else
  git checkout -b main origin/main
fi
git pull --ff-only origin main
echo "▸ Current commit: $(git rev-parse --short HEAD)"

# docker compose expands ${VARS} from process env (and .env), not from env_file.
if [ -f .env.production ]; then
  export SANDBOX_RUNNER_TOKEN="$(grep '^SANDBOX_RUNNER_TOKEN=' .env.production | head -n1 | cut -d= -f2- || true)"
fi
if [ -z "${SANDBOX_RUNNER_TOKEN:-}" ]; then
  echo "SANDBOX_RUNNER_TOKEN missing; generating..."
  export SANDBOX_RUNNER_TOKEN="$(openssl rand -hex 32)"
  if [ -f .env.production ]; then
    if grep -q '^SANDBOX_RUNNER_TOKEN=' .env.production; then
      sed -i "s/^SANDBOX_RUNNER_TOKEN=.*/SANDBOX_RUNNER_TOKEN=${SANDBOX_RUNNER_TOKEN}/" .env.production
    else
      echo "SANDBOX_RUNNER_TOKEN=${SANDBOX_RUNNER_TOKEN}" >> .env.production
    fi
  fi
fi

echo "▸ Building images..."
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" build app worker sandbox-runner

echo "▸ Restarting stack (keep volumes)..."
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" down --remove-orphans || true
docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" up -d

echo "▸ Waiting for health..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:5000/health >/dev/null 2>&1; then
    echo "✓ Healthy"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "✗ Health failed"
    docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" logs --tail=120 app
    exit 1
  fi
  echo "  Attempt $i/30..."
  sleep 5
done

docker compose -p "$COMPOSE_PROJECT" -f "$COMPOSE_FILE" ps
curl -s http://127.0.0.1:5000/health || true
DEPLOY

echo ""
echo "▸ Verifying public health..."
curl -sS https://iliagpt.com/health || true
echo ""
echo "✓ Deploy finished"

