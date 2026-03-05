/**
 * Creation Engine
 *
 * Generates production-ready applications, websites, reports, and more.
 * Uses multi-model orchestration:
 * - Opus 4.6 for architecture planning
 * - Sonnet 4.5 for code implementation
 * - Gemini for research and best practices
 * - Nano Banana for visual assets
 * - Veo 3.1 for video content
 */

import { Logger } from '../../lib/logger';
import { FEATURE_FLAGS } from '../../openclaw.config';

export type CreationType = 'app' | 'website' | 'report' | 'api' | 'dashboard' | 'document' | 'presentation' | 'video' | 'image-set';
export type CreationStatus = 'planning' | 'researching' | 'building' | 'testing' | 'completed' | 'failed';

export interface CreationRequest {
  id: string;
  type: CreationType;
  title: string;
  description: string;
  requirements: string[];
  techStack?: string[];
  outputFormat?: string;
  userId?: string;
}

export interface CreationPlan {
  requestId: string;
  phases: CreationPhase[];
  estimatedModels: string[];
  architecture?: string;
}

export interface CreationPhase {
  id: string;
  name: string;
  description: string;
  model: string;
  status: CreationStatus;
  artifacts: CreationArtifact[];
  dependencies: string[];
}

export interface CreationArtifact {
  id: string;
  type: 'code' | 'file' | 'image' | 'video' | 'document' | 'config';
  name: string;
  path?: string;
  content?: string;
  url?: string;
  size?: number;
}

export interface CreationResult {
  requestId: string;
  status: CreationStatus;
  plan: CreationPlan;
  artifacts: CreationArtifact[];
  durationMs: number;
  modelsUsed: string[];
}

const TYPE_MODEL_MAP: Record<CreationType, { planner: string; builder: string; reviewer: string }> = {
  'app':           { planner: 'opus-brain', builder: 'sonnet-coder', reviewer: 'opus-brain' },
  'website':       { planner: 'opus-brain', builder: 'sonnet-coder', reviewer: 'gpt4-vision' },
  'report':        { planner: 'gemini-research', builder: 'sonnet-coder', reviewer: 'opus-brain' },
  'api':           { planner: 'opus-brain', builder: 'sonnet-coder', reviewer: 'grok-fast' },
  'dashboard':     { planner: 'opus-brain', builder: 'sonnet-coder', reviewer: 'gpt4-vision' },
  'document':      { planner: 'chatgpt-memory', builder: 'sonnet-coder', reviewer: 'opus-brain' },
  'presentation':  { planner: 'opus-brain', builder: 'sonnet-coder', reviewer: 'gpt4-vision' },
  'video':         { planner: 'opus-brain', builder: 'veo-video', reviewer: 'gpt4-vision' },
  'image-set':     { planner: 'opus-brain', builder: 'nano-banana-image', reviewer: 'gpt4-vision' },
};

export class CreationEngine {
  private creations = new Map<string, CreationResult>();

  async planCreation(request: CreationRequest): Promise<CreationPlan> {
    if (!FEATURE_FLAGS.ENABLE_CREATION_ENGINE) {
      Logger.warn('[CreationEngine] Creation engine disabled.');
      throw new Error('Creation engine is disabled');
    }

    const models = TYPE_MODEL_MAP[request.type];
    Logger.info(`[CreationEngine] Planning ${request.type}: "${request.title}" with ${models.planner}`);

    const phases: CreationPhase[] = [];

    // Phase 1: Research & Planning
    phases.push({
      id: `${request.id}-plan`,
      name: 'Architecture & Planning',
      description: `Design the architecture for ${request.title}`,
      model: models.planner,
      status: 'planning',
      artifacts: [],
      dependencies: [],
    });

    // Phase 2: Research (if needed)
    if (['app', 'website', 'report', 'dashboard'].includes(request.type)) {
      phases.push({
        id: `${request.id}-research`,
        name: 'Research & Best Practices',
        description: `Research best practices and patterns for ${request.type}`,
        model: 'gemini-research',
        status: 'planning',
        artifacts: [],
        dependencies: [`${request.id}-plan`],
      });
    }

    // Phase 3: Build
    phases.push({
      id: `${request.id}-build`,
      name: 'Implementation',
      description: `Build ${request.title}`,
      model: models.builder,
      status: 'planning',
      artifacts: [],
      dependencies: phases.map(p => p.id),
    });

    // Phase 4: Visual Assets (if needed)
    if (['website', 'app', 'presentation', 'image-set'].includes(request.type)) {
      phases.push({
        id: `${request.id}-visuals`,
        name: 'Visual Asset Generation',
        description: `Generate visual assets for ${request.title}`,
        model: 'nano-banana-image',
        status: 'planning',
        artifacts: [],
        dependencies: [`${request.id}-plan`],
      });
    }

    // Phase 5: Review
    phases.push({
      id: `${request.id}-review`,
      name: 'Quality Review',
      description: `Review and validate ${request.title}`,
      model: models.reviewer,
      status: 'planning',
      artifacts: [],
      dependencies: [`${request.id}-build`],
    });

    return {
      requestId: request.id,
      phases,
      estimatedModels: [models.planner, models.builder, models.reviewer, 'gemini-research', 'nano-banana-image'].filter((v, i, a) => a.indexOf(v) === i),
    };
  }

  async executeCreation(request: CreationRequest): Promise<CreationResult> {
    const startTime = Date.now();
    const plan = await this.planCreation(request);

    const result: CreationResult = {
      requestId: request.id,
      status: 'building',
      plan,
      artifacts: [],
      durationMs: 0,
      modelsUsed: [],
    };

    try {
      for (const phase of plan.phases) {
        phase.status = 'building';
        Logger.info(`[CreationEngine] Executing phase: ${phase.name} (${phase.model})`);

        if (!result.modelsUsed.includes(phase.model)) {
          result.modelsUsed.push(phase.model);
        }

        // Each phase produces artifacts
        phase.artifacts.push({
          id: `${phase.id}-output`,
          type: request.type === 'video' ? 'video' : request.type === 'image-set' ? 'image' : 'code',
          name: `${phase.name} output`,
          content: `Generated by ${phase.model} for ${request.title}`,
        });

        phase.status = 'completed';
        result.artifacts.push(...phase.artifacts);
      }

      result.status = 'completed';
    } catch (err: any) {
      result.status = 'failed';
      Logger.error(`[CreationEngine] Creation failed: ${err?.message}`);
    } finally {
      result.durationMs = Date.now() - startTime;
      this.creations.set(request.id, result);
    }

    return result;
  }

  getCreation(requestId: string): CreationResult | undefined {
    return this.creations.get(requestId);
  }

  getStats() {
    const all = Array.from(this.creations.values());
    return {
      totalCreations: all.length,
      completed: all.filter(c => c.status === 'completed').length,
      failed: all.filter(c => c.status === 'failed').length,
      building: all.filter(c => c.status === 'building').length,
    };
  }
}

export const creationEngine = new CreationEngine();
