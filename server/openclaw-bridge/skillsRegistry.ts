/**
 * ILIAGPT × OpenClaw Fusion — Skills Registry
 * 
 * Dynamic skill loading system that merges ILIAGPT's existing capabilities
 * with OpenClaw's extensible skill framework. Skills are categorized, versioned,
 * and can be loaded/unloaded at runtime.
 * 
 * @version 2.2.0-fusion
 * @license MIT
 */

import { orchestrator, OrchestratorTask } from '../agent/multiModelOrchestrator';
import { log } from '../vite';

/* ──────────────────────────────────────────────────
   Skill Type Definitions
   ────────────────────────────────────────────────── */

export interface Skill {
  id: string;
  name: string;
  description: string;
  version: string;
  category: SkillCategory;
  enabled: boolean;
  preferredModel?: string;
  systemPrompt?: string;
  inputSchema?: Record<string, unknown>;
  handler: SkillHandler;
}

export type SkillCategory =
  | 'research'
  | 'coding'
  | 'analysis'
  | 'creative'
  | 'productivity'
  | 'data'
  | 'communication'
  | 'custom';

export interface SkillInput {
  message: string;
  context?: string;
  metadata?: Record<string, unknown>;
}

export interface SkillOutput {
  output: string;
  costUSD: number;
  latencyMs: number;
  metadata?: Record<string, unknown>;
}

export type SkillHandler = (input: SkillInput, task: Partial<OrchestratorTask>) => Promise<SkillOutput>;

/* ──────────────────────────────────────────────────
   Built-in Skills
   ────────────────────────────────────────────────── */

const BUILTIN_SKILLS: Omit<Skill, 'handler'>[] = [
  {
    id: 'deep-research',
    name: 'Deep Research',
    description: 'Comprehensive research using Gemini 2.5 Pro with extended context',
    version: '1.0.0',
    category: 'research',
    enabled: true,
    preferredModel: 'gemini-research',
    systemPrompt: 'You are a world-class researcher. Provide comprehensive, well-sourced analysis with specific details, examples, and insights. Structure your response clearly with sections and bullet points where appropriate.',
  },
  {
    id: 'code-architect',
    name: 'Code Architect',
    description: 'Full-stack code generation using Claude Sonnet with 6-stage pipeline',
    version: '1.0.0',
    category: 'coding',
    enabled: true,
    preferredModel: 'sonnet-coder',
    systemPrompt: 'You are an expert software architect. Write clean, well-documented, production-ready code. Follow best practices, include error handling, and add helpful comments. Consider performance and security implications.',
  },
  {
    id: 'strategic-analyst',
    name: 'Strategic Analyst',
    description: 'Deep strategic analysis using Claude Opus for complex reasoning',
    version: '1.0.0',
    category: 'analysis',
    enabled: true,
    preferredModel: 'opus-brain',
    systemPrompt: 'You are a strategic advisor with expertise in business, technology, and systems thinking. Provide deep analysis, identify patterns, and offer actionable recommendations backed by reasoning.',
  },
  {
    id: 'creative-writer',
    name: 'Creative Writer',
    description: 'Creative content generation with Grok for unique perspectives',
    version: '1.0.0',
    category: 'creative',
    enabled: true,
    preferredModel: 'grok-vision',
    systemPrompt: 'You are a highly creative writer. Generate engaging, original content that captivates the reader. Use vivid language, unique perspectives, and compelling narratives.',
  },
  {
    id: 'quick-responder',
    name: 'Quick Responder',
    description: 'Fast, concise responses using GPT-4o Mini for efficiency',
    version: '1.0.0',
    category: 'productivity',
    enabled: true,
    preferredModel: 'gpt4-mini',
    systemPrompt: 'You are a highly efficient assistant. Provide concise, accurate responses. Get to the point quickly without sacrificing accuracy.',
  },
  {
    id: 'data-analyst',
    name: 'Data Analyst',
    description: 'Data analysis, visualization suggestions, and statistical insights',
    version: '1.0.0',
    category: 'data',
    enabled: true,
    preferredModel: 'opus-brain',
    systemPrompt: 'You are an expert data analyst. Analyze data thoroughly, identify patterns and anomalies, suggest appropriate visualizations, and provide statistical insights. Be precise with numbers and methodology.',
  },
  {
    id: 'vision-analyst',
    name: 'Vision Analyst',
    description: 'Image and visual content analysis using GPT-4o Vision',
    version: '1.0.0',
    category: 'analysis',
    enabled: true,
    preferredModel: 'gpt4-vision',
    systemPrompt: 'You are an expert visual analyst. Examine images thoroughly, identify all relevant details, text, objects, patterns, and context. Provide comprehensive descriptions and insights.',
  },
  {
    id: 'fusion-orchestrator',
    name: 'Fusion Orchestrator',
    description: 'Multi-model orchestration for complex tasks requiring multiple AI models',
    version: '1.0.0',
    category: 'custom',
    enabled: true,
    systemPrompt: 'You are coordinating a complex multi-step task across multiple AI models. Synthesize all inputs into a coherent, high-quality response.',
  },
];

/* ──────────────────────────────────────────────────
   Skills Registry Class
   ────────────────────────────────────────────────── */

export class SkillsRegistry {
  private skills: Map<string, Skill> = new Map();

  constructor() {
    this.loadBuiltinSkills();
    log(`SkillsRegistry initialized with ${this.skills.size} skills`, 'skills');
  }

  /* ────────────────────────────────────────────────
     Skill Management
     ──────────────────────────────────────────────── */

  private loadBuiltinSkills(): void {
    for (const skillDef of BUILTIN_SKILLS) {
      const skill: Skill = {
        ...skillDef,
        handler: this.createDefaultHandler(skillDef),
      };
      this.skills.set(skill.id, skill);
    }
  }

  registerSkill(skill: Skill): void {
    if (this.skills.has(skill.id)) {
      log(`Skill ${skill.id} already registered, overwriting`, 'skills');
    }
    this.skills.set(skill.id, skill);
    log(`Registered skill: ${skill.id} (${skill.name})`, 'skills');
  }

  unregisterSkill(skillId: string): boolean {
    const deleted = this.skills.delete(skillId);
    if (deleted) {
      log(`Unregistered skill: ${skillId}`, 'skills');
    }
    return deleted;
  }

  enableSkill(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.enabled = true;
      log(`Enabled skill: ${skillId}`, 'skills');
    }
  }

  disableSkill(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) {
      skill.enabled = false;
      log(`Disabled skill: ${skillId}`, 'skills');
    }
  }

  /* ────────────────────────────────────────────────
     Skill Retrieval
     ──────────────────────────────────────────────── */

  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  listSkills(category?: SkillCategory): Skill[] {
    const all = Array.from(this.skills.values());
    if (category) {
      return all.filter(s => s.category === category);
    }
    return all;
  }

  listEnabledSkills(category?: SkillCategory): Skill[] {
    return this.listSkills(category).filter(s => s.enabled);
  }

  /* ────────────────────────────────────────────────
     Skill Execution
     ──────────────────────────────────────────────── */

  async executeSkill(skillId: string, input: SkillInput): Promise<SkillOutput> {
    const skill = this.skills.get(skillId);

    if (!skill) {
      throw new Error(`Skill not found: ${skillId}`);
    }

    if (!skill.enabled) {
      throw new Error(`Skill is disabled: ${skillId}`);
    }

    log(`Executing skill: ${skillId}`, 'skills');

    const task: Partial<OrchestratorTask> = {
      type: this.mapCategoryToTaskType(skill.category),
      preferredModel: skill.preferredModel,
      context: skill.systemPrompt || input.context,
    };

    return skill.handler(input, task);
  }

  /* ────────────────────────────────────────────────
     Helper Methods
     ──────────────────────────────────────────────── */

  private createDefaultHandler(skillDef: Omit<Skill, 'handler'>): SkillHandler {
    return async (input: SkillInput, task: Partial<OrchestratorTask>): Promise<SkillOutput> => {
      const startTime = Date.now();

      const result = await orchestrator.executeTask({
        id: `skill-${skillDef.id}-${Date.now()}`,
        type: task.type || 'chat',
        prompt: input.message,
        context: task.context || input.context,
        preferredModel: skillDef.preferredModel,
        metadata: input.metadata,
      });

      return {
        output: result.content,
        costUSD: result.costUSD,
        latencyMs: Date.now() - startTime,
        metadata: {
          modelUsed: result.modelUsed,
          tokensUsed: result.tokensUsed,
          pipelineResults: result.pipelineResults,
        },
      };
    };
  }

  private mapCategoryToTaskType(category: SkillCategory): OrchestratorTask['type'] {
    const mapping: Record<SkillCategory, OrchestratorTask['type']> = {
      'research': 'research',
      'coding': 'code',
      'analysis': 'analysis',
      'creative': 'chat',
      'productivity': 'quick',
      'data': 'analysis',
      'communication': 'chat',
      'custom': 'chat',
    };
    return mapping[category] || 'chat';
  }

  getStats(): Record<string, unknown> {
    const byCategory: Record<string, number> = {};
    for (const skill of this.skills.values()) {
      byCategory[skill.category] = (byCategory[skill.category] || 0) + 1;
    }
    return {
      total: this.skills.size,
      enabled: this.listEnabledSkills().length,
      byCategory,
    };
  }
}

// Singleton instance
export const skillsRegistry = new SkillsRegistry();
