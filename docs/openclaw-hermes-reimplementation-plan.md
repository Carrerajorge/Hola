# OpenClaw + Hermes Reimplementation Plan

## Objective

Absorb the best ideas from:

- `openclaw/openclaw`
- `NousResearch/hermes-agent`

Then reimplement and integrate them cleanly into `Hola-live` instead of trying to hard-fork or glue together two large upstream products.

## Current State In This Repo

`Hola-live` already embeds OpenClaw as a first-class dependency and workspace package:

- [pnpm-workspace.yaml](/Users/ale/.openclaw/workspace/Hola-live/pnpm-workspace.yaml:1)
- [server/openclaw/package.json](/Users/ale/.openclaw/workspace/Hola-live/server/openclaw/package.json:1)
- [Dockerfile](/Users/ale/.openclaw/workspace/Hola-live/Dockerfile:24)

This means OpenClaw is already structurally inside the product.

Hermes Agent is not integrated in the repo today. It should be treated as a source of architecture patterns and implementation ideas, not as something to vendor wholesale.

## High-Level Decision

Do **not** attempt a direct merge of OpenClaw + Hermes Agent.

Reasons:

- OpenClaw here is already embedded and adapted to the current product.
- Hermes Agent is a separate runtime and product surface with different packaging and lifecycle assumptions.
- A direct merge would create overlapping agent loops, duplicated config systems, duplicated task schedulers, and incompatible operational expectations.

The right approach is:

1. Reverse engineer both systems.
2. Extract the valuable concepts and boundaries.
3. Reimplement those capabilities natively in `Hola-live`.
4. Integrate behind existing auth, data, channel, and UI patterns.

## What To Take From OpenClaw

OpenClaw is strongest as the channel/gateway/control-plane layer.

Keep and strengthen:

- Multi-channel ingress/egress
- Session routing and conversation binding
- Tool execution plumbing
- Plugin/extension runtime
- Gateway-style control surfaces
- Canvas / live surface concepts where useful

OpenClaw should remain the outer communications and orchestration shell.

## What To Take From Hermes Agent

Hermes is strongest as an agent-product pattern reference.

Reimplement these ideas in TypeScript inside `Hola-live`:

- Better local dashboard / operator UX
- Stronger context-file conventions
- Durable cron/task execution model
- Cleaner ACP / registry / adapter boundaries
- Faster developer ergonomics around setup, resume, and session continuity
- Potentially improved agent workflow patterns for long-running jobs

Do **not** copy Hermes runtime as-is. Recreate the good parts in the current stack.

## Recommended Target Architecture

### Layer 1: Channel + Control Plane

Backed by the existing embedded OpenClaw package.

Responsibilities:

- receive user messages
- normalize channel events
- map conversations to sessions
- expose tool and plugin surfaces

### Layer 2: Agent Kernel

New `Hola-live` native layer.

Responsibilities:

- run durable tasks
- manage plans, waits, resumes, retries
- handle context assembly
- orchestrate subagents/workflows

This is where Hermes-inspired ideas should land.

### Layer 3: Product Runtime

Existing `Hola-live` business features.

Responsibilities:

- chat experience
- document generation
- automation features
- admin/workspace UX
- billing, auth, analytics

### Layer 4: Operator UI

A unified dashboard for:

- sessions
- tasks
- scheduled jobs
- connectors/channels
- agent health
- model/provider routing

This is the best place to absorb the Hermes local dashboard idea.

## Integration Strategy

### Phase 0: Reverse Engineering Inventory

Create a subsystem map for both upstreams.

Inventory buckets:

- session model
- task model
- cron/scheduler model
- config/context model
- tool registry model
- dashboard/admin surfaces
- persistence boundaries
- auth assumptions

Output:

- one capability matrix
- one “adopt vs reimplement vs ignore” table

### Phase 1: Native Agent Kernel In `Hola-live`

Build a new internal kernel instead of importing Hermes runtime code.

First capabilities:

- durable run state
- resumable task execution
- explicit wait/retry lifecycle
- scheduled jobs
- context bundle assembly

Suggested modules:

- `server/services/agent-kernel/`
- `server/services/agent-kernel/scheduler/`
- `server/services/agent-kernel/context/`
- `server/services/agent-kernel/runs/`

### Phase 2: Dashboard Unification

Expose kernel state and OpenClaw state in one admin surface.

Views:

- active sessions
- queued jobs
- cron schedules
- failed runs
- channel health
- tool/provider health

### Phase 3: ACP / Adapter Compatibility

Only after the native kernel exists.

Goal:

- support selected Hermes/OpenClaw-compatible interfaces
- avoid copying internals
- keep `Hola-live` as the system of record

### Phase 4: Selective Feature Parity

Implement only the Hermes features that improve the product:

- better local web operator UI
- stronger context-file workflows
- more ergonomic session resume
- durable background jobs

Ignore anything that duplicates current product value without clear gain.

## Concrete Recommendation

For `Hola-live`, the best blend is:

- **OpenClaw as infrastructure**
- **Hermes as product-pattern inspiration**
- **Reimplementation in TypeScript as the execution path**

That gives:

- less architectural debt
- less duplicated runtime logic
- easier debugging
- cleaner future upgrades from upstream OpenClaw

## What Not To Do

- Do not vendor Hermes wholesale into `Hola-live`
- Do not run two competing agent runtimes inside the same request path
- Do not create parallel config systems for sessions, tools, or scheduling
- Do not bolt a Hermes UI on top of unrelated backend semantics

## First Execution Slice

The first practical slice should be:

1. document a capability matrix between embedded OpenClaw and Hermes Agent
2. build a native `agent-kernel` folder in `Hola-live`
3. start with durable runs + scheduler + context assembly
4. add an admin dashboard page for those primitives

If done correctly, later Hermes-inspired features become additive instead of invasive.

## Verdict

This should be executed as:

**reverse engineering + selective reimplementation + staged integration**

Not as a repo merge.
