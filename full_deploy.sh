#!/bin/bash
set -e

VPS_HOST="69.62.98.126"
VPS_USER="root"
APP_DIR="/var/www/michat"

echo "🚀 DESPLIEGUE COMPLETO A VPS..."
echo "========================================"

ssh "$VPS_USER@$VPS_HOST" "
    set -e
    
    echo '📂 Entrando a $APP_DIR...'
    cd $APP_DIR

    echo ''
    echo '🔄 PASO 1: Actualizando código desde GitHub...'
    git fetch origin main
    git reset --hard origin/main

    echo ''
    echo '🗑️  PASO 2: Limpiando node_modules (instalación fresca)...'
    rm -rf node_modules

    echo ''
    echo '📦 PASO 3: Instalando TODAS las dependencias...'
    npm ci --include=dev

    echo ''
    echo '🏗️  PASO 4: Compilando cliente y servidor...'
    npm run build

    echo ''
    echo '⚙️  PASO 5: Configurando variables de entorno...'
    if [ ! -f .env.production ] || ! grep -q 'DATABASE_URL' .env.production; then
        echo 'Creando .env.production...'
        cat > .env.production <<'ENDOFENV'
PORT=5000
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat
SESSION_SECRET=supersecret123456789abcdefghij12
ENDOFENV
    else
        echo '.env.production ya existe y tiene DATABASE_URL'
    fi
    cat .env.production

    echo ''
    echo '🗄️  PASO 6: Sincronizando base de datos...'
    npm run db:push

    echo ''
    echo '🔄 PASO 7: Reiniciando PM2...'
    pm2 kill || true
    pm2 start npm --name 'michat' --cwd $APP_DIR -- start
    pm2 save --force

    echo ''
    echo '✅ PASO 8: Verificando estado...'
    pm2 status
    sleep 3
    echo ''
    echo '📝 Últimos logs:'
    pm2 logs michat --lines 30 --nostream
"

echo ""
echo "✅ DESPLIEGUE COMPLETADO"
