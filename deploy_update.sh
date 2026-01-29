#!/bin/bash

# Script de actualización automática para VPS
# Servidor: 69.62.98.126
# Usuario: root

echo "🚀 Iniciando despliegue a VPS (69.62.98.126)..."

ssh root@69.62.98.126 "cd /var/www/michat && \
git pull origin main && \
echo '📦 Instalando dependencias...' && \
npm install && \
echo '🗄️ Actualizando base de datos...' && \
npm run db:push && \
echo '🏗️ Construyendo aplicación...' && \
npm run build && \
echo '🔄 Reiniciando servicios...' && \
pm2 restart michat --update-env && \
pm2 save"

echo "✅ Despliegue completado."
