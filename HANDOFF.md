# MEMORY.md — Long-term notes

## Hola / iliagpt — deploy + caching + UX

### Google OAuth refresh_token persistence (2026-02-05)
- Symptom in prod: `auth_tokens` rows existed for provider `google` but `refresh_token` was NULL (`has_refresh = f`).
- Root cause: OAuth start route `/api/auth/google` only used `prompt=select_account` and did **not** request offline access/consent, so Google did not issue `refresh_token`.
- Code fix: update `server/routes.ts` Google auth route to include:
  - `accessType: "offline"`
  - `prompt: "consent select_account"`
  (Strategy-side changes alone were insufficient; the params must be in the authorization request.)
- Verification method:
  - Confirm redirect contains params:
    - `curl -sI https://iliagpt.com/api/auth/google | grep -i '^location:'` → must include `access_type=offline` and `prompt=consent...`.
  - After re-consent (often requires revoking access in Google Account), verify DB:
    - `docker exec -it iliagpt-postgres-1 psql -U postgres -d iliagpt -c "select user_id, provider, (refresh_token is not null) as has_refresh, updated_at from auth_tokens order by updated_at desc limit 10;"`
    - Expected: newest Google row has `has_refresh = t`.
- Ops pitfall encountered: duplicate Docker Compose stacks.
  - Old stack `hola-*` was still running and binding port `5000`, causing deploy failure: `Bind for 0.0.0.0:5000 failed: port is already allocated`.
  - Fix: stop old stack then redeploy canonical stack:
    - `docker compose -p hola -f docker-compose.prod.yml down`
    - `docker compose -p iliagpt -f docker-compose.prod.yml up -d --build`
  - After this, `iliagpt-app-1` binds `0.0.0.0:5000->5000`.
- Reminder: production deploy is from `/opt/hola` and always use `-p iliagpt` to avoid creating `hola-*` stacks.

### Working agreement (Alexis)
- **Persist every meaningful change in memory** (what changed + why + commands run + test summary + any prod steps) to avoid repeating past issues after resets.

### Golden rules
- Every meaningful change is only “done” after running **>= 1000 tests** and reporting the summary (include the Vitest summary lines).
- **Production deploy happens from the VPS directory `/opt/hola`** (this is the canonical deploy dir; avoid confusion with other folders).
- On VPS, prefer a clean, deterministic deploy:
  - `cd /opt/hola && git fetch origin && git checkout main && git pull --ff-only origin main`
  - Avoid making local edits to tracked deploy files in `/opt/hola` (they block fast-forward pulls).

### Production: avoid black screens / stale UI
- If users see old UI but incognito works: suspect **PWA/Service Worker cache**.
- Implemented build-time cache-bust by auto-versioning `dist/public/sw-cleanup.js` (`APP_VERSION=build-<timestamp>`).

### Production: nginx + assets returning HTML
- Symptom: `https://iliagpt.com/assets/*.js` returning `text/html` (index.html) → black screen.
- Root cause observed: nginx proxied to **wrong port** (`127.0.0.1:5001`) while app served on **5000**.
- Fix decision: **unify nginx to 5000** so HTML and assets are served coherently.

### VPS Docker/Compose stability (2026-02-05)
- Stabilized production in repo (merged to `main`):
  - Docker entrypoint uses `dist/index.cjs`.
  - App healthcheck hits `http://127.0.0.1:5000/health` (IPv4), and uses `wget -qO-` (letter O).
  - Worker healthcheck disabled (worker is not HTTP).
  - Replit auth no longer crashes if `REPL_ID` is missing; returns `503 AUTH_NOT_CONFIGURED`.

### Production DB migrations + pgvector (2026-02-05)
- Intermittent `INTERNAL_ERROR` on `/welcome` traced to 500s from missing DB tables (e.g. `ai_models`, `sessions`, `api_logs`).
- `drizzle-kit push` was not usable inside the production container because `drizzle.config.ts` (and `/drizzle` folder) are **not copied** into the runtime image.
- Applying SQL migrations initially failed due to missing pgvector (`type "vector" does not exist`).
- Fix that worked:
  - Reset schema and enable extensions on DB `iliagpt`:
    - `DROP SCHEMA public CASCADE; CREATE SCHEMA public;`
    - `CREATE EXTENSION IF NOT EXISTS pgcrypto;`
    - `CREATE EXTENSION IF NOT EXISTS vector;`
  - Apply `/opt/hola/migrations/*.sql` via `psql` into `iliagpt-postgres-1`.
  - Restart app; `/api/models/available` returned 200 (`{"models":[]}`) and `/welcome` stopped failing.

### Deploy pitfall: duplicate Compose project stacks
- If you run `docker compose up` from `/opt/hola` without `-p iliagpt`, Compose will create a new stack named `hola-*` (folder name).
- This can lead to two parallel stacks (`hola-*` and `iliagpt-*`) and confusion/502s.
- Canonical command (always include `-p`):
  - `docker compose -p iliagpt -f docker-compose.prod.yml up -d --build`

### Deploy runbook: when builds get “Killed” / deploy gets stuck (2026-02-05)
- Symptom: `docker compose ... up -d --build` runs for a long time then ends with `Killed` during `exporting layers`.
- Practical fix that worked on VPS:
  1) Add swap (mitigates build peaks / BuildKit pressure):
     - `fallocate -l 4G /swapfile || dd if=/dev/zero of=/swapfile bs=1M count=4096`
     - `chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile`
     - `free -h` should show Swap > 0.
  2) Build **sequentially** (avoid parallel app+worker peak):
     - `docker compose -p iliagpt -f docker-compose.prod.yml down`
     - `docker compose -p iliagpt -f docker-compose.prod.yml build app`
     - `docker compose -p iliagpt -f docker-compose.prod.yml build worker`
     - `docker compose -p iliagpt -f docker-compose.prod.yml up -d`

### Deploy runbook: app healthy-check stuck / DB timeout but Postgres is up (network/DNS)
- Symptom: app logs show `Failed to connect to database: Connection terminated due to connection timeout` and container keeps restarting, while `iliagpt-postgres-1` says “ready to accept connections”.
- Root cause observed: `iliagpt-app-1` ended up attached to **no Docker network**, so hostname `postgres` didn’t resolve.
- Fast diagnosis:
  - `docker inspect -f '{{.Name}} -> {{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' iliagpt-app-1 iliagpt-postgres-1`
  - If app shows no networks but postgres shows `iliagpt_app-network`, DNS will fail.
- Fast fix:
  - `docker network connect iliagpt_app-network iliagpt-app-1`
  - `docker restart iliagpt-app-1`
  - Verify: inside app `node -e 'require("dns").lookup("postgres", console.log)'`.
- If port mappings are wrong after manual network attach, recreate app cleanly:
  - `docker compose -p iliagpt -f docker-compose.prod.yml up -d --force-recreate --no-deps app`

### Ops hygiene
- Don’t keep backups inside sensitive config dirs (e.g. **no nginx backups** in `/etc/nginx/sites-enabled/` or you can hit `duplicate listen`).
- Keep VPS deploy dir clean. Move stray backups to something like `/root/hola-compose-backups/<timestamp>/`.

### Production: default models in `ai_models` (2026-02-06)
- Symptom: `/api/models/available` returned `{"models":[]}` when `ai_models` was empty.
- Cause: `server/seed-production.ts` only enables models if the rows exist; it does **not** create missing rows.
- Permanent fix: add idempotent migration `migrations/0008_seed_gemini_models.sql` that:
  - INSERTs baseline Gemini models (`provider='google'`) with `is_enabled='true'` and `enabled_at=NOW()`.
  - Ensures stable UI ordering by setting `display_order` to 10/20/30/40 via an idempotent UPDATE when rows already existed with 0/NULL order.
- VPS apply:
  - `docker exec -i iliagpt-postgres-1 psql -U postgres -d iliagpt -v ON_ERROR_STOP=1 < /opt/hola/migrations/0008_seed_gemini_models.sql`
- Verify:
  - DB: `select model_id, display_order from ai_models where provider='google' order by display_order asc;`
  - API: `curl -fsS http://127.0.0.1:5000/api/models/available`

## Iliagpt — roadmap input document ("Super Agente Digital")
- User provided canonical requirements doc (62 pages) as the target capability set to implement in iliagpt:
  - https://docs.google.com/document/d/e/2PACX-1vRmnbTpfi4bjsQc663qYRLv1jLvec3nJxDIrSWnYn6nZyTS2I4m7nqC6jvfoilFUrch_hC9elure1nz/pub
- High-level constraints / working agreement:
  - Should eventually "do everything" (broad agent capabilities), with WhatsApp + other channels enabled.
  - Runs on Alexis' VPS for now.
  - Workflow: PR → run >=1000 tests (capture Vitest summary) → deploy to production.
- Local cached copy for reference:
  - `requirements/super-agente-digital-100_2026-02-06.md`
