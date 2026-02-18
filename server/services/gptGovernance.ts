/**
 * GPT Governance & Observability Service
 *
 * Provides:
 *  (a) Permissions management (workspace/team level)
 *  (b) Publication lifecycle (draft → internal → public with approval)
 *  (c) Version management with rollback
 *  (d) Audit trail for every GPT mutation
 *  (e) Observability: per-request traces, latency breakdowns, quality metrics
 *  (f) Metrics aggregation (hourly buckets for dashboards)
 */

import { db } from "../db";
import { eq, and, desc, sql, gte, lte, count } from "drizzle-orm";
import {
  gpts,
  gptVersions,
  type Gpt,
  type GptVersion,
  type InsertGptVersion,
  gptDefinitionSchema,
} from "@shared/schema/gpt";
import {
  gptAuditLog,
  gptPermissions,
  gptPublications,
  gptConversationRuns,
  gptTraces,
  gptMetricsHourly,
  type InsertGptAuditLog,
  type InsertGptPermission,
  type InsertGptPublication,
  type InsertGptMetricsHourly,
  type GptAuditLogEntry,
  type GptPermission,
  type GptPublication,
  type GptConversationRun,
  type GptTrace,
  type GptMetricsHourly,
} from "@shared/schema/gptProduct";
import { createLogger } from "../lib/structuredLogger";

const logger = createLogger("gpt-governance");

// ─── Version Management ──────────────────────────────────────────────────────

export class GptVersionManager {
  /**
   * Create a new immutable version snapshot when a GPT is updated.
   * Every change creates a new version — no in-place mutations.
   */
  async createVersion(
    gptId: string,
    gpt: Gpt,
    changeNotes: string,
    actorId?: string
  ): Promise<GptVersion> {
    const currentVersion = gpt.version || 1;
    const newVersionNumber = currentVersion + 1;

    // Build definition snapshot
    const definitionSnapshot = gpt.definition || {
      name: gpt.name,
      description: gpt.description,
      instructions: gpt.systemPrompt,
      model: gpt.recommendedModel || "grok-4-1-fast-non-reasoning",
      conversationStarters: gpt.conversationStarters || [],
      capabilities: gpt.capabilities || {},
      knowledgeSources: [],
      actions: [],
      policies: {},
    };

    const versionData: InsertGptVersion = {
      gptId,
      versionNumber: newVersionNumber,
      systemPrompt: gpt.systemPrompt,
      temperature: gpt.temperature,
      topP: gpt.topP,
      maxTokens: gpt.maxTokens,
      definitionSnapshot: definitionSnapshot as any,
      changeNotes,
      createdBy: actorId,
    };

    const [version] = await db.insert(gptVersions).values(versionData).returning();

    // Update the GPT's version counter
    await db
      .update(gpts)
      .set({ version: newVersionNumber, updatedAt: new Date() })
      .where(eq(gpts.id, gptId));

    // Audit log
    await this.audit(gptId, "version_created", actorId, {
      versionBefore: currentVersion,
      versionAfter: newVersionNumber,
      changeSummary: changeNotes,
    });

    logger.info(
      `GPT version created: v${newVersionNumber}`,
      { gptId, version: newVersionNumber, actor: actorId }
    );

    return version;
  }

  /**
   * Rollback a GPT to a previous version.
   * Creates a NEW version with the old version's snapshot (immutability preserved).
   */
  async rollback(
    gptId: string,
    targetVersionNumber: number,
    actorId?: string
  ): Promise<GptVersion> {
    // Fetch the target version
    const [targetVersion] = await db
      .select()
      .from(gptVersions)
      .where(
        and(
          eq(gptVersions.gptId, gptId),
          eq(gptVersions.versionNumber, targetVersionNumber)
        )
      )
      .limit(1);

    if (!targetVersion) {
      throw new Error(`Version ${targetVersionNumber} not found for GPT ${gptId}`);
    }

    // Get current GPT state
    const [gpt] = await db.select().from(gpts).where(eq(gpts.id, gptId)).limit(1);
    if (!gpt) throw new Error(`GPT ${gptId} not found`);

    const currentVersion = gpt.version || 1;
    const newVersionNumber = currentVersion + 1;

    // Create new version with the target's snapshot
    const rollbackData: InsertGptVersion = {
      gptId,
      versionNumber: newVersionNumber,
      systemPrompt: targetVersion.systemPrompt,
      temperature: targetVersion.temperature,
      topP: targetVersion.topP,
      maxTokens: targetVersion.maxTokens,
      definitionSnapshot: targetVersion.definitionSnapshot as any,
      changeNotes: `Rollback to v${targetVersionNumber}`,
      createdBy: actorId,
    };

    const [newVersion] = await db.insert(gptVersions).values(rollbackData).returning();

    // Update GPT with rolled-back values
    const snapshot = targetVersion.definitionSnapshot as Record<string, any> | null;
    await db
      .update(gpts)
      .set({
        version: newVersionNumber,
        systemPrompt: targetVersion.systemPrompt,
        temperature: targetVersion.temperature,
        topP: targetVersion.topP,
        maxTokens: targetVersion.maxTokens,
        definition: snapshot as any,
        updatedAt: new Date(),
      })
      .where(eq(gpts.id, gptId));

    // Audit log
    await this.audit(gptId, "rollback", actorId, {
      versionBefore: currentVersion,
      versionAfter: newVersionNumber,
      changeSummary: `Rolled back to v${targetVersionNumber}`,
      diff: { rollbackTarget: targetVersionNumber },
    });

    logger.info(
      `GPT rolled back to v${targetVersionNumber} as v${newVersionNumber}`,
      { gptId, from: currentVersion, to: newVersionNumber, rollbackTarget: targetVersionNumber }
    );

    return newVersion;
  }

  /**
   * Get version history for a GPT.
   */
  async getVersionHistory(gptId: string, limit = 50): Promise<GptVersion[]> {
    return db
      .select()
      .from(gptVersions)
      .where(eq(gptVersions.gptId, gptId))
      .orderBy(desc(gptVersions.versionNumber))
      .limit(limit);
  }

  /**
   * Compare two versions and produce a diff.
   */
  async diffVersions(
    gptId: string,
    versionA: number,
    versionB: number
  ): Promise<{
    versionA: number;
    versionB: number;
    changes: Array<{ field: string; before: unknown; after: unknown }>;
  }> {
    const [a] = await db
      .select()
      .from(gptVersions)
      .where(and(eq(gptVersions.gptId, gptId), eq(gptVersions.versionNumber, versionA)));

    const [b] = await db
      .select()
      .from(gptVersions)
      .where(and(eq(gptVersions.gptId, gptId), eq(gptVersions.versionNumber, versionB)));

    if (!a || !b) {
      throw new Error("One or both versions not found");
    }

    const changes: Array<{ field: string; before: unknown; after: unknown }> = [];

    if (a.systemPrompt !== b.systemPrompt) {
      changes.push({ field: "systemPrompt", before: a.systemPrompt, after: b.systemPrompt });
    }
    if (a.temperature !== b.temperature) {
      changes.push({ field: "temperature", before: a.temperature, after: b.temperature });
    }
    if (a.topP !== b.topP) {
      changes.push({ field: "topP", before: a.topP, after: b.topP });
    }
    if (a.maxTokens !== b.maxTokens) {
      changes.push({ field: "maxTokens", before: a.maxTokens, after: b.maxTokens });
    }

    // Deep diff on definition snapshots
    const snapA = (a.definitionSnapshot || {}) as Record<string, unknown>;
    const snapB = (b.definitionSnapshot || {}) as Record<string, unknown>;
    const allKeys = new Set([...Object.keys(snapA), ...Object.keys(snapB)]);

    for (const key of allKeys) {
      const valA = JSON.stringify(snapA[key]);
      const valB = JSON.stringify(snapB[key]);
      if (valA !== valB) {
        changes.push({
          field: `definition.${key}`,
          before: snapA[key],
          after: snapB[key],
        });
      }
    }

    return { versionA, versionB, changes };
  }

  /** Record an audit log entry */
  private async audit(
    gptId: string,
    action: string,
    actorId?: string,
    extra?: Partial<InsertGptAuditLog>
  ): Promise<void> {
    try {
      await db.insert(gptAuditLog).values({
        gptId,
        action,
        actorId: actorId ?? null,
        ...extra,
      });
    } catch (err) {
      logger.error("Failed to write audit log", { err, gptId, action });
    }
  }
}

// ─── Permission Management ───────────────────────────────────────────────────

export class GptPermissionManager {
  /**
   * Grant a permission to a user/team/workspace for a GPT.
   */
  async grant(
    gptId: string,
    granteeType: "user" | "team" | "workspace",
    granteeId: string,
    role: "owner" | "editor" | "viewer" | "user",
    grantedBy?: string,
    expiresAt?: Date
  ): Promise<GptPermission> {
    // Upsert: update if exists, insert otherwise
    const existing = await db
      .select()
      .from(gptPermissions)
      .where(
        and(
          eq(gptPermissions.gptId, gptId),
          eq(gptPermissions.granteeId, granteeId),
          eq(gptPermissions.granteeType, granteeType)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      const [updated] = await db
        .update(gptPermissions)
        .set({ role, grantedBy, expiresAt })
        .where(eq(gptPermissions.id, existing[0].id))
        .returning();
      return updated;
    }

    const [permission] = await db
      .insert(gptPermissions)
      .values({ gptId, granteeType, granteeId, role, grantedBy, expiresAt })
      .returning();

    return permission;
  }

  /**
   * Revoke a permission.
   */
  async revoke(gptId: string, granteeId: string): Promise<void> {
    await db
      .delete(gptPermissions)
      .where(
        and(eq(gptPermissions.gptId, gptId), eq(gptPermissions.granteeId, granteeId))
      );
  }

  /**
   * Check if a user has at least the required role.
   */
  async hasPermission(
    gptId: string,
    userId: string,
    requiredRole: "owner" | "editor" | "viewer" | "user"
  ): Promise<boolean> {
    const roleHierarchy = { owner: 4, editor: 3, viewer: 2, user: 1 };
    const requiredLevel = roleHierarchy[requiredRole] || 0;

    const permissions = await db
      .select()
      .from(gptPermissions)
      .where(
        and(eq(gptPermissions.gptId, gptId), eq(gptPermissions.granteeId, userId))
      );

    if (permissions.length === 0) return false;

    return permissions.some((p) => {
      const level = roleHierarchy[p.role as keyof typeof roleHierarchy] || 0;
      return level >= requiredLevel;
    });
  }

  /**
   * List permissions for a GPT.
   */
  async listPermissions(gptId: string): Promise<GptPermission[]> {
    return db
      .select()
      .from(gptPermissions)
      .where(eq(gptPermissions.gptId, gptId));
  }
}

// ─── Publication Manager ─────────────────────────────────────────────────────

export class GptPublicationManager {
  /**
   * Publish a GPT version to a scope (internal, workspace, public).
   */
  async publish(
    gptId: string,
    versionNumber: number,
    scope: "internal" | "workspace" | "public",
    publishedBy: string,
    releaseNotes?: string,
    approvedBy?: string
  ): Promise<GptPublication> {
    // Deactivate previous publications for this GPT in this scope
    await db
      .update(gptPublications)
      .set({ isActive: "false", unpublishedAt: new Date() })
      .where(and(eq(gptPublications.gptId, gptId), eq(gptPublications.scope, scope)));

    const [publication] = await db
      .insert(gptPublications)
      .values({
        gptId,
        publishedVersion: versionNumber,
        publishedBy,
        scope,
        approvedBy,
        releaseNotes,
      })
      .returning();

    // Update GPT visibility based on scope
    const visibilityMap = { internal: "team", workspace: "team", public: "public" };
    await db
      .update(gpts)
      .set({
        isPublished: "true",
        visibility: visibilityMap[scope] || "private",
        updatedAt: new Date(),
      })
      .where(eq(gpts.id, gptId));

    logger.info(
      `GPT published: v${versionNumber} to ${scope}`,
      { gptId, version: versionNumber, scope, publishedBy }
    );

    return publication;
  }

  /**
   * Unpublish a GPT from a scope.
   */
  async unpublish(gptId: string, scope: string): Promise<void> {
    await db
      .update(gptPublications)
      .set({ isActive: "false", unpublishedAt: new Date() })
      .where(and(eq(gptPublications.gptId, gptId), eq(gptPublications.scope, scope)));

    // Check if any other active publications exist
    const remaining = await db
      .select()
      .from(gptPublications)
      .where(and(eq(gptPublications.gptId, gptId), eq(gptPublications.isActive, "true")));

    if (remaining.length === 0) {
      await db
        .update(gpts)
        .set({ isPublished: "false", visibility: "private", updatedAt: new Date() })
        .where(eq(gpts.id, gptId));
    }
  }

  /**
   * Get publication history for a GPT.
   */
  async getPublicationHistory(gptId: string): Promise<GptPublication[]> {
    return db
      .select()
      .from(gptPublications)
      .where(eq(gptPublications.gptId, gptId))
      .orderBy(desc(gptPublications.publishedAt));
  }
}

// ─── Audit Service ───────────────────────────────────────────────────────────

export class GptAuditService {
  /**
   * Log a GPT mutation event.
   */
  async log(entry: InsertGptAuditLog): Promise<void> {
    try {
      await db.insert(gptAuditLog).values(entry);
    } catch (err) {
      logger.error("Failed to write GPT audit log", { err });
    }
  }

  /**
   * Get audit trail for a GPT.
   */
  async getAuditTrail(
    gptId: string,
    options?: { limit?: number; offset?: number; action?: string }
  ): Promise<GptAuditLogEntry[]> {
    const conditions = [eq(gptAuditLog.gptId, gptId)];
    if (options?.action) {
      conditions.push(eq(gptAuditLog.action, options.action));
    }

    return db
      .select()
      .from(gptAuditLog)
      .where(and(...conditions))
      .orderBy(desc(gptAuditLog.createdAt))
      .limit(options?.limit ?? 100)
      .offset(options?.offset ?? 0);
  }
}

// ─── Observability Service ───────────────────────────────────────────────────

export class GptObservabilityService {
  /**
   * Get traces for a specific request.
   */
  async getRequestTraces(requestId: string): Promise<GptTrace[]> {
    return db
      .select()
      .from(gptTraces)
      .where(eq(gptTraces.requestId, requestId))
      .orderBy(gptTraces.createdAt);
  }

  /**
   * Get traces for a conversation.
   */
  async getConversationTraces(
    conversationId: string,
    limit = 100
  ): Promise<GptTrace[]> {
    return db
      .select()
      .from(gptTraces)
      .where(eq(gptTraces.conversationId, conversationId))
      .orderBy(desc(gptTraces.createdAt))
      .limit(limit);
  }

  /**
   * Get conversation run history for a GPT.
   */
  async getRunHistory(
    gptId: string,
    options?: { limit?: number; state?: string }
  ): Promise<GptConversationRun[]> {
    const conditions = [eq(gptConversationRuns.gptId, gptId)];
    if (options?.state) {
      conditions.push(eq(gptConversationRuns.state, options.state));
    }

    return db
      .select()
      .from(gptConversationRuns)
      .where(and(...conditions))
      .orderBy(desc(gptConversationRuns.createdAt))
      .limit(options?.limit ?? 50);
  }

  /**
   * Compute quality metrics for a GPT over a time range.
   */
  async computeQualityMetrics(
    gptId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<{
    totalRequests: number;
    successRate: number;
    avgLatencyMs: number;
    timeoutRate: number;
    toolFailureRate: number;
    avgTimeToFirstToken: number;
    streamAbortRate: number;
  }> {
    const runs = await db
      .select()
      .from(gptConversationRuns)
      .where(
        and(
          eq(gptConversationRuns.gptId, gptId),
          gte(gptConversationRuns.createdAt, fromDate),
          lte(gptConversationRuns.createdAt, toDate)
        )
      );

    if (runs.length === 0) {
      return {
        totalRequests: 0,
        successRate: 1,
        avgLatencyMs: 0,
        timeoutRate: 0,
        toolFailureRate: 0,
        avgTimeToFirstToken: 0,
        streamAbortRate: 0,
      };
    }

    const total = runs.length;
    const successful = runs.filter((r) => r.state === "done").length;
    const timeouts = runs.filter((r) => r.errorCode === "TIMEOUT" || r.errorCode === "STREAM_ERROR").length;
    const toolFailures = runs.filter((r) => r.errorCode === "TOOL_ERROR").length;
    const aborted = runs.filter((r) => r.streamAborted === "true").length;

    const latencies = runs
      .map((r) => r.latencyTotalMs)
      .filter((l): l is number => l !== null && l !== undefined);
    const ttfts = runs
      .map((r) => r.timeToFirstTokenMs)
      .filter((t): t is number => t !== null && t !== undefined);

    return {
      totalRequests: total,
      successRate: total > 0 ? successful / total : 1,
      avgLatencyMs: latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0,
      timeoutRate: total > 0 ? timeouts / total : 0,
      toolFailureRate: total > 0 ? toolFailures / total : 0,
      avgTimeToFirstToken: ttfts.length > 0 ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : 0,
      streamAbortRate: total > 0 ? aborted / total : 0,
    };
  }

  /**
   * Aggregate metrics into hourly buckets.
   * This should be run periodically (e.g., via cron job).
   */
  async aggregateHourlyMetrics(gptId: string, hourBucket: Date): Promise<void> {
    const hourStart = new Date(hourBucket);
    hourStart.setMinutes(0, 0, 0);
    const hourEnd = new Date(hourStart.getTime() + 3600_000);

    const metrics = await this.computeQualityMetrics(gptId, hourStart, hourEnd);

    const runs = await db
      .select()
      .from(gptConversationRuns)
      .where(
        and(
          eq(gptConversationRuns.gptId, gptId),
          gte(gptConversationRuns.createdAt, hourStart),
          lte(gptConversationRuns.createdAt, hourEnd)
        )
      );

    const latencies = runs
      .map((r) => r.latencyTotalMs)
      .filter((l): l is number => l !== null && l !== undefined)
      .sort((a, b) => a - b);

    const p50 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.5)] : null;
    const p95 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.95)] : null;
    const p99 = latencies.length > 0 ? latencies[Math.floor(latencies.length * 0.99)] : null;

    const totalInput = runs.reduce((s, r) => s + (r.inputTokens || 0), 0);
    const totalOutput = runs.reduce((s, r) => s + (r.outputTokens || 0), 0);
    const totalTools = runs.reduce((s, r) => s + (r.toolCallCount || 0), 0);

    await db.insert(gptMetricsHourly).values({
      gptId,
      hourBucket: hourStart,
      totalRequests: metrics.totalRequests,
      successfulRequests: Math.round(metrics.totalRequests * metrics.successRate),
      failedRequests: metrics.totalRequests - Math.round(metrics.totalRequests * metrics.successRate),
      timeoutCount: Math.round(metrics.totalRequests * metrics.timeoutRate),
      toolCallCount: totalTools,
      toolFailureCount: Math.round(metrics.totalRequests * metrics.toolFailureRate),
      avgLatencyMs: Math.round(metrics.avgLatencyMs),
      p50LatencyMs: p50,
      p95LatencyMs: p95,
      p99LatencyMs: p99,
      avgTimeToFirstTokenMs: Math.round(metrics.avgTimeToFirstToken),
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      streamAbortCount: Math.round(metrics.totalRequests * metrics.streamAbortRate),
    });

    logger.info(
      "Hourly metrics aggregated",
      { gptId, hourBucket: hourStart.toISOString(), requests: metrics.totalRequests }
    );
  }

  /**
   * Get hourly metrics for dashboard display.
   */
  async getHourlyMetrics(
    gptId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<GptMetricsHourly[]> {
    return db
      .select()
      .from(gptMetricsHourly)
      .where(
        and(
          eq(gptMetricsHourly.gptId, gptId),
          gte(gptMetricsHourly.hourBucket, fromDate),
          lte(gptMetricsHourly.hourBucket, toDate)
        )
      )
      .orderBy(gptMetricsHourly.hourBucket);
  }
}

// ─── Singleton exports ────────────────────────────────────────────────────────

export const gptVersionManager = new GptVersionManager();
export const gptPermissionManager = new GptPermissionManager();
export const gptPublicationManager = new GptPublicationManager();
export const gptAuditService = new GptAuditService();
export const gptObservabilityService = new GptObservabilityService();
