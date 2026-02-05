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
        SESSION_SECRET_VALUE=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        TOKEN_ENCRYPTION_KEY_VALUE=$(openssl rand -hex 32 2>/dev/null || node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
        cat > .env.production <<ENDOFENV
PORT=5001
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat
SESSION_SECRET=$SESSION_SECRET_VALUE
TOKEN_ENCRYPTION_KEY=$TOKEN_ENCRYPTION_KEY_VALUE
ENDOFENV
    else
        echo '.env.production ya existe y tiene DATABASE_URL'
    fi
    echo '📋 .env.production (redacted):'
    awk -F= 'BEGIN{redact["DATABASE_URL"]=1; redact["SESSION_SECRET"]=1; redact["TOKEN_ENCRYPTION_KEY"]=1; redact["GOOGLE_CLIENT_SECRET"]=1; redact["MICROSOFT_CLIENT_SECRET"]=1; redact["AUTH0_CLIENT_SECRET"]=1; redact["OPENAI_API_KEY"]=1; redact["GEMINI_API_KEY"]=1; redact["XAI_API_KEY"]=1; redact["ANTHROPIC_API_KEY"]=1; redact["STRIPE_SECRET_KEY"]=1; redact["STRIPE_WEBHOOK_SECRET"]=1; redact["RESEND_API_KEY"]=1; redact["TWILIO_AUTH_TOKEN"]=1; redact["ADMIN_PASSWORD"]=1}
      {k=$1; if (redact[k]) print k"=***REDACTED***"; else print $0}' .env.production

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
