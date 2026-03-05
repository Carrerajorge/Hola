#!/bin/bash
set -e

# Make executable
# chmod +x scripts/init-local.sh

echo "Installing dependencies..."
npm install

echo "Starting Docker containers..."
docker-compose up -d

echo "Waiting for database to be ready..."
sleep 5

echo "Pushing database schema..."
npm run db:push

# Optional: Seed data if needed
# npm run db:seed

echo "Setup complete! Run 'npm run dev' to start the server."
