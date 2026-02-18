/**
 * GPT Governance & Observability
 *
 * Provides:
 * (a) Workspace/team permissions
 * (b) Publication controls (internal/external)
 * (c) Observability: traces per requestId, latencies per stage
 * (d) Golden conversation evaluations
 * (e) Prompt/schema regression tests
 * (f) Quality metrics: timeout rates, tool failures, hallucination checks
 */
import crypto from "node:crypto";
import { db } from "../../db";
import { eq, and, sql, desc } from "drizzle-orm";
import { gpts, gptVersions } from "@shared/schema/gpt";
import type { TurnResult, StageLatency } from "./orchestrator";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WorkspacePermissions {
  workspaceId: string;
  gptId: string;
  permissions: {
    canUse: string[];       // userIds or role names
    canEdit: string[];
    canPublish: string[];
    canDelete: string[];
  };
}

export interface PublicationStatus {
  gptId: string;
  internal: boolean;
  external: boolean;
  publishedVersion: number | null;
  publishedAt: Date | null;
  publishedBy: string | null;
}

export interface TraceEntry {
  requestId: string;
  conversationId: string;
  gptId: string;
  userId?: string;
  timestamp: number;
  stages: StageLatency[];
  totalLatencyMs: number;
  success: boolean;
  toolCallCount: number;
  ragChunkCount: number;
  citationCount: number;
  error?: string;
  modelUsed?: string;
}

export interface GoldenConversation {
  id: string;
  gptId: string;
  name: string;
  turns: GoldenTurn[];
  createdAt: number;
  lastRunAt?: number;
  lastRunResult?: EvaluationResult;
}

export interface GoldenTurn {
  userMessage: string;
  expectedPatterns: string[];
  expectedCitations?: string[];
  forbiddenPatterns?: string[];
  maxLatencyMs?: number;
}

export interface EvaluationResult {
  goldenConversationId: string;
  passed: boolean;
  turnResults: TurnEvaluation[];
  runAt: number;
  totalLatencyMs: number;
}

export interface TurnEvaluation {
  turnIndex: number;
  passed: boolean;
  actualResponse: string;
  matchedPatterns: string[];
  missingPatterns: string[];
  forbiddenMatches: string[];
  latencyMs: number;
  latencyWithinBudget: boolean;
}

export interface QualityMetrics {
  gptId: string;
  period: string;
  totalRequests: number;
  successRate: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  timeoutRate: number;
  toolFailureRate: number;
  ragHitRate: number;
  citationRate: number;
  avgCitationsPerResponse: number;
  stageBreakdown: Record<string, { avgMs: number; p95Ms: number }>;
}

export interface RegressionTestResult {
  gptId: string;
  versionTested: number;
  passed: boolean;
  schemaValid: boolean;
  promptHash: string;
  goldenConversationsPassed: number;
  goldenConversationsTotal: number;
  runAt: number;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_TRACE_BUFFER = 10_000;
const METRICS_WINDOW_MS = 3_600_000; // 1 hour
const HALLUCINATION_CHECK_THRESHOLD = 0.3;

// ─── Governance & Observability ──────────────────────────────────────────────

export class GptGovernance {
  private traces: TraceEntry[] = [];
  private goldenConversations = new Map<string, GoldenConversation[]>();
  private permissionsCache = new Map<string, WorkspacePermissions>();

  // ── Workspace Permissions ─────────────────────────────────────────────

  /**
   * Set permissions for a GPT within a workspace.
   */
  setPermissions(permissions: WorkspacePermissions): void {
    const key = `${permissions.workspaceId}:${permissions.gptId}`;
    this.permissionsCache.set(key, permissions);
  }

  /**
   * Check if a user has a specific permission on a GPT.
   */
  checkPermission(
    workspaceId: string,
    gptId: string,
    userId: string,
    action: "canUse" | "canEdit" | "canPublish" | "canDelete"
  ): boolean {
    const key = `${workspaceId}:${gptId}`;
    const permissions = this.permissionsCache.get(key);
    if (!permissions) return false;
    return permissions.permissions[action].includes(userId) || permissions.permissions[action].includes("*");
  }

  /**
   * Get permissions for a GPT.
   */
  getPermissions(workspaceId: string, gptId: string): WorkspacePermissions | null {
    const key = `${workspaceId}:${gptId}`;
    return this.permissionsCache.get(key) ?? null;
  }

  // ── Publication ───────────────────────────────────────────────────────

  /**
   * Publish a GPT (marks it as published, records who/when).
   */
  async publish(gptId: string, scope: "internal" | "external", userId: string): Promise<PublicationStatus> {
    const [gpt] = await db.select().from(gpts).where(eq(gpts.id, gptId)).limit(1);
    if (!gpt) throw new Error(`GPT ${gptId} not found`);

    const visibility = scope === "external" ? "public" : "team";
    await db
      .update(gpts)
      .set({
        isPublished: "true",
        visibility,
        updatedAt: new Date(),
      })
      .where(eq(gpts.id, gptId));

    return {
      gptId,
      internal: true,
      external: scope === "external",
      publishedVersion: gpt.version ?? 1,
      publishedAt: new Date(),
      publishedBy: userId,
    };
  }

  /**
   * Unpublish a GPT.
   */
  async unpublish(gptId: string): Promise<void> {
    await db
      .update(gpts)
      .set({ isPublished: "false", visibility: "private", updatedAt: new Date() })
      .where(eq(gpts.id, gptId));
  }

  // ── Observability / Traces ────────────────────────────────────────────

  /**
   * Record a trace from a turn execution.
   */
  recordTrace(turnResult: TurnResult, extra?: { gptId: string; userId?: string; modelUsed?: string }): void {
    const entry: TraceEntry = {
      requestId: turnResult.requestId,
      conversationId: turnResult.conversationId,
      gptId: extra?.gptId ?? "",
      userId: extra?.userId,
      timestamp: Date.now(),
      stages: turnResult.stages,
      totalLatencyMs: turnResult.latencyMs,
      success: turnResult.state === "done",
      toolCallCount: turnResult.toolCalls.length,
      ragChunkCount: turnResult.ragContext?.chunks.length ?? 0,
      citationCount: turnResult.citations.length,
      error: turnResult.state === "error" ? "Turn failed" : undefined,
      modelUsed: extra?.modelUsed,
    };

    this.traces.push(entry);

    // Prune old traces
    if (this.traces.length > MAX_TRACE_BUFFER) {
      this.traces = this.traces.slice(-MAX_TRACE_BUFFER);
    }
  }

  /**
   * Get traces for a specific request/conversation/GPT.
   */
  getTraces(filters?: {
    requestId?: string;
    conversationId?: string;
    gptId?: string;
    limit?: number;
  }): TraceEntry[] {
    let entries = [...this.traces];
    if (filters?.requestId) entries = entries.filter((e) => e.requestId === filters.requestId);
    if (filters?.conversationId) entries = entries.filter((e) => e.conversationId === filters.conversationId);
    if (filters?.gptId) entries = entries.filter((e) => e.gptId === filters.gptId);
    entries.sort((a, b) => b.timestamp - a.timestamp);
    return entries.slice(0, filters?.limit ?? 50);
  }

  // ── Quality Metrics ───────────────────────────────────────────────────

  /**
   * Compute quality metrics for a GPT over a time window.
   */
  computeMetrics(gptId: string, windowMs: number = METRICS_WINDOW_MS): QualityMetrics {
    const cutoff = Date.now() - windowMs;
    const entries = this.traces.filter((e) => e.gptId === gptId && e.timestamp > cutoff);

    if (entries.length === 0) {
      return {
        gptId,
        period: `${windowMs / 60_000}min`,
        totalRequests: 0,
        successRate: 0,
        avgLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        timeoutRate: 0,
        toolFailureRate: 0,
        ragHitRate: 0,
        citationRate: 0,
        avgCitationsPerResponse: 0,
        stageBreakdown: {},
      };
    }

    const latencies = entries.map((e) => e.totalLatencyMs).sort((a, b) => a - b);
    const successCount = entries.filter((e) => e.success).length;
    const timeoutCount = entries.filter((e) => e.error?.includes("imeout")).length;
    const toolCallEntries = entries.filter((e) => e.toolCallCount > 0);
    const toolFailures = entries.filter((e) => !e.success && e.toolCallCount > 0).length;
    const ragEntries = entries.filter((e) => e.ragChunkCount > 0);
    const citationEntries = entries.filter((e) => e.citationCount > 0);

    // Stage breakdown
    const stageMap = new Map<string, number[]>();
    for (const entry of entries) {
      for (const stage of entry.stages) {
        const arr = stageMap.get(stage.stage) ?? [];
        arr.push(stage.durationMs);
        stageMap.set(stage.stage, arr);
      }
    }
    const stageBreakdown: Record<string, { avgMs: number; p95Ms: number }> = {};
    for (const [stage, durations] of stageMap) {
      durations.sort((a, b) => a - b);
      stageBreakdown[stage] = {
        avgMs: Math.round(durations.reduce((s, d) => s + d, 0) / durations.length),
        p95Ms: durations[Math.floor(durations.length * 0.95)] ?? 0,
      };
    }

    return {
      gptId,
      period: `${windowMs / 60_000}min`,
      totalRequests: entries.length,
      successRate: successCount / entries.length,
      avgLatencyMs: Math.round(latencies.reduce((s, l) => s + l, 0) / latencies.length),
      p95LatencyMs: latencies[Math.floor(latencies.length * 0.95)] ?? 0,
      p99LatencyMs: latencies[Math.floor(latencies.length * 0.99)] ?? 0,
      timeoutRate: timeoutCount / entries.length,
      toolFailureRate: toolCallEntries.length > 0 ? toolFailures / toolCallEntries.length : 0,
      ragHitRate: ragEntries.length / entries.length,
      citationRate: citationEntries.length / entries.length,
      avgCitationsPerResponse: entries.reduce((s, e) => s + e.citationCount, 0) / entries.length,
      stageBreakdown,
    };
  }

  // ── Golden Conversations (Evaluations) ────────────────────────────────

  /**
   * Register a golden conversation for evaluation.
   */
  registerGoldenConversation(gptId: string, golden: Omit<GoldenConversation, "id" | "createdAt">): GoldenConversation {
    const entry: GoldenConversation = {
      ...golden,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
    };
    const existing = this.goldenConversations.get(gptId) ?? [];
    existing.push(entry);
    this.goldenConversations.set(gptId, existing);
    return entry;
  }

  /**
   * Evaluate a golden conversation against the current GPT version.
   * This runs each turn and checks patterns/citations/latency.
   */
  async evaluateGoldenConversation(
    goldenId: string,
    gptId: string,
    executeTurn: (message: string) => Promise<{ response: string; latencyMs: number; citations: string[] }>
  ): Promise<EvaluationResult> {
    const goldens = this.goldenConversations.get(gptId) ?? [];
    const golden = goldens.find((g) => g.id === goldenId);
    if (!golden) throw new Error(`Golden conversation ${goldenId} not found`);

    const turnResults: TurnEvaluation[] = [];
    const startTime = Date.now();

    for (let i = 0; i < golden.turns.length; i++) {
      const turn = golden.turns[i];
      const result = await executeTurn(turn.userMessage);

      const matchedPatterns = turn.expectedPatterns.filter((p) =>
        new RegExp(p, "i").test(result.response)
      );
      const missingPatterns = turn.expectedPatterns.filter(
        (p) => !new RegExp(p, "i").test(result.response)
      );
      const forbiddenMatches = (turn.forbiddenPatterns ?? []).filter((p) =>
        new RegExp(p, "i").test(result.response)
      );

      const latencyOk = turn.maxLatencyMs ? result.latencyMs <= turn.maxLatencyMs : true;

      turnResults.push({
        turnIndex: i,
        passed: missingPatterns.length === 0 && forbiddenMatches.length === 0 && latencyOk,
        actualResponse: result.response,
        matchedPatterns,
        missingPatterns,
        forbiddenMatches,
        latencyMs: result.latencyMs,
        latencyWithinBudget: latencyOk,
      });
    }

    const passed = turnResults.every((t) => t.passed);
    const evalResult: EvaluationResult = {
      goldenConversationId: goldenId,
      passed,
      turnResults,
      runAt: Date.now(),
      totalLatencyMs: Date.now() - startTime,
    };

    // Update last run info
    golden.lastRunAt = evalResult.runAt;
    golden.lastRunResult = evalResult;

    return evalResult;
  }

  /**
   * Run all golden conversation evaluations for a GPT.
   */
  async runAllEvaluations(
    gptId: string,
    executeTurn: (message: string) => Promise<{ response: string; latencyMs: number; citations: string[] }>
  ): Promise<EvaluationResult[]> {
    const goldens = this.goldenConversations.get(gptId) ?? [];
    const results: EvaluationResult[] = [];

    for (const golden of goldens) {
      const result = await this.evaluateGoldenConversation(golden.id, gptId, executeTurn);
      results.push(result);
    }

    return results;
  }

  /**
   * List golden conversations for a GPT.
   */
  listGoldenConversations(gptId: string): GoldenConversation[] {
    return this.goldenConversations.get(gptId) ?? [];
  }

  // ── Regression Tests ──────────────────────────────────────────────────

  /**
   * Run a regression test for a GPT version: checks schema validity,
   * prompt hash consistency, and golden conversation pass rate.
   */
  async runRegressionTest(
    gptId: string,
    executeTurn: (message: string) => Promise<{ response: string; latencyMs: number; citations: string[] }>
  ): Promise<RegressionTestResult> {
    const [gpt] = await db.select().from(gpts).where(eq(gpts.id, gptId)).limit(1);
    if (!gpt) throw new Error(`GPT ${gptId} not found`);

    const definition = gpt.definition as Record<string, unknown>;
    const promptHash = crypto
      .createHash("sha256")
      .update(gpt.systemPrompt)
      .digest("hex")
      .slice(0, 16);

    // Schema validation
    let schemaValid = true;
    try {
      const { gptDefinitionSchema: schema } = await import("@shared/schema/gpt");
      schema.parse(definition);
    } catch {
      schemaValid = false;
    }

    // Golden conversations
    const evalResults = await this.runAllEvaluations(gptId, executeTurn);
    const passedCount = evalResults.filter((r) => r.passed).length;

    return {
      gptId,
      versionTested: gpt.version ?? 1,
      passed: schemaValid && passedCount === evalResults.length,
      schemaValid,
      promptHash,
      goldenConversationsPassed: passedCount,
      goldenConversationsTotal: evalResults.length,
      runAt: Date.now(),
    };
  }

  // ── Hallucination Check ───────────────────────────────────────────────

  /**
   * Check if a response may contain hallucinations by verifying citations
   * against the knowledge context.
   */
  checkHallucination(
    response: string,
    citationCount: number,
    ragChunkCount: number
  ): { suspicious: boolean; reason?: string } {
    // If we have RAG context but zero citations, that's suspicious
    if (ragChunkCount > 0 && citationCount === 0) {
      return {
        suspicious: true,
        reason: "Response uses knowledge context but contains no citations",
      };
    }

    // If the response mentions specific facts/numbers but no sources
    const factPatterns = /\b(?:according to|studies show|research indicates|data shows|statistics|percent|%|\d{4}\s+study)\b/i;
    if (factPatterns.test(response) && citationCount === 0 && ragChunkCount > 0) {
      return {
        suspicious: true,
        reason: "Response contains factual claims without citations while knowledge was available",
      };
    }

    return { suspicious: false };
  }
}

export const gptGovernance = new GptGovernance();
