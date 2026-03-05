# AgentOS Formal Invariants

Safety properties expressed in TLA+-style pseudocode.

## I1: Budget Safety

Every execution path must respect budget limits. No action can proceed if budget is exhausted.

```tla+
INVARIANT BudgetSafety ==
  \A mission \in Missions:
    /\ mission.tokensUsed <= mission.budget.maxTokens
    /\ mission.costUSD <= mission.budget.maxCostUSD
    /\ mission.apiCalls <= mission.budget.maxApiCalls

PROPERTY BudgetMonotonicity ==
  \A mission \in Missions:
    []( mission.budget.remaining' <= mission.budget.remaining )

PROPERTY BudgetCheck ==
  \A step \in Steps:
    step.status = "executing" =>
      step.mission.budget.remaining > 0
```

## I2: Soul Policy Compliance

No action executes without passing soul policy checks.

```tla+
INVARIANT SoulCompliance ==
  \A action \in ExecutedActions:
    \E check \in PolicyChecks:
      /\ check.action = action
      /\ check.result \in {"allow", "allow_with_log"}
      /\ check.timestamp < action.timestamp

PROPERTY NoBypass ==
  \A action \in Actions:
    action.status = "executed" =>
      ~(\E violation \in SoulViolations: violation.action = action)
```

## I3: Escalation Guarantee

High-risk actions must escalate to human review.

```tla+
INVARIANT EscalationGuarantee ==
  \A action \in Actions:
    /\ action.riskLevel >= ESCALATION_THRESHOLD
    => \E escalation \in Escalations:
        /\ escalation.action = action
        /\ escalation.humanResponse \in {"approve", "reject", "modify"}

PROPERTY HumanInLoop ==
  \A mission \in Missions:
    mission.hasIrreversibleAction =>
      <>(\E approval \in HumanApprovals: approval.mission = mission)
```

## I4: Critic Evaluation Completeness

Every executed step must be evaluated by the critic.

```tla+
INVARIANT CriticCompleteness ==
  \A step \in Steps:
    step.status = "completed" =>
      \E feedback \in CriticFeedbacks:
        /\ feedback.stepId = step.id
        /\ feedback.verdict \in {"accept", "revise", "reject"}

PROPERTY NoUnreviewedOutput ==
  \A result \in ExecutionResults:
    <>(\E review \in CriticReviews: review.resultId = result.id)
```

## I5: Event Sourcing Integrity

All state changes are recorded as events. State is reconstructable from events.

```tla+
INVARIANT EventIntegrity ==
  \A state \in SystemStates:
    state = Replay(EventLog, InitialState)

PROPERTY AppendOnly ==
  \A event \in EventLog:
    []( event \in EventLog' )

PROPERTY CausalOrdering ==
  \A e1, e2 \in EventLog:
    e1.causedBy = e2 => e1.sequence > e2.sequence
```

## I6: Memory Privacy

Memory access respects privacy levels and retention policies.

```tla+
INVARIANT MemoryPrivacy ==
  \A access \in MemoryAccesses:
    /\ access.requester.clearanceLevel >= access.entry.privacyLevel
    /\ access.entry.expiresAt > CurrentTime
    /\ ~access.entry.forgotten

PROPERTY RightToForget ==
  \A forgetRequest \in ForgetRequests:
    forgetRequest.status = "completed" =>
      ~(\E entry \in MemoryEntries:
        /\ entry.subjectId = forgetRequest.subjectId
        /\ entry.scope \in forgetRequest.scopes)
```

## I7: Grounding Requirement

Claims in evidence packs must be grounded in sources.

```tla+
INVARIANT GroundingRequirement ==
  \A claim \in EvidencePack.claims:
    /\ Len(claim.citations) >= MIN_CITATIONS
    /\ \A citation \in claim.citations:
        /\ citation.source \in VerifiedSources
        /\ citation.retrievedAt > (CurrentTime - MAX_STALENESS)

PROPERTY ProvenanceChain ==
  \A evidence \in EvidencePacks:
    \A item \in evidence.items:
      \E chain \in ProvenanceChains:
        /\ chain.claim = item.claim
        /\ chain.source \in TrustedSources
```

## I8: Action Safety

External actions must be authorized, logged, and reversibility-classified.

```tla+
INVARIANT ActionSafety ==
  \A action \in ExternalActions:
    /\ action.authorized = TRUE
    /\ action.logged = TRUE
    /\ action.reversibility \in {"reversible", "irreversible", "unknown"}
    /\ (action.reversibility = "irreversible" =>
        action.humanApproved = TRUE)

PROPERTY ConsentRequired ==
  \A call \in TelephonyCalls:
    \E consent \in ConsentRecords:
      /\ consent.callId = call.id
      /\ consent.grantedBy \in HumanUsers
      /\ consent.timestamp < call.startTime
```

## I9: Model Router Availability

The model router must always have at least one healthy provider.

```tla+
INVARIANT RouterAvailability ==
  \E provider \in ProviderRegistry:
    provider.healthy = TRUE

PROPERTY FallbackGuarantee ==
  \A request \in ModelRequests:
    request.primaryProvider.healthy = FALSE =>
      \E fallback \in FallbackChain:
        /\ fallback.healthy = TRUE
        /\ fallback.capabilities \supseteq request.requiredCapabilities
```

## I10: Plugin Sandboxing

Plugins execute in sandboxed environments with resource limits.

```tla+
INVARIANT PluginSandbox ==
  \A plugin \in LoadedPlugins:
    /\ plugin.memoryUsage <= plugin.memoryLimit
    /\ plugin.executionTime <= plugin.timeoutLimit
    /\ plugin.capabilities \subseteq plugin.grantedCapabilities
    /\ ~plugin.hasNetworkAccess \/ plugin.networkWhitelisted
```
