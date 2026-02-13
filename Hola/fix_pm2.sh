#!/bin/bash
set -e

VPS_HOST="69.62.98.126"
VPS_USER="root"
WORKDIR="/var/www/michat"

echo "🚀 Fixing PM2 Process Path on $VPS_HOST..."

ssh "$VPS_USER@$VPS_HOST" "
    echo '📂 Navigating to $WORKDIR...'
    cd $WORKDIR || { echo '❌ Directory not found!'; exit 1; }

    echo '🛑 Deleting old PM2 process...'
    pm2 delete michat || echo '⚠️ Process michat not found, skipping delete.'

    echo '🏗️  Ensuring build is fresh...'
    npm run build

    echo '🚀 Starting new PM2 process from correct path...'
    # Use npm start to leverage package.json configuration
    pm2 start npm --name 'michat' -- start

    echo '💾 Saving PM2 list...'
    pm2 save

    echo '📊 Checking status...'
    pm2 status

    echo '📝 Tail logs...'
    sleep 2
    pm2 logs michat --lines 20 --nostream
"

echo "✅ PM2 Process fixed."
