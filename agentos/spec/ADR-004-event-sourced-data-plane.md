# ADR-004: Event-Sourced Data Plane with CQRS

**Date:** 2026-03-05
**Status:** Accepted
**Deciders:** AgentOS-ASI Architecture Board

---

## Context

AgentOS-ASI orchestrates long-running, multi-step agent tasks that may span minutes to hours. The data layer must support:

1. **Full audit trail**: Every state change must be recorded for compliance, debugging, and reproducibility. Regulatory and safety requirements demand that no history is lost.
2. **Deterministic replay**: Any past execution must be reconstructable from its event log. This is critical for debugging agent behavior and for the Critic/Judge to review past decisions.
3. **Durable execution**: Long-running workflows must survive process crashes, restarts, and deployments without losing progress.
4. **Temporal decoupling**: Producers and consumers of state changes operate at different rates and availability levels. The Data Plane must buffer and deliver events reliably.
5. **Read optimization**: Different consumers need different views of the same data -- the UI Plane needs a session timeline, the Control Plane needs task status, finance needs cost accounting.

We evaluated three persistence strategies:

### Option A: Traditional CRUD with WAL

Standard relational database with write-ahead logging. Simple to implement, but:
- Loses history on UPDATE/DELETE operations.
- Requires separate audit logging (duplicating writes).
- Read and write paths compete for the same schema.

### Option B: Event Sourcing Only

Append-only event log as the sole source of truth. State is derived by replaying events. Provides full history, but:
- Every read requires replay (expensive without snapshots).
- No optimized read models for diverse query patterns.

### Option C: Event Sourcing + CQRS

Append-only event log for writes (command side). Materialized projections for reads (query side). Combines full history with read-optimized views.

---

## Decision

We adopt **Event Sourcing + CQRS** (Option C) as the persistence strategy for the Data Plane, combined with **durable execution** via Temporal for long-running workflows.

### Event Store

The Event Store is an append-only, immutable log. Each event belongs to a stream (identified by `stream_id`, typically an aggregate ID).

#### Event Schema

```
Event {
  event_id:        UUID            -- globally unique
  stream_id:       StreamId        -- aggregate identity (e.g., "task-{uuid}")
  sequence_num:    uint64          -- monotonically increasing within stream
  event_type:      string          -- e.g., "TaskCreated", "ActionCompleted"
  payload:         bytes (CBOR)    -- event-specific data
  metadata: {
    correlation_id:  UUID          -- ties related events across streams
    causation_id:    UUID          -- the event/command that caused this event
    trace_id:        TraceId       -- OpenTelemetry trace
    actor:           ActorId       -- who/what produced this event
    timestamp:       Timestamp     -- UTC wall clock
    schema_version:  uint32        -- for schema evolution
  }
}
```

#### Storage Backend

- **Primary**: PostgreSQL with an `events` table, partitioned by time range.
- **Indexing**: B-tree on `(stream_id, sequence_num)` for stream replay; B-tree on `(event_type, timestamp)` for type-based queries.
- **Retention**: Events are retained indefinitely (they are the source of truth). Optionally, streams with no active aggregates are archived to cold storage after a configurable period.

#### Snapshots

To avoid replaying long event streams on every read, the system periodically creates snapshots:

```
Snapshot {
  stream_id:       StreamId
  sequence_num:    uint64          -- snapshot is valid as of this sequence
  state:           bytes (CBOR)    -- serialized aggregate state
  created_at:      Timestamp
}
```

Snapshot frequency is configurable per aggregate type (e.g., every 100 events or every 5 minutes of wall clock).

#### Concurrency Control

Optimistic concurrency via expected sequence number:

1. Writer reads current sequence number for the stream.
2. Writer appends event with `expected_sequence = current + 1`.
3. If another writer has appended in the meantime, the append fails with a concurrency conflict.
4. The caller retries with a fresh read.

This eliminates the need for pessimistic locks while ensuring stream consistency.

### CQRS: Command and Query Separation

#### Command Side

Commands are processed by command handlers that:

1. Load the aggregate (from snapshot + subsequent events).
2. Validate the command against business rules.
3. Produce zero or more events.
4. Append events to the Event Store.
5. Publish events to the event bus (NATS JetStream).

Command handlers are the only components that write to the Event Store. They enforce all domain invariants.

#### Query Side

Read models (projections) are materialized views optimized for specific query patterns:

| Projection | Storage | Purpose |
|-----------|---------|---------|
| **Session Timeline** | PostgreSQL (time-series) | Ordered list of events for UI rendering. |
| **Task Status** | Redis (hash) | Current state of all active tasks for real-time dashboards. |
| **Cost Accounting** | ClickHouse (columnar) | Aggregated token/cost data for billing and analytics. |
| **Audit Trail** | PostgreSQL (immutable) | Compliance view: actor, action, resource, timestamp, outcome. |
| **Search Index** | Elasticsearch | Full-text search over events and task metadata. |

Projections are built by event handlers (projectors) that subscribe to the event bus. They are:

- **Eventually consistent**: Projections may lag behind the Event Store by milliseconds to seconds.
- **Rebuildable**: Any projection can be rebuilt from scratch by replaying the Event Store.
- **Independent**: Each projection can use a different storage technology optimized for its access pattern.

### Durable Execution (Temporal)

Long-running agent tasks are modeled as Temporal workflows:

#### Workflow Structure

```
TaskWorkflow(goal, constraints, capabilities):
  1. plan = await PlanActivity(goal, constraints, capabilities)
  2. for each step in topological_sort(plan.dag):
       if step.dependencies_met():
         result = await ExecuteStepActivity(step)
         if result.failed and step.compensatable:
           await CompensateActivity(step)
           raise StepFailedError(step)
  3. critique = await CritiqueActivity(plan, results)
  4. judgment = await JudgeActivity(critique)
  5. if judgment == REVISE and revision_count < MAX_REVISIONS:
       goto 1 with feedback
  6. return FinalResult(results, critique, judgment)
```

#### Activity Properties

| Property | Value | Rationale |
|----------|-------|-----------|
| **Start-to-close timeout** | Varies per activity type (30s - 30min) | Prevents indefinite hangs. |
| **Heartbeat timeout** | 30s for long activities | Detects stuck activities. |
| **Retry policy** | 3 retries, exponential backoff, non-retryable error list | Handles transient failures. |
| **Compensation** | Registered per activity | Enables saga rollback. |

#### Benefits of Temporal

- **Crash recovery**: Workflows survive process restarts; Temporal replays the workflow history to reconstruct state.
- **Visibility**: Temporal UI provides workflow execution history, searchable by correlation ID.
- **Versioning**: Workflow definitions can be versioned for safe deployments.

### Schema Evolution

Events use CBOR encoding with schema versioning:

1. Each event type has a `schema_version` in its metadata.
2. **Additive changes** (new optional fields) are backward-compatible and require no migration.
3. **Breaking changes** (field removal, type changes) require:
   - A new event type version (e.g., `TaskCreated_v2`).
   - An upcaster that transforms old events to the new format on read.
   - An ADR documenting the change.

---

## Consequences

### Positive

- **Full audit trail**: Every state change is an immutable event. Nothing is lost. Compliance requirements are met by construction.
- **Deterministic replay**: Any past execution can be reconstructed by replaying events from the Event Store. Critical for debugging and the Critic/Judge review process.
- **Read optimization**: CQRS allows each consumer to have a view optimized for its access pattern, without compromising write-side integrity.
- **Temporal decoupling**: Event producers and consumers are decoupled in time and space. The event bus provides reliable delivery.
- **Durable execution**: Temporal ensures that long-running workflows survive crashes and restarts.
- **Scalability**: Command and query sides can be scaled independently. Read models can be replicated.

### Negative

- **Eventual consistency**: Read models lag behind writes. Mitigated by providing strong consistency for safety-critical reads via direct Event Store queries when needed.
- **Event schema evolution complexity**: Schema changes must be managed carefully. Mitigated by upcasters and the schema versioning protocol.
- **Storage growth**: The append-only Event Store grows indefinitely. Mitigated by snapshots (reducing replay cost), cold storage archival, and compression.
- **Operational complexity**: Event Store, projectors, Temporal, and multiple read databases add operational surface area. Mitigated by standardized deployment templates and monitoring.
- **Learning curve**: Event sourcing + CQRS patterns are less familiar than CRUD. Mitigated by documentation, code examples, and pair programming.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Projector bug creates incorrect read model | Medium | Medium | Projections are rebuildable from the Event Store. Automated consistency checks compare projections against event replay. |
| Event Store becomes a bottleneck | Low | High | PostgreSQL partitioning and connection pooling. Can migrate to dedicated event store (EventStoreDB) if needed. |
| Temporal cluster failure halts all workflows | Low | Critical | Temporal deployed in multi-replica HA mode. Workflow state is persisted in PostgreSQL; cluster recovery restores all in-flight workflows. |
| Schema evolution breaks consumers | Medium | Medium | CI-enforced schema compatibility checks. Upcasters are unit-tested against historical event fixtures. |

---

## References

- Fowler, M. "Event Sourcing." martinfowler.com.
- Young, G. "CQRS Documents." cqrs.files.wordpress.com.
- Temporal.io documentation and workflow patterns.
- Garcia-Molina, H. & Salem, K. "Sagas." ACM SIGMOD, 1987.
- Kleppmann, M. *Designing Data-Intensive Applications*, O'Reilly, 2017.
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Data Plane section.
