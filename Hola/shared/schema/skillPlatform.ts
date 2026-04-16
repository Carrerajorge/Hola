/**
 * Skill Platform schema types.
 * Defines the scopes and types used by the skill execution platform.
 */

export type SkillScope =
  | "read"
  | "write"
  | "execute"
  | "admin"
  | "browse"
  | "search"
  | "email"
  | "calendar"
  | "files"
  | "code"
  | "shell"
  | "integrations"
  | "*";

export const ALL_SKILL_SCOPES: readonly SkillScope[] = [
  "read",
  "write",
  "execute",
  "admin",
  "browse",
  "search",
  "email",
  "calendar",
  "files",
  "code",
  "shell",
  "integrations",
  "*",
] as const;

export interface SkillDefinition {
  slug: string;
  name: string;
  description?: string;
  requiredScopes: SkillScope[];
  enabled: boolean;
}
