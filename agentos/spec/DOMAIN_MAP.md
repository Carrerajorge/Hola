# AgentOS Domain Map

## Bounded Contexts

### 1. Mission Management (Control Plane)
- **Entities**: Mission, Plan, Step, SubGoal, WorldState
- **Value Objects**: Budget, CriticFeedback, JudgeVerdict, SoulPolicy
- **Aggregates**: MissionRun (root), PlanTree
- **Domain Events**: MissionCreated, PlanGenerated, StepExecuted, CriticEvaluated, JudgeDecided, MissionCompleted, MissionFailed, EscalationTriggered
- **Commands**: CreateMission, ExecuteStep, ReplanFromCritic, EscalateToHuman
- **Queries**: GetMissionStatus, GetPlanDAG, GetBudgetRemaining

### 2. Model Routing (Model Plane)
- **Entities**: ModelProvider, ModelEndpoint, RoutingPolicy
- **Value Objects**: ModelCapability, QoSRequirement, CostEstimate, ProviderHealth
- **Aggregates**: RoutingDecision
- **Domain Events**: ModelSelected, RequestRouted, ProviderHealthChanged, CostThresholdReached, CanaryPromoted
- **Commands**: RouteRequest, RegisterProvider, UpdatePolicy
- **Queries**: GetProviderHealth, GetCostReport, GetRoutingStats

### 3. Data Management (Data Plane)
- **Entities**: EventStream, Workflow, Projection
- **Value Objects**: DomainEvent, Command, Query, Snapshot
- **Aggregates**: WorkflowRun, EventLog
- **Domain Events**: EventAppended, WorkflowStarted, ActivityCompleted, WorkflowCompleted, WorkflowFailed
- **Commands**: AppendEvent, StartWorkflow, SignalWorkflow, CancelWorkflow
- **Queries**: ReplayEvents, GetProjection, GetWorkflowStatus

### 4. Knowledge Management (Knowledge Plane)
- **Entities**: Document, Chunk, KnowledgeGraphNode, EvidencePack
- **Value Objects**: Embedding, Citation, SearchResult, FreshnessScore
- **Aggregates**: DocumentCorpus, EvidenceChain
- **Domain Events**: DocumentIngested, ChunksCreated, SearchExecuted, EvidenceAssembled
- **Commands**: IngestDocument, Search, AssembleEvidence, InvalidateStale
- **Queries**: SemanticSearch, GraphTraversal, GetEvidencePack

### 5. Action Execution (Action Plane)
- **Entities**: BrowserSession, MCPConnection, TelephonySession
- **Value Objects**: WebAction, Screenshot, ConsentRecord, CallTranscript
- **Aggregates**: ActionSession
- **Domain Events**: BrowserSessionStarted, PageNavigated, FormFilled, MCPToolCalled, CallInitiated, ConsentGranted
- **Commands**: NavigateTo, ClickElement, CallPhone, DiscoverCapability
- **Queries**: GetSessionState, GetScreenshot, GetCallTranscript

### 6. Memory (Cross-cutting)
- **Entities**: MemoryEntry, MemoryIndex
- **Value Objects**: MemoryScope, RetentionPolicy, PrivacyLevel
- **Aggregates**: MemoryStore (per scope)
- **Domain Events**: MemoryStored, MemoryRetrieved, MemoryExpired, MemoryForgotten
- **Commands**: StoreMemory, ForgetMemory, ApplyRetentionPolicy
- **Queries**: SearchMemory, GetRelevantContext

### 7. Security (Cross-cutting)
- **Entities**: Identity, Policy, AuditEntry
- **Value Objects**: AuthToken, PolicyDecision, ThreatIndicator
- **Domain Events**: PolicyEvaluated, ThreatDetected, AccessDenied, SecretRotated

### 8. Observability (Cross-cutting)
- **Entities**: Trace, Span, EvalRun
- **Value Objects**: Metric, LogEntry, EvalScore
- **Domain Events**: TraceCompleted, MetricEmitted, EvalCompleted, AlertTriggered

## Context Map (Relationships)

```
Mission Management ──[upstream/downstream]──▶ Model Routing
       │                                            │
       │ [conformist]                    [partnership]
       ▼                                            ▼
Action Execution ◀──[shared kernel]──▶ Knowledge Management
       │                                            │
       │ [anticorruption layer]         [open host service]
       ▼                                            ▼
   Memory ◀─────────[published language]──────▶ Data Management
       │
       ▼
  Security ◀──────[conformist]──────▶ Observability
```

## Integration Patterns

| From → To | Pattern | Protocol |
|-----------|---------|----------|
| Control → Model | Request/Reply | Internal async |
| Control → Action | Command | Event bus |
| Control → Knowledge | Query | Request/Reply |
| Action → Knowledge | Event | Event bus |
| All → Data | Event Sourcing | Append-only log |
| All → Memory | Read/Write | Shared service |
| All → Security | Policy check | Sync middleware |
| All → Observability | Fire-and-forget | Async spans |
