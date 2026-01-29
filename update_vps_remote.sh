#!/bin/bash
set -e

echo "🔄 Conectando al VPS (69.62.98.126)..."
# Pull latest changes, install dependencies, build, migrate DB, and restart
ssh root@69.62.98.126 "cd /var/www/michat && \
  echo '⬇️  Bajando cambios desde GitHub...' && \
  git pull origin main && \
  echo '📦 Instalando dependencias...' && \
  npm ci --include=dev && \
  echo '🏗️  Compilando aplicación...' && \
  npm run build && \
  echo '🗄️  Actualizando base de datos...' && \
  npm run db:push && \
  echo '🌱 Sembrando modelos AI...' && \
  npx tsx server/scripts/seed_models.ts && \
  echo '🚀 Reiniciando servicio...' && \
  pm2 restart michat --update-env"

echo "✅ ¡Actualización completada exitosamente!"
