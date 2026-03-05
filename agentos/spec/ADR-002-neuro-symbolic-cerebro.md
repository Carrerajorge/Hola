# ADR-002: Neuro-Symbolic Cerebro

**Date:** 2026-03-05
**Status:** Accepted
**Deciders:** AgentOS-ASI Architecture Board

---

## Context

The Control Plane must orchestrate complex, multi-step agent tasks that require:

1. **Planning**: Decomposing high-level goals into executable sub-tasks with dependencies.
2. **Execution**: Running sub-tasks with parallelism, retries, and compensation.
3. **Quality assurance**: Evaluating outputs against criteria before delivery.
4. **Safety enforcement**: Ensuring no harmful, policy-violating, or unauthorized actions proceed.

Pure LLM-based approaches (e.g., ReAct, chain-of-thought with tool use) suffer from:

- **Unbounded loops**: LLMs can enter infinite refinement cycles without explicit termination conditions.
- **Inconsistent planning**: LLM plans vary across runs and may miss constraints.
- **Unverifiable safety**: There is no structural guarantee that safety checks occur; they depend on prompt engineering.
- **Poor compensation**: When things fail mid-execution, pure LLM approaches lack systematic rollback.

Pure symbolic approaches (e.g., classical HTN planners, STRIPS) suffer from:

- **Brittleness**: Require complete domain axiomatization, which is infeasible for open-ended agent tasks.
- **No natural language understanding**: Cannot directly interpret user goals expressed in natural language.
- **Rigid execution**: Cannot adapt to unexpected intermediate results.

We need an architecture that combines the flexibility of neural (LLM) reasoning with the reliability of symbolic verification and control flow.

---

## Decision

We adopt a **neuro-symbolic architecture** for the Control Plane, called the **Cerebro**, implementing a four-stage reasoning loop:

### Stage 1: Planner (Neural + Symbolic)

The Planner combines LLM-based reasoning with symbolic constraint propagation:

1. **LLM decomposition**: The LLM receives the goal, available capabilities, world state, and generates a candidate plan as a DAG of sub-tasks.
2. **Symbolic validation**: A constraint propagation engine validates the candidate plan against:
   - Resource constraints (budget, time, capability availability).
   - Dependency constraints (no circular dependencies, topological ordering).
   - Safety constraints (prohibited action sequences, required approval gates).
3. **Repair loop**: If validation fails, violations are fed back to the LLM for plan repair (max 3 repair attempts).

The output is a validated Plan DAG where each node specifies:
- Task description, required capability, estimated cost/time.
- Pre-conditions and post-conditions (symbolic assertions).
- Compensation handler (for saga rollback).

### Stage 2: Executor (Symbolic)

The Executor is purely symbolic -- a saga orchestrator:

1. Topologically sorts the Plan DAG.
2. Executes tasks respecting dependency edges, maximizing parallelism.
3. Dispatches tasks to the Action Plane via the Data Plane (durable execution).
4. Collects results and updates the execution trace.
5. On failure: triggers compensation handlers in reverse topological order.

The Executor makes no LLM calls. Its behavior is deterministic given the Plan DAG and action results.

### Stage 3: Critic (Neural)

The Critic uses a separate LLM call (potentially a different model) to evaluate:

1. **Output quality**: Does the result satisfy the user's goal?
2. **Constraint satisfaction**: Are all post-conditions met?
3. **Safety compliance**: Does the output violate any safety policies?
4. **Evidence quality**: Are claims supported by evidence (evidence pack provenance)?

The Critic produces a structured Critique Report:
```
CritiqueReport {
  overall_score:    float (0.0 - 1.0)
  issues: [
    {
      severity: CRITICAL | HIGH | MEDIUM | LOW
      category: "quality" | "safety" | "constraint" | "evidence"
      description: string
      suggestion: string
    }
  ]
  recommendation: APPROVE | REVISE | ABORT
}
```

### Stage 4: Judge (Symbolic + Policy)

The Judge is primarily symbolic, applying organizational policy:

1. If Critique has any CRITICAL issues: **ABORT** (non-overridable).
2. If Critique recommends REVISE and revision count < `MAX_REVISIONS`: **REVISE** (return to Planner).
3. If Critique recommends REVISE and revision count >= `MAX_REVISIONS`: **ESCALATE** to human.
4. If the task is in the escalation-required category: **ESCALATE** regardless of Critique.
5. Otherwise: **APPROVE**.

The Judge's decision logic is expressed as declarative policy rules (Rego/OPA-style), not as LLM prompts. This ensures deterministic, auditable decision-making at the final gate.

### Loop Termination

The loop is guaranteed to terminate:

- `MAX_REVISIONS` (default: 3) bounds the number of Planner re-entries.
- Each stage has a wall-clock timeout.
- The Judge's ABORT and ESCALATE paths are terminal.
- A monotonically increasing iteration counter is checked at loop entry.

### Feedback Mechanism

Revision feedback flows backward through the loop:

```
Judge (REVISE) --> Planner receives:
  - Original goal
  - Previous plan DAG
  - Execution trace
  - Critique report with specific issues
  - Revision number (for the LLM to understand this is a retry)
```

This gives the Planner rich context for generating an improved plan.

---

## Consequences

### Positive

- **Bounded execution**: The symbolic loop structure guarantees termination, unlike pure LLM loops.
- **Separation of concerns**: Neural components (Planner, Critic) handle open-ended reasoning; symbolic components (Executor, Judge) handle control flow and policy enforcement.
- **Verifiable safety**: The Judge's policy rules are inspectable, testable, and deterministic. Safety does not depend on prompt engineering.
- **Auditable decisions**: Every loop iteration produces an immutable `CerebroIterationEvent` with the plan, execution trace, critique, and judgment.
- **Model flexibility**: The Planner and Critic can use different models (e.g., a fast model for planning, a strong model for critique). They are decoupled.
- **Systematic compensation**: The Executor's saga pattern provides reliable rollback, unlike ad-hoc LLM-driven error handling.

### Negative

- **Latency**: The four-stage loop adds latency compared to single-pass LLM execution. Mitigated by parallelism within stages and by skipping the Critic for low-risk tasks (configurable).
- **Complexity**: Four interacting components are harder to debug than a single LLM call. Mitigated by comprehensive tracing and the DAG visualization in the UI Plane.
- **Constraint specification burden**: Symbolic constraints must be specified for safety and resource limits. Mitigated by providing sensible defaults and a policy-as-code framework.
- **Critique quality depends on LLM**: The Critic's evaluation is only as good as the LLM's judgment. Mitigated by using structured rubrics and supporting the Critic with evidence packs.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Planner-Critic disagreement loop (plan is always revised) | Medium | Medium | `MAX_REVISIONS` bound; escalation to human after bound reached. |
| Critic misses a safety issue | Low | Critical | Defense in depth: Judge applies symbolic safety rules independently of Critic. Action Plane has its own capability checks. |
| Symbolic constraints are too restrictive | Medium | Medium | Start permissive; tighten based on incident data. Policy rules are hot-reloadable. |

---

## References

- Kambhampati, S. "Can LLMs Really Plan?" Position paper, 2024.
- Yao, S. et al. "ReAct: Synergizing Reasoning and Acting in Language Models." ICLR 2023.
- Garcia-Molina, H. & Salem, K. "Sagas." ACM SIGMOD, 1987.
- Open Policy Agent (OPA) documentation.
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Control Plane section.
