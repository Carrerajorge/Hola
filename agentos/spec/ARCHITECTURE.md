# AgentOS-ASI Architecture Specification

**Version:** 1.0.0
**Status:** Draft
**Last Updated:** 2026-03-05

---

## Table of Contents

1. [Overview](#overview)
2. [Design Principles](#design-principles)
3. [System Topology](#system-topology)
4. [Plane Specifications](#plane-specifications)
   - [Control Plane](#1-control-plane-neuro-symbolic-cerebro)
   - [Model Plane](#2-model-plane)
   - [Data Plane](#3-data-plane)
   - [Knowledge Plane](#4-knowledge-plane)
   - [Action Plane](#5-action-plane)
   - [Memory](#6-memory)
   - [UI Plane](#7-ui-plane)
   - [SDK](#8-sdk)
5. [Data Flow](#data-flow)
6. [Invariants](#invariants)
7. [Deployment Model](#deployment-model)
8. [References](#references)

---

## Overview

AgentOS-ASI is a distributed agent operating system designed to orchestrate autonomous AI agents with safety, auditability, and extensibility as first-class concerns. The system decomposes agent behavior into eight cooperating planes, each independently deployable and horizontally scalable, communicating over a durable event bus.

The architecture draws from three traditions:

- **Operating systems design** -- process isolation, capability-based security, resource scheduling.
- **Distributed systems** -- event sourcing, CQRS, saga orchestration, circuit breakers.
- **Cognitive architectures** -- neuro-symbolic reasoning, working/episodic/persistent memory, metacognitive monitoring.

---

## Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Safety by construction** | Invariants are enforced structurally, not by convention. |
| P2 | **Audit everything** | Every state transition is an immutable event. |
| P3 | **Least privilege** | Each plane and plugin receives only the capabilities it needs. |
| P4 | **Model-agnostic** | No plane assumes a specific LLM provider or architecture. |
| P5 | **Graceful degradation** | Plane failures are isolated; the system continues in reduced mode. |
| P6 | **Human-in-the-loop by default** | Escalation gates require explicit opt-out, never implicit bypass. |
| P7 | **Deterministic replay** | Any past execution can be replayed from its event log. |
| P8 | **Plugin-first extensibility** | Core planes expose extension points; custom logic ships as plugins. |

---

## System Topology

```
                          +---------------------------+
                          |        UI PLANE           |
                          | (Agentic Console, DAG Viz)|
                          +------------+--------------+
                                       |
                                       | WebSocket / SSE
                                       |
+------------------------------------------------------------------------------+
|                              CONTROL PLANE                                   |
|                        (Neuro-Symbolic Cerebro)                              |
|                                                                              |
|   +-----------+     +------------+     +----------+     +---------+          |
|   |  PLANNER  +---->+  EXECUTOR  +---->+  CRITIC  +---->+  JUDGE  |          |
|   +-----------+     +------------+     +----------+     +---------+          |
|        ^                   |                |                |               |
|        |                   |                |                |               |
|        +-------------------+----------------+----------------+               |
|                            | feedback loop                                   |
+--------+----------+-------+--------+----------+---------+----------+---------+
         |          |                 |          |         |          |
         v          v                 v          v         v          v
  +-----------+ +--------+    +------------+ +-------+ +--------+ +-----+
  |  MODEL    | |  DATA  |    | KNOWLEDGE  | |ACTION | |MEMORY  | | SDK |
  |  PLANE    | | PLANE  |    |   PLANE    | |PLANE  | |        | |     |
  +-----------+ +--------+    +------------+ +-------+ +--------+ +-----+
  |Multi-model| |Event   |    |RAG++       | |Play-  | |Working | |WASM |
  |router,    | |sourcing|    |Evidence    | |wright,| |Episodic| |gRPC |
  |provider   | |CQRS,   |    |packs,      | |MCP,   | |Persist.| |MCP  |
  |abstraction| |durable |    |provenance  | |Teleph.| |Privacy | |     |
  +-----------+ |exec.   |    +------------+ +-------+ +--------+ +-----+
                +--------+
```

### Inter-Plane Communication

```
+----------+       +-----------------+       +----------+
|  Plane A +------>+  Event Bus      +------>+  Plane B |
|          |       | (NATS JetStream |       |          |
|          |       |  / Kafka)       |       |          |
+----------+       +-----------------+       +----------+
     |                     |                      |
     |              +------+------+               |
     |              | Event Store |               |
     |              | (append-only|               |
     |              |  log)       |               |
     |              +-------------+               |
     |                                            |
     +------------ gRPC (sync calls) ------------+
```

**Transport rules:**

- **Commands** flow synchronously via gRPC with deadlines.
- **Events** flow asynchronously via the event bus.
- **Queries** are served from read-model projections (CQRS).
- All messages carry a `correlation_id`, `causation_id`, and `trace_id` (OpenTelemetry compatible).

---

## Plane Specifications

### 1. Control Plane (Neuro-Symbolic Cerebro)

The control plane is the cognitive core. It implements a four-stage reasoning loop inspired by metacognitive architectures.

#### Architecture

```
                        +-------------------+
                        |   TASK INTAKE     |
                        | (goal, constraints|
                        |  capabilities)    |
                        +--------+----------+
                                 |
                                 v
                        +--------+----------+
                        |     PLANNER       |
                        | - HTN decomposer  |
                        | - LLM chain-of-   |
                        |   thought         |
                        | - Constraint       |
                        |   propagation     |
                        +--------+----------+
                                 |
                          Plan DAG (nodes = sub-tasks,
                          edges = dependencies)
                                 |
                                 v
                        +--------+----------+
                        |    EXECUTOR       |
                        | - Saga orchestr.  |
                        | - Parallel exec.  |
                        | - Compensation    |
                        |   handlers        |
                        +--------+----------+
                                 |
                          Execution trace +
                          intermediate results
                                 |
                                 v
                        +--------+----------+
                        |     CRITIC        |
                        | - Output quality  |
                        | - Constraint      |
                        |   satisfaction    |
                        | - Safety checks   |
                        +--------+----------+
                                 |
                          Critique report
                          (pass / revise / abort)
                                 |
                                 v
                        +--------+----------+
                        |      JUDGE        |
                        | - Final gate      |
                        | - Human escalation|
                        | - Policy enforce  |
                        +--------+----------+
                                 |
                          Decision: APPROVE / REVISE / ESCALATE / ABORT
                                 |
               +-----------------+-----------------+
               |                 |                 |
            APPROVE           REVISE           ESCALATE
               |                 |                 |
               v                 v                 v
          Emit result     Return to          Notify human
          events          PLANNER            via UI Plane
```

#### Components

| Component | Responsibility | Inputs | Outputs |
|-----------|---------------|--------|---------|
| **Planner** | Decomposes goals into executable DAGs using hierarchical task networks (HTN) augmented by LLM reasoning. Applies symbolic constraints (deadlines, budgets, capability requirements). | Goal spec, agent capabilities, world state snapshot | Plan DAG, resource estimates |
| **Executor** | Orchestrates plan DAG execution as a distributed saga. Manages parallelism, retries, compensation. Dispatches sub-tasks to Action Plane. | Plan DAG, execution context | Execution trace, intermediate artifacts |
| **Critic** | Evaluates executor output against quality criteria, constraint satisfaction, and safety policies. Uses a separate LLM call with evaluation rubrics. | Execution trace, quality rubrics, safety policies | Critique report (score, issues, recommendation) |
| **Judge** | Final decision gate. Applies organizational policy. Decides approve/revise/escalate/abort. Manages human-in-the-loop escalation. | Critique report, escalation policy, execution history | Terminal decision + justification |

#### Loop Invariants

- The loop terminates: a maximum retry count `MAX_REVISIONS` (default: 3) is enforced.
- Escalation is mandatory if the Critic reports a safety violation.
- The Judge cannot approve if any CRITICAL-severity issue is unresolved.
- Every loop iteration produces an immutable `CerebroIterationEvent`.

---

### 2. Model Plane

The model plane abstracts LLM providers behind a unified interface and routes requests based on policy.

#### Architecture

```
+-------------------+     +-------------------+     +-------------------+
| Calling Plane     |     |   MODEL PLANE     |     | Provider Pool     |
| (e.g., Control)   |     |                   |     |                   |
|                   +---->+ +---------------+ +---->+ OpenAI            |
|  ModelRequest     |     | | Policy Engine | |     | Anthropic         |
|  {task_type,      |     | +-------+-------+ |     | Google            |
|   complexity,     |     |         |         |     | Local (vLLM)      |
|   budget,         |     | +-------v-------+ |     | Custom gRPC       |
|   latency_sla}    |     | | Router        | |     |                   |
|                   |     | +-------+-------+ |     |                   |
|                   |<----+ +-------v-------+ +<----+                   |
|  ModelResponse    |     | | Response      | |     |                   |
|                   |     | | Normalizer    | |     |                   |
+-------------------+     | +---------------+ |     +-------------------+
                          +-------------------+
```

#### Routing Policies

| Policy Dimension | Description | Example |
|-----------------|-------------|---------|
| **Task affinity** | Route by task type (code gen, summarization, reasoning). | Code generation prefers Claude; summarization prefers GPT-4o. |
| **Cost budget** | Enforce per-request and per-session cost ceilings. | If remaining budget < $0.10, downgrade to smaller model. |
| **Latency SLA** | Route to lowest-latency provider meeting quality threshold. | Interactive tasks target < 2s TTFT. |
| **Privacy tier** | Some data cannot leave the tenant boundary. | PII-tagged requests route to on-prem vLLM only. |
| **Capability** | Route based on required capabilities (vision, function calling, long context). | Requests with images route to vision-capable models. |
| **Fallback chain** | Automatic failover on provider errors. | Primary: Claude -> Fallback: GPT-4o -> Fallback: local Llama. |

#### Provider Abstraction

Every provider implements the `ModelProvider` interface:

```
interface ModelProvider {
  id: ProviderId
  capabilities: Set<Capability>

  complete(request: CompletionRequest): AsyncStream<CompletionChunk>
  embed(request: EmbedRequest): EmbedResponse

  health(): HealthStatus
  usage(): UsageReport
}
```

The normalizer transforms provider-specific response formats into a canonical `ModelResponse` that includes token counts, cost, latency metrics, and the provider ID for audit.

---

### 3. Data Plane

The data plane provides durable state management using event sourcing and CQRS.

#### Architecture

```
+------------------+          +------------------+
|  COMMAND SIDE    |          |   QUERY SIDE     |
|                  |          |                  |
| +==============+ |  events  | +==============+ |
| | Command      | +--------->+ | Projector    | |
| | Handler      | |          | | (event ->    | |
| +======+=======+ |          | |  read model) | |
|        |         |          | +======+=======+ |
|        v         |          |        |         |
| +==============+ |          | +======v=======+ |
| | Aggregate    | |          | | Read Model   | |
| | (domain      | |          | | (Postgres /  | |
| |  logic)      | |          | | ClickHouse)  | |
| +======+=======+ |          | +==============+ |
|        |         |          +------------------+
|        v         |
| +==============+ |
| | Event Store  | |
| | (append-only)| |
| +==============+ |
+------------------+

        +------------------+
        | DURABLE EXECUTION|
        | (Temporal)       |
        |                  |
        | - Workflow defs  |
        | - Activity impls |
        | - Retry policies |
        | - Compensation   |
        +------------------+
```

#### Event Store Schema

```
Event {
  event_id:       UUID
  stream_id:      StreamId          -- aggregate identity
  sequence_num:   uint64            -- monotonic within stream
  event_type:     string            -- e.g., "TaskCompleted"
  payload:        bytes (CBOR)      -- event data
  metadata: {
    correlation_id: UUID
    causation_id:   UUID
    trace_id:       TraceId
    actor:          ActorId
    timestamp:      Timestamp (UTC)
    schema_version: uint32
  }
}
```

#### Durable Execution

Long-running agent tasks are modeled as Temporal workflows:

- **Workflow**: Defines the high-level task (e.g., "research and write report").
- **Activities**: Individual units of work dispatched to Action Plane.
- **Saga compensation**: If step N fails, steps N-1 ... 1 are compensated in reverse.
- **Heartbeats**: Long activities send heartbeats; missed heartbeats trigger timeout recovery.

---

### 4. Knowledge Plane

The knowledge plane implements RAG++ -- retrieval-augmented generation with evidence packs, provenance tracking, and multi-index search.

#### Architecture

```
+------------------+     +---------------------+     +------------------+
|  Query           |     |   RETRIEVAL ENGINE  |     |  Index Layer     |
|  (from Control   +---->+                     +---->+                  |
|   Plane)         |     | +=========+         |     | Vector (pgvector)|
|                  |     | |Query    |         |     | Full-text (BM25) |
|                  |     | |Planner  |         |     | Graph (Neo4j)    |
|                  |     | +====+====+         |     | Structured (SQL) |
|                  |     |      |              |     +------------------+
|                  |     | +====v====+         |
|                  |     | |Multi-   |         |          +----------+
|                  |     | |Index    |         |          | Evidence |
|                  |     | |Retriever|         +--------->+ Pack     |
|                  |     | +====+====+         |          | Builder  |
|                  |     |      |              |          +----+-----+
|                  |     | +====v====+         |               |
|                  |     | |Re-ranker|         |               v
|                  |<----+ |(cross-  |         |          +----+-----+
|  EvidencePack    |     | |encoder) |         |          | Evidence |
|                  |     | +=========+         |          | Pack     |
+------------------+     +---------------------+          +----------+
```

#### Evidence Pack Structure

```
EvidencePack {
  pack_id:        UUID
  query:          string
  strategy:       RetrievalStrategy

  evidence: [
    {
      chunk_id:     UUID
      source:       SourceReference {
        document_id:  UUID
        uri:          string
        title:        string
        ingested_at:  Timestamp
        content_hash: SHA256
      }
      content:      string
      relevance:    float (0.0 - 1.0)
      provenance: {
        retrieval_method: "vector" | "bm25" | "graph" | "sql"
        index_name:       string
        score_raw:        float
        rerank_score:     float
      }
    }
  ]

  metadata: {
    total_candidates:  uint32
    retrieval_time_ms: uint32
    rerank_model:      string
    freshness:         Timestamp   -- oldest source timestamp
  }
}
```

#### Provenance Guarantees

- Every chunk traces back to an ingested document with a content hash.
- Evidence packs are immutable; re-retrieval creates a new pack.
- Staleness is tracked: the UI and Critic can flag evidence older than a configurable threshold.

---

### 5. Action Plane

The action plane executes side effects in the external world.

#### Capabilities

| Channel | Technology | Use Cases |
|---------|-----------|-----------|
| **Web Automation** | Playwright (CDP) | Form filling, scraping, testing, navigation |
| **MCP (Model Context Protocol)** | MCP client | Tool invocation across MCP-compatible servers |
| **Telephony** | SIP + WebRTC | Outbound/inbound calls, IVR navigation, voicemail |
| **API Calls** | HTTP/gRPC | REST APIs, webhooks, third-party integrations |
| **File System** | Sandboxed FS | Read/write files within agent workspace |
| **Shell** | Sandboxed shell | Execute commands in isolated containers |

#### Sandbox Model

```
+-----------------------------------------------+
|  ACTION PLANE HOST                            |
|                                               |
|  +------------------+   +------------------+  |
|  |  Capability      |   |  Rate Limiter    |  |
|  |  Checker         |   |  (per-agent,     |  |
|  |  (policy engine) |   |   per-channel)   |  |
|  +--------+---------+   +--------+---------+  |
|           |                       |            |
|  +--------v-----------------------v---------+  |
|  |           SANDBOX ORCHESTRATOR           |  |
|  +--+----------+----------+----------+------+  |
|     |          |          |          |         |
|  +--v---+  +--v---+  +--v---+  +--v---+      |
|  |Playw.|  | MCP  |  |Telph.|  | API  |      |
|  |Contx.|  |Client|  |Stack |  |Client|      |
|  +------+  +------+  +------+  +------+      |
|                                               |
|  Each channel runs in an isolated runtime:    |
|  - Playwright: headless browser in container  |
|  - Shell: gVisor / Firecracker microVM        |
|  - Network: egress allowlist per policy       |
+-----------------------------------------------+
```

#### Action Lifecycle

1. **Request**: Control Plane dispatches `ActionRequest` with required capability.
2. **Capability check**: Policy engine verifies the agent has the required capability token.
3. **Rate limit**: Token bucket check (per agent, per channel, per time window).
4. **Execute**: Sandboxed execution with timeout.
5. **Result**: `ActionResult` event emitted (success / failure / timeout).
6. **Compensation**: If the saga requires rollback, the Action Plane executes the registered compensating action.

---

### 6. Memory

Memory is partitioned into three tiers, each with distinct semantics, storage backends, and retention policies.

#### Architecture

```
+----------------------------------------------------------------------+
|                           MEMORY PLANE                               |
|                                                                      |
|  +==================+  +===================+  +====================+ |
|  |  WORKING MEMORY  |  |  EPISODIC MEMORY  |  | PERSISTENT MEMORY  | |
|  |                   |  |                   |  |                    | |
|  | - Current context |  | - Past sessions   |  | - User prefs       | |
|  | - Active plan     |  | - Task histories  |  | - Learned facts    | |
|  | - Scratch space   |  | - Conversations   |  | - Skill library    | |
|  |                   |  | - Outcomes        |  | - Org knowledge    | |
|  | TTL: session      |  | TTL: configurable |  | TTL: indefinite    | |
|  | Store: Redis      |  | Store: Event Store|  | Store: Postgres +  | |
|  |                   |  | + Vector Index    |  |   Vector Index     | |
|  +==================+  +===================+  +====================+ |
|                                                                      |
|  +================================================================+  |
|  |                     PRIVACY / RETENTION                        |  |
|  |                                                                |  |
|  | - PII detection and tagging (Presidio)                         |  |
|  | - Retention policies per memory tier and data classification   |  |
|  | - Right-to-erasure: hard delete with cryptographic proof       |  |
|  | - Encryption at rest (AES-256-GCM) and in transit (mTLS)      |  |
|  | - Access audit log for every memory read/write                 |  |
|  +================================================================+  |
+----------------------------------------------------------------------+
```

#### Memory Operations

| Operation | Working | Episodic | Persistent |
|-----------|---------|----------|------------|
| **Read** | O(1) key lookup | Similarity search + recency bias | Similarity search + exact match |
| **Write** | Direct set | Append event + index | Upsert with conflict resolution |
| **Evict** | LRU within session budget | TTL-based + importance score | Manual or policy-driven |
| **Forget** | Session end | Retention policy | Right-to-erasure request |

#### Privacy Controls

- **Data classification**: Each memory entry is tagged with a sensitivity level (`PUBLIC`, `INTERNAL`, `CONFIDENTIAL`, `RESTRICTED`).
- **PII detection**: Automated scanning on write using Presidio; PII is either redacted, tokenized, or encrypted depending on policy.
- **Consent tracking**: Memory writes record the consent basis (user consent, legitimate interest, contractual necessity).
- **Geo-fencing**: Memories tagged with jurisdiction constraints are stored in region-specific partitions.

---

### 7. UI Plane

The UI plane provides the human interface: an agentic console with real-time streaming, plan DAG visualization, and approval workflows.

#### Architecture

```
+----------------------------------------------------------------------+
|                            UI PLANE                                  |
|                                                                      |
|  +================+  +=================+  +========================+ |
|  | STREAMING      |  | DAG             |  | APPROVAL               | |
|  | CONSOLE        |  | VISUALIZATION   |  | WORKFLOW               | |
|  |                |  |                 |  |                        | |
|  | - Token-by-    |  | - Plan DAG      |  | - Pending approvals    | |
|  |   token output |  |   rendering     |  | - Diff view            | |
|  | - Multi-agent  |  | - Execution     |  | - Risk assessment      | |
|  |   chat         |  |   progress      |  | - Approve / Reject     | |
|  | - Code blocks  |  | - Critical path |  | - Delegate             | |
|  |   with syntax  |  |   highlighting  |  |                        | |
|  |   highlighting |  | - Zoom / filter |  |                        | |
|  +================+  +=================+  +========================+ |
|                                                                      |
|  +================+  +=================+                             |
|  | OBSERVABILITY  |  | SESSION         |                             |
|  | DASHBOARD      |  | MANAGEMENT      |                             |
|  |                |  |                 |                             |
|  | - Token usage  |  | - Session list  |                             |
|  | - Cost tracker |  | - Replay        |                             |
|  | - Latency p99  |  | - Fork session  |                             |
|  | - Error rates  |  | - Export        |                             |
|  +================+  +=================+                             |
+----------------------------------------------------------------------+
```

#### Communication Protocol

- **WebSocket**: Bidirectional streaming for real-time token output and user input.
- **SSE (Server-Sent Events)**: Fallback for environments that don't support WebSocket.
- **REST API**: CRUD operations for sessions, preferences, exports.

#### DAG Visualization

The plan DAG is rendered as a directed acyclic graph where:

- **Nodes** represent sub-tasks, colored by status (pending=gray, running=blue, success=green, failed=red, skipped=yellow).
- **Edges** represent dependencies.
- **Critical path** is highlighted with bold edges.
- **Zoom levels**: overview (full DAG), cluster (sub-DAG), detail (single task with logs).
- Updates stream in real-time as execution progresses.

---

### 8. SDK

The SDK provides a plugin system for extending AgentOS with custom capabilities.

#### Plugin Runtimes

```
+----------------------------------------------------------------------+
|                              SDK                                     |
|                                                                      |
|  +===================+  +===================+  +==================+  |
|  |  WASM PLUGINS     |  |  gRPC PLUGINS     |  |  MCP PLUGINS    |  |
|  |                   |  |                   |  |                  |  |
|  | - Sandboxed exec  |  | - Out-of-process  |  | - MCP-compatible |  |
|  | - WASI preview 2  |  | - Any language    |  |   tool servers   |  |
|  | - Capability-     |  | - Proto-defined   |  | - Auto-discovery |  |
|  |   based security  |  |   interface       |  | - Schema-driven  |  |
|  | - Hot-reload      |  | - Health checks   |  |   invocation     |  |
|  | - <50ms startup   |  | - Circuit breaker |  |                  |  |
|  +===================+  +===================+  +==================+  |
|                                                                      |
|  +================================================================+  |
|  |                    PLUGIN LIFECYCLE                             |  |
|  |                                                                |  |
|  |  1. Register   (manifest + capability request)                 |  |
|  |  2. Validate   (schema check, security scan)                   |  |
|  |  3. Install    (store artifact, create sandbox config)         |  |
|  |  4. Activate   (start runtime, inject capabilities)            |  |
|  |  5. Execute    (invoke via standard interface)                 |  |
|  |  6. Monitor    (health, resource usage, error rate)            |  |
|  |  7. Deactivate (drain, checkpoint, stop)                      |  |
|  |  8. Uninstall  (remove artifact, revoke capabilities)         |  |
|  +================================================================+  |
+----------------------------------------------------------------------+
```

#### Plugin Manifest

```yaml
name: "acme-web-scraper"
version: "1.2.0"
runtime: "wasm"            # wasm | grpc | mcp
entrypoint: "scraper.wasm"

capabilities_required:
  - net:egress:*.acme.com
  - memory:working:read_write
  - action:web:navigate

capabilities_provided:
  - tool:acme_scrape_page
  - tool:acme_extract_table

resource_limits:
  memory_mb: 128
  cpu_ms_per_invocation: 5000
  max_concurrent: 4

health_check:
  interval_seconds: 30
  timeout_seconds: 5
```

#### Capability Tokens

Plugins request capabilities in their manifest. The SDK runtime grants capability tokens at activation time based on organizational policy. Capabilities are:

- **Granular**: `net:egress:*.example.com` vs. `net:egress:*`
- **Revocable**: Tokens can be revoked at runtime.
- **Audited**: Every capability exercise is logged.

---

## Data Flow

### End-to-End Request Flow

```
User                UI Plane           Control Plane        Model Plane
 |                    |                    |                    |
 |  "Research X"      |                    |                    |
 +------------------->+                    |                    |
 |                    |  TaskRequest       |                    |
 |                    +------------------->+                    |
 |                    |                    |                    |
 |                    |                    |  Plan (LLM call)   |
 |                    |                    +------------------->+
 |                    |                    |                    |
 |                    |                    +<-------------------+
 |                    |                    |  Plan DAG          |
 |                    |                    |                    |
 |                    |                    |                    |
 |                    |       Knowledge Plane     Action Plane  |
 |                    |            |                   |        |
 |                    |            |  Retrieve          |        |
 |                    |            +<------------------+        |
 |                    |            |  EvidencePack      |        |
 |                    |            +------------------>+        |
 |                    |            |                   |        |
 |                    |                    |  Execute actions   |
 |                    |                    +------------------->+
 |                    |                    |                    | Action Plane
 |                    |                    |                    +---------->
 |                    |                    |                    |  results
 |                    |                    +<-------------------+
 |                    |                    |                    |
 |                    |                    |  Critic evaluates  |
 |                    |                    +---------+          |
 |                    |                    |         |          |
 |                    |                    +<--------+          |
 |                    |                    |                    |
 |                    |                    |  Judge approves    |
 |                    |                    +---------+          |
 |                    |                    |         |          |
 |                    |                    +<--------+          |
 |                    |                    |                    |
 |                    |  TaskResult        |                    |
 |                    +<-------------------+                    |
 |  Streamed result   |                    |                    |
 +<-------------------+                    |                    |
 |                    |                    |                    |
```

### Event Flow (Data Plane Perspective)

```
1. TaskRequested         -- user submits goal
2. PlanGenerated         -- planner produces DAG
3. PlanValidated         -- critic validates plan structure
4. ExecutionStarted      -- executor begins saga
5. ActionDispatched(n)   -- action sent to Action Plane
6. ActionCompleted(n)    -- action result received
7. EvidenceRetrieved     -- knowledge plane returns evidence pack
8. CritiqueGenerated     -- critic evaluates results
9. JudgmentRendered      -- judge decides (approve/revise/escalate)
10. TaskCompleted        -- final result emitted
```

All events are appended to the Event Store. Read models (projections) materialize views optimized for:

- **Session timeline**: Ordered list of events for a session.
- **Task status**: Current state of all active tasks.
- **Cost accounting**: Aggregated token and API costs.
- **Audit trail**: Compliance-oriented view with actor, action, resource, timestamp.

---

## Invariants

The following invariants must hold at all times. Formal specifications are in `INVARIANTS.md`.

| ID | Invariant | Enforcement |
|----|-----------|-------------|
| **INV-01** | Every state mutation produces an event in the Event Store. | Data Plane command handler. |
| **INV-02** | No action executes without a valid capability token. | Action Plane capability checker. |
| **INV-03** | The Cerebro loop terminates within `MAX_REVISIONS` iterations. | Control Plane loop counter. |
| **INV-04** | Safety-critical actions require Judge approval (no bypass). | Control Plane Judge gate. |
| **INV-05** | PII is never stored unencrypted outside the Memory Plane. | Memory Plane write interceptor. |
| **INV-06** | Event sequence numbers are monotonically increasing per stream. | Event Store append logic. |
| **INV-07** | Plugin capabilities are a subset of the granted capability set. | SDK capability checker. |
| **INV-08** | Model requests with privacy tier >= CONFIDENTIAL route to on-prem only. | Model Plane policy engine. |
| **INV-09** | Every Evidence Pack has full provenance (no orphan chunks). | Knowledge Plane pack builder. |
| **INV-10** | Human escalation cannot be suppressed by any agent action. | Control Plane Judge, hardcoded. |

---

## Deployment Model

```
+----------------------------------------------------------------------+
|                        Kubernetes Cluster                            |
|                                                                      |
|  +--namespace: agentos-control--+  +--namespace: agentos-data------+ |
|  | control-plane (Deployment)   |  | event-store (StatefulSet)     | |
|  | cerebro workers (HPA)        |  | temporal-server (Deployment)  | |
|  +------------------------------+  | postgres (StatefulSet)        | |
|                                     +-------------------------------+ |
|  +--namespace: agentos-model---+  +--namespace: agentos-knowledge-+ |
|  | model-router (Deployment)   |  | retrieval-engine (Deployment) | |
|  | local-vllm (StatefulSet)    |  | vector-db (StatefulSet)       | |
|  +------------------------------+  | neo4j (StatefulSet)           | |
|                                     +-------------------------------+ |
|  +--namespace: agentos-action--+  +--namespace: agentos-ui--------+ |
|  | action-orchestrator (Deploy)|  | ui-server (Deployment)        | |
|  | browser-pool (StatefulSet)  |  | websocket-gateway (Deployment)| |
|  | telephony-gateway (Deploy)  |  +-------------------------------+ |
|  +------------------------------+                                    |
|                                                                      |
|  +--namespace: agentos-infra---+                                     |
|  | nats-jetstream (StatefulSet)|                                     |
|  | redis-cluster (StatefulSet) |                                     |
|  | cert-manager                |                                     |
|  | istio-gateway               |                                     |
|  +------------------------------+                                    |
+----------------------------------------------------------------------+
```

Each plane is deployed in its own Kubernetes namespace with:

- **Network policies**: Planes communicate only through defined interfaces.
- **Resource quotas**: Each plane has CPU/memory limits.
- **HPA**: Autoscaling based on queue depth and latency.
- **PodDisruptionBudgets**: Ensure minimum replica counts during upgrades.

---

## References

- [ADR-001: Distributed Planes Architecture](ADR-001-distributed-planes.md)
- [ADR-002: Neuro-Symbolic Cerebro](ADR-002-neuro-symbolic-cerebro.md)
- [ADR-003: Multi-Model Routing](ADR-003-multi-model-routing.md)
- [ADR-004: Event-Sourced Data Plane](ADR-004-event-sourced-data-plane.md)
- [ADR-005: RAG with Evidence Packs](ADR-005-rag-evidence-packs.md)
- [Threat Model](THREAT_MODEL.md)
- [Formal Invariants](INVARIANTS.md)
