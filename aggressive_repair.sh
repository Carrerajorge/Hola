#!/bin/bash
set -e

# Configuration
VPS_HOST="69.62.98.126"
VPS_USER="root"
APP_DIR="/var/www/michat"

echo "STARTING AGGRESSIVE REPAIR ON $VPS_HOST..."

ssh "$VPS_USER@$VPS_HOST" "
    set -e
    echo 'Entering directory...'
    cd $APP_DIR

    echo 'Checking .env.production...'
    # Ensure .env.production exists with required values
    if [ ! -f .env.production ]; then
        echo '.env.production not found. Creating default...'
        cat > .env.production <<EOF
PORT=5001
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat
SESSION_SECRET=\$(openssl rand -hex 32)
EOF
    fi

    # Ensure SESSION_SECRET exists
    if ! grep -q 'SESSION_SECRET' .env.production; then
        echo \"SESSION_SECRET=\$(openssl rand -hex 32)\" >> .env.production
    fi

    echo 'Updating code...'
    git pull origin main

    echo 'Reinstalling dependencies (Clean Install)...'
    rm -rf node_modules
    npm ci --include=dev

    echo 'Rebuilding...'
    npm run build

    echo 'Forcing database schema sync...'
    npm run db:push

    echo 'Restarting PM2...'
    pm2 delete michat || true
    pm2 start ecosystem.config.cjs
    pm2 save

    echo 'Service status:'
    pm2 status
    sleep 3
    pm2 logs michat --lines 30 --nostream
"

echo "REPAIR COMPLETED."
