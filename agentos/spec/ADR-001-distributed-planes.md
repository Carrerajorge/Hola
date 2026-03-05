# ADR-001: Distributed Planes Architecture

**Status:** Accepted
**Date:** 2026-03-05
**Deciders:** AgentOS Core Team
**Supersedes:** N/A

---

## Context

AgentOS-ASI must orchestrate autonomous AI agents that perform complex, multi-step tasks involving LLM reasoning, external tool use, knowledge retrieval, and human interaction. Early prototypes used a monolithic agent loop (prompt -> LLM -> tool -> loop) that exhibited several problems:

1. **Scalability bottleneck**: A single process handled reasoning, tool execution, and memory, creating resource contention. LLM inference (GPU-bound) competed with web automation (I/O-bound) on the same scheduler.

2. **Blast radius**: A bug in the web scraping module could crash the entire agent, including the reasoning loop and in-flight state.

3. **Deployment rigidity**: Upgrading the knowledge retrieval stack required redeploying the entire system, introducing unnecessary risk to stable components.

4. **Team autonomy**: Multiple teams (ML, infrastructure, product, security) needed to iterate independently on different subsystems without blocking each other.

5. **Security boundaries**: Different subsystems have different trust levels. The model plane handles API keys for external providers; the action plane executes untrusted browser sessions; the memory plane stores PII. A monolith makes it impossible to enforce meaningful security boundaries.

6. **Regulatory requirements**: Data residency rules require that certain data (PII, financial records) stays within specific geographic regions, which is difficult to enforce in a monolith.

We evaluated three architectural patterns:

- **Monolithic agent loop**: Simple but fails requirements 1-6 above.
- **Microservices (service-per-function)**: Maximum decomposition but excessive operational overhead for the team size.
- **Planes architecture (domain-aligned bounded contexts)**: Groups related functions into cohesive planes, each independently deployable but coarser-grained than microservices.

---

## Decision

We adopt a **distributed planes architecture** with eight planes, each representing a bounded context aligned to a cognitive or operational function:

| Plane | Bounded Context |
|-------|----------------|
| Control Plane | Reasoning, planning, metacognition |
| Model Plane | LLM provider management and routing |
| Data Plane | State persistence, event sourcing, durable execution |
| Knowledge Plane | Information retrieval, RAG, evidence assembly |
| Action Plane | External world interaction (browser, APIs, telephony) |
| Memory | Agent memory (working, episodic, persistent) |
| UI Plane | Human interface, visualization, approval workflows |
| SDK | Plugin system, extensibility runtime |

### Communication Model

- **Asynchronous events** (via NATS JetStream) for all state-change notifications. Events are the system of record.
- **Synchronous gRPC** for request-response calls that require immediate results (e.g., model inference, capability checks).
- **Shared nothing**: Planes do not share databases. Each plane owns its storage. Cross-plane data access happens through published events or explicit API calls.

### Deployment Model

- Each plane deploys to its own Kubernetes namespace.
- Network policies enforce that planes communicate only through defined interfaces.
- Planes can scale independently (HPA per plane based on plane-specific metrics).

### Failure Isolation

- Circuit breakers on all cross-plane gRPC calls.
- Bulkheads: Each plane has its own resource quota (CPU, memory, connections).
- Graceful degradation: If the Knowledge Plane is unavailable, the Control Plane proceeds with reduced context (degraded mode), rather than failing entirely.

---

## Consequences

### Positive

1. **Independent scalability**: The Model Plane can scale GPU resources independently of the Action Plane's browser pool.

2. **Fault isolation**: A browser crash in the Action Plane does not affect the reasoning loop in the Control Plane.

3. **Independent deployability**: Teams can deploy plane updates independently with zero-downtime rolling updates.

4. **Security boundaries**: Each plane runs with its own service account and network policies. The Action Plane (which runs untrusted browser sessions) is isolated from the Memory Plane (which stores PII).

5. **Technology heterogeneity**: Each plane can use the best-fit technology stack. The Knowledge Plane can use specialized vector databases; the Data Plane can use event-store-optimized storage.

6. **Regulatory compliance**: Data residency can be enforced per-plane. Memory Plane instances can be geo-fenced without affecting other planes.

7. **Team autonomy**: Teams own their plane end-to-end (code, deployment, on-call).

### Negative

1. **Operational complexity**: Eight planes means eight deployment pipelines, eight sets of health checks, eight on-call rotations. Mitigated by shared infrastructure tooling and platform engineering.

2. **Latency overhead**: Cross-plane communication adds network hops. Mitigated by co-locating latency-sensitive planes and using efficient serialization (Protocol Buffers, CBOR).

3. **Distributed debugging**: Tracing a request across planes requires distributed tracing infrastructure. Mitigated by mandatory OpenTelemetry instrumentation and correlation IDs on all messages.

4. **Data consistency**: Without shared databases, cross-plane consistency is eventual. Mitigated by event sourcing (single source of truth) and saga patterns for operations spanning multiple planes.

5. **Schema evolution**: Events shared between planes require careful schema evolution (backward/forward compatibility). Mitigated by schema registry and compatibility checks in CI.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Excessive inter-plane chatter | Medium | Performance degradation | Monitor message rates; coalesce events; review boundaries quarterly |
| Plane boundary misalignment | Low | Costly refactoring | Validate boundaries against actual data flow before v1.0 GA |
| Distributed transaction failures | Medium | Inconsistent state | Saga compensation; idempotent event handlers; reconciliation jobs |

---

## References

- Sam Newman, *Building Microservices*, 2nd edition (O'Reilly, 2021) -- bounded contexts and decomposition strategies.
- Pat Helland, "Life beyond Distributed Transactions" (2007) -- eventual consistency patterns.
- NATS JetStream documentation -- event bus technology choice.
- Kubernetes network policies -- inter-namespace isolation.
- [ARCHITECTURE.md](ARCHITECTURE.md) -- full system architecture.
