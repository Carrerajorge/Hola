# OpenClaw vs Hermes vs Hola-live Capability Matrix

## Purpose

This matrix decides, subsystem by subsystem, whether `Hola-live` should:

- adopt existing embedded OpenClaw behavior
- reimplement Hermes-inspired behavior natively
- integrate both behind a cleaner boundary
- ignore the subsystem

## Summary Table

| Subsystem | OpenClaw | Hermes Agent | Hola-live Today | Decision |
| --- | --- | --- | --- | --- |
| Channel ingress/egress | Strong | Present but not primary fit here | Present via embedded OpenClaw paths | Keep OpenClaw |
| Session routing/binding | Strong | Strong | Partial/product-specific | Keep OpenClaw, adapt at boundary |
| Agent workflow kernel | Present but oriented to OpenClaw runtime | Strong | Fragmented across product services | Reimplement natively |
| Durable runs/resume | Partial | Strong | Inconsistent | Reimplement natively |
| Cron/scheduled jobs | Strong | Strong | Partial | Reimplement with OpenClaw-compatible surface |
| Context files / workspace memory | Strong | Strong | Partial | Reimplement product-native |
| Local operator dashboard | Emerging | Strong | Fragmented admin surfaces | Reimplement and unify |
| Plugin / extension runtime | Strong | Different philosophy | Embedded OpenClaw present | Keep OpenClaw |
| ACP / registry adapters | Strong | Strong | Partial | Integrate after kernel exists |
| Multi-agent spawning | Strong | Strong | Partial | Reimplement around native kernel |
| Tool execution safety | Strong | Strong | Mixed | Keep OpenClaw shell + harden product layer |
| Personal assistant UX conventions | Strong | Strong | Mixed | Selectively absorb |

## Detailed Decisions

### 1. Channel Ingress / Egress

OpenClaw is already the correct foundation here.

Why:

- embedded in this repo already
- designed for many messaging surfaces
- already fits the current product direction better than replacing transport with Hermes runtime

Decision:

- retain OpenClaw as canonical channel transport layer
- do not replace with Hermes transport stack

### 2. Session Routing And Conversation Binding

OpenClaw should stay authoritative for message/session attachment.

Decision:

- use OpenClaw for conversation/session binding
- expose a narrow handoff into a native `agent-kernel`

Needed boundary:

- channel event -> session context -> kernel run request

### 3. Workflow / Agent Kernel

This is the biggest missing clean layer in `Hola-live`.

Observation:

- `Hola-live` has lots of agent-like behavior
- logic is spread across services rather than centralized in one durable workflow engine
- Hermes is a better reference than a direct dependency here

Decision:

- create a native `agent-kernel`
- model long-running tasks, retries, waits, resumptions, workflow orchestration
- do not embed Hermes runtime directly

### 4. Durable Runs And Resume

Hermes is especially strong as a product pattern for continuity and resumability.

Decision:

- reimplement durable run primitives in TypeScript
- persist run state in the product’s own storage model
- allow OpenClaw sessions to trigger/resume these runs

Core primitives to add:

- run id
- status
- checkpoints
- retry policy
- wait condition
- resume token / binding

### 5. Cron / Scheduled Work

Both upstreams have meaningful scheduling ideas.

Decision:

- build a native scheduler inside `agent-kernel`
- optionally mirror or bridge selected OpenClaw cron semantics later

Do not:

- run multiple unrelated schedulers as first-class peers

### 6. Context Files / Memory Shaping

This is a strong overlap area.

Decision:

- keep workspace/context-file discipline
- implement product-native context assembly with:
  - workspace files
  - chat/session state
  - task state
  - selected skills/tools

Goal:

- one context assembly pipeline, not per-runtime ad hoc assembly

### 7. Local Operator Dashboard

Hermes has strong product inspiration here.

Decision:

- reimplement the dashboard concept in `Hola-live`
- unify:
  - sessions
  - tasks
  - schedules
  - channel health
  - model/provider health

This should land in existing admin/workspace UI instead of becoming a separate app.

### 8. Plugin / Extension Runtime

OpenClaw already has the more relevant runtime in this repo.

Decision:

- keep OpenClaw plugin/runtime model
- expose product-native services to it where useful
- do not add Hermes plugin internals directly

### 9. ACP / Registry / Adapter Layer

Both ecosystems care about adapters and registries.

Decision:

- do not start here
- add compatibility only after the native `agent-kernel` exists

Rule:

- adapters serve the kernel
- adapters do not define the product’s core state model

### 10. Multi-Agent Orchestration

This should become a kernel concern, not be scattered across features.

Decision:

- model subagent/workflow orchestration natively
- keep spawning interfaces compatible with the OpenClaw shell where possible

### 11. Tool Execution And Safety

OpenClaw already provides a mature shell around tool execution.

Decision:

- retain OpenClaw as outer tool execution shell
- add product-native policy, auditing, and workflow-level controls around it

### 12. Personal Assistant UX Conventions

This is not a single subsystem, but the product feel matters.

Decision:

- absorb only the conventions that improve operator UX and session continuity
- avoid importing personas, commands, or UX metaphors that conflict with `Hola-live`

## Adopt / Reimplement / Ignore Table

| Capability | Action |
| --- | --- |
| OpenClaw channels | Adopt |
| OpenClaw plugin runtime | Adopt |
| OpenClaw session binding | Adopt with boundary cleanup |
| Hermes durable agent-flow ideas | Reimplement |
| Hermes dashboard patterns | Reimplement |
| Hermes resume/session continuity patterns | Reimplement |
| Hermes full runtime | Ignore as direct dependency |
| Duplicate schedulers/runtimes | Avoid |

## Phase 1 Build Order

1. `agent-kernel/runs`
2. `agent-kernel/persistence`
3. `agent-kernel/context`
4. `agent-kernel/scheduler`
5. dashboard surface for runs + schedules
6. OpenClaw handoff boundary

## Exit Criteria For Phase 0

Phase 0 is complete when:

- architecture decision is written
- capability matrix exists
- first native landing zone exists in code
- next implementation slice is unambiguous

This document, together with:

- [openclaw-hermes-reimplementation-plan.md](/Users/ale/.openclaw/workspace/Hola-live/docs/openclaw-hermes-reimplementation-plan.md:1)
- [server/services/agent-kernel/README.md](/Users/ale/.openclaw/workspace/Hola-live/server/services/agent-kernel/README.md:1)

marks that phase as complete.
