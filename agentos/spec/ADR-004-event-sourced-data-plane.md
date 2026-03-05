# ADR-004: Event-Sourced Data Plane with CQRS

## Status
Accepted

## Context
Agent execution must be reproducible and auditable. Traditional CRUD approaches lose history and make debugging long-running missions difficult. Agent workflows need durable execution with replay capability.

## Decision
Implement event sourcing + CQRS for the data plane:
- **Event Store**: Append-only log of all state changes with snapshot support
- **CQRS**: Separate command (write) and query (read) paths with different optimizations
- **Durable Workflows**: Temporal-inspired workflow engine with deterministic replay
- **Streaming**: Pub/sub with backpressure for real-time event distribution

All agent actions produce events. State can be reconstructed by replaying events.

## Consequences
- **Positive**: Full audit trail, deterministic replay, debugging via event replay
- **Positive**: Temporal decoupling between producers and consumers
- **Negative**: Eventually consistent read models
- **Negative**: Event schema evolution complexity
- **Negative**: Storage growth (mitigated by snapshots and compaction)

## References
- Temporal.io workflow patterns
- Event Sourcing (Martin Fowler)
- CQRS pattern (Greg Young)
