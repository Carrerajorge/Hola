# ILIAGPT

ILIAGPT is a full-stack AI chat and agentic automation platform with multi-provider LLM support, tools, document analysis, and an admin dashboard.

This repository contains the codebase after the rebrand from **MICHAT** to **ILIAGPT**.

## Repo Layout

- `client/`: React + Vite UI
- `server/`: Express API + agent system
- `migrations/`: database migrations (Drizzle)
- `docs/`: specs, architecture notes, and reference docs
- `docker-compose.yml`: local infrastructure (Postgres + Redis + Meilisearch)
- `docker-compose.prod.yml` / `Dockerfile`: production container build

## Quickstart (Local Development)

### Prerequisites

- Node.js 20 (recommended)
- Docker (recommended for Postgres/Redis/Meilisearch)

### Install

```bash
npm ci
```

### Configure Environment

Create a `.env` file in the repo root. Use `.env.example` as a reference (it documents required variables).

Minimum required:

- `DATABASE_URL`
- `SESSION_SECRET`
- at least one LLM key: `XAI_API_KEY` or `GEMINI_API_KEY` or `OPENAI_API_KEY`

### Start Local Services (Recommended)

```bash
docker compose up -d
```

### Run the App

```bash
npm run dev
```

The server serves the API and the client on the same port (default: `5000` unless `PORT` is set).

## Testing

```bash
npm run verify
```

If you are running in a restricted/sandboxed environment that blocks `listen(2)` (some sandboxes do), you can still run type-check + build:

```bash
npm run verify:sandbox
```

E2E (Playwright):

```bash
npm run test:e2e
```

In GitHub Actions, Playwright E2E runs only when a PR is labeled `run-e2e`.

## Deployment

- PR-first GitHub flow: see `docs/GITHUB_FLOW_DEPLOY.md`
- Production deploy runbook: see `docs/DEPLOY-GUIDE.md`
- Production Compose file: `docker-compose.prod.yml`
- Production env template: `.env.production.example`

## Security

Please report vulnerabilities privately. See `SECURITY.md`.

## License

MIT. See `LICENSE`.

