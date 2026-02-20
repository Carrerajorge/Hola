import { BUNDLED_SKILLS } from "../data/bundledSkills";

type RuntimeSkill = {
  id: string;
  name: string;
  description?: string;
  enabled?: boolean;
  status: "available" | "disabled" | "unknown";
};

export interface OpenClawSkillsRuntimeSnapshot {
  runtimeAvailable: boolean;
  source: "remote_runtime" | "fallback" | "bundled";
  fallback: boolean;
  fetchedAt: string;
  skills: RuntimeSkill[];
  message?: string;
}

export async function getOpenClawSkillsRuntimeSnapshot(): Promise<OpenClawSkillsRuntimeSnapshot> {
  const skills: RuntimeSkill[] = BUNDLED_SKILLS.map(skill => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    enabled: true,
    status: "available"
  }));

  return {
    runtimeAvailable: true,
    source: "bundled",
    fallback: false,
    fetchedAt: new Date().toISOString(),
    skills,
  };
}
