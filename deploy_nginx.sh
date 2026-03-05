#!/bin/bash
set -e

# Configuration
VPS_HOST="69.62.98.126"
VPS_USER="root"
LOCAL_NGINX_CONF="nginx.conf"
REMOTE_NGINX_PATH="/etc/nginx/sites-available/iliagpt"
LOCAL_MAINTENANCE_PAGE="nginx/maintenance.html"
REMOTE_MAINTENANCE_PAGE="/etc/nginx/html/maintenance.html"

echo "🚀 Deploying Nginx Configuration to $VPS_HOST..."

# Check if local file exists
if [ ! -f "$LOCAL_NGINX_CONF" ]; then
    echo "❌ Error: $LOCAL_NGINX_CONF not found in current directory."
    exit 1
fi

# Check if maintenance page exists (best-effort)
if [ ! -f "$LOCAL_MAINTENANCE_PAGE" ]; then
    echo "⚠️  Warning: $LOCAL_MAINTENANCE_PAGE not found. Custom error_page may 404."
fi

# Upload file
echo "📤 Uploading configuration..."
scp "$LOCAL_NGINX_CONF" "$VPS_USER@$VPS_HOST:/tmp/iliagpt_nginx_new"
if [ -f "$LOCAL_MAINTENANCE_PAGE" ]; then
    echo "📤 Uploading maintenance page..."
    scp "$LOCAL_MAINTENANCE_PAGE" "$VPS_USER@$VPS_HOST:/tmp/iliagpt_maintenance_new"
fi

# Apply configuration
echo "🔄 Applying configuration and testing..."
ssh "$VPS_USER@$VPS_HOST" "
    echo 'Backup existing config...'
    BACKUP_PATH=\"${REMOTE_NGINX_PATH}.bak_\$(date +%s)\"
    cp $REMOTE_NGINX_PATH \"\$BACKUP_PATH\"

    echo 'Replacing config...'
    mv /tmp/iliagpt_nginx_new $REMOTE_NGINX_PATH

    if [ -f /tmp/iliagpt_maintenance_new ]; then
        echo 'Installing maintenance page...'
        mkdir -p \"\$(dirname \"$REMOTE_MAINTENANCE_PAGE\")\"
        cp /tmp/iliagpt_maintenance_new \"$REMOTE_MAINTENANCE_PAGE\"
    fi

    echo 'Testing Nginx configuration...'
    nginx -t

    if [ \$? -eq 0 ]; then
        echo '✅ Configuration valid. Reloading Nginx...'
        systemctl reload nginx
        echo '🎉 Success! Nginx reloaded.'
    else
        echo '❌ Configuration invalid! Restoring backup...'
        mv \"\$BACKUP_PATH\" $REMOTE_NGINX_PATH
        systemctl reload nginx
        exit 1
    fi
"
