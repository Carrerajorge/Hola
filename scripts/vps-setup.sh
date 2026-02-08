#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ILIAGPT - VPS Initial Setup Script
# Run this ONCE on a fresh Ubuntu 22.04+ VPS
# Usage: ssh root@69.62.98.126 'bash -s' < scripts/vps-setup.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}▸ $1${NC}"; }
warn() { echo -e "${YELLOW}⚠ $1${NC}"; }
err()  { echo -e "${RED}✗ $1${NC}"; exit 1; }

echo "═══════════════════════════════════════════"
echo "  ILIAGPT - VPS Initial Setup"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "═══════════════════════════════════════════"
echo ""

# ── 1. System updates ──
log "Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq
apt-get install -y -qq curl git ufw certbot python3-certbot-nginx fail2ban htop

# ── 2. Setup swap (4GB) for small VPS ──
if [ ! -f /swapfile ]; then
  log "Creating 4GB swap file..."
  fallocate -l 4G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  # Optimize swap settings
  sysctl vm.swappiness=10
  echo 'vm.swappiness=10' >> /etc/sysctl.conf
else
  log "Swap already exists, skipping..."
fi

# ── 3. Install Docker ──
if ! command -v docker &>/dev/null; then
  log "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  log "Docker installed: $(docker --version)"
else
  log "Docker already installed: $(docker --version)"
fi

# ── 4. Install Docker Compose plugin ──
if ! docker compose version &>/dev/null; then
  log "Installing Docker Compose plugin..."
  apt-get install -y -qq docker-compose-plugin
  log "Docker Compose installed: $(docker compose version)"
else
  log "Docker Compose already installed: $(docker compose version)"
fi

# ── 5. Install Node.js 20 (for migrations & scripts) ──
if ! command -v node &>/dev/null; then
  log "Installing Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y -qq nodejs
  log "Node.js installed: $(node --version)"
else
  log "Node.js already installed: $(node --version)"
fi

# ── 6. Setup firewall ──
log "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp    # SSH
ufw allow 80/tcp    # HTTP
ufw allow 443/tcp   # HTTPS
echo "y" | ufw enable
ufw status

# ── 7. Clone repository ──
DEPLOY_PATH="/opt/hola"
if [ ! -d "$DEPLOY_PATH" ]; then
  log "Cloning repository..."
  git clone https://github.com/Carrerajorge/Hola.git "$DEPLOY_PATH"
else
  log "Repository already exists at $DEPLOY_PATH"
  cd "$DEPLOY_PATH"
  git fetch origin main
  git checkout main
  git pull --ff-only origin main
fi

cd "$DEPLOY_PATH"

# ── 8. Create .env.production ──
if [ ! -f .env.production ]; then
  log "Creating .env.production..."
  SESSION_SECRET=$(openssl rand -hex 32)
  TOKEN_ENCRYPTION_KEY=$(openssl rand -hex 32)
  SANDBOX_TOKEN=$(openssl rand -hex 16)

  cat > .env.production << ENVEOF
# ═══════════════════════════════════════════
# ILIAGPT Production Environment
# Generated: $(date '+%Y-%m-%d %H:%M:%S')
# ═══════════════════════════════════════════

NODE_ENV=production
PORT=5000
BASE_URL=https://iliagpt.com
ALLOWED_ORIGINS=https://iliagpt.com,https://www.iliagpt.com

# Database (Docker internal)
DATABASE_URL=postgres://postgres:postgres@postgres:5432/iliagpt

# Session & Security
SESSION_SECRET=${SESSION_SECRET}
TOKEN_ENCRYPTION_KEY=${TOKEN_ENCRYPTION_KEY}

# Admin
ADMIN_EMAIL=carrerajorge874@gmail.com
ADMIN_PASSWORD=CHANGE_ME_NOW_min12chars

# Redis & Meilisearch (Docker internal)
REDIS_URL=redis://redis:6379
MEILI_URL=http://meilisearch:7700
MEILI_API_KEY=

# Sandbox runner
SANDBOX_RUNNER_TOKEN=${SANDBOX_TOKEN}

# ─── LLM Providers (set at least one) ───
XAI_API_KEY=
GEMINI_API_KEY=
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
DEEPSEEK_API_KEY=

# ─── OAuth (optional) ───
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
MICROSOFT_CLIENT_ID=
MICROSOFT_CLIENT_SECRET=
MICROSOFT_TENANT_ID=

# ─── Email (optional) ───
RESEND_API_KEY=
EMAIL_FROM=

# ─── Payments (optional) ───
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
ENVEOF

  warn "IMPORTANT: Edit .env.production with your real API keys!"
  warn "Run: nano /opt/hola/.env.production"
else
  log ".env.production already exists"
fi

# ── 9. Setup Nginx ──
log "Configuring Nginx..."
apt-get install -y -qq nginx

cat > /etc/nginx/sites-available/iliagpt << 'NGINXEOF'
server {
    server_name iliagpt.com www.iliagpt.com;
    client_max_body_size 50M;

    location ^~ /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 86400;
    }

    listen 80;
    listen [::]:80;
}
NGINXEOF

ln -sf /etc/nginx/sites-available/iliagpt /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── 10. SSL Certificate ──
log "Setting up SSL with Let's Encrypt..."
if [ ! -d /etc/letsencrypt/live/iliagpt.com ]; then
  certbot --nginx -d iliagpt.com -d www.iliagpt.com \
    --non-interactive --agree-tos --email carrerajorge874@gmail.com \
    --redirect
  log "SSL certificate installed!"
else
  log "SSL certificate already exists"
  certbot renew --dry-run
fi

# ── 11. Setup auto-renewal cron ──
log "Setting up SSL auto-renewal..."
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --post-hook 'systemctl reload nginx'") | sort -u | crontab -

# ── 12. Build & Start ──
log "Building and starting ILIAGPT..."
cd "$DEPLOY_PATH"
docker compose -p iliagpt -f docker-compose.prod.yml build
docker compose -p iliagpt -f docker-compose.prod.yml up -d

# ── 13. Wait for health ──
log "Waiting for application to start..."
for i in $(seq 1 30); do
  if curl -sf http://127.0.0.1:5000/health > /dev/null 2>&1; then
    echo ""
    log "Application is healthy!"
    break
  fi
  if [ "$i" -eq 30 ]; then
    warn "Health check timed out. Check logs with:"
    warn "  docker compose -p iliagpt -f docker-compose.prod.yml logs app"
  fi
  printf "."
  sleep 5
done

# ── Final Status ──
echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}✓ ILIAGPT VPS Setup Complete!${NC}"
echo "═══════════════════════════════════════════"
echo ""
docker compose -p iliagpt -f docker-compose.prod.yml ps
echo ""
echo "Next steps:"
echo "  1. Edit API keys:  nano /opt/hola/.env.production"
echo "  2. Restart app:    cd /opt/hola && docker compose -p iliagpt -f docker-compose.prod.yml up -d"
echo "  3. View logs:      docker compose -p iliagpt -f docker-compose.prod.yml logs -f app"
echo "  4. Check health:   curl https://iliagpt.com/health"
echo ""
