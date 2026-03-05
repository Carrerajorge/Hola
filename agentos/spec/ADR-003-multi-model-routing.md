# ADR-003: Multi-Model Routing with Policy-Based Selection

## Status
Accepted

## Context
No single model excels at all tasks. Cost, latency, capability, and quality requirements vary per step in a mission. Hard-coding model selection limits flexibility and cost efficiency.

## Decision
Implement a policy-based model router that:
- Selects models based on task type, required capabilities, budget, and latency needs
- Supports multiple providers (Anthropic, OpenAI, Google, xAI, local models)
- Provides canary/A-B testing for model evaluation
- Includes automatic fallback chains when primary providers fail
- Tracks cost and quality metrics per provider for data-driven routing

Predefined policies: cost-optimized, quality-optimized, latency-optimized, balanced.

## Consequences
- **Positive**: Cost optimization (use cheaper models for simple tasks)
- **Positive**: Resilience through fallback chains
- **Positive**: Data-driven model selection improvement over time
- **Negative**: Routing adds latency overhead (mitigated by caching)
- **Negative**: Provider interface maintenance burden

## References
- LiteLLM gateway pattern
- Vercel AI SDK provider abstraction
