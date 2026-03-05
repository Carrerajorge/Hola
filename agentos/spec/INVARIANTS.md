# AgentOS-ASI Formal Invariants

**Version:** 1.0.0
**Status:** Draft
**Last Updated:** 2026-03-05

Safety properties expressed in TLA+-style pseudocode. These invariants must hold in every reachable state of the system. Temporal properties (liveness, fairness) are specified where applicable.

---

## Table of Contents

1. [I1: Event Sourcing Integrity](#i1-event-sourcing-integrity)
2. [I2: Budget Safety](#i2-budget-safety)
3. [I3: Cerebro Loop Termination](#i3-cerebro-loop-termination)
4. [I4: Safety Gate Non-Bypass](#i4-safety-gate-non-bypass)
5. [I5: Capability Confinement](#i5-capability-confinement)
6. [I6: Memory Privacy](#i6-memory-privacy)
7. [I7: Evidence Provenance Completeness](#i7-evidence-provenance-completeness)
8. [I8: Privacy-Tier Routing](#i8-privacy-tier-routing)
9. [I9: Human Escalation Non-Suppression](#i9-human-escalation-non-suppression)
10. [I10: Plugin Sandboxing](#i10-plugin-sandboxing)
11. [I11: Action Authorization](#i11-action-authorization)
12. [I12: Critic Evaluation Completeness](#i12-critic-evaluation-completeness)

---

## Constants and Type Definitions

```tla+
CONSTANTS
  MAX_REVISIONS,          \* Maximum Cerebro loop iterations (default: 3)
  MAX_STALENESS,          \* Maximum evidence age (duration)
  MIN_COVERAGE,           \* Minimum evidence coverage score (float)
  MIN_SOURCES,            \* Minimum distinct sources for corroboration
  ESCALATION_THRESHOLD    \* Risk level above which escalation is mandatory

VARIABLES
  eventStore,             \* Sequence of Event records (append-only)
  sessions,               \* Set of active sessions
  agents,                 \* Set of active agents
  tasks,                  \* Set of tasks (each with state machine)
  memory,                 \* Memory state (working, episodic, persistent)
  plugins,                \* Set of loaded plugins with capabilities
  modelRequests,          \* Set of model invocation records
  actions,                \* Set of executed actions
  escalations,            \* Set of human escalation records
  evidencePacks           \* Set of evidence packs

\* Type definitions
Event == [
  event_id:       UUID,
  stream_id:      StreamId,
  sequence_num:   Nat,
  event_type:     STRING,
  payload:        BYTES,
  metadata:       EventMetadata
]

Task == [
  task_id:        UUID,
  session_id:     UUID,
  status:         {"pending", "planning", "executing", "critiquing",
                   "judging", "completed", "failed", "escalated"},
  revision_count: Nat,
  budget:         Budget,
  plan_dag:       DAG,
  execution_trace: Seq(ActionResult),
  critique:       CritiqueReport \union {NULL},
  judgment:       Judgment \union {NULL}
]

Budget == [
  max_tokens:     Nat,
  max_cost_usd:   Real,
  max_api_calls:  Nat,
  tokens_used:    Nat,
  cost_used:      Real,
  api_calls_used: Nat
]

PrivacyTier == {"PUBLIC", "INTERNAL", "CONFIDENTIAL", "RESTRICTED"}
Severity    == {"LOW", "MEDIUM", "HIGH", "CRITICAL"}
```

---

## I1: Event Sourcing Integrity

Every state mutation in the system is recorded as an immutable event. The event log is append-only and causally ordered within each stream.

```tla+
--------------------------------------------------------------------------------
INVARIANT EventStoreAppendOnly ==
  \* The event store only grows; no event is ever removed or modified.
  \A i \in 1..Len(eventStore):
    \A j \in 1..Len(eventStore'):
      (i <= Len(eventStore)) => eventStore'[i] = eventStore[i]

INVARIANT StreamMonotonicity ==
  \* Within each stream, sequence numbers are strictly increasing.
  \A e1, e2 \in Range(eventStore):
    (e1.stream_id = e2.stream_id /\ e1 # e2) =>
      (e1.sequence_num # e2.sequence_num)

INVARIANT CausalOrdering ==
  \* If event A caused event B, then A's sequence number is lower
  \* (within the same stream) or A's timestamp is earlier (across streams).
  \A e1, e2 \in Range(eventStore):
    (e2.metadata.causation_id = e1.event_id) =>
      e1.metadata.timestamp <= e2.metadata.timestamp

INVARIANT StateDerivedFromEvents ==
  \* The current state of any aggregate can be reconstructed by replaying
  \* all events in its stream from the initial state.
  \A stream_id \in StreamIds:
    LET events == SelectSeq(eventStore, LAMBDA e: e.stream_id = stream_id)
    IN  CurrentState(stream_id) = FoldLeft(ApplyEvent, InitialState, events)

INVARIANT EventUniqueness ==
  \* Every event_id is globally unique.
  \A e1, e2 \in Range(eventStore):
    (e1.event_id = e2.event_id) => (e1 = e2)

PROPERTY EventualDelivery ==
  \* Every event appended to the store is eventually delivered to all
  \* subscribed projectors (liveness property).
  \A e \in Range(eventStore):
    \A projector \in Projectors:
      projector.subscribed_to(e.event_type) =>
        <>(e \in projector.processed_events)
--------------------------------------------------------------------------------
```

---

## I2: Budget Safety

No operation that consumes budget (model invocations, API calls) can proceed if the session budget is exhausted.

```tla+
--------------------------------------------------------------------------------
INVARIANT BudgetNotExceeded ==
  \* Actual usage never exceeds the configured maximum.
  \A session \in sessions:
    /\ session.budget.tokens_used  <= session.budget.max_tokens
    /\ session.budget.cost_used    <= session.budget.max_cost_usd
    /\ session.budget.api_calls_used <= session.budget.max_api_calls

INVARIANT BudgetCheckedBeforeInvocation ==
  \* Every model invocation was preceded by a budget check that passed.
  \A req \in modelRequests:
    LET session == SessionOf(req)
        estimated_cost == req.cost_estimate
    IN  session.budget.cost_used + estimated_cost <= session.budget.max_cost_usd

PROPERTY BudgetMonotonicity ==
  \* Budget remaining is monotonically decreasing within a session.
  \A session \in sessions:
    [](session.budget.cost_used' >= session.budget.cost_used)

PROPERTY BudgetExhaustionHalts ==
  \* If budget is exhausted, no further model invocations occur in that session.
  \A session \in sessions:
    (session.budget.cost_used >= session.budget.max_cost_usd) =>
      [](~ \E req \in modelRequests':
            req.session_id = session.session_id
            /\ req \notin modelRequests)
--------------------------------------------------------------------------------
```

---

## I3: Cerebro Loop Termination

The Planner-Executor-Critic-Judge loop always terminates within a bounded number of iterations.

```tla+
--------------------------------------------------------------------------------
INVARIANT RevisionBounded ==
  \* No task exceeds the maximum number of revisions.
  \A task \in tasks:
    task.revision_count <= MAX_REVISIONS

INVARIANT LoopProgressMonotonic ==
  \* The revision count only increases (never resets or decreases).
  \A task \in tasks:
    task.revision_count' >= task.revision_count

PROPERTY LoopTermination ==
  \* Every task eventually reaches a terminal state.
  \A task \in tasks:
    <>(task.status \in {"completed", "failed", "escalated"})

INVARIANT TimeoutEnforced ==
  \* Each Cerebro stage has a wall-clock timeout. A stage that exceeds
  \* its timeout is forcibly terminated.
  \A task \in tasks:
    \A stage \in {"planning", "executing", "critiquing", "judging"}:
      (task.status = stage) =>
        (CurrentTime - task.stage_start_time <= StageTimeout(stage))

INVARIANT MaxRevisionsForceTermination ==
  \* When revision count reaches MAX_REVISIONS and the Judge recommends
  \* REVISE, the system MUST escalate (not revise again).
  \A task \in tasks:
    (task.revision_count = MAX_REVISIONS /\ task.judgment = "REVISE") =>
      task.status' \in {"escalated", "failed"}
--------------------------------------------------------------------------------
```

---

## I4: Safety Gate Non-Bypass

The Judge's safety decisions cannot be circumvented by any system component.

```tla+
--------------------------------------------------------------------------------
INVARIANT CriticalIssuesBlockApproval ==
  \* If the Critique contains any CRITICAL-severity issue, the Judge
  \* cannot approve the task.
  \A task \in tasks:
    (\E issue \in task.critique.issues: issue.severity = "CRITICAL") =>
      task.judgment # "APPROVE"

INVARIANT AbortIsTerminal ==
  \* Once the Judge decides ABORT, the task cannot transition to any
  \* non-terminal state.
  \A task \in tasks:
    (task.judgment = "ABORT") =>
      [](task.status' \in {"failed", task.status})

INVARIANT SafetyPolicyIsDeterministic ==
  \* The Judge's safety rules are deterministic: same inputs always
  \* produce the same output. (This is ensured by using Rego/OPA
  \* rules, not LLM calls, for the Judge's safety logic.)
  \A critique1, critique2 \in CritiqueReports:
    \A policy \in SafetyPolicies:
      (critique1 = critique2 /\ policy = policy) =>
        JudgeDecision(critique1, policy) = JudgeDecision(critique2, policy)

INVARIANT NoActionWithoutJudgment ==
  \* No task result is emitted without passing through the Judge.
  \A task \in tasks:
    (task.status = "completed") =>
      /\ task.judgment \in {"APPROVE"}
      /\ task.critique # NULL
--------------------------------------------------------------------------------
```

---

## I5: Capability Confinement

Every action and resource access is governed by capability tokens. No component can exercise a capability it was not granted.

```tla+
--------------------------------------------------------------------------------
INVARIANT CapabilitySubset ==
  \* A plugin's exercised capabilities are always a subset of its
  \* granted capabilities.
  \A plugin \in plugins:
    plugin.exercised_capabilities \subseteq plugin.granted_capabilities

INVARIANT ActionRequiresCapability ==
  \* Every executed action was authorized by a valid capability token.
  \A action \in actions:
    \E cap \in action.agent.granted_capabilities:
      /\ CapabilityCovers(cap, action.required_capability)
      /\ cap.expires_at > action.timestamp
      /\ cap.revoked = FALSE

INVARIANT CapabilityGranularity ==
  \* Capability grants are no broader than the organizational policy
  \* allows for the given agent role.
  \A agent \in agents:
    \A cap \in agent.granted_capabilities:
      cap \in AllowedCapabilities(agent.role, OrganizationalPolicy)

PROPERTY CapabilityRevocation ==
  \* When a capability is revoked, it cannot be exercised thereafter.
  \A cap \in AllCapabilities:
    (cap.revoked = TRUE) =>
      [](~ \E action \in actions':
            action.capability_token = cap
            /\ action \notin actions)
--------------------------------------------------------------------------------
```

---

## I6: Memory Privacy

Memory access respects privacy classifications, retention policies, and right-to-erasure requests.

```tla+
--------------------------------------------------------------------------------
INVARIANT PrivacyLevelEnforced ==
  \* A memory read is permitted only if the requester's clearance level
  \* is at or above the entry's classification.
  \A access \in MemoryAccesses:
    (access.type = "read") =>
      ClearanceLevel(access.requester) >= access.entry.classification

INVARIANT PiiEncryptedAtRest ==
  \* All memory entries classified as CONFIDENTIAL or RESTRICTED are
  \* encrypted at rest (AES-256-GCM).
  \A entry \in MemoryEntries:
    (entry.classification \in {"CONFIDENTIAL", "RESTRICTED"}) =>
      entry.encrypted = TRUE

INVARIANT RetentionPolicyEnforced ==
  \* Memory entries past their retention deadline are not accessible.
  \A entry \in MemoryEntries:
    (CurrentTime > entry.retention_deadline) =>
      entry.status \in {"archived", "deleted"}

PROPERTY RightToErasure ==
  \* After a right-to-erasure request is completed, no trace of the
  \* subject's data remains in accessible memory.
  \A req \in ErasureRequests:
    (req.status = "completed") =>
      [](~ \E entry \in AccessibleMemoryEntries:
            entry.subject_id = req.subject_id
            /\ entry.scope \in req.scopes)

INVARIANT CrossSessionIsolation ==
  \* An agent in session A cannot read memory entries belonging to
  \* session B unless explicitly granted cross-session access.
  \A access \in MemoryAccesses:
    (access.entry.session_id # access.requester.session_id) =>
      \E grant \in CrossSessionGrants:
        /\ grant.source_session = access.entry.session_id
        /\ grant.target_session = access.requester.session_id
        /\ grant.expires_at > access.timestamp
--------------------------------------------------------------------------------
```

---

## I7: Evidence Provenance Completeness

Every evidence item in an Evidence Pack has a complete provenance chain back to a verifiable source.

```tla+
--------------------------------------------------------------------------------
INVARIANT NoOrphanEvidence ==
  \* Every evidence item has a valid source reference.
  \A pack \in evidencePacks:
    \A item \in pack.evidence:
      /\ item.source.document_id \in IngestedDocuments
      /\ item.source.content_hash # NULL
      /\ item.source.uri # NULL

INVARIANT ProvenanceChainComplete ==
  \* The provenance chain is unbroken: from evidence item, through
  \* retrieval method, to the ingested document, to the original source.
  \A pack \in evidencePacks:
    \A item \in pack.evidence:
      /\ item.provenance.retrieval_method \in
           {"vector", "bm25", "graph", "sql"}
      /\ item.provenance.raw_score >= 0.0
      /\ item.provenance.rerank_score >= 0.0
      /\ item.source.ingested_at # NULL

INVARIANT EvidencePackImmutable ==
  \* Once created, an Evidence Pack is never modified.
  \A pack \in evidencePacks:
    [](pack \in evidencePacks' /\ pack' = pack)

INVARIANT FreshnessTracked ==
  \* Every evidence item has a freshness indicator that reflects the
  \* age of the source document.
  \A pack \in evidencePacks:
    pack.quality.freshness =
      MIN({item.source.ingested_at : item \in pack.evidence})

PROPERTY StaleEvidenceFlagged ==
  \* If any evidence item's source is older than MAX_STALENESS,
  \* the pack's quality assessment reflects this.
  \A pack \in evidencePacks:
    (\E item \in pack.evidence:
      CurrentTime - item.source.last_verified > MAX_STALENESS) =>
        pack.quality.has_stale_evidence = TRUE
--------------------------------------------------------------------------------
```

---

## I8: Privacy-Tier Routing

Model requests carrying data above a certain privacy tier are routed only to approved (on-premises) providers.

```tla+
--------------------------------------------------------------------------------
INVARIANT ConfidentialDataStaysOnPrem ==
  \* Requests tagged CONFIDENTIAL or RESTRICTED route only to providers
  \* in the on-premises approved set.
  \A req \in modelRequests:
    (req.privacy_tier \in {"CONFIDENTIAL", "RESTRICTED"}) =>
      req.routed_to_provider \in OnPremProviders

INVARIANT PublicDataUnrestricted ==
  \* Requests tagged PUBLIC can route to any healthy provider.
  \* (This is a freedom, not a constraint -- included for completeness.)
  \A req \in modelRequests:
    (req.privacy_tier = "PUBLIC") =>
      req.routed_to_provider \in HealthyProviders

INVARIANT PrivacyTierMonotonic ==
  \* When data from multiple sources is combined, the resulting privacy
  \* tier is the maximum (most restrictive) of the inputs.
  \A req \in modelRequests:
    req.privacy_tier = MAX({source.privacy_tier : source \in req.data_sources})

PROPERTY PrivacyPolicyEvaluation ==
  \* The privacy routing policy is evaluated for EVERY model request
  \* without exception.
  \A req \in modelRequests:
    \E eval \in PolicyEvaluations:
      /\ eval.request_id = req.request_id
      /\ eval.policy_type = "privacy_routing"
      /\ eval.timestamp <= req.routed_at
--------------------------------------------------------------------------------
```

---

## I9: Human Escalation Non-Suppression

When escalation is required (by policy or by the Judge), no system component can suppress or bypass it.

```tla+
--------------------------------------------------------------------------------
INVARIANT EscalationMandatory ==
  \* If the Judge decides ESCALATE, the task MUST enter the escalated
  \* state and a human notification MUST be created.
  \A task \in tasks:
    (task.judgment = "ESCALATE") =>
      /\ task.status \in {"escalated"}
      /\ \E notif \in HumanNotifications:
           /\ notif.task_id = task.task_id
           /\ notif.type = "escalation"

INVARIANT EscalationNotSuppressible ==
  \* No agent action can cancel, dismiss, or resolve an escalation.
  \* Only a human user can resolve an escalation.
  \A esc \in escalations:
    (esc.status = "resolved") =>
      /\ esc.resolved_by \in HumanUsers
      /\ esc.resolved_by \notin Agents

INVARIANT HighRiskRequiresEscalation ==
  \* Tasks involving irreversible actions above the escalation threshold
  \* must be escalated to a human.
  \A task \in tasks:
    (task.risk_level >= ESCALATION_THRESHOLD
     /\ task.has_irreversible_actions = TRUE) =>
      \E esc \in escalations:
        esc.task_id = task.task_id

PROPERTY EscalationTimeliness ==
  \* Every escalation receives a human response within the SLA
  \* (liveness property; SLA is configurable).
  \A esc \in escalations:
    <>(esc.status = "resolved"
       /\ esc.resolved_at - esc.created_at <= EscalationSLA)
--------------------------------------------------------------------------------
```

---

## I10: Plugin Sandboxing

Plugins execute within strict resource and capability boundaries.

```tla+
--------------------------------------------------------------------------------
INVARIANT PluginMemoryBounded ==
  \* A plugin's memory usage never exceeds its configured limit.
  \A plugin \in plugins:
    plugin.current_memory_bytes <= plugin.memory_limit_bytes

INVARIANT PluginCpuBounded ==
  \* A plugin invocation's CPU time never exceeds its configured limit.
  \A invocation \in PluginInvocations:
    invocation.cpu_time_ms <= invocation.plugin.cpu_limit_ms

INVARIANT PluginNetworkRestricted ==
  \* A plugin can only make network calls if it has a network capability
  \* grant, and only to the domains specified in that grant.
  \A plugin \in plugins:
    \A net_call \in plugin.network_calls:
      \E cap \in plugin.granted_capabilities:
        /\ cap.type = "net:egress"
        /\ DomainMatches(net_call.host, cap.domain_pattern)

INVARIANT PluginConcurrencyLimited ==
  \* The number of concurrent invocations of a plugin does not exceed
  \* its configured maximum.
  \A plugin \in plugins:
    Cardinality({inv \in PluginInvocations:
      inv.plugin_id = plugin.id /\ inv.status = "running"})
      <= plugin.max_concurrent

PROPERTY PluginTermination ==
  \* Every plugin invocation eventually completes (success, failure,
  \* or timeout). No plugin can run indefinitely.
  \A inv \in PluginInvocations:
    <>(inv.status \in {"completed", "failed", "timeout"})
--------------------------------------------------------------------------------
```

---

## I11: Action Authorization

Every external action (web automation, API call, telephony, shell command) is authorized, logged, and classified for reversibility.

```tla+
--------------------------------------------------------------------------------
INVARIANT ActionAuthorized ==
  \* Every executed action has a valid authorization record.
  \A action \in actions:
    (action.status = "executed") =>
      /\ action.authorized = TRUE
      /\ \E cap \in action.agent.granted_capabilities:
           CapabilityCovers(cap, action.required_capability)

INVARIANT ActionLogged ==
  \* Every executed action produces an event in the Event Store.
  \A action \in actions:
    (action.status \in {"executed", "failed", "timeout"}) =>
      \E event \in Range(eventStore):
        /\ event.event_type \in {"ActionCompleted", "ActionFailed",
                                  "ActionTimeout"}
        /\ event.payload.action_id = action.action_id

INVARIANT IrreversibleActionsRequireApproval ==
  \* Actions classified as irreversible require human approval before
  \* execution (unless the task has pre-approved this action type).
  \A action \in actions:
    (action.reversibility = "irreversible"
     /\ action.status = "executed") =>
      \/ action.pre_approved = TRUE
      \/ \E approval \in HumanApprovals:
           /\ approval.action_id = action.action_id
           /\ approval.decision = "approve"
           /\ approval.timestamp < action.executed_at

INVARIANT TelephonyRequiresConsent ==
  \* Telephony actions (calls) require explicit consent records.
  \A action \in actions:
    (action.channel = "telephony" /\ action.status = "executed") =>
      \E consent \in ConsentRecords:
        /\ consent.action_id = action.action_id
        /\ consent.granted_by \in HumanUsers
        /\ consent.timestamp < action.executed_at

INVARIANT ActionRateLimited ==
  \* Actions respect rate limits per agent, per channel, per time window.
  \A agent \in agents:
    \A channel \in ActionChannels:
      LET recent == {a \in actions:
        a.agent_id = agent.id
        /\ a.channel = channel
        /\ a.executed_at > CurrentTime - RateWindow(channel)}
      IN Cardinality(recent) <= RateLimit(agent, channel)
--------------------------------------------------------------------------------
```

---

## I12: Critic Evaluation Completeness

Every task result that reaches the Judge has been evaluated by the Critic.

```tla+
--------------------------------------------------------------------------------
INVARIANT CriticEvaluatesBeforeJudge ==
  \* The Judge only receives tasks that have a Critique report.
  \A task \in tasks:
    (task.status = "judging") =>
      task.critique # NULL

INVARIANT CritiqueCoversAllDimensions ==
  \* Every Critique report evaluates all required dimensions.
  \A task \in tasks:
    (task.critique # NULL) =>
      /\ task.critique.overall_score \in [0.0, 1.0]
      /\ task.critique.recommendation \in {"APPROVE", "REVISE", "ABORT"}
      /\ \A dim \in {"quality", "safety", "constraint", "evidence"}:
           \E issue_or_pass \in task.critique.evaluations:
             issue_or_pass.category = dim

PROPERTY CriticIndependence ==
  \* The Critic's evaluation is performed by a separate model invocation
  \* from the Planner's generation. (Structural, not formally provable
  \* in TLA+, but enforced by architecture.)
  \A task \in tasks:
    (task.critique # NULL) =>
      task.critique.model_invocation_id # task.plan_generation.model_invocation_id
--------------------------------------------------------------------------------
```

---

## Composition Theorem

The conjunction of all invariants defines the system's safety envelope:

```tla+
SystemSafe ==
  /\ EventStoreAppendOnly
  /\ StreamMonotonicity
  /\ CausalOrdering
  /\ StateDerivedFromEvents
  /\ EventUniqueness
  /\ BudgetNotExceeded
  /\ BudgetCheckedBeforeInvocation
  /\ RevisionBounded
  /\ LoopProgressMonotonic
  /\ TimeoutEnforced
  /\ MaxRevisionsForceTermination
  /\ CriticalIssuesBlockApproval
  /\ AbortIsTerminal
  /\ SafetyPolicyIsDeterministic
  /\ NoActionWithoutJudgment
  /\ CapabilitySubset
  /\ ActionRequiresCapability
  /\ CapabilityGranularity
  /\ PrivacyLevelEnforced
  /\ PiiEncryptedAtRest
  /\ RetentionPolicyEnforced
  /\ CrossSessionIsolation
  /\ NoOrphanEvidence
  /\ ProvenanceChainComplete
  /\ EvidencePackImmutable
  /\ FreshnessTracked
  /\ ConfidentialDataStaysOnPrem
  /\ PrivacyTierMonotonic
  /\ EscalationMandatory
  /\ EscalationNotSuppressible
  /\ HighRiskRequiresEscalation
  /\ PluginMemoryBounded
  /\ PluginCpuBounded
  /\ PluginNetworkRestricted
  /\ PluginConcurrencyLimited
  /\ ActionAuthorized
  /\ ActionLogged
  /\ IrreversibleActionsRequireApproval
  /\ TelephonyRequiresConsent
  /\ ActionRateLimited
  /\ CriticEvaluatesBeforeJudge
  /\ CritiqueCoversAllDimensions

\* The spec asserts that SystemSafe holds in the initial state and is
\* preserved by every state transition.
Spec == Init /\ [][Next]_vars /\ SystemSafe
```

---

## Verification Strategy

These invariants are designed for:

1. **Model checking**: Simplified TLA+ models can be checked with the TLC model checker for small state spaces.
2. **Property-based testing**: Each invariant translates to a property test that can be run against the actual implementation using QuickCheck-style generators.
3. **Runtime assertions**: Critical invariants (budget checks, capability checks, escalation non-suppression) are enforced as runtime assertions in production code.
4. **Code review checklist**: Each PR that modifies a plane must identify which invariants are affected and demonstrate continued compliance.
