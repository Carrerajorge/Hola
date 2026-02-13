#!/bin/bash
set -e

VPS_HOST="69.62.98.126"
VPS_USER="root"
REMOTE_ENV_PATH="/var/www/iliagpt/.env.production"
# Alternate path if user is using 'michat' folder
REMOTE_ENV_PATH_ALT="/var/www/michat/.env.production"

echo "🚀 Fixing VPS Environment Variables on $VPS_HOST..."

ssh "$VPS_USER@$VPS_HOST" "
    # 1. Determine which directory is active
    if [ -d \"/var/www/iliagpt\" ]; then
        TARGET_ENV=\"$REMOTE_ENV_PATH\"
        WORKDIR=\"/var/www/iliagpt\"
    elif [ -d \"/var/www/michat\" ]; then
        TARGET_ENV=\"$REMOTE_ENV_PATH_ALT\"
        WORKDIR=\"/var/www/michat\"
    else
        echo '❌ Could not find app directory!'
        exit 1
    fi

    echo \"📂 Active directory: \$WORKDIR\"
    cd \$WORKDIR

    # 2. Backup existing .env
    cp .env.production .env.production.bak

    # 3. Ensure PORT=5001
    if grep -q \"PORT=\" .env.production; then
        sed -i 's/^PORT=.*/PORT=5001/' .env.production
    else
        echo \"PORT=5001\" >> .env.production
    fi
    echo \"✅ Set PORT=5001\"

    # 4. Check for DATABASE_URL (Critical for start)
    if ! grep -q \"DATABASE_URL=\" .env.production; then
        echo \"❌ DATABASE_URL is missing! Adding default Docker placeholder...\"
        echo \"DATABASE_URL=postgresql://postgres:postgres@localhost:5432/iliagpt\" >> .env.production
        echo \"⚠️ Added default DB URL. You might need to edit this manually if using a different password!\"
    fi
    
    # 5. Check for SESSION_SECRET
    if ! grep -q \"SESSION_SECRET=\" .env.production; then
        echo \"SESSION_SECRET=$(openssl rand -hex 32)\" >> .env.production
        echo \"✅ Added SESSION_SECRET\"
    fi

    echo \"🔄 Restarting PM2...\"
    pm2 restart all --update-env
    pm2 save
    
    echo \"🎉 Environment fixed and server restarted!\"
"
