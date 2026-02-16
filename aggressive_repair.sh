#!/bin/bash
set -e

# Configuration
VPS_HOST="69.62.98.126"
VPS_USER="root"
APP_DIR="/var/www/michat"

echo "🔥 INICIANDO REPARACIÓN AGRESIVA EN $VPS_HOST..."

ssh "$VPS_USER@$VPS_HOST" "
    set -e
    echo '📂 Entrando al directorio...'
    cd $APP_DIR

    echo '⚙️  REPARANDO .ENV (Sobreescribiendo configuración rota)...'
    # Intentar preservar DATABASE_URL si existe en algún backup o archivo viejo, si no, usar default
    # Pero dado el error, asumimos que no está cargando.
    
    # Check if .env.production exists and has content, otherwise create default
    if [ -f .env.production ] && grep -q 'DATABASE_URL' .env.production; then
        echo '✅ .env.production existe y tiene DB URL. Asegurando otros valores...'
    else
        echo '⚠️ .env.production roto o inexistente. Creando uno nuevo...'
        cat > .env.production <<EOF
PORT=5000
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat
SESSION_SECRET=\$(openssl rand -hex 32)
EOF
    fi

    # Ensure SESSION_SECRET exists
    if ! grep -q 'SESSION_SECRET' .env.production; then
        echo \"SESSION_SECRET=\$(openssl rand -hex 32)\" >> .env.production
    fi

    echo '⬇️  Actualizando código...'
    git pull origin main

    echo '📦 Reinstalando dependencias (Clean Install)...'
    rm -rf node_modules
    npm ci --include=dev

    echo '🏗️  Reconstruyendo...'
    npm run build

    echo '🗄️  FORZANDO SINCRONIZACIÓN DE BASE DE DATOS...'
    # Force push schema to fix 'relation does not exist' errors
    npm run db:push

    echo '🔄 Reiniciando PM2 agresivamente...'
    pm2 delete michat || true
    pm2 start npm --name 'michat' -- start --update-env
    pm2 save

    echo '✅ Estado del servicio:'
    pm2 status
    sleep 2
    pm2 logs michat --lines 20 --nostream
"

echo "✅ REPARACIÓN COMPLETADA."
