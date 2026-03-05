# ADR-003: Multi-Model Routing with Policy-Based Selection

**Date:** 2026-03-05
**Status:** Accepted
**Deciders:** AgentOS-ASI Architecture Board

---

## Context

AgentOS-ASI is not tied to a single LLM provider. Different tasks benefit from different models:

- **Code generation** may perform best on Claude or Codex.
- **Summarization** may be most cost-effective on GPT-4o-mini.
- **Long-context analysis** requires models with 100K+ context windows.
- **Vision tasks** require multimodal models.
- **Privacy-sensitive tasks** must route to on-premises models (e.g., vLLM-hosted Llama) to prevent data from leaving the tenant boundary.

Additionally, the system must handle:

- **Provider outages**: If the primary provider is down, requests must fail over to an alternative.
- **Cost management**: Total LLM spend must be controllable per session, per agent, and per organization.
- **Latency requirements**: Interactive tasks need low time-to-first-token (TTFT); batch tasks can tolerate higher latency.
- **A/B testing**: The team needs to evaluate new models in production with traffic splitting.

We considered three approaches:

1. **Hardcoded model selection**: Each calling site specifies the exact model. Simple but inflexible; every task-model mapping change requires code changes.
2. **Central routing with static config**: A router maps task types to models via configuration. Better, but cannot adapt to runtime conditions (cost, latency, availability).
3. **Policy-based routing**: A router evaluates a policy engine at request time, considering task metadata, runtime conditions, and organizational rules.

---

## Decision

We adopt **policy-based multi-model routing** in the Model Plane.

### Architecture

The Model Plane consists of three components:

#### 1. Policy Engine

A rule engine (Rego/OPA-style) that evaluates routing policies against the request context:

```
input: {
  task_type:        "code_generation" | "summarization" | "reasoning" | ...
  complexity:       "low" | "medium" | "high"
  privacy_tier:     "PUBLIC" | "INTERNAL" | "CONFIDENTIAL" | "RESTRICTED"
  latency_sla_ms:   2000
  budget_remaining:  4.50     // USD remaining in session budget
  capabilities:     ["vision", "function_calling", "long_context"]
  context_tokens:   45000
  prefer_provider:  null      // optional explicit preference
}

output: {
  model_id:         "claude-opus-4-20250514"
  provider:         "anthropic"
  fallback_chain:   ["gpt-4o", "llama-3-70b-local"]
  max_tokens:       4096
  temperature:      0.3
  cost_estimate:    0.12
}
```

Policies are organized in layers with precedence:

1. **Safety policies** (highest precedence): Privacy tier routing, content filtering.
2. **Organizational policies**: Cost ceilings, approved provider lists.
3. **Performance policies**: Task-model affinity, latency-based routing.
4. **Default policies** (lowest precedence): Fallback selections.

Policies are hot-reloadable without restarts.

#### 2. Router

The Router executes the policy engine's decision:

1. Selects the primary model and provider.
2. Constructs the provider-specific request (prompt format, parameters).
3. Sends the request with a deadline.
4. On failure: tries the next model in the fallback chain.
5. On all failures: returns an error with details.

The Router implements:

- **Circuit breakers** per provider (open after N consecutive failures; half-open after cooldown).
- **Retry with exponential backoff** for transient errors (rate limits, timeouts).
- **Request hedging** for latency-critical requests (send to two providers, use first response, cancel second).
- **Traffic splitting** for A/B testing (e.g., 90% to Claude, 10% to GPT-4o for comparison).

#### 3. Response Normalizer

Provider responses are transformed into a canonical format:

```
ModelResponse {
  request_id:       UUID
  model_id:         string
  provider_id:      string
  content:          string | AsyncStream<string>

  usage: {
    prompt_tokens:      uint32
    completion_tokens:  uint32
    total_tokens:       uint32
    cost_usd:           float
  }

  performance: {
    ttft_ms:            uint32   // time to first token
    total_latency_ms:   uint32
    tokens_per_second:  float
  }

  metadata: {
    finish_reason:        "stop" | "length" | "tool_use" | "content_filter"
    provider_request_id:  string
    cache_hit:            bool
  }
}
```

This normalization ensures that calling planes never depend on provider-specific response formats.

### Provider Abstraction

Each provider implements a `ModelProvider` interface:

- `complete(request) -> AsyncStream<CompletionChunk>` -- streaming completion.
- `embed(request) -> EmbedResponse` -- embedding generation.
- `health() -> HealthStatus` -- health check for circuit breaker.
- `usage() -> UsageReport` -- current usage/quota status.

Adding a new provider requires implementing this interface and registering it. No changes to the router or policy engine are needed.

### Cost Management

- **Session budget**: Each session has a maximum spend. The router checks remaining budget before each request.
- **Per-request cost estimation**: The policy engine estimates cost before routing, allowing pre-flight budget checks.
- **Retroactive accounting**: Actual costs are recorded in the Data Plane via `ModelInvocationEvent` for billing and analytics.
- **Alert thresholds**: Configurable alerts at 50%, 75%, 90%, and 100% of budget consumption.

### Semantic Cache

To reduce cost and latency, the Model Plane implements a semantic cache:

- Requests are hashed by (model_id, prompt_hash, parameters).
- Exact matches return cached responses immediately.
- Optional semantic similarity matching (cosine similarity > threshold) for near-duplicate prompts.
- Cache TTL is configurable per task type.
- Cache is invalidated when the underlying model version changes.

### Predefined Policy Profiles

| Profile | Behavior |
|---------|----------|
| **cost-optimized** | Prefer cheapest model that meets minimum quality threshold for the task type. |
| **quality-optimized** | Prefer the highest-capability model regardless of cost, within budget. |
| **latency-optimized** | Prefer the lowest-latency provider; use hedging for p99 guarantees. |
| **balanced** | Weighted scoring across cost, quality, and latency dimensions. |
| **privacy-first** | Route all requests to on-premises models; no external provider calls. |

---

## Consequences

### Positive

- **Provider resilience**: Automatic failover ensures the system is not dependent on any single provider's availability.
- **Cost control**: Policy-based routing with budget awareness prevents runaway spend.
- **Optimal model selection**: Tasks are routed to the model best suited for them, improving quality and cost-efficiency.
- **Privacy compliance**: Routing rules structurally enforce that sensitive data stays within approved boundaries.
- **Extensibility**: New providers can be added without modifying existing code.
- **Observability**: Normalized responses with usage metrics enable comprehensive cost and performance dashboards.
- **Data-driven improvement**: Metrics collected per provider and task type allow continuous optimization of routing policies.

### Negative

- **Policy complexity**: The policy engine introduces a layer of indirection. Debugging "why was this model selected?" requires inspecting policy evaluation traces. Mitigated by policy tracing/explanation in the observability stack.
- **Cache staleness**: Semantic caching can return stale results if the world state has changed. Mitigated by configurable TTLs and cache bypass flags.
- **Routing latency**: Policy evaluation adds ~1-5ms per request. Acceptable given LLM call latencies of 100ms-30s.
- **Provider interface maintenance**: Each provider integration must be maintained as APIs evolve. Mitigated by a provider conformance test suite.

### Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Policy misconfiguration routes sensitive data to external provider | Low | Critical | Safety policies have highest precedence and are code-reviewed. Integration tests verify routing for each privacy tier. |
| Provider API changes break integration | Medium | Medium | Provider adapters are versioned. Conformance tests run on CI. Provider SDK updates are pinned and tested before rollout. |
| Cost estimation inaccuracy leads to budget overruns | Medium | Low | Estimation is conservative (overestimates by 10%). Actual costs are tracked retroactively; sessions are paused if budget is exceeded. |
| Semantic cache returns stale or incorrect results | Medium | Medium | Cache bypass flag available per request. TTL defaults are conservative. Cache is partitioned by model version. |

---

## References

- LiteLLM gateway pattern.
- Vercel AI SDK provider abstraction.
- Anthropic, OpenAI, Google Vertex AI API documentation.
- Open Policy Agent (OPA) documentation.
- Netflix Zuul / Envoy proxy routing patterns.
- [ARCHITECTURE.md](ARCHITECTURE.md) -- Model Plane section.
