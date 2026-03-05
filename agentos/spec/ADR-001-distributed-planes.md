# ADR-001: Distributed Planes Architecture

**Date:** 2026-03-05
**Status:** Accepted
**Deciders:** AgentOS-ASI Architecture Board

---

## Context

AgentOS-ASI must orchestrate autonomous AI agents that perform complex, multi-step tasks involving LLM reasoning, external actions, knowledge retrieval, and human interaction. The system must support:

- **Independent scaling** of compute-intensive subsystems (LLM inference vs. web automation vs. data storage).
- **Fault isolation** so that a failure in one subsystem (e.g., a browser crash in web automation) does not cascade to reasoning or data persistence.
- **Team autonomy** where different engineering teams can own, develop, deploy, and operate their subsystem independently.
- **Security boundaries** where sensitive operations (PII handling, external API calls) are isolated from less privileged components.
- **Evolutionary architecture** where individual subsystems can be replaced or upgraded without a full system rewrite.

We considered three approaches:

1. **Monolithic architecture**: Single deployable unit with module boundaries.
2. **Microservices by entity**: Services decomposed around domain entities (TaskService, UserService, etc.).
3. **Plane-based decomposition**: Services decomposed around functional planes (control, model, data, knowledge, action, memory, UI, SDK), inspired by networking architectures (control plane / data plane separation) and cognitive architectures.

### Why not monolith?

A monolith would be simpler initially but creates coupling between subsystems with vastly different scaling profiles. LLM inference is GPU-bound and bursty; event storage is IO-bound and steady. Coupling them forces over-provisioning.

### Why not entity-based microservices?

Entity-based decomposition fragments the cognitive loop across services. A single reasoning step touches tasks, models, knowledge, and actions -- entity boundaries would create excessive cross-service calls for the core path.

---

## Decision

We adopt a **distributed planes architecture** with eight planes:

| Plane | Responsibility |
|-------|---------------|
| **Control Plane** | Cognitive loop: planning, execution, critique, judgment. |
| **Model Plane** | LLM provider abstraction, routing, cost management. |
| **Data Plane** | Event sourcing, CQRS, durable execution (Temporal). |
| **Knowledge Plane** | RAG retrieval, evidence packs, provenance. |
| **Action Plane** | External side effects: browser, MCP, telephony, APIs. |
| **Memory** | Working, episodic, and persistent memory with privacy controls. |
| **UI Plane** | Human interface: streaming console, DAG visualization, approvals. |
| **SDK** | Plugin system: WASM, gRPC, MCP tool servers. |

### Communication Model

- **Asynchronous events** (via NATS JetStream) for inter-plane state propagation. Events are the source of truth.
- **Synchronous gRPC** for request-response calls where latency matters (e.g., Control Plane calling Model Plane for an LLM completion).
- All messages carry OpenTelemetry-compatible correlation, causation, and trace IDs.

### Deployment Model

- Each plane runs in its own Kubernetes namespace with dedicated network policies, resource quotas, and autoscaling rules.
- Planes communicate only through defined interfaces (gRPC service definitions + event schemas). No shared databases.
- Schema evolution follows a compatibility matrix: events use CBOR with schema versioning; gRPC uses proto3 with backward-compatible field additions.

### Ownership Model

- Each plane has a single owning team.
- Inter-plane contracts are defined in a shared `contracts/` repository with CI-enforced compatibility checks.
- Breaking changes require an ADR and a migration plan.

---

## Consequences

### Positive

- **Independent scaling**: The Model Plane can scale GPU instances without affecting the Data Plane's storage nodes.
- **Fault isolation**: A Playwright browser crash in the Action Plane does not affect the Control Plane's reasoning loop. Circuit breakers at plane boundaries prevent cascading failures.
- **Security boundaries**: The Action Plane (which makes external network calls) runs with different network policies than the Memory Plane (which stores PII). Blast radius of a compromised plane is contained.
- **Technology flexibility**: Each plane can use the best technology for its domain (e.g., ClickHouse for analytics projections, Neo4j for knowledge graphs, Redis for working memory).
- **Evolutionary replacement**: A plane can be rewritten or replaced without affecting others, as long as the contract is maintained.
- **Team autonomy**: Teams can deploy, test, and operate their plane independently with clear ownership.

### Negative

- **Operational complexity**: Eight planes mean eight deployment pipelines, eight sets of alerts, eight on-call rotations. Mitigated by shared infrastructure tooling and platform team support.
- **Distributed tracing overhead**: Cross-plane requests require distributed tracing infrastructure. Mitigated by mandating OpenTelemetry from day one.
- **Eventual consistency**: Asynchronous events mean read models may lag behind writes. Mitigated by explicit consistency guarantees per use case (strong consistency for safety-critical paths via synchronous gRPC).
- **Contract management**: Shared contracts require governance. Mitigated by CI-enforced schema compatibility and the ADR process for breaking changes.
- **Latency**: Cross-plane calls add network hops. Mitigated by co-locating latency-sensitive planes and using connection pooling.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Plane boundary is wrong (too many or too few planes) | Medium | High | Start with current decomposition; merge/split planes based on operational data after 6 months. |
| Event bus becomes bottleneck | Low | High | NATS JetStream supports clustering and partitioning; monitor throughput and scale horizontally. |
| Schema drift between planes | Medium | Medium | CI-enforced compatibility checks on every PR to the contracts repository. |

---

## References

- Fowler, M. "Microservices." martinfowler.com.
- Newman, S. *Building Microservices*, 2nd ed., O'Reilly, 2021.
- Kubernetes Network Policies documentation.
- NATS JetStream documentation.
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Full system architecture.
