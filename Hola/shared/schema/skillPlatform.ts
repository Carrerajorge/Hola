/**
 * Skill Platform Schema
 * Defines the types and schemas for the skill execution platform.
 */

export type SkillScope =
  | "storage.read"
  | "storage.write"
  | "browser"
  | "email"
  | "database"
  | "external_network"
  | "code_interpreter"
  | "files"
  | "system";

export interface SkillManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  scopes: SkillScope[];
  triggerPatterns?: string[];
  enabled: boolean;
}
