# System Overview

This document describes how the application works end-to-end (client, server, persistence, agentic runtime), and where the main cross-cutting concerns live (auth, security, policies, observability).

## High-Level Architecture

The app is a single-page React client backed by an Express API server. Postgres is the primary source of truth. Redis is optional and used for select caching/streaming features when configured.

```text
┌──────────────┐        HTTP(S)         ┌───────────────────────────────┐
│   Browser    │  ───────────────────▶  │         Express API           │
│  (React UI)  │                        │   (routes + middleware)       │
└──────────────┘                        ├───────────────┬───────────────┤
                                        │               │               │
                                        ▼               ▼               ▼
                                   ┌─────────┐     ┌─────────┐    ┌──────────┐
                                   │ Postgres│     │  Redis  │    │ LLM APIs  │
                                   │ (Drizzle)     │ (opt.)  │    │ (xAI/...) │
                                   └─────────┘     └─────────┘    └──────────┘
                                            ▲
                                            │
                                            ▼
                                   ┌────────────────┐
                                   │ Integrations    │
                                   │ (Gmail/WhatsApp)│
                                   └────────────────┘
```

## Server Startup & Bootstrap

Entry-point: `server/index.ts`

1. Environment is validated on boot via `server/config/env.ts` (Zod schema).
2. Core middleware is registered in a security-first order (logger, compression, CORS, security headers).
3. Auth/session is initialized (`setupAuth`) before middleware that relies on `req.user`/`req.session`.
4. API middleware is applied (`csrfProtection`, `rateLimiter`, `idempotency`).
5. Routes are registered via `registerRoutes` / `server/routes.ts`.
6. Health checks and graceful shutdown hooks are configured.

## HTTP Middleware Pipeline (Conceptual)

Order matters because some middleware depends on state produced by earlier middleware.

```text
request
  -> request logger / tracer
  -> compression
  -> CORS
  -> security headers (helmet + HPP)
  -> CSRF token cookie (double submit pattern)
  -> session + passport (req.session / req.user)
  -> CSRF validation (mutations only; disabled in NODE_ENV=test)
  -> user-based rate limiting
  -> idempotency (mutations)
  -> routes
  -> apiErrorHandler
  -> errorHandler
response
```

## Agentic Runtime (Core Mental Model)

There are two primary execution paths:

1. **Chat path**: single-step conversational response.
2. **Agent path**: multi-step, tool-using execution with a run lifecycle.

Key pieces:

- **Complexity / routing**: `POST /api/chat/complexity` returns recommended execution path and model hints.
- **Agent runs**: `/api/agent/*` provides run creation/status + event stream.
- **Tool registry**: server-side tool execution with policy enforcement and audit logging.

### Run Lifecycle

The run state machine lives in `server/agent/stateMachine.ts` and supports intermediate states (e.g. replanning, awaiting confirmation) to keep the runtime resilient and debuggable.

### Tool Execution Safety

The tool execution entrypoint is `server/agent/toolRegistry.ts`. It enforces:

- **PolicyEngine** checks (tool allow/deny, sandbox access, network access policy).
- **IntegrationPolicy** allow/deny lists for connectors/tools.
- Optional strict tool-output contract validation (see `AGENTIC_STRICT_TOOL_OUTPUT_VALIDATION`).
- User-level feature gates (e.g. web search disabled in settings must be enforced server-side).

## Persistence Model (Pragmatic View)

- Postgres stores application state (users, chats, messages, runs, settings, etc).
- Redis is optional; when configured it powers targeted performance/scalability features:
  - rate limiting distribution
  - streaming fan-out (SSE) where enabled
  - select caches

## Security Model (What We Rely On)

- Session cookies (httpOnly) for authentication where applicable.
- CSRF protection using double-submit cookie + header on mutations (disabled in `NODE_ENV=test` for integration tests).
- RBAC for admin/workspace gated operations.
- Tool-level policy enforcement to prevent prompt injection from escalating capabilities.
- Audit logging (mutations) in non-test environments; in tests it is disabled to keep tests hermetic.

## Observability & Operations

Health:
- `GET /api/health` (basic status + process metrics)
- `GET /api/health/live` (liveness probe)
- `GET /api/health/ready` (readiness probe, DB health summary)

Metrics / tracing:
- OpenTelemetry initialization is controlled by server boot; console exporter is used for development.

## Testing

Unit tests:
- `npm run test:run` (Vitest)

Agentic API integration tests (real server):
- `npm run test:agentic:integration`

Test environment behaviors (`NODE_ENV=test`) are intentionally more hermetic:
- CSRF validation disabled (server-side).
- Session store uses in-memory storage (no DB `sessions` table requirement).
- Global audit middleware is disabled by default.
- Redis-backed caches/queues are disabled unless explicitly enabled.

## Where To Look (Directory Map)

- Client UI: `client/src/*`
- API routes: `server/routes.ts` and `server/routes/*`
- Agentic engine: `server/agent/*`
- Auth/session: `server/replit_integrations/auth/*`
- Middleware: `server/middleware/*`
- Persistence: `server/db.ts`, `server/storage.ts`, `shared/schema/*`, `migrations/*`
- Tests: `server/__tests__/*`, `tests/*`

