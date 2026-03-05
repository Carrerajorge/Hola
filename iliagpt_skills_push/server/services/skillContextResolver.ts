import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { customSkills } from "@shared/schema";

export interface SkillContext {
  source: "custom_skill" | "client";
  id?: string;
  name: string;
  instructions: string;
}

export interface SkillStore {
  getSkillForUser: (
    userId: string,
    skillId: string
  ) => Promise<{
    id: string;
    name: string | null;
    instructions: string | null;
    enabled: boolean | null;
  } | null>;
  trackSkillUsed?: (userId: string, skillId: string, now: Date) => Promise<void>;
}

function clampText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (trimmed.length <= maxLen) return trimmed;
  return trimmed.slice(0, maxLen);
}

export const drizzleSkillStore: SkillStore = {
  async getSkillForUser(userId: string, skillId: string) {
    const rows = await db
      .select({
        id: customSkills.id,
        name: customSkills.name,
        instructions: customSkills.instructions,
        enabled: customSkills.enabled,
      })
      .from(customSkills)
      .where(and(eq(customSkills.id, skillId), eq(customSkills.userId, userId)))
      .limit(1);

    return rows[0] || null;
  },
  async trackSkillUsed(userId: string, skillId: string, now: Date) {
    await db
      .update(customSkills)
      .set({
        usageCount: sql<number>`coalesce(${customSkills.usageCount}, 0) + 1`,
        lastUsedAt: now,
      })
      .where(and(eq(customSkills.id, skillId), eq(customSkills.userId, userId)));
  },
};

/**
 * Resolve skill context for a chat request.
 * Preference order:
 * 1) skillId (server-trusted, persisted skill owned by user)
 * 2) skill object (legacy client-provided; sanitized + bounded)
 */
export async function resolveSkillContextFromRequest(
  store: SkillStore,
  params: { userId: string; skillId?: unknown; skill?: unknown; now?: Date }
): Promise<SkillContext | null> {
  const now = params.now || new Date();
  const skillId = clampText(params.skillId, 64);

  if (skillId) {
    try {
      const row = await store.getSkillForUser(params.userId, skillId);
      const enabled = row?.enabled !== false;
      const instructions = clampText(row?.instructions ?? "", 8000);

      if (row && enabled && instructions) {
        // Fire-and-forget: do not add latency to the chat request.
        if (store.trackSkillUsed) {
          void store.trackSkillUsed(params.userId, skillId, now).catch((e: any) => {
            console.warn("[SkillContext] Failed to track usage:", e?.message || e);
          });
        }

        return {
          source: "custom_skill",
          id: row.id,
          name: clampText(row.name ?? "", 64) || "Skill personalizado",
          instructions,
        };
      }
    } catch (e: any) {
      // DB issues should not break chat; just ignore the skill.
      console.warn("[SkillContext] Failed to resolve skillId:", e?.message || e);
    }
  }

  if (params.skill && typeof params.skill === "object") {
    const name = clampText((params.skill as any).name, 64) || "Skill personalizado";
    const instructions = clampText((params.skill as any).instructions, 8000);
    if (instructions) {
      return { source: "client", name, instructions };
    }
  }

  return null;
}

