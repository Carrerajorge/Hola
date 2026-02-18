/**
 * GPT Definition Manager
 *
 * Manages GPT definitions as immutable, versioned product entities.
 * Every mutation creates a new version snapshot for auditability and rollback.
 */
import crypto from "node:crypto";
import { db } from "../../db";
import { eq, desc, and, sql } from "drizzle-orm";
import {
  gpts,
  gptVersions,
  gptActions,
  gptKnowledge,
  gptSessions,
  type Gpt,
  type GptVersion,
  type InsertGpt,
  type InsertGptVersion,
  type GptAction,
  type GptKnowledge,
  gptDefinitionSchema,
  gptCapabilitiesSchema,
  gptPolicySchema,
  gptToolPermissionsSchema,
  gptRuntimePolicySchema,
} from "@shared/schema/gpt";
import type { z } from "zod/v4";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GptDefinition = z.infer<typeof gptDefinitionSchema>;

export interface GptProductSnapshot {
  gptId: string;
  version: number;
  definition: GptDefinition;
  actions: GptAction[];
  knowledgeSources: GptKnowledge[];
  systemPrompt: string;
  capabilities: z.infer<typeof gptCapabilitiesSchema>;
  toolPermissions: z.infer<typeof gptToolPermissionsSchema>;
  runtimePolicy: z.infer<typeof gptRuntimePolicySchema>;
  policies: z.infer<typeof gptPolicySchema>;
  createdAt: Date;
  createdBy: string | null;
}

export interface VersionDiff {
  field: string;
  before: unknown;
  after: unknown;
}

export interface CreateGptProductInput {
  name: string;
  description?: string;
  avatar?: string;
  categoryId?: string;
  creatorId: string;
  visibility?: "private" | "team" | "public";
  definition: GptDefinition;
}

export interface UpdateGptProductInput {
  definition?: Partial<GptDefinition>;
  visibility?: "private" | "team" | "public";
  categoryId?: string;
  changeNotes?: string;
  updatedBy: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_VERSIONS_RETAINED = 100;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${base}-${suffix}`;
}

function computeDefinitionHash(definition: GptDefinition): string {
  const canonical = JSON.stringify(definition, Object.keys(definition).sort());
  return crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function diffDefinitions(before: GptDefinition, after: GptDefinition): VersionDiff[] {
  const diffs: VersionDiff[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const bVal = JSON.stringify((before as any)[key]);
    const aVal = JSON.stringify((after as any)[key]);
    if (bVal !== aVal) {
      diffs.push({ field: key, before: (before as any)[key], after: (after as any)[key] });
    }
  }
  return diffs;
}

// ─── GPT Definition Manager ──────────────────────────────────────────────────

export class GptDefinitionManager {
  /**
   * Create a new GPT product from scratch.
   * Validates the definition, persists it, and creates version 1.
   */
  async create(input: CreateGptProductInput): Promise<GptProductSnapshot> {
    const validated = gptDefinitionSchema.parse(input.definition);
    const slug = generateSlug(input.name);

    const [gpt] = await db
      .insert(gpts)
      .values({
        name: input.name,
        slug,
        description: input.description ?? validated.description ?? null,
        avatar: input.avatar ?? validated.avatar ?? null,
        categoryId: input.categoryId ?? null,
        creatorId: input.creatorId,
        visibility: input.visibility ?? "private",
        systemPrompt: validated.instructions,
        temperature: String(validated.policies?.temperatureOverride ?? 0.7),
        topP: "1",
        maxTokens: validated.policies?.maxTokensOverride ?? 4096,
        definition: validated,
        welcomeMessage: null,
        capabilities: validated.capabilities,
        conversationStarters: validated.conversationStarters,
        version: 1,
        recommendedModel: validated.model,
        runtimePolicy: {
          enforceModel: validated.policies?.enforceModel ?? false,
          modelFallbacks: validated.policies?.modelFallbacks ?? [],
          maxTokensOverride: validated.policies?.maxTokensOverride,
          temperatureOverride: validated.policies?.temperatureOverride,
          allowClientOverride: validated.policies?.allowClientOverride ?? false,
        },
        toolPermissions: {
          mode: "allowlist" as const,
          tools: [],
          actionsEnabled: true,
        },
        isPublished: "false",
      })
      .returning();

    // Create version 1 snapshot
    await db.insert(gptVersions).values({
      gptId: gpt.id,
      versionNumber: 1,
      systemPrompt: validated.instructions,
      temperature: String(validated.policies?.temperatureOverride ?? 0.7),
      topP: "1",
      maxTokens: validated.policies?.maxTokensOverride ?? 4096,
      definitionSnapshot: validated,
      changeNotes: "Initial creation",
      createdBy: input.creatorId,
    });

    return this.getSnapshot(gpt.id);
  }

  /**
   * Update a GPT product. Creates a new immutable version.
   */
  async update(gptId: string, input: UpdateGptProductInput): Promise<GptProductSnapshot> {
    const existing = await db.select().from(gpts).where(eq(gpts.id, gptId)).limit(1);
    if (!existing.length) {
      throw new Error(`GPT ${gptId} not found`);
    }
    const gpt = existing[0];
    const currentDef = (gpt.definition as GptDefinition) ?? gptDefinitionSchema.parse({
      instructions: gpt.systemPrompt,
    });

    // Merge definitions
    const merged: GptDefinition = {
      ...currentDef,
      ...(input.definition ?? {}),
    };
    if (input.definition?.capabilities) {
      merged.capabilities = { ...currentDef.capabilities, ...input.definition.capabilities };
    }
    if (input.definition?.policies) {
      merged.policies = { ...currentDef.policies, ...input.definition.policies };
    }

    const validated = gptDefinitionSchema.parse(merged);
    const nextVersion = (gpt.version ?? 1) + 1;

    // Persist the update
    await db
      .update(gpts)
      .set({
        name: validated.name ?? gpt.name,
        description: validated.description ?? gpt.description,
        avatar: validated.avatar ?? gpt.avatar,
        visibility: input.visibility ?? gpt.visibility,
        categoryId: input.categoryId ?? gpt.categoryId,
        systemPrompt: validated.instructions,
        temperature: String(validated.policies?.temperatureOverride ?? 0.7),
        maxTokens: validated.policies?.maxTokensOverride ?? 4096,
        definition: validated,
        capabilities: validated.capabilities,
        conversationStarters: validated.conversationStarters,
        version: nextVersion,
        recommendedModel: validated.model,
        runtimePolicy: {
          enforceModel: validated.policies?.enforceModel ?? false,
          modelFallbacks: validated.policies?.modelFallbacks ?? [],
          maxTokensOverride: validated.policies?.maxTokensOverride,
          temperatureOverride: validated.policies?.temperatureOverride,
          allowClientOverride: validated.policies?.allowClientOverride ?? false,
        },
        updatedAt: new Date(),
      })
      .where(eq(gpts.id, gptId));

    // Create immutable version snapshot
    await db.insert(gptVersions).values({
      gptId,
      versionNumber: nextVersion,
      systemPrompt: validated.instructions,
      temperature: String(validated.policies?.temperatureOverride ?? 0.7),
      topP: "1",
      maxTokens: validated.policies?.maxTokensOverride ?? 4096,
      definitionSnapshot: validated,
      changeNotes: input.changeNotes ?? `Updated to v${nextVersion}`,
      createdBy: input.updatedBy,
    });

    // Prune old versions beyond retention limit
    await this.pruneOldVersions(gptId);

    return this.getSnapshot(gptId);
  }

  /**
   * Rollback a GPT to a specific version.
   */
  async rollback(gptId: string, targetVersion: number, userId: string): Promise<GptProductSnapshot> {
    const [version] = await db
      .select()
      .from(gptVersions)
      .where(and(eq(gptVersions.gptId, gptId), eq(gptVersions.versionNumber, targetVersion)))
      .limit(1);

    if (!version) {
      throw new Error(`Version ${targetVersion} not found for GPT ${gptId}`);
    }

    const snapshot = version.definitionSnapshot as GptDefinition;
    return this.update(gptId, {
      definition: snapshot,
      changeNotes: `Rollback to version ${targetVersion}`,
      updatedBy: userId,
    });
  }

  /**
   * Get the full product snapshot (definition + actions + knowledge).
   */
  async getSnapshot(gptId: string): Promise<GptProductSnapshot> {
    const [gpt] = await db.select().from(gpts).where(eq(gpts.id, gptId)).limit(1);
    if (!gpt) throw new Error(`GPT ${gptId} not found`);

    const actions = await db.select().from(gptActions).where(eq(gptActions.gptId, gptId));
    const knowledge = await db.select().from(gptKnowledge).where(eq(gptKnowledge.gptId, gptId));

    const definition = (gpt.definition as GptDefinition) ?? gptDefinitionSchema.parse({
      instructions: gpt.systemPrompt,
    });

    return {
      gptId: gpt.id,
      version: gpt.version ?? 1,
      definition,
      actions,
      knowledgeSources: knowledge,
      systemPrompt: gpt.systemPrompt,
      capabilities: gptCapabilitiesSchema.parse(definition.capabilities ?? gpt.capabilities ?? {}),
      toolPermissions: gptToolPermissionsSchema.parse(gpt.toolPermissions ?? {}),
      runtimePolicy: gptRuntimePolicySchema.parse(gpt.runtimePolicy ?? {}),
      policies: gptPolicySchema.parse(definition.policies ?? {}),
      createdAt: gpt.createdAt,
      createdBy: gpt.creatorId,
    };
  }

  /**
   * Get version history with diffs.
   */
  async getVersionHistory(gptId: string, limit = 20): Promise<Array<GptVersion & { diff?: VersionDiff[] }>> {
    const versions = await db
      .select()
      .from(gptVersions)
      .where(eq(gptVersions.gptId, gptId))
      .orderBy(desc(gptVersions.versionNumber))
      .limit(limit);

    // Compute diffs between consecutive versions
    const result: Array<GptVersion & { diff?: VersionDiff[] }> = [];
    for (let i = 0; i < versions.length; i++) {
      const current = versions[i];
      const previous = versions[i + 1];
      const diff = previous
        ? diffDefinitions(
            previous.definitionSnapshot as GptDefinition,
            current.definitionSnapshot as GptDefinition
          )
        : undefined;
      result.push({ ...current, diff });
    }

    return result;
  }

  /**
   * Compare two versions side by side.
   */
  async compareVersions(gptId: string, versionA: number, versionB: number): Promise<VersionDiff[]> {
    const [a] = await db
      .select()
      .from(gptVersions)
      .where(and(eq(gptVersions.gptId, gptId), eq(gptVersions.versionNumber, versionA)))
      .limit(1);
    const [b] = await db
      .select()
      .from(gptVersions)
      .where(and(eq(gptVersions.gptId, gptId), eq(gptVersions.versionNumber, versionB)))
      .limit(1);

    if (!a || !b) throw new Error("One or both versions not found");
    return diffDefinitions(a.definitionSnapshot as GptDefinition, b.definitionSnapshot as GptDefinition);
  }

  /**
   * Publish / unpublish a GPT.
   */
  async setPublished(gptId: string, published: boolean): Promise<void> {
    await db.update(gpts).set({ isPublished: published ? "true" : "false", updatedAt: new Date() }).where(eq(gpts.id, gptId));
  }

  /**
   * Set visibility.
   */
  async setVisibility(gptId: string, visibility: "private" | "team" | "public"): Promise<void> {
    await db.update(gpts).set({ visibility, updatedAt: new Date() }).where(eq(gpts.id, gptId));
  }

  /**
   * Delete a GPT and all related data (cascades via FK).
   */
  async delete(gptId: string): Promise<void> {
    await db.delete(gpts).where(eq(gpts.id, gptId));
  }

  /**
   * Prune versions beyond the retention limit, keeping the first and last N.
   */
  private async pruneOldVersions(gptId: string): Promise<void> {
    const versions = await db
      .select({ id: gptVersions.id, versionNumber: gptVersions.versionNumber })
      .from(gptVersions)
      .where(eq(gptVersions.gptId, gptId))
      .orderBy(desc(gptVersions.versionNumber));

    if (versions.length <= MAX_VERSIONS_RETAINED) return;

    // Always keep version 1 (initial) and the latest MAX_VERSIONS_RETAINED
    const toKeepIds = new Set<string>();
    const firstVersion = versions[versions.length - 1];
    if (firstVersion) toKeepIds.add(firstVersion.id);
    for (let i = 0; i < MAX_VERSIONS_RETAINED && i < versions.length; i++) {
      toKeepIds.add(versions[i].id);
    }

    const toDelete = versions.filter((v) => !toKeepIds.has(v.id));
    if (toDelete.length > 0) {
      for (const v of toDelete) {
        await db.delete(gptVersions).where(eq(gptVersions.id, v.id));
      }
    }
  }
}

export const gptDefinitionManager = new GptDefinitionManager();
