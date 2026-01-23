#!/bin/bash
# MICHAT VPS Deployment Script
# Usage: ./deploy.sh

set -e

VPS_USER="root"
VPS_HOST="69.62.98.126"
VPS_PATH="/var/www/michat"

echo "🚀 Deploying MICHAT to VPS..."

# 1. Build locally
echo "📦 Building locally..."
npm run build

# 2. Commit and push changes
echo "📤 Pushing to Git..."
git add .
git commit -m "Deploy $(date '+%Y-%m-%d %H:%M')" || echo "No changes to commit"
git push origin main

echo ""
echo "✅ Code pushed! Now run these commands on VPS:"
echo ""
echo "  cd /var/www/michat"
echo "  git pull origin main"
echo "  npm run build" 
echo "  pm2 restart michat"
echo ""
echo "Or connect via: ssh root@69.62.98.126"
