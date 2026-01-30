#!/bin/bash
set -e

VPS_HOST="69.62.98.126"
VPS_USER="root"
WORKDIR="/var/www/michat"

echo "Fixing PM2 Process on $VPS_HOST..."

ssh "$VPS_USER@$VPS_HOST" "
    echo 'Navigating to $WORKDIR...'
    cd $WORKDIR || { echo 'Directory not found!'; exit 1; }

    echo 'Verifying .env.production exists...'
    if [ ! -f .env.production ]; then
        echo 'ERROR: .env.production not found. Create it first with DATABASE_URL and SESSION_SECRET.'
        exit 1
    fi

    echo 'Deleting old PM2 process...'
    pm2 delete michat || echo 'Process michat not found, skipping delete.'

    echo 'Building...'
    npm run build

    echo 'Pushing database schema...'
    npm run db:push

    echo 'Starting PM2 with ecosystem config...'
    pm2 start ecosystem.config.cjs

    echo 'Saving PM2 list...'
    pm2 save

    echo 'Checking status...'
    pm2 status

    echo 'Tail logs...'
    sleep 3
    pm2 logs michat --lines 30 --nostream
"

echo "PM2 Process fixed."
