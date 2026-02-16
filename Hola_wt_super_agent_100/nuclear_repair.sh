#!/bin/bash
# NUCLEAR REPAIR SCRIPT
# Run this on the VPS to completely reset and rebuild the application

set -e # Exit on error

APP_DIR="/var/www/michat"

echo "☢️  INITIATING NUCLEAR REPAIR ☢️"
cd $APP_DIR

echo "1. Stopping all processes..."
pm2 delete all || true
pm2 flush

echo "2. Wiping artifacts and dependencies..."
rm -rf node_modules package-lock.json dist

echo "3. Cleaning npm cache..."
npm cache clean --force

echo "4. Installing dependencies (FRESH)..."
# We install EVERYTHING including devDeps to ensure build works
npm install

echo "5. Building application..."
npm run build

echo "6. Forcing .env.production creation..."
cat > .env.production <<'EOF'
PORT=5001
NODE_ENV=production
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat
SESSION_SECRET=nuclear_launch_detected_secure_key
EOF

echo "7. Starting application..."
# Using the most basic, robust start command possible
# Injecting env vars directly to ensure they persist
pm2 start npm --name "michat" -- start --update-env \
  PORT=5001 \
  NODE_ENV=production \
  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/michat \
  SESSION_SECRET=nuclear_launch_detected_secure_key

echo "8. Saving PM2 state..."
pm2 save --force

echo "✅ DONE. Tailing logs..."
pm2 logs michat --lines 20 --nostream
