/**
 * GPT Product Orchestrator
 *
 * Deterministic conversation state machine that drives each turn through:
 *   idle → composing → sending → streaming → [tool_calling] → done | error
 *
 * Responsibilities:
 *  1. Context building with priority (system → policies → retrieval → history → user → tools)
 *  2. Tool routing when the model emits tool_calls
 *  3. Streaming with timeouts, abort, and retry
 *  4. Full isolation per conversationId
 */

import crypto from "node:crypto";
import { db } from "../db";
import { eq, and } from "drizzle-orm";
import {
  gptConversationRuns,
  gptTraces,
  type ConversationState,
  type InsertGptConversationRun,
  type InsertGptTrace,
} from "@shared/schema/gptProduct";
import { type GptSessionContract } from "./gptSessionService";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("gpt-orchestrator");

// ─── State Machine ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  idle: ["composing"],
  composing: ["sending", "error"],
  sending: ["streaming", "error"],
  streaming: ["tool_calling", "done", "error", "aborted"],
  tool_calling: ["sending", "done", "error"],
  rag_retrieving: ["sending", "error"],
  done: ["idle"],
  error: ["idle"],
  aborted: ["idle"],
};

const MAX_TOOL_ROUNDS = 10;
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 30_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 60_000;
const MAX_RETRY_COUNT = 2;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorTurnInput {
  conversationId: string;
  gptId: string;
  userId?: string;
  requestId?: string;
  userMessage: string;
  history: Array<{ role: string; content: string }>;
  attachments?: Array<{ type: string; url: string; name: string }>;
  sessionContract: GptSessionContract;
  /** Override first-token timeout (ms) */
  firstTokenTimeoutMs?: number;
  /** Override stream idle timeout (ms) */
  streamIdleTimeoutMs?: number;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface ToolCallResult {
  id: string;
  name: string;
  success: boolean;
  output: unknown;
  error?: string;
  durationMs: number;
}

export interface OrchestratorTurnResult {
  runId: string;
  conversationId: string;
  state: ConversationState;
  response: string;
  toolCalls: ToolCallResult[];
  citations: Array<{
    text: string;
    source: string;
    pageNumber?: number;
    relevanceScore: number;
  }>;
  metrics: {
    contextBuildMs: number;
    retrievalMs: number;
    modelMs: number;
    toolMs: number;
    totalMs: number;
    timeToFirstTokenMs: number;
    inputTokens: number;
    outputTokens: number;
    retryCount: number;
    toolRounds: number;
  };
  error?: {
    code: string;
    message: string;
    retryable: boolean;
  };
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
  onToolCallStart: (toolCall: ToolCallRequest) => void;
  onToolCallEnd: (result: ToolCallResult) => void;
  onCitation: (citation: { text: string; source: string }) => void;
  onStateChange: (from: ConversationState, to: ConversationState) => void;
  onError: (error: { code: string; message: string }) => void;
  onDone: (result: OrchestratorTurnResult) => void;
}

// ─── Context Builder ──────────────────────────────────────────────────────────

export interface ContextMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  tool_call_id?: string;
}

export interface BuiltContext {
  messages: ContextMessage[];
  toolSpecs: Array<{
    type: "function";
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  totalTokenEstimate: number;
  buildDurationMs: number;
}

/**
 * Builds the full prompt context with strict priority ordering:
 *   1. System instructions (from GPT definition)
 *   2. Policies (rate limits, PII redaction rules, allowed domains)
 *   3. Retrieval snippets (from RAG, with citations)
 *   4. Conversation history (windowed)
 *   5. User message
 *   6. Tool specifications (only enabled tools)
 */
export function buildContext(
  input: OrchestratorTurnInput,
  retrievalSnippets: Array<{ content: string; source: string; pageNumber?: number; score: number }>,
  toolSpecs: BuiltContext["toolSpecs"]
): BuiltContext {
  const start = Date.now();
  const messages: ContextMessage[] = [];

  // 1. System instructions
  const systemParts: string[] = [];
  systemParts.push(input.sessionContract.systemPrompt);

  // 2. Policy annotations
  const policy = input.sessionContract.runtimePolicy;
  if (policy) {
    const policyLines: string[] = [];
    if (policy.maxTokensOverride) {
      policyLines.push(`Maximum response tokens: ${policy.maxTokensOverride}`);
    }
    if (policy.temperatureOverride !== undefined) {
      policyLines.push(`Temperature: ${policy.temperatureOverride}`);
    }
    if (policyLines.length > 0) {
      systemParts.push(`\n[Runtime Policies]\n${policyLines.join("\n")}`);
    }
  }

  // Capabilities annotation
  const caps = input.sessionContract.capabilities;
  const enabledCaps: string[] = [];
  if (caps.webBrowsing) enabledCaps.push("web browsing");
  if (caps.codeInterpreter) enabledCaps.push("code interpreter");
  if (caps.imageGeneration) enabledCaps.push("image generation");
  if (caps.fileUpload) enabledCaps.push("file upload");
  if (caps.dataAnalysis) enabledCaps.push("data analysis");
  if (enabledCaps.length > 0) {
    systemParts.push(`\n[Enabled Capabilities: ${enabledCaps.join(", ")}]`);
  }

  // 3. Retrieval snippets
  if (retrievalSnippets.length > 0) {
    const ragSection = retrievalSnippets
      .map((s, i) => {
        const header = s.pageNumber
          ? `[Source: ${s.source}, Page ${s.pageNumber}]`
          : `[Source: ${s.source}]`;
        return `${header}\n${s.content}`;
      })
      .join("\n\n---\n\n");
    systemParts.push(
      `\n[Knowledge Base — cite sources when using this information]\n${ragSection}`
    );
  }

  messages.push({ role: "system", content: systemParts.join("\n") });

  // 4. Conversation history (windowed)
  const maxHistoryTurns = 50;
  const recentHistory = input.history.slice(-maxHistoryTurns * 2);
  for (const msg of recentHistory) {
    const role = msg.role === "assistant" ? "assistant" : "user";
    messages.push({ role, content: msg.content });
  }

  // 5. User message
  messages.push({ role: "user", content: input.userMessage });

  // Rough token estimate: ~4 chars per token
  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const toolChars = JSON.stringify(toolSpecs).length;
  const totalTokenEstimate = Math.ceil((totalChars + toolChars) / 4);

  return {
    messages,
    toolSpecs,
    totalTokenEstimate,
    buildDurationMs: Date.now() - start,
  };
}

// ─── Conversation Run Tracker ─────────────────────────────────────────────────

export class ConversationRunTracker {
  private runId: string;
  private state: ConversationState = "idle";
  private traces: InsertGptTrace[] = [];

  constructor(
    private conversationId: string,
    private gptId: string,
    private requestId: string | null
  ) {
    this.runId = crypto.randomUUID();
  }

  get id(): string {
    return this.runId;
  }

  get currentState(): ConversationState {
    return this.state;
  }

  transition(to: ConversationState): void {
    const allowed = VALID_TRANSITIONS[this.state];
    if (!allowed || !allowed.includes(to)) {
      logger.warn(
        `Invalid state transition ${this.state} → ${to}`,
        { from: this.state, to, runId: this.runId }
      );
      throw new Error(
        `Invalid state transition: ${this.state} → ${to}`
      );
    }
    const from = this.state;
    this.state = to;
    logger.debug(
      `State transition: ${from} → ${to}`,
      { from, to, runId: this.runId, conversationId: this.conversationId }
    );
  }

  addTrace(
    traceType: string,
    stage: string,
    durationMs: number,
    extra?: Partial<InsertGptTrace>
  ): void {
    this.traces.push({
      gptId: this.gptId,
      conversationId: this.conversationId,
      requestId: this.requestId,
      traceType,
      stage,
      durationMs,
      ...extra,
    });
  }

  async persist(metrics: OrchestratorTurnResult["metrics"], errorInfo?: { code: string; message: string }): Promise<void> {
    const runData: InsertGptConversationRun = {
      id: this.runId,
      conversationId: this.conversationId,
      gptId: this.gptId,
      requestId: this.requestId,
      state: this.state,
      modelUsed: undefined,
      retrievalChunkCount: undefined,
      toolCallCount: metrics.toolRounds,
      inputTokens: metrics.inputTokens,
      outputTokens: metrics.outputTokens,
      latencyContextBuildMs: metrics.contextBuildMs,
      latencyRetrievalMs: metrics.retrievalMs,
      latencyModelMs: metrics.modelMs,
      latencyToolMs: metrics.toolMs,
      latencyTotalMs: metrics.totalMs,
      timeToFirstTokenMs: metrics.timeToFirstTokenMs,
      errorCode: errorInfo?.code ?? null,
      errorMessage: errorInfo?.message ?? null,
      retryCount: metrics.retryCount,
    };

    try {
      await db.insert(gptConversationRuns).values(runData);
      if (this.traces.length > 0) {
        await db.insert(gptTraces).values(this.traces);
      }
    } catch (err) {
      logger.error("Failed to persist conversation run", { err, runId: this.runId });
    }
  }
}

// ─── Tool Router ──────────────────────────────────────────────────────────────

export interface ToolRouter {
  /**
   * Check if a tool is allowed for this GPT session.
   */
  isAllowed(toolName: string, contract: GptSessionContract): boolean;

  /**
   * Execute a tool call within the GPT session context.
   */
  execute(
    toolCall: ToolCallRequest,
    contract: GptSessionContract,
    conversationId: string
  ): Promise<ToolCallResult>;

  /**
   * Get tool specifications for tools enabled in this GPT.
   */
  getToolSpecs(contract: GptSessionContract): BuiltContext["toolSpecs"];
}

// ─── Orchestrator Engine ──────────────────────────────────────────────────────

export interface RAGProvider {
  retrieve(
    query: string,
    gptId: string,
    knowledgeContext: string,
    options?: { maxChunks?: number; minScore?: number; mode?: "qa" | "review" }
  ): Promise<Array<{
    content: string;
    source: string;
    pageNumber?: number;
    score: number;
    chunkId: string;
  }>>;
}

export interface ModelProvider {
  streamChat(
    messages: ContextMessage[],
    options: {
      model: string;
      temperature: number;
      maxTokens: number;
      topP: number;
      tools?: BuiltContext["toolSpecs"];
      signal?: AbortSignal;
    }
  ): AsyncIterable<{
    type: "token" | "tool_call" | "usage" | "done" | "error";
    token?: string;
    toolCall?: ToolCallRequest;
    usage?: { inputTokens: number; outputTokens: number };
    error?: string;
  }>;
}

export class GptOrchestrator {
  constructor(
    private ragProvider: RAGProvider,
    private modelProvider: ModelProvider,
    private toolRouter: ToolRouter
  ) {}

  /**
   * Execute a full conversation turn with state machine progression.
   */
  async executeTurn(
    input: OrchestratorTurnInput,
    callbacks: Partial<StreamCallbacks>
  ): Promise<OrchestratorTurnResult> {
    const tracker = new ConversationRunTracker(
      input.conversationId,
      input.gptId,
      input.requestId ?? null
    );
    const contract = input.sessionContract;
    const metricsAccum = {
      contextBuildMs: 0,
      retrievalMs: 0,
      modelMs: 0,
      toolMs: 0,
      totalMs: 0,
      timeToFirstTokenMs: 0,
      inputTokens: 0,
      outputTokens: 0,
      retryCount: 0,
      toolRounds: 0,
    };
    const toolResults: ToolCallResult[] = [];
    const citations: OrchestratorTurnResult["citations"] = [];
    let fullResponse = "";
    const totalStart = Date.now();

    try {
      // ── COMPOSING ─────────────────────────────────────────────
      tracker.transition("composing");
      callbacks.onStateChange?.("idle", "composing");

      // RAG retrieval
      const retrievalStart = Date.now();
      let retrievalSnippets: Awaited<ReturnType<RAGProvider["retrieve"]>> = [];
      if (contract.knowledgeContext && contract.knowledgeContext.length > 0) {
        try {
          retrievalSnippets = await this.ragProvider.retrieve(
            input.userMessage,
            input.gptId,
            contract.knowledgeContext,
            { maxChunks: 10, minScore: 0.3 }
          );
        } catch (err) {
          logger.warn("RAG retrieval failed, continuing without knowledge", { err, gptId: input.gptId });
        }
      }
      metricsAccum.retrievalMs = Date.now() - retrievalStart;
      tracker.addTrace("retrieval", "composing", metricsAccum.retrievalMs, {
        metadata: { chunkCount: retrievalSnippets.length },
      });

      // Build context
      const toolSpecs = this.toolRouter.getToolSpecs(contract);
      const contextBuildStart = Date.now();
      const context = buildContext(input, retrievalSnippets, toolSpecs);
      metricsAccum.contextBuildMs = context.buildDurationMs;
      tracker.addTrace("context_build", "composing", metricsAccum.contextBuildMs, {
        inputSize: context.totalTokenEstimate,
      });

      // ── TURN LOOP (supports multiple tool rounds) ─────────────
      let currentMessages = [...context.messages];
      let currentToolSpecs = context.toolSpecs;
      let toolRound = 0;

      while (toolRound <= MAX_TOOL_ROUNDS) {
        // ── SENDING → STREAMING ───────────────────────────────
        tracker.transition("sending");
        callbacks.onStateChange?.(tracker.currentState, "sending");

        const model = contract.enforcedModelId || "grok-4-1-fast-non-reasoning";
        const modelStart = Date.now();
        let firstTokenReceived = false;
        const firstTokenTimeout = input.firstTokenTimeoutMs ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS;
        const streamIdleTimeout = input.streamIdleTimeoutMs ?? DEFAULT_STREAM_IDLE_TIMEOUT_MS;

        const abortController = new AbortController();
        let firstTokenTimer: ReturnType<typeof setTimeout> | undefined;
        let idleTimer: ReturnType<typeof setTimeout> | undefined;

        const clearTimers = () => {
          if (firstTokenTimer) clearTimeout(firstTokenTimer);
          if (idleTimer) clearTimeout(idleTimer);
        };

        // Set up first-token timeout
        firstTokenTimer = setTimeout(() => {
          if (!firstTokenReceived) {
            abortController.abort();
            logger.warn(
              "First token timeout exceeded",
              { runId: tracker.id, timeout: firstTokenTimeout }
            );
          }
        }, firstTokenTimeout);

        tracker.transition("streaming");
        callbacks.onStateChange?.("sending", "streaming");

        const pendingToolCalls: ToolCallRequest[] = [];
        let streamError: string | undefined;

        try {
          const stream = this.modelProvider.streamChat(currentMessages, {
            model,
            temperature: contract.temperature,
            maxTokens: contract.maxTokens,
            topP: contract.topP,
            tools: currentToolSpecs.length > 0 ? currentToolSpecs : undefined,
            signal: abortController.signal,
          });

          for await (const event of stream) {
            // Reset idle timer on each event
            if (idleTimer) clearTimeout(idleTimer);
            idleTimer = setTimeout(() => {
              abortController.abort();
              logger.warn("Stream idle timeout", { runId: tracker.id });
            }, streamIdleTimeout);

            switch (event.type) {
              case "token":
                if (!firstTokenReceived) {
                  firstTokenReceived = true;
                  metricsAccum.timeToFirstTokenMs = Date.now() - modelStart;
                  clearTimeout(firstTokenTimer);
                }
                fullResponse += event.token ?? "";
                callbacks.onToken?.(event.token ?? "");
                break;

              case "tool_call":
                if (event.toolCall) {
                  pendingToolCalls.push(event.toolCall);
                  callbacks.onToolCallStart?.(event.toolCall);
                }
                break;

              case "usage":
                if (event.usage) {
                  metricsAccum.inputTokens += event.usage.inputTokens;
                  metricsAccum.outputTokens += event.usage.outputTokens;
                }
                break;

              case "error":
                streamError = event.error;
                break;

              case "done":
                break;
            }
          }
        } catch (err: any) {
          if (err?.name === "AbortError" || abortController.signal.aborted) {
            streamError = "Stream aborted (timeout)";
          } else {
            streamError = err?.message ?? "Unknown stream error";
          }
        } finally {
          clearTimers();
        }

        metricsAccum.modelMs += Date.now() - modelStart;
        tracker.addTrace("model_call", "streaming", Date.now() - modelStart, {
          metadata: { model, toolCallCount: pendingToolCalls.length },
        });

        if (streamError && pendingToolCalls.length === 0) {
          // Retry logic
          if (metricsAccum.retryCount < MAX_RETRY_COUNT) {
            metricsAccum.retryCount++;
            logger.warn(
              "Retrying after stream error",
              { runId: tracker.id, retry: metricsAccum.retryCount, error: streamError }
            );
            tracker.transition("error");
            tracker.transition("idle");
            tracker.transition("composing");
            // Wait with exponential backoff
            await new Promise((r) =>
              setTimeout(r, 1000 * Math.pow(2, metricsAccum.retryCount - 1))
            );
            continue;
          }
          // Fatal error
          tracker.transition("error");
          callbacks.onStateChange?.("streaming", "error");
          callbacks.onError?.({ code: "STREAM_ERROR", message: streamError });

          metricsAccum.totalMs = Date.now() - totalStart;
          const result: OrchestratorTurnResult = {
            runId: tracker.id,
            conversationId: input.conversationId,
            state: "error",
            response: fullResponse,
            toolCalls: toolResults,
            citations,
            metrics: metricsAccum,
            error: { code: "STREAM_ERROR", message: streamError, retryable: false },
          };
          await tracker.persist(metricsAccum, { code: "STREAM_ERROR", message: streamError });
          callbacks.onDone?.(result);
          return result;
        }

        // ── TOOL CALLING ────────────────────────────────────────
        if (pendingToolCalls.length > 0) {
          tracker.transition("tool_calling");
          callbacks.onStateChange?.("streaming", "tool_calling");
          metricsAccum.toolRounds++;
          toolRound++;

          const toolStart = Date.now();
          for (const tc of pendingToolCalls) {
            // Check permission
            if (!this.toolRouter.isAllowed(tc.name, contract)) {
              const denied: ToolCallResult = {
                id: tc.id,
                name: tc.name,
                success: false,
                output: null,
                error: `Tool "${tc.name}" is not allowed for this GPT`,
                durationMs: 0,
              };
              toolResults.push(denied);
              callbacks.onToolCallEnd?.(denied);
              currentMessages.push({
                role: "tool",
                content: JSON.stringify({ error: denied.error }),
                tool_call_id: tc.id,
              });
              continue;
            }

            const result = await this.toolRouter.execute(tc, contract, input.conversationId);
            toolResults.push(result);
            callbacks.onToolCallEnd?.(result);

            currentMessages.push({
              role: "tool",
              content: JSON.stringify(result.success ? result.output : { error: result.error }),
              tool_call_id: tc.id,
            });

            tracker.addTrace("tool_call", "tool_calling", result.durationMs, {
              metadata: { toolName: tc.name, success: result.success ? "true" : "false" },
            });
          }
          metricsAccum.toolMs += Date.now() - toolStart;

          // Loop back to send tool results to model
          tracker.transition("sending");
          fullResponse = ""; // Reset - model will generate a fresh response with tool results
          continue;
        }

        // ── No tool calls, we're done ───────────────────────────
        break;
      }

      // ── Extract citations from retrieval snippets ───────────────
      for (const snippet of retrievalSnippets) {
        // Simple citation matching: check if response references content from this snippet
        const snippetWords = snippet.content.split(/\s+/).slice(0, 8).join(" ");
        if (
          fullResponse.toLowerCase().includes(snippetWords.toLowerCase().slice(0, 30)) ||
          snippet.score > 0.7
        ) {
          citations.push({
            text: snippet.content.slice(0, 200),
            source: snippet.source,
            pageNumber: snippet.pageNumber,
            relevanceScore: snippet.score,
          });
          callbacks.onCitation?.({ text: snippet.content.slice(0, 200), source: snippet.source });
        }
      }

      // ── DONE ──────────────────────────────────────────────────
      tracker.transition("done");
      callbacks.onStateChange?.("streaming", "done");

      metricsAccum.totalMs = Date.now() - totalStart;
      const result: OrchestratorTurnResult = {
        runId: tracker.id,
        conversationId: input.conversationId,
        state: "done",
        response: fullResponse,
        toolCalls: toolResults,
        citations,
        metrics: metricsAccum,
      };

      await tracker.persist(metricsAccum);
      callbacks.onDone?.(result);
      return result;

    } catch (err: any) {
      metricsAccum.totalMs = Date.now() - totalStart;
      const errorInfo = {
        code: "ORCHESTRATOR_ERROR",
        message: err?.message ?? "Unknown orchestrator error",
      };

      try {
        if (tracker.currentState !== "error") {
          tracker.transition("error");
        }
      } catch {
        // State transition might fail if already in error — ignore
      }

      callbacks.onError?.(errorInfo);
      const result: OrchestratorTurnResult = {
        runId: tracker.id,
        conversationId: input.conversationId,
        state: "error",
        response: fullResponse,
        toolCalls: toolResults,
        citations,
        metrics: metricsAccum,
        error: { ...errorInfo, retryable: true },
      };
      await tracker.persist(metricsAccum, errorInfo);
      callbacks.onDone?.(result);
      return result;
    }
  }
}
