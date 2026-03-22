/**
 * OpenClaw Bridge Module
 * Re-exports OpenClaw components for use in the chat pipeline.
 * Provides graceful fallbacks when OpenClaw modules are not available.
 */

interface Skill {
  id: string;
  name: string;
  description?: string;
  prompt?: string;
  tools?: string[];
  source?: string;
}

interface SkillResolveResult {
  skills: Skill[];
  prompt: string;
  tools: string[];
}

interface SkillRegistryLike {
  list(): Skill[];
  resolve(skillIds?: string[]): SkillResolveResult;
  get(id: string): Skill | undefined;
}

const noopRegistry: SkillRegistryLike = {
  list: () => [],
  resolve: () => ({ skills: [], prompt: "", tools: [] }),
  get: () => undefined,
};

let _skillRegistry: SkillRegistryLike = noopRegistry;

// Lazy init: load on first access to avoid top-level require
let _initialized = false;

function getSkillRegistry(): SkillRegistryLike {
  if (!_initialized) {
    _initialized = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require("../../server/openclaw/skills/skillRegistry");
      _skillRegistry = mod.skillRegistry;
      console.log("[OpenClaw Bridge] Skill registry loaded successfully");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn("[OpenClaw Bridge] Skill registry not available, using no-op fallback:", msg);
    }
  }
  return _skillRegistry;
}

export const skillRegistry: SkillRegistryLike = {
  list: () => getSkillRegistry().list(),
  resolve: (ids?: string[]) => getSkillRegistry().resolve(ids),
  get: (id: string) => getSkillRegistry().get(id),
};
