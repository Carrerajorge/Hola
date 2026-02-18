/**
 * GPT Product Framework - Main Entry Point
 *
 * A GPT is NOT "a prompt". It is a product composed of:
 *
 * 1. GPT Definition (versioned, immutable config)
 *    → gptDefinitionManager
 *
 * 2. Knowledge / RAG (first-class citizen)
 *    → gptKnowledgePipeline
 *
 * 3. Tools / Capabilities (permission matrix)
 *    → gptToolRouter
 *
 * 4. Actions (OpenAPI contracts + auth)
 *    → gptActionExecutor
 *
 * 5. Runtime Orchestrator (state machine + streaming + tool routing)
 *    → gptOrchestrator
 *
 * 6. Governance & Observability (permissions, traces, evaluations, metrics)
 *    → gptGovernance
 *
 * Usage:
 *
 *   import { gptProductFramework } from "./gpt-product";
 *
 *   // Create a GPT
 *   const snapshot = await gptProductFramework.definitions.create({ ... });
 *
 *   // Ingest knowledge
 *   await gptProductFramework.knowledge.ingest({ gptId, fileName, ... });
 *
 *   // Execute a conversation turn
 *   const result = await gptProductFramework.orchestrator.executeTurn({ gptId, conversationId, message });
 *
 *   // Get quality metrics
 *   const metrics = gptProductFramework.governance.computeMetrics(gptId);
 */

// ─── Core modules ────────────────────────────────────────────────────────────

export { GptDefinitionManager, gptDefinitionManager } from "./gptDefinitionManager";
export type {
  GptDefinition,
  GptProductSnapshot,
  VersionDiff,
  CreateGptProductInput,
  UpdateGptProductInput,
} from "./gptDefinitionManager";

export { GptKnowledgePipeline, gptKnowledgePipeline } from "./knowledgePipeline";
export type {
  KnowledgeChunk,
  RetrievedChunk,
  Citation,
  RAGContext,
  PreflightResult,
  RetrievalStrategy,
  RetrievalRequest,
  IngestionRequest,
} from "./knowledgePipeline";

export { GptToolRouter, gptToolRouter } from "./toolRouter";
export type {
  GptCapabilities,
  GptToolPermissions,
  ToolSpec,
  ToolCategory,
  ToolCallResult,
  ResolvedToolSet,
} from "./toolRouter";

export { GptActionExecutor, gptActionExecutor } from "./actionExecutor";
export type {
  ActionSchema,
  ActionParameter,
  ActionExecutionInput,
  ActionExecutionResult,
  OpenAPIValidationResult,
  ActionAuditEntry,
} from "./actionExecutor";

export {
  GptOrchestrator,
  gptOrchestrator,
  ConversationStateMachine,
  ContextBuilder,
} from "./orchestrator";
export type {
  ConversationState,
  ConversationMessage,
  TurnRequest,
  TurnResult,
  ToolCallSummary,
  StageLatency,
  StreamEvent,
  OrchestratorConfig,
} from "./orchestrator";

export { GptGovernance, gptGovernance } from "./governance";
export type {
  WorkspacePermissions,
  PublicationStatus,
  TraceEntry,
  GoldenConversation,
  GoldenTurn,
  EvaluationResult,
  TurnEvaluation,
  QualityMetrics,
  RegressionTestResult,
} from "./governance";

// ─── Unified facade ──────────────────────────────────────────────────────────

import { gptDefinitionManager } from "./gptDefinitionManager";
import { gptKnowledgePipeline } from "./knowledgePipeline";
import { gptToolRouter } from "./toolRouter";
import { gptActionExecutor } from "./actionExecutor";
import { gptOrchestrator } from "./orchestrator";
import { gptGovernance } from "./governance";

/**
 * Unified access point for the entire GPT Product Framework.
 *
 * A GPT is a **system** with:
 * - Versioned configuration (definitions)
 * - Reliable RAG (knowledge)
 * - Contract-based tools (toolRouter + actionExecutor)
 * - Orchestration with timeouts/fallbacks/isolation (orchestrator)
 * - Observability to detect and correct failures (governance)
 */
export const gptProductFramework = {
  /** GPT Definition CRUD + versioning + rollback */
  definitions: gptDefinitionManager,

  /** Knowledge ingestion + dual-strategy retrieval + citations */
  knowledge: gptKnowledgePipeline,

  /** Tool capability resolution + permission enforcement */
  tools: gptToolRouter,

  /** Action execution with OpenAPI validation + auth + rate limits + PII redaction */
  actions: gptActionExecutor,

  /** Turn engine: state machine + context builder + streaming + tool routing */
  orchestrator: gptOrchestrator,

  /** Permissions + publication + traces + metrics + golden evals + regression tests */
  governance: gptGovernance,
} as const;
