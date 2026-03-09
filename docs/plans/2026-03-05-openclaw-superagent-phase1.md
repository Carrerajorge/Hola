# OpenClaw Superagent Fusion - Phase 1

Date: 2026-03-05

## What changed in this pass

- Mounted `openclawRuntimeRouter` at `/api/openclaw/runtime`.
- Added a central control-plane policy for model roles in `server/services/agentControlPlane.ts`.
- Switched `AgentRunner` planning from hardcoded Gemini-only logic to the control-plane brain model with fallbacks.
- Exposed `GET /api/openclaw/runtime/control-plane`.
- Extended `GET /api/openclaw/runtime/health` with brain/research/speed role visibility and capability flags.
- Updated `server/workers/agentWorker.ts` to stop using stale model assignments.

## Current runtime status

Verified locally on `http://127.0.0.1:5001`:

- `GET /api/openclaw/runtime/health` -> 200
- `GET /api/openclaw/runtime/skills` -> 200
- `GET /api/openclaw/runtime/control-plane` -> 200

Observed active capabilities:

- background tasks: enabled
- persistent subagents: enabled
- browser automation: enabled
- long-term memory: enabled
- continuous supervision: enabled

## Current model policy

Desired product policy:

- brain: `claude-opus-4-6`
- research: `gemini-2.5-pro`
- search_memory: `gpt-5.2`
- speed: `grok-4-1-fast-non-reasoning`
- image: `nano-banana-pro`
- video: `veo-3.1-preview`

Current active local resolution depends on configured keys.
On this machine during this pass:

- brain -> `gpt-5.2`
- research -> `gemini-2.5-pro`
- search_memory -> `gpt-5.2`
- speed -> `grok-4-1-fast-non-reasoning`
- image -> `nano-banana-pro`
- video -> `veo-3.1-preview`

Note:

- `claude-opus-4-6` is still the preferred brain, but it was not active because `ANTHROPIC_API_KEY` was not configured in the local runtime.

## Upstream merge gap

Local vendored OpenClaw:

- `server/openclaw/package.json` version: `2026.2.25`

Requested upstream target:

- `openclaw/openclaw` tag: `v2026.3.2`
- release URL: `https://github.com/openclaw/openclaw/releases/tag/v2026.3.2`

The diff against `/tmp/openclaw-v2026.3.2` is large and spans many files across:

- `.github`
- `apps/android`
- `apps/macos`
- `src/agents`
- `src/infra`
- `README.md`
- `CHANGELOG.md`
- `package.json`

Conclusion:

- Do not overwrite `server/openclaw` blindly.
- Cherry-pick or port release changes by area:
  1. cron and heartbeat reliability
  2. session store/cache invalidation
  3. hook stability and hook payload parity
  4. plugin install compatibility and diagnostics
  5. secrets coverage and config UX

## Open source projects worth integrating

Official sources checked on 2026-03-05:

- `browser-use/browser-use`
  - URL: https://github.com/browser-use/browser-use
  - Why: strongest fit for resilient browser task execution and extraction loops.
- `langfuse/langfuse`
  - URL: https://github.com/langfuse/langfuse
  - Why: agent observability, evals, prompt/version tracking, run analytics.
- `qdrant/qdrant`
  - URL: https://github.com/qdrant/qdrant
  - Why: production-grade vector memory for long-term retrieval and agent memory layers.
- `n8n-io/n8n`
  - URL: https://github.com/n8n-io/n8n
  - Why: durable integrations and external workflow automation with hundreds of connectors.
- `temporalio/temporal`
  - URL: https://github.com/temporalio/temporal
  - Why: durable background workflows, retries, recovery, long-running supervision loops.
- `mem0ai/mem0`
  - URL: https://github.com/mem0ai/mem0
  - Why: opinionated memory layer for agents; useful if native memory abstractions remain fragmented.

## Immediate next steps

1. Port high-value OpenClaw `v2026.3.2` changes into `server/openclaw/src/infra` and `server/openclaw/src/agents`.
2. Replace the simplistic `server/services/orchestrationEngine.ts` with role-aware planning and execution.
3. Add runtime endpoints for cron jobs, background exec sessions, and heartbeats.
4. Wire Langfuse and Qdrant into the control-plane status page.
5. Introduce durable workflow execution for recurrent jobs, preferably Temporal or a thinner persisted scheduler.
6. Fix baseline TypeScript errors in `shared/schema/*` before widening CI gates.

## Phase 2 update

Implemented in this pass:

- Added a host-native background scheduler in `server/services/openclawTaskRuntime.ts`.
- Added direct process supervision in `server/services/openclawProcessRuntime.ts`.
- Exposed runtime routes for:
  - `GET /api/openclaw/runtime/background/status`
  - `GET /api/openclaw/runtime/background/wakes`
  - `GET|POST|PATCH|DELETE /api/openclaw/runtime/background/cron/jobs`
  - `POST /api/openclaw/runtime/background/cron/jobs/:jobId/run`
  - `GET /api/openclaw/runtime/background/cron/runs`
  - `POST /api/openclaw/runtime/background/cron/wake`
  - `GET /api/openclaw/runtime/background/processes`
  - `GET /api/openclaw/runtime/background/processes/:sessionId/log`
  - `POST /api/openclaw/runtime/background/processes/:sessionId/{poll,write,send-keys,submit,paste,kill,clear}`
  - `DELETE /api/openclaw/runtime/background/processes/:sessionId`

Design note:

- This pass uses OpenClaw contracts and portable modules directly (`cron/types`, `cron/store`, `cron/run-log`, `cron/normalize`, `bash-process-registry`) but does not boot the upstream cron gateway wholesale.
- Reason: the vendored upstream runtime still has unresolved local boot issues in this repo (`logging/subsystem` initialization order and missing transitive deps for alternate copies), so a selective code fusion was safer than forcing the full gateway runtime.

Verification in this pass:

- `npx vitest run server/services/openclawTaskRuntime.test.ts server/services/openclawProcessRuntime.test.ts server/__tests__/openclawRuntimeRouter.test.ts`
- `npm run build`
- Live GET checks on local dev server:
  - `GET /api/openclaw/runtime/background/status` -> 200
  - `GET /api/openclaw/runtime/background/cron/jobs` -> 200
  - `GET /api/openclaw/runtime/background/processes` -> 200

Known limitation:

- In the full app runtime, unsafe HTTP methods on these routes still pass through the global CSRF middleware, so browser/UI clients must send the normal CSRF token to create/update/run jobs.
