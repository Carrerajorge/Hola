#!/bin/bash
set -e

echo "🚀 Iniciando despliegue a VPS..."

# 1. Push changes
echo "📤 Subiendo cambios a GitHub..."
git push origin main

# 2. Deploy on VPS
echo "🔄 Conectando al VPS para actualizar..."
ssh root@69.62.98.126 "cd /var/www/michat && \
echo '⬇️  Bajando cambios...' && \
git pull origin main && \
echo '📦 Instalando dependencias...' && \
npm ci --include=dev && \
echo '🏗️  Compilando...' && \
npm run build && \
echo '🗄️  Sincronizando base de datos...' && \
npm run db:push && \
echo '🚀 Reiniciando servidor...' && \
pm2 restart michat --update-env"

echo "✅ Despliegue completado con éxito."
