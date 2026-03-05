# ADR-002: Neuro-Symbolic Cerebro

**Status:** Accepted
**Date:** 2026-03-05
**Deciders:** AgentOS Core Team
**Supersedes:** N/A

---

## Context

The Control Plane must convert high-level user goals into executable plans and ensure those plans are carried out correctly, safely, and efficiently. This requires three capabilities:

1. **Flexible reasoning**: Handling ambiguous, open-ended goals that cannot be fully specified in advance.
2. **Structured planning**: Decomposing goals into dependency-ordered sub-tasks with resource estimates.
3. **Verification**: Ensuring outputs meet quality standards and safety constraints before delivery.

We evaluated three approaches:

### Option A: Pure LLM (ReAct-style agent loop)

The LLM handles all reasoning, planning, and self-evaluation in a single prompt chain.

- **Pro**: Simple implementation; leverages LLM's broad knowledge.
- **Con**: Plans are opaque text with no formal structure. No guarantee of constraint satisfaction. Self-evaluation suffers from the same biases as generation ("the fox guarding the henhouse"). Difficult to enforce hard safety invariants.

### Option B: Pure symbolic planner (PDDL / HTN)

A classical AI planner handles all task decomposition using formal domain specifications.

- **Pro**: Provably correct plans given correct domain model. Constraint satisfaction guaranteed.
- **Con**: Requires complete domain specification upfront, which is infeasible for general-purpose agent tasks. Cannot handle ambiguity or novel domains. Brittle to domain model errors.

### Option C: Neuro-symbolic hybrid (proposed)

Combine LLM reasoning with symbolic planning and multi-stage verification.

- **Pro**: LLM handles ambiguity and novel domains; symbolic constraints enforce hard invariants; separate Critic and Judge stages provide independent verification.
- **Con**: More complex architecture; requires careful interface design between neural and symbolic components.

---

## Decision

We adopt **Option C: a neuro-symbolic Cerebro** implementing a four-stage reasoning loop: **Planner -> Executor -> Critic -> Judge**.

### Stage 1: Planner (Neural + Symbolic)

The Planner combines LLM chain-of-thought reasoning with Hierarchical Task Network (HTN) decomposition:

1. The LLM generates a natural-language plan given the goal, available capabilities, and context.
2. A structured output parser extracts the plan into a formal DAG representation.
3. A symbolic constraint propagator validates:
   - **Temporal constraints**: Dependency ordering is acyclic.
   - **Resource constraints**: Estimated costs are within budget.
   - **Capability constraints**: Every sub-task maps to an available capability.
   - **Safety constraints**: No sub-task violates safety policies.
4. If validation fails, the LLM is re-prompted with the constraint violations as feedback (up to `MAX_PLAN_RETRIES = 3`).

### Stage 2: Executor (Saga orchestration)

The Executor treats the plan DAG as a distributed saga:

- Nodes execute in topological order with maximum parallelism.
- Each node dispatches to the Action Plane, Knowledge Plane, or Model Plane.
- Failures trigger compensation handlers registered per node.
- Partial results are checkpointed via the Data Plane (Temporal workflow).

### Stage 3: Critic (Independent neural evaluation)

The Critic is a separate LLM call (potentially a different model) that evaluates the Executor's output:

- **Quality assessment**: Does the output satisfy the original goal?
- **Constraint satisfaction**: Were all constraints met?
- **Safety check**: Does the output contain harmful, biased, or policy-violating content?
- **Evidence audit**: Are claims supported by the Evidence Packs from the Knowledge Plane?

The Critic produces a structured report with severity levels (`INFO`, `WARNING`, `CRITICAL`) and a recommendation (`PASS`, `REVISE`, `ABORT`).

### Stage 4: Judge (Policy enforcement + human gate)

The Judge is the terminal decision maker:

- Applies organizational policy rules (deterministic, not LLM-based).
- If the Critic reports any `CRITICAL` issue, the Judge must `ESCALATE` (cannot override).
- If the task is flagged as high-risk, the Judge presents the result to a human approver via the UI Plane.
- The Judge produces a final `APPROVE`, `REVISE`, `ESCALATE`, or `ABORT` decision with justification.

### Loop Termination

- `MAX_REVISIONS = 3` (configurable per task risk level).
- If the loop exhausts revisions without approval, the task is `ESCALATED` to a human.
- The loop counter is enforced in the Executor, not the LLM, making it un-bypassable.

### Separation of Concerns

| Stage | Neural | Symbolic | Human |
|-------|--------|----------|-------|
| Planner | LLM generates plan | Constraint propagator validates | N/A |
| Executor | N/A | Saga orchestrator | N/A |
| Critic | LLM evaluates output | Rubric scoring | N/A |
| Judge | N/A | Policy rules engine | Escalation approver |

The key insight: **generation and evaluation are performed by independent components** (Planner/Executor vs. Critic/Judge), and **hard safety invariants are enforced symbolically, not neurally**.

---

## Consequences

### Positive

1. **Robust planning**: LLM handles ambiguity; symbolic constraints enforce hard requirements. Plans that violate constraints are caught before execution.

2. **Independent verification**: The Critic evaluates output independently of the generation process, reducing self-consistency bias.

3. **Enforceable safety**: Safety invariants are checked symbolically in the Judge. An LLM cannot "argue its way past" a deterministic policy rule.

4. **Auditability**: Each stage produces a structured artifact (plan DAG, execution trace, critique report, judgment), creating a complete audit trail.

5. **Tunability**: Risk tolerance is adjustable per task type -- low-risk tasks may skip human escalation; high-risk tasks may require multi-human approval.

6. **Model independence**: The Planner LLM and Critic LLM can be different models, reducing the risk of correlated failures.

### Negative

1. **Latency**: Four stages add latency compared to a single LLM call. Mitigated by parallelizing where possible and caching plans for repeated task types.

2. **Cost**: Multiple LLM calls per task increase token costs. Mitigated by using smaller/cheaper models for the Critic when appropriate (via Model Plane routing).

3. **Complexity**: The four-stage loop is more complex to implement and debug than a simple agent loop. Mitigated by comprehensive tracing and structured event logging.

4. **Domain modeling**: Symbolic constraints require a schema of capabilities and policies. This schema must be maintained as the system evolves. Mitigated by deriving capability schemas from plugin manifests.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Critic-Planner collusion (same model, correlated biases) | Medium | Missed safety issues | Use different models for Planner and Critic; rotate models periodically |
| Constraint model incompleteness | High (initially) | Plans that satisfy constraints but are still flawed | Iterative refinement of constraint model based on Critic findings |
| Loop starvation (always revising, never approving) | Low | Task never completes | MAX_REVISIONS hard limit with mandatory escalation |

---

## References

- Yao et al., "ReAct: Synergizing Reasoning and Acting in Language Models" (2023).
- Nau et al., "SHOP2: An HTN Planning System" (2003).
- Madaan et al., "Self-Refine: Iterative Refinement with Self-Feedback" (2023).
- Shinn et al., "Reflexion: Language Agents with Verbal Reinforcement Learning" (2023).
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Control Plane specification.
