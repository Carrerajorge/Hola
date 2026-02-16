#!/bin/bash
set -e

# Configuration
VPS_HOST="69.62.98.126"
VPS_USER="root"
VPS_PORT="${VPS_PORT:-8022}"
LOCAL_NGINX_CONF="nginx.conf"
REMOTE_NGINX_PATH="/etc/nginx/sites-available/iliagpt"

echo "🚀 Deploying Nginx Configuration to $VPS_HOST..."

# Check if local file exists
if [ ! -f "$LOCAL_NGINX_CONF" ]; then
    echo "❌ Error: $LOCAL_NGINX_CONF not found in current directory."
    exit 1
fi

# Upload file
echo "📤 Uploading configuration..."
scp -P "$VPS_PORT" "$LOCAL_NGINX_CONF" "$VPS_USER@$VPS_HOST:/tmp/iliagpt_nginx_new"

# Apply configuration
echo "🔄 Applying configuration and testing..."
ssh -p "$VPS_PORT" "$VPS_USER@$VPS_HOST" "
    echo 'Backup existing config...'
    cp $REMOTE_NGINX_PATH ${REMOTE_NGINX_PATH}.bak_$(date +%s)
    
    echo 'Replacing config...'
    mv /tmp/iliagpt_nginx_new $REMOTE_NGINX_PATH
    
    echo 'Testing Nginx configuration...'
    nginx -t
    
    if [ \$? -eq 0 ]; then
        echo '✅ Configuration valid. Reloading Nginx...'
        systemctl reload nginx
        echo '🎉 Success! Nginx reloaded.'
    else
        echo '❌ Configuration invalid! Restoring backup...'
        mv ${REMOTE_NGINX_PATH}.bak_* $REMOTE_NGINX_PATH
        systemctl reload nginx
        exit 1
    fi
"
