# OPS Deploy Checklist — iliagpt (VPS)

Canonical VPS deploy directory: **/opt/hola**
Canonical compose project name: **iliagpt**

## 0) Pre-flight
```bash
cd /opt/hola

git status --porcelain
# If non-empty, DO NOT "just pull". Stash or discard local edits first:
#   git stash push -m "wip before deploy"

# Optional sanity:
docker compose ls
```

## 1) Update code deterministically
```bash
git fetch origin
git checkout main
git pull --ff-only origin main
```

## 2) Build + run (safe mode)
### If you ever see `Killed` during `exporting layers`
Add swap once (recommended on small VPS / to avoid build peaks):
```bash
fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096
chmod 600 /swapfile
mkswap /swapfile
swapon /swapfile
free -h
```

Build **sequentially** (avoid app+worker peak):
```bash
docker compose -p iliagpt -f docker-compose.prod.yml down
docker compose -p iliagpt -f docker-compose.prod.yml build app
docker compose -p iliagpt -f docker-compose.prod.yml build worker
docker compose -p iliagpt -f docker-compose.prod.yml up -d
```

## 3) Port 5000 conflict (duplicate stacks)
Symptom:
- `Bind for 0.0.0.0:5000 failed: port is already allocated`

Fix:
```bash
# identify who owns 5000
docker ps --format "table {{.Names}}\t{{.Ports}}" | grep 5000 || true

# if you see hola-app-1, remove the accidental stack:
docker compose -p hola -f docker-compose.prod.yml down

# then start canonical stack:
docker compose -p iliagpt -f docker-compose.prod.yml up -d
```

## 4) App unhealthy / DB timeout while Postgres is healthy (Docker DNS/network)
Symptom:
- app logs: `Failed to connect to database: Connection terminated due to connection timeout`
- postgres logs: `ready to accept connections`

Diagnosis:
```bash
docker inspect -f '{{.Name}} -> {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' \
  iliagpt-app-1 iliagpt-postgres-1
```
If app shows **no networks**, it cannot resolve host `postgres`.

Fix:
```bash
docker network ls | grep iliagpt
# usually: iliagpt_app-network

docker network connect iliagpt_app-network iliagpt-app-1
docker restart iliagpt-app-1

# verify DNS inside app
docker exec -it iliagpt-app-1 sh -lc 'node -e "require(\"dns\").lookup(\"postgres\", console.log)"'
```
If port mapping got lost due to manual attach, recreate app cleanly (no rebuild):
```bash
docker compose -p iliagpt -f docker-compose.prod.yml up -d --force-recreate --no-deps app
```

## 5) Post-deploy verification
```bash
# containers
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# app health (from VPS)
curl -sS http://127.0.0.1:5000/health

# public check
curl -sSI https://iliagpt.com | head
```

## 6) UI looks old but incognito works (PWA/SW cache)
- Hard refresh / clear site storage.
- Chrome DevTools → Application → Clear storage → Clear site data.
