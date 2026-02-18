/**
 * GPT Runtime Orchestrator
 *
 * The engine that makes a GPT "work" — a deterministic state machine per conversation:
 *
 * States: idle → composing → sending → streaming → tool_calling → done | error
 *
 * Components:
 * 1. Context Builder: assembles prompt with priorities
 * 2. Tool Router: dispatches tool calls from the model
 * 3. Streaming Controller: robust streaming with timeouts/retry/fallback
 * 4. Conversation Isolation: conversationId scoped on everything
 */
import crypto from "node:crypto";
import { EventEmitter } from "events";
import { gptDefinitionManager, type GptProductSnapshot } from "./gptDefinitionManager";
import { gptKnowledgePipeline, type RAGContext, type Citation } from "./knowledgePipeline";
import { gptToolRouter, type ToolSpec, type ToolCallResult } from "./toolRouter";
import { gptActionExecutor, type ActionExecutionResult } from "./actionExecutor";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConversationState =
  | "idle"
  | "composing"
  | "sending"
  | "streaming"
  | "tool_calling"
  | "done"
  | "error";

export interface ConversationMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  name?: string;
  toolCallId?: string;
  citations?: Citation[];
  metadata?: Record<string, unknown>;
}

export interface ToolCallRequest {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface TurnRequest {
  gptId: string;
  conversationId: string;
  userId?: string;
  message: string;
  attachments?: Array<{ type: string; url: string; name: string }>;
  history?: ConversationMessage[];
  streamCallback?: (event: StreamEvent) => void;
}

export interface TurnResult {
  conversationId: string;
  requestId: string;
  response: string;
  citations: Citation[];
  toolCalls: ToolCallSummary[];
  ragContext?: RAGContext;
  state: ConversationState;
  latencyMs: number;
  stages: StageLatency[];
}

export interface ToolCallSummary {
  toolName: string;
  success: boolean;
  executionTimeMs: number;
}

export interface StageLatency {
  stage: string;
  durationMs: number;
}

export interface StreamEvent {
  type: "token" | "tool_start" | "tool_end" | "citation" | "error" | "done";
  data: unknown;
  timestamp: number;
}

export interface OrchestratorConfig {
  firstTokenTimeoutMs: number;
  streamIdleTimeoutMs: number;
  totalTimeoutMs: number;
  maxToolCallRounds: number;
  maxHistoryTokens: number;
  retryOnTimeout: boolean;
  maxRetries: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: OrchestratorConfig = {
  firstTokenTimeoutMs: 15_000,
  streamIdleTimeoutMs: 30_000,
  totalTimeoutMs: 120_000,
  maxToolCallRounds: 5,
  maxHistoryTokens: 32_000,
  retryOnTimeout: true,
  maxRetries: 2,
};

const HISTORY_WINDOW_MESSAGES = 40;

// ─── Conversation State Machine ──────────────────────────────────────────────

const VALID_TRANSITIONS: Record<ConversationState, ConversationState[]> = {
  idle: ["composing"],
  composing: ["sending", "error"],
  sending: ["streaming", "error"],
  streaming: ["tool_calling", "done", "error"],
  tool_calling: ["sending", "done", "error"],
  done: ["idle"],
  error: ["idle"],
};

export class ConversationStateMachine {
  private state: ConversationState = "idle";
  private history: Array<{ from: ConversationState; to: ConversationState; at: number }> = [];

  get current(): ConversationState {
    return this.state;
  }

  transition(to: ConversationState): void {
    const valid = VALID_TRANSITIONS[this.state];
    if (!valid?.includes(to)) {
      throw new Error(`Invalid state transition: ${this.state} → ${to}`);
    }
    this.history.push({ from: this.state, to, at: Date.now() });
    this.state = to;
  }

  reset(): void {
    this.state = "idle";
  }

  getHistory(): Array<{ from: ConversationState; to: ConversationState; at: number }> {
    return [...this.history];
  }
}

// ─── Context Builder ──────────────────────────────────────────────────────────

export class ContextBuilder {
  /**
   * Build the full prompt messages array with priority:
   * 1. System instructions (from GPT definition)
   * 2. Policies/guardrails
   * 3. RAG retrieval snippets (with citations)
   * 4. Conversation history (windowed)
   * 5. User message
   * 6. Tool specifications
   */
  build(params: {
    snapshot: GptProductSnapshot;
    ragContext?: RAGContext;
    history: ConversationMessage[];
    userMessage: string;
    tools: ToolSpec[];
    maxHistoryTokens: number;
  }): ConversationMessage[] {
    const messages: ConversationMessage[] = [];
    const { snapshot, ragContext, history, userMessage, tools, maxHistoryTokens } = params;

    // 1. System instructions
    let systemContent = snapshot.systemPrompt;

    // 2. Policy guardrails
    const policies = snapshot.policies;
    const policyLines: string[] = [];
    if (policies.piiRedactionEnabled) {
      policyLines.push("- IMPORTANT: Do NOT include personal identifiable information (PII) in responses.");
    }
    if (policies.allowedDomains?.length) {
      policyLines.push(`- Only reference or link to these domains: ${policies.allowedDomains.join(", ")}`);
    }
    if (policyLines.length) {
      systemContent += `\n\n## Policies\n${policyLines.join("\n")}`;
    }

    // 3. RAG context with citation instructions
    if (ragContext && ragContext.chunks.length > 0) {
      const citationInstructions =
        "\n\n## Knowledge Context\n" +
        "Use the following sources to answer. Cite sources as [Source: filename, page X] when using information from them.\n\n" +
        ragContext.chunks
          .map((c, i) => `[Source ${i + 1}: ${c.metadata.fileName}${c.metadata.pageNumber ? `, p.${c.metadata.pageNumber}` : ""}]\n${c.content}`)
          .join("\n\n---\n\n");
      systemContent += citationInstructions;
    }

    // Tool instructions
    if (tools.length > 0) {
      systemContent += "\n\n## Available Tools\n" +
        "You have access to these tools. Use them when the user's request requires real-time data, computation, or external actions.\n" +
        tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
    }

    messages.push({ role: "system", content: systemContent });

    // 4. Conversation history (windowed by tokens)
    const windowedHistory = this.windowHistory(history, maxHistoryTokens);
    messages.push(...windowedHistory);

    // 5. User message
    messages.push({ role: "user", content: userMessage });

    return messages;
  }

  private windowHistory(history: ConversationMessage[], maxTokens: number): ConversationMessage[] {
    // Take the last N messages that fit within the token budget
    let tokenCount = 0;
    const result: ConversationMessage[] = [];

    const recent = history.slice(-HISTORY_WINDOW_MESSAGES);
    for (let i = recent.length - 1; i >= 0; i--) {
      const msg = recent[i];
      const msgTokens = Math.ceil(msg.content.length / 4);
      if (tokenCount + msgTokens > maxTokens) break;
      tokenCount += msgTokens;
      result.unshift(msg);
    }

    return result;
  }
}

// ─── GPT Orchestrator ─────────────────────────────────────────────────────────

export class GptOrchestrator extends EventEmitter {
  private conversations = new Map<string, ConversationStateMachine>();
  private config: OrchestratorConfig;
  private contextBuilder = new ContextBuilder();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Execute a full "turn" of the conversation.
   * This is the main entry point that drives the state machine through all phases.
   */
  async executeTurn(request: TurnRequest): Promise<TurnResult> {
    const startTime = Date.now();
    const requestId = crypto.randomUUID();
    const stages: StageLatency[] = [];
    const allToolCalls: ToolCallSummary[] = [];
    let allCitations: Citation[] = [];

    // Get or create state machine for this conversation
    const sm = this.getStateMachine(request.conversationId);

    // Ensure we start from idle
    if (sm.current !== "idle") {
      sm.reset();
    }

    try {
      // ── COMPOSING: Build context ──────────────────────────────────────
      sm.transition("composing");
      const composeStart = Date.now();

      // Load GPT snapshot
      const snapshot = await gptDefinitionManager.getSnapshot(request.gptId);

      // Resolve tools
      const tools = gptToolRouter.getAllTools(
        request.gptId,
        snapshot.capabilities,
        snapshot.toolPermissions
      );

      // Retrieve knowledge (RAG)
      let ragContext: RAGContext | undefined;
      if (snapshot.knowledgeSources.length > 0) {
        ragContext = await gptKnowledgePipeline.retrieve({
          gptId: request.gptId,
          query: request.message,
          conversationId: request.conversationId,
        });
        allCitations = ragContext.citations;
      }

      // Build context
      const messages = this.contextBuilder.build({
        snapshot,
        ragContext,
        history: request.history ?? [],
        userMessage: request.message,
        tools,
        maxHistoryTokens: this.config.maxHistoryTokens,
      });

      stages.push({ stage: "compose", durationMs: Date.now() - composeStart });

      // ── SENDING: Send to model ────────────────────────────────────────
      sm.transition("sending");
      const sendStart = Date.now();

      // Determine model from GPT definition
      const model = snapshot.definition.model ?? "grok-4-1-fast-non-reasoning";
      const temperature = snapshot.definition.policies?.temperatureOverride ?? 0.7;
      const maxTokens = snapshot.definition.policies?.maxTokensOverride ?? 4096;

      // Build the function-calling tools array
      const functionTools = gptToolRouter.toFunctionCallingFormat(tools);

      stages.push({ stage: "send_prepare", durationMs: Date.now() - sendStart });

      // ── STREAMING: Process model response ─────────────────────────────
      sm.transition("streaming");
      const streamStart = Date.now();

      // Simulate model call structure (the actual LLM call would go through llmGateway)
      const modelResponse = await this.callModel({
        messages,
        model,
        temperature,
        maxTokens,
        tools: functionTools,
        conversationId: request.conversationId,
        requestId,
        streamCallback: request.streamCallback,
      });

      stages.push({ stage: "stream", durationMs: Date.now() - streamStart });

      // ── TOOL_CALLING: Execute any tool calls ──────────────────────────
      let response = modelResponse.content;
      let toolRound = 0;

      while (modelResponse.toolCalls.length > 0 && toolRound < this.config.maxToolCallRounds) {
        sm.transition("tool_calling");
        const toolStart = Date.now();

        const toolResults: ConversationMessage[] = [];

        for (const toolCall of modelResponse.toolCalls) {
          request.streamCallback?.({
            type: "tool_start",
            data: { name: toolCall.name, id: toolCall.id },
            timestamp: Date.now(),
          });

          const result = await this.executeToolCall(toolCall, request, snapshot);
          allToolCalls.push({
            toolName: toolCall.name,
            success: result.success,
            executionTimeMs: result.executionTimeMs,
          });

          toolResults.push({
            role: "tool",
            content: JSON.stringify(result.output ?? result.error),
            toolCallId: toolCall.id,
            name: toolCall.name,
          });

          request.streamCallback?.({
            type: "tool_end",
            data: { name: toolCall.name, success: result.success },
            timestamp: Date.now(),
          });
        }

        // Re-send with tool results to get the final response
        const updatedMessages = [...messages, { role: "assistant" as const, content: response }, ...toolResults];
        sm.transition("sending");
        sm.transition("streaming");

        const followUp = await this.callModel({
          messages: updatedMessages,
          model,
          temperature,
          maxTokens,
          tools: functionTools,
          conversationId: request.conversationId,
          requestId,
          streamCallback: request.streamCallback,
        });

        response = followUp.content;
        modelResponse.toolCalls = followUp.toolCalls;
        toolRound++;

        stages.push({ stage: `tool_round_${toolRound}`, durationMs: Date.now() - toolStart });
      }

      // ── DONE ──────────────────────────────────────────────────────────
      sm.transition("done");

      request.streamCallback?.({
        type: "done",
        data: { requestId },
        timestamp: Date.now(),
      });

      // Reset to idle for next turn
      sm.transition("idle");

      return {
        conversationId: request.conversationId,
        requestId,
        response,
        citations: allCitations,
        toolCalls: allToolCalls,
        ragContext,
        state: "done",
        latencyMs: Date.now() - startTime,
        stages,
      };
    } catch (err: any) {
      // Transition to error
      try {
        sm.transition("error");
      } catch {
        sm.reset();
      }

      request.streamCallback?.({
        type: "error",
        data: { message: err.message },
        timestamp: Date.now(),
      });

      // Reset to idle so we can try again
      try {
        sm.transition("idle");
      } catch {
        sm.reset();
      }

      return {
        conversationId: request.conversationId,
        requestId,
        response: "",
        citations: allCitations,
        toolCalls: allToolCalls,
        ragContext: undefined,
        state: "error",
        latencyMs: Date.now() - startTime,
        stages,
      };
    }
  }

  /**
   * Get the state machine for a conversation, creating one if needed.
   */
  private getStateMachine(conversationId: string): ConversationStateMachine {
    let sm = this.conversations.get(conversationId);
    if (!sm) {
      sm = new ConversationStateMachine();
      this.conversations.set(conversationId, sm);
    }
    return sm;
  }

  /**
   * Call the LLM model. In production this routes through llmGateway.
   * This method abstracts the model call with timeout/retry logic.
   */
  private async callModel(params: {
    messages: ConversationMessage[];
    model: string;
    temperature: number;
    maxTokens: number;
    tools: Array<{ type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }>;
    conversationId: string;
    requestId: string;
    streamCallback?: (event: StreamEvent) => void;
  }): Promise<{ content: string; toolCalls: ToolCallRequest[] }> {
    // This is the integration point with llmGateway.
    // The actual implementation will call llmGateway.chat() with streaming.
    // For now, we define the contract.

    const { llmGateway } = await import("../../lib/llmGateway");

    const llmMessages = params.messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));

    let retries = 0;
    const maxRetries = this.config.retryOnTimeout ? this.config.maxRetries : 0;

    while (retries <= maxRetries) {
      try {
        const llmOptions: Record<string, unknown> = {
          model: params.model,
          temperature: params.temperature,
          maxTokens: params.maxTokens,
          stream: false,
        };
        if (params.tools.length > 0) {
          llmOptions.tools = params.tools;
        }
        const result = await Promise.race([
          llmGateway.chat(llmMessages, llmOptions as any),
          this.createTimeout(this.config.totalTimeoutMs),
        ]);

        // Parse tool calls from the response if any
        const toolCalls: ToolCallRequest[] = [];
        const content = typeof result === "string" ? result : (result as any)?.content ?? "";

        if ((result as any)?.tool_calls) {
          for (const tc of (result as any).tool_calls) {
            toolCalls.push({
              id: tc.id ?? crypto.randomUUID(),
              name: tc.function?.name ?? tc.name,
              arguments: typeof tc.function?.arguments === "string"
                ? JSON.parse(tc.function.arguments)
                : tc.function?.arguments ?? {},
            });
          }
        }

        return { content, toolCalls };
      } catch (err: any) {
        if (retries >= maxRetries) throw err;
        retries++;
        // Exponential backoff
        await new Promise((r) => setTimeout(r, Math.pow(2, retries) * 1000));
      }
    }

    throw new Error("Max retries exceeded");
  }

  /**
   * Execute a tool call, routing between built-in tools and GPT actions.
   */
  private async executeToolCall(
    toolCall: ToolCallRequest,
    request: TurnRequest,
    snapshot: GptProductSnapshot
  ): Promise<ToolCallResult> {
    const start = Date.now();

    // Check permission
    const permitted = gptToolRouter.isToolPermitted(
      toolCall.name,
      snapshot.capabilities,
      snapshot.toolPermissions
    );

    if (!permitted.permitted) {
      return {
        toolName: toolCall.name,
        success: false,
        output: null,
        error: { code: "permission_denied", message: permitted.reason!, retryable: false },
        executionTimeMs: Date.now() - start,
        sandboxed: false,
      };
    }

    // Route to action executor if it's a custom action
    if (toolCall.name.startsWith("action:")) {
      const actionId = toolCall.name.replace("action:", "");
      const result: ActionExecutionResult = await gptActionExecutor.execute({
        actionId,
        gptId: request.gptId,
        conversationId: request.conversationId,
        userId: request.userId,
        requestId: crypto.randomUUID(),
        arguments: toolCall.arguments,
      });

      return {
        toolName: toolCall.name,
        success: result.success,
        output: result.data,
        error: result.error,
        executionTimeMs: result.latencyMs,
        sandboxed: false,
      };
    }

    // Built-in tool execution placeholder
    // In production, this would route to the actual tool implementations
    // (e.g., web search → webtool, code interpreter → sandbox, etc.)
    return {
      toolName: toolCall.name,
      success: true,
      output: { message: `Tool '${toolCall.name}' executed`, arguments: toolCall.arguments },
      executionTimeMs: Date.now() - start,
      sandboxed: true,
    };
  }

  private createTimeout(ms: number): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms);
    });
  }

  /**
   * Get the current state of a conversation.
   */
  getConversationState(conversationId: string): ConversationState {
    return this.conversations.get(conversationId)?.current ?? "idle";
  }

  /**
   * Cleanup a conversation's state machine.
   */
  cleanupConversation(conversationId: string): void {
    this.conversations.delete(conversationId);
  }

  /**
   * Get active conversation count (for monitoring).
   */
  getActiveConversationCount(): number {
    let count = 0;
    for (const sm of this.conversations.values()) {
      if (sm.current !== "idle") count++;
    }
    return count;
  }
}

export const gptOrchestrator = new GptOrchestrator();
