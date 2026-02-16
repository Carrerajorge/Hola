#!/bin/bash
set -e

VPS_HOST="69.62.98.126"
VPS_USER="root"
VPS_DIR="/var/www/michat"

# echo "🚀 Building application locally..."
# npm run build (Skipped due to local EPERM, building on VPS instead)

echo "📤 Syncing files to VPS..."
rsync -avz --delete \
  --exclude 'node_modules' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude 'dist' \
  ./ "$VPS_USER@$VPS_HOST:$VPS_DIR"

# echo "📤 Syncing build artifacts..."
# rsync -avz --delete ./dist/ "$VPS_USER@$VPS_HOST:$VPS_DIR/dist/"

echo "🔄 Installing dependencies, building, and restarting application on VPS..."
ssh "$VPS_USER@$VPS_HOST" "cd $VPS_DIR && npm install && npm run build && npm run db:push && pm2 restart michat --update-env"

echo "✅ Deployment complete! Check https://iliagpt.com"
