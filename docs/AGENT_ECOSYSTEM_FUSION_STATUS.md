# Agent Ecosystem Fusion Status

## Scope

This workspace cloned and registered the following agent ecosystem stack under:

- `external/agent_ecosystem`

Source list:

- `external/agent_ecosystem/repos.list`
- `external/agent_ecosystem/fusion.endpoints.env.example`

## Clone Status

- Target repos: 17
- Cloned repos: 17
- Clone coverage: 100%

Note:

- The provided URL `https://github.com/nicepkg/openclaw.git` does not exist publicly.
- It was replaced with `https://github.com/openclaw/openclaw.git` as `openclaw-upstream`.

## Fusion Mode (No API Keys)

Default fusion policy is local-first and API-keyless:

- `AGENT_ECOSYSTEM_LOCAL_ONLY=true` (default)
- Code unification via cloned repos + adapters (`repo_search`, `repo_read`, `repo_exec`, `repo_probe`)
- Runtime orchestration via local compose/services and control-plane adapters
- No requirement of external API keys to validate integration health/control

Optional HTTP proxy for local services exists but is disabled by default:

- `AGENT_ECOSYSTEM_ENABLE_PROXY=false` (default in local-only mode)

## Operational Commands

Use from workspace root:

```bash
pnpm ecosystem:status
pnpm ecosystem:fusion-report
pnpm ecosystem:deep-audit
pnpm ecosystem:sync
```

Control-plane endpoints (main software -> ecosystem):

- `GET /api/agent-ecosystem/status`
- `GET /api/agent-ecosystem/status?deep=true` (status + deep audit embebido)
- `POST /api/agent-ecosystem/repos/search` (code search in one/all repos)
- `POST /api/agent-ecosystem/repos/read` (safe file read)
- `POST /api/agent-ecosystem/repos/exec` (guarded command execution per repo)
- `POST /api/agent-ecosystem/repos/probe` (runtime adapter probe one/all repos)
- `POST /api/agent-ecosystem/deep-audit` (auditoría profunda: adapter + runtime + smoke + gaps)
- `POST /api/agent-ecosystem/proxy` (optional; disabled by default in local-only mode)

Bring up core runtime stack:

```bash
docker compose -f docker-compose.agent-ecosystem.yml --profile core up -d
```

Bring up your app with the stack:

```bash
docker compose -f docker-compose.agent-ecosystem.yml --profile core --profile app up -d
```

Bring up observability layer:

```bash
docker compose -f docker-compose.agent-ecosystem.yml --profile observability up -d
```

## Fusion Definition Used

- Clone fusion: repository presence in local workspace.
- Runtime fusion: capability reachable either as Docker service or control-plane runtime adapter per repo.
- Code-level fusion: adapters/tools/wrappers so your app can invoke project capabilities through a unified contract.
- Control-plane fusion: `/api/agent-ecosystem/*` and `agent_ecosystem_*` tools can orchestrate stack status, compose, sync, and per-repo execution from the main software.
- Total fusion metric: `softwareFusionPct` (code-integrated OR runtime-integrated), exposed by `pnpm ecosystem:fusion-report`.
- Deep fusion metric: `deepFusionPct` (pondera nivel real por modo de integración: embedded > docker-compose > sdk+adapter > adapter genérico).
- Experiential fusion metric: `experientialFusionPct` (resultado operativo real por repo: clone + adapter + runtime + smoke checks), expuesto por `pnpm ecosystem:deep-audit`.
