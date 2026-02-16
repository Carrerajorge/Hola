#!/bin/bash
set -e

APP_DIR="/var/www/michat"

echo "🔥 INICIANDO REPARACIÓN DEFINITIVA DEL VPS 🔥"
echo "============================================="

cd $APP_DIR

echo "1. 🛑 Deteniendo procesos antiguos..."
pm2 delete all || true

echo "2. 🗑️  Limpiando instalación corrupta..."
rm -rf node_modules package-lock.json

echo "3. 📦 Instalando TODAS las dependencias (incluyendo dev)..."
# Importante: flag --production=false para asegurar que se instale TODO
npm install --production=false

echo "4. 🏗️  Reconstruyendo proyecto..."
npm run build

echo "5. ⚙️  Configurando entorno de producción..."
# Aseguramos que el archivo .env.production tenga los datos críticos
cat > .env.production <<'EOF'
PORT=5000
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat
SESSION_SECRET=7f8a9b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z
EOF

echo "6. 🚀 Arrancando aplicación con configuración explícita..."
# Usamos ecosystem si existe, sino comando manual robusto
if [ -f ecosystem.config.cjs ]; then
    echo "   -> Usando ecosystem.config.cjs"
    pm2 start ecosystem.config.cjs --env production
else
    echo "   -> Usando comando manual de emergencia"
    # Exportamos variables explícitamente y lanzamos node directo para evitar intermediarios
    pm2 start "NODE_ENV=production PORT=5000 DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat SESSION_SECRET=7f8a9b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0u1v2w3x4y5z node dist/index.cjs" --name "michat"
fi

echo "7. 💾 Guardando estado de PM2..."
pm2 save --force

echo "8. ✅ Verificando logs..."
sleep 3
pm2 logs michat --lines 20 --nostream
