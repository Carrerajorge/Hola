#!/usr/bin/env bash
set -euo pipefail

# Script para crear .env.production automaticamente en el VPS.
# Uso: ejecutar en el servidor dentro del directorio del proyecto:
#   bash production_env_setup.sh

echo "Configurando entorno de produccion..."

if [[ -f ".env.production" ]]; then
  backup=".env.production.bak.$(date +%Y%m%d%H%M%S)"
  cp ".env.production" "$backup"
  echo "Backup creado: $backup"
fi

session_secret="$(openssl rand -hex 32)"

cat > ".env.production" <<EOF
NODE_ENV=production
PORT=5000

# Public base URL (used for OAuth callback URLs)
BASE_URL=https://your-domain.example

# CORS allowlist (comma-separated). If omitted, defaults are used.
# ALLOWED_ORIGINS=https://your-domain.example,https://www.your-domain.example

# Database (required)
# If you are running via docker-compose, the default host is usually "postgres".
DATABASE_URL=postgres://postgres:postgres@postgres:5432/iliagpt

# Session (required)
SESSION_SECRET=$session_secret

# Admin (optional but recommended)
# ADMIN_EMAIL=admin@example.com
# ADMIN_PASSWORD=replace-with-a-strong-password

# Required in production when OAuth integrations are enabled (encrypts stored OAuth tokens)
# TOKEN_ENCRYPTION_KEY=replace-with-32+chars-random-string

# LLM Providers (at least one required for chat)
# XAI_API_KEY=
# GEMINI_API_KEY=
# OPENAI_API_KEY=
# ANTHROPIC_API_KEY=

# OAuth providers (optional)
# GOOGLE_CLIENT_ID=
# GOOGLE_CLIENT_SECRET=

# Replit OIDC (optional; enabled when REPL_ID is set)
# REPL_ID=
# ISSUER_URL=https://replit.com/oidc

# Optional services
# REDIS_URL=redis://redis:6379
# MEILI_URL=http://meilisearch:7700
# MEILI_API_KEY=

# Sandbox runner (optional; only required for shell/agent sandbox execution)
# SANDBOX_RUNNER_TOKEN=
EOF

echo ".env.production creado exitosamente."
echo "Importante: completa los secretos y URLs reales antes de arrancar el servicio."
