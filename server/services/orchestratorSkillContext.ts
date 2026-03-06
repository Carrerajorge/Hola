import { desc, eq } from "drizzle-orm";
import { db } from "../db";
import { customSkills, users } from "@shared/schema";
import {
  buildPlannerSkillContext,
  type PlannerSkillContext,
  type SkillCatalogCategory,
  type SkillOperationalInput,
} from "@shared/skills/skillOperationalCatalog";

export interface ActiveSkillPreference {
  activeSkillId: string | null;
  activeSkillRef: SkillOperationalInput | null;
}

export interface ResolvedOrchestratorSkillContext extends ActiveSkillPreference {
  availableSkills: SkillOperationalInput[];
  skillContext: PlannerSkillContext | null;
}

function clampText(raw: unknown, maxLen: number): string {
  if (typeof raw !== "string") return "";
  const trimmed = raw.trim();
  if (!trimmed) return "";
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function normalizeCategory(raw: unknown): SkillCatalogCategory {
  switch (raw) {
    case "documents":
    case "data":
    case "integrations":
    case "automation":
      return raw;
    default:
      return "custom";
  }
}

function sanitizeStringArray(raw: unknown, maxItems: number, maxLen: number): string[] {
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const value = clampText(
      typeof item === "string"
        ? item
        : item && typeof item === "object"
          ? (item as any).value
          : "",
      maxLen,
    );
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    out.push(value);
    if (out.length >= maxItems) break;
  }

  return out;
}

export function sanitizeActiveSkillRef(raw: unknown): SkillOperationalInput | null {
  if (!raw || typeof raw !== "object") return null;

  const id = clampText((raw as any).id, 64);
  const name = clampText((raw as any).name, 120);
  if (!id || !name) return null;

  return {
    id,
    name,
    description: clampText((raw as any).description, 500),
    category: normalizeCategory((raw as any).category),
    features: sanitizeStringArray((raw as any).features, 20, 120),
    triggers: sanitizeStringArray((raw as any).triggers, 20, 60),
    builtIn: Boolean((raw as any).builtIn),
    enabled: (raw as any).enabled !== false,
    instructions: clampText((raw as any).instructions, 8000),
    runtimeTools: sanitizeStringArray((raw as any).runtimeTools, 12, 80),
  };
}

async function getPreferenceRow(userId: string): Promise<Record<string, any>> {
  const rows = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return rows[0]?.preferences && typeof rows[0].preferences === "object"
    ? (rows[0].preferences as Record<string, any>)
    : {};
}

export async function getActiveSkillPreferenceForUser(userId: string): Promise<ActiveSkillPreference> {
  const prefs = await getPreferenceRow(userId);
  const nested = prefs?.skills && typeof prefs.skills === "object"
    ? prefs.skills as Record<string, any>
    : {};
  const activeSkillId = clampText(nested.activeSkillId ?? prefs.activeSkillId, 64) || null;
  const activeSkillRef = sanitizeActiveSkillRef(nested.activeSkillRef ?? null);

  return {
    activeSkillId,
    activeSkillRef: activeSkillRef && activeSkillId && activeSkillRef.id === activeSkillId
      ? activeSkillRef
      : activeSkillRef && !activeSkillId
        ? activeSkillRef
        : activeSkillRef && activeSkillId
          ? { ...activeSkillRef, id: activeSkillId }
          : null,
  };
}

async function listEnabledCustomSkills(userId: string): Promise<SkillOperationalInput[]> {
  const rows = await db
    .select({
      id: customSkills.id,
      name: customSkills.name,
      description: customSkills.description,
      instructions: customSkills.instructions,
      category: customSkills.category,
      enabled: customSkills.enabled,
      features: customSkills.features,
      triggers: customSkills.triggers,
    })
    .from(customSkills)
    .where(eq(customSkills.userId, userId))
    .orderBy(desc(customSkills.lastUsedAt), desc(customSkills.updatedAt), desc(customSkills.createdAt));

  return rows
    .filter((row) => row.enabled !== false)
    .map((row) => ({
      id: clampText(row.id, 64),
      name: clampText(row.name, 120) || "Skill personalizada",
      description: clampText(row.description, 500),
      category: normalizeCategory(row.category),
      features: sanitizeStringArray(row.features, 20, 120),
      triggers: sanitizeStringArray(row.triggers, 20, 60),
      builtIn: false,
      enabled: row.enabled !== false,
      instructions: clampText(row.instructions, 8000),
    }))
    .filter((row) => row.id && row.name);
}

function mergeActiveSkill(
  activeSkillRef: SkillOperationalInput | null,
  availableSkills: SkillOperationalInput[],
): SkillOperationalInput[] {
  if (!activeSkillRef) return availableSkills;
  if (availableSkills.some((skill) => skill.id === activeSkillRef.id)) {
    return availableSkills.map((skill) => (skill.id === activeSkillRef.id ? { ...skill, ...activeSkillRef } : skill));
  }
  return [activeSkillRef, ...availableSkills];
}

export async function resolveOrchestratorSkillContextForUser(
  params: { userId: string; objective: string },
): Promise<ResolvedOrchestratorSkillContext> {
  const { activeSkillId, activeSkillRef } = await getActiveSkillPreferenceForUser(params.userId);
  const customSkillInputs = await listEnabledCustomSkills(params.userId);
  const availableSkills = mergeActiveSkill(activeSkillRef, customSkillInputs);

  if (availableSkills.length === 0 && !activeSkillRef) {
    return {
      activeSkillId,
      activeSkillRef,
      availableSkills: [],
      skillContext: null,
    };
  }

  return {
    activeSkillId,
    activeSkillRef,
    availableSkills,
    skillContext: buildPlannerSkillContext(params.objective, availableSkills, { activeSkillId }),
  };
}
