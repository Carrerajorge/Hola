#!/bin/bash
set -e

echo "🚀 Iniciando despliegue a VPS..."

VPS_HOST=${VPS_HOST:-69.62.98.126}
VPS_DIR=${VPS_DIR:-/var/www/michat}
REPO_HTTPS_URL=${REPO_HTTPS_URL:-https://github.com/Carrerajorge/Hola.git}
VPS_GITHUB_TOKEN=${VPS_GITHUB_TOKEN:-}

# 1. Push changes
echo "📤 Subiendo cambios a GitHub..."
git push origin main

# 2. Deploy on VPS
echo "🔄 Conectando al VPS para actualizar..."
ssh root@${VPS_HOST} "GITHUB_TOKEN='${VPS_GITHUB_TOKEN}' REPO_HTTPS_URL='${REPO_HTTPS_URL}' bash -lc 'cd ${VPS_DIR} && \
echo '⬇️  Bajando cambios...' && \
if [ -n "$GITHUB_TOKEN" ]; then \
  git remote set-url origin "$REPO_HTTPS_URL" && \
  git -c http.extraHeader=\"AUTHORIZATION: bearer $GITHUB_TOKEN\" pull origin main; \
else \
  git pull origin main; \
fi && \
echo '📦 Instalando dependencias...' && \
npm ci --include=dev || \
(echo '⚠️  npm ci falló. Intentando npm install --include=dev...' && \
 npm install --include=dev) && \
echo '🏗️  Compilando...' && \
npm run build && \
echo '🗄️  Sincronizando base de datos...' && \
npm run db:push && \
echo '🔑 Actualizando credenciales de admin...' && \
npx tsx server/scripts/set_admin_credentials.ts &&  echo '🌱 Sembrando modelos AI...' && \
  npx tsx server/scripts/seed_models.ts && \
  echo '🚀 Reiniciando servidor...' && \
  pm2 restart michat --update-env'"

echo "✅ Despliegue completado con éxito."
