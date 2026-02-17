# ILIAGPT - Production Deployment Guide

## Architecture

```
User → iliagpt.com → Nginx (SSL) → Docker Compose
                                    ├── app (Node.js :5000)
                                    ├── worker (BullMQ jobs)
                                    ├── sandbox-runner (:8080)
                                    ├── postgres (pgvector)
                                    └── redis
```

## Prerequisites

- VPS: Ubuntu 22.04+ (min 2GB RAM, 20GB disk)
- Domain: iliagpt.com pointing to VPS IP (100.93.79.71)
- GitHub repo: Carrerajorge/Hola
- At least one LLM API key (Anthropic, OpenAI, Google, xAI, or DeepSeek)

---

## First-Time Setup (run once)

### Step 1: Setup GitHub Secrets

Run this from your Mac terminal, inside the project folder:

```bash
bash scripts/setup-github-secrets.sh
```

This will:
- Generate an SSH deploy key
- Copy the public key to the VPS
- Add the private key as `VPS_SSH_KEY` secret in GitHub

If you don't have `gh` CLI installed:
```bash
brew install gh
gh auth login
```

### Step 2: Setup the VPS

```bash
ssh root@100.93.79.71 'bash -s' < scripts/vps-setup.sh
```

This installs Docker, Nginx, SSL (Let's Encrypt), clones the repo, creates `.env.production`, and starts the application.

### Step 3: Configure API Keys

```bash
ssh root@100.93.79.71
nano /opt/hola/.env.production
```

Set your real API keys, then restart:

```bash
cd /opt/hola
docker compose -p iliagpt -f docker-compose.prod.yml restart app worker
```

### Observabilidad (Prometheus + InfluxDB)

Enable with:

```bash
docker compose -p iliagpt -f docker-compose.prod.yml --profile monitoring up -d
```

Endpoints after startup:

- Prometheus: `http://<host>:${PROMETHEUS_PORT:-9090}`
- InfluxDB UI (incluye explorador/consulta): `http://<host>:${INFLUXDB_PORT:-8086}`

Token compatibility:

- `INFLUXDB_ADMIN_TOKEN` is the preferred variable.
- If still using legacy `INFLUX_TOKEN`, the compose file currently falls back to it automatically.
- Rotate credentials in `/opt/hola/.env.production` after first bootstrap and keep only the preferred variable.

---

## Deploying Updates

### Automatic (recommended)

Every push to `main` triggers the GitHub Actions deploy workflow:

```bash
git add .
git commit -m "your changes"
git push origin main
```

The workflow will:
1. Run CI checks (typecheck, tests, build, audit)
2. SSH into the VPS
3. Pull the latest code
4. Build new Docker images
5. Rolling restart (DB stays up)
6. Health check verification

### Manual Deploy

```bash
# Option 1: Trigger from GitHub CLI
gh workflow run deploy.yml

# Option 2: Trigger with skip CI
gh workflow run deploy.yml -f skip_ci=true

# Option 3: Direct SSH deploy
ssh root@100.93.79.71 << 'EOF'
cd /opt/hola
git pull origin main
docker compose -p iliagpt -f docker-compose.prod.yml build app worker
docker compose -p iliagpt -f docker-compose.prod.yml up -d
EOF
```

---

## Common Operations

### View logs
```bash
ssh root@100.93.79.71 'cd /opt/hola && docker compose -p iliagpt -f docker-compose.prod.yml logs -f app'
```

### Check health
```bash
curl https://iliagpt.com/health
```

### Restart services
```bash
ssh root@100.93.79.71 'cd /opt/hola && docker compose -p iliagpt -f docker-compose.prod.yml restart app worker'
```

### Database backup
```bash
ssh root@100.93.79.71 'docker exec iliagpt-postgres-1 pg_dump -U postgres iliagpt | gzip > /opt/backups/iliagpt_$(date +%Y%m%d).sql.gz'
```

### Rollback
```bash
ssh root@100.93.79.71 << 'EOF'
cd /opt/hola
git checkout HEAD~1
docker compose -p iliagpt -f docker-compose.prod.yml up -d --build
EOF
```

---

## Troubleshooting

**App not responding**: Check container status and logs
```bash
docker compose -p iliagpt -f docker-compose.prod.yml ps
docker compose -p iliagpt -f docker-compose.prod.yml logs --tail=100 app
```

**Database connection timeout**: Verify network
```bash
docker network inspect iliagpt_app-network
docker compose -p iliagpt -f docker-compose.prod.yml up -d --force-recreate
```

**SSL certificate renewal**: Auto-renews via cron, but to force:
```bash
certbot renew --force-renewal --post-hook 'systemctl reload nginx'
```

**Disk space**: Clean old Docker images
```bash
docker system prune -af --volumes
```
