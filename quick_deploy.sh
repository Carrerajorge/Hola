#!/bin/bash

# Quick deployment script for iliagpt.com
# This script will:
# 1. Pull latest changes
# 2. Rebuild the application
# 3. Restart PM2

echo "🚀 Deploying to iliagpt.com (69.62.98.126)..."

# Add the host key if needed (run once)
# ssh-keyscan -H 69.62.98.126 >> ~/.ssh/known_hosts

ssh root@69.62.98.126 << 'ENDSSH'
cd /var/www/michat

echo "📥 Pulling latest changes..."
git pull origin main

echo "📦 Installing dependencies..."
npm install

echo "🏗️ Building application..."
npm run build

echo "🔄 Restarting PM2..."
pm2 restart michat --update-env
pm2 restart michat-worker --update-env

echo "📊 PM2 Status:"
pm2 status

echo "✅ Deployment completed!"
echo "🔍 Checking logs for errors..."
pm2 logs michat --lines 20 --nostream

ENDSSH

echo ""
echo "✅ Deployment script finished!"
echo "🌐 Check: https://iliagpt.com/api/auth/google"
