/**
 * AgentOS-ASI — Agent Operating System + Aspirational Super-Intelligence
 *
 * A distributed agent operating system with six planes:
 *   control-plane  → Neuro-symbolic "Cerebro" (planner→executor→critic→judge)
 *   model-plane    → Multi-model router with provider abstraction layer
 *   data-plane     → Event-sourced, CQRS, durable execution engine
 *   knowledge-plane→ RAG++ with evidence packs and provenance
 *   action-plane   → Web automation (Playwright), MCP, telephony
 *   ui-plane       → Agentic console with streaming DAG visualization
 *
 * Plus cross-cutting concerns:
 *   memory         → Working, episodic, persistent with privacy/retention
 *   security       → Zero-trust identity, OPA policies, prompt-injection defense
 *   observability  → OpenTelemetry traces, metrics, eval framework
 *   sdk            → Plugin system (WASM, gRPC, MCP, OpenAPI)
 *
 * @module agentos
 */

// ── Control Plane ──────────────────────────────────────────────────────
export { Orchestrator } from './control-plane/orchestrator.js';
export { HierarchicalPlanner } from './control-plane/planner/hierarchical-planner.js';
export { TaskExecutor } from './control-plane/executor/task-executor.js';
export { CriticVerifier } from './control-plane/critic/critic-verifier.js';
export { Judge } from './control-plane/judge/judge.js';
export { BudgetManager } from './control-plane/budgeting/budget-manager.js';
export { SoulPolicies } from './control-plane/soul/soul-policies.js';

// ── Model Plane ────────────────────────────────────────────────────────
export { ModelRouter } from './model-plane/router/model-router.js';
export { ProviderRegistry } from './model-plane/providers/provider-registry.js';
export { ApiGateway } from './model-plane/gateway/api-gateway.js';

// ── Data Plane ─────────────────────────────────────────────────────────
export { EventStore } from './data-plane/events/event-store.js';
export { CommandBus } from './data-plane/cqrs/command-bus.js';
export { QueryBus } from './data-plane/cqrs/query-bus.js';
export { WorkflowEngine } from './data-plane/workflows/workflow-engine.js';
export { StreamManager } from './data-plane/streaming/stream-manager.js';
export { HybridStore } from './data-plane/storage/hybrid-store.js';

// ── Knowledge Plane ────────────────────────────────────────────────────
export { RAGPipeline } from './knowledge-plane/rag/rag-pipeline.js';
export { DocumentProcessor } from './knowledge-plane/etl/document-processor.js';
export { CrossEncoderReranker } from './knowledge-plane/reranker/cross-encoder-reranker.js';
export { GraphStore } from './knowledge-plane/knowledge-graph/graph-store.js';
export { EvidenceAssembler } from './knowledge-plane/evidence/evidence-assembler.js';

// ── Action Plane ───────────────────────────────────────────────────────
export { BrowserController } from './action-plane/web/browser-controller.js';
export { MCPClient } from './action-plane/mcp/mcp-client.js';
export { TelephonyController } from './action-plane/telephony/telephony-controller.js';
export { CapabilityDiscovery } from './action-plane/capabilities/capability-discovery.js';

// ── Memory ─────────────────────────────────────────────────────────────
export { WorkingMemory } from './memory/working/working-memory.js';
export { EpisodicMemory } from './memory/episodic/episodic-memory.js';
export { PersistentMemory } from './memory/persistent/persistent-memory.js';

// ── UI Plane ───────────────────────────────────────────────────────────
export { EventStreamClient } from './ui-plane/streaming/event-stream.js';

// ── SDK ────────────────────────────────────────────────────────────────
export { AgentSDK } from './sdk/core/agent-sdk.js';
export { PluginSystem } from './sdk/plugins/plugin-system.js';
export { WasmRuntime } from './sdk/wasm/wasm-runtime.js';
export { GrpcBridge } from './sdk/grpc/grpc-bridge.js';

// ── Security ───────────────────────────────────────────────────────────
export { PolicyEngine } from './security/policies/opa-policies.js';
export { InputSanitizer } from './security/scanning/input-sanitizer.js';
export { IdentityManager } from './security/identity/identity-manager.js';
export { ActionGuard } from './security/policies/action-guard.js';

// ── Observability ──────────────────────────────────────────────────────
export { MetricsCollector } from './observability/metrics/metrics-collector.js';
export { TraceManager } from './observability/traces/trace-manager.js';
export { EvalFramework } from './observability/evals/eval-framework.js';

// ── Factory: quick-start ───────────────────────────────────────────────

import type { AgentOSConfig } from './config.js';

/**
 * Bootstrap a fully-wired AgentOS instance with sane defaults.
 *
 * @example
 * ```ts
 * import { createAgentOS } from './agentos';
 * const os = await createAgentOS({ name: 'my-agent' });
 * const result = await os.runMission('Book a flight to Tokyo');
 * ```
 */
export async function createAgentOS(config: Partial<AgentOSConfig> = {}) {
  const { AgentSDK } = await import('./sdk/core/agent-sdk.js');
  const sdk = new AgentSDK(config);
  await sdk.initialize();
  return sdk;
}

export default createAgentOS;
