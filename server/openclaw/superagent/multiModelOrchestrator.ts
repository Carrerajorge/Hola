/**
 * Multi-Model SuperAgent Orchestrator
 *
 * Routes tasks to the optimal AI model based on task type:
 * - Opus 4.6: Main brain, orchestration, complex reasoning
 * - Gemini 2.5 Pro: Deep research, long-context analysis
 * - Grok 3: Speed-critical responses, real-time data
 * - ChatGPT 5.2: Broad web search, long-term memory persistence
 * - Nano Banana: Image generation
 * - Veo 3.1: Video generation
 * - Sonnet 4.5: Code implementation
 * - GPT-4o Mini: Fast routing/classification
 */

import { MODEL_REGISTRY, type ModelConfig, FEATURE_FLAGS } from '../../openclaw.config';
import { Logger } from '../../lib/logger';

export type TaskType =
  | 'reasoning'
  | 'research'
  | 'coding'
  | 'speed'
  | 'web-search'
  | 'memory-recall'
  | 'image-generation'
  | 'video-generation'
  | 'vision-analysis'
  | 'classification'
  | 'orchestration'
  | 'app-building'
  | 'browser-automation'
  | 'tool-integration';

export interface TaskRequest {
  id: string;
  type: TaskType;
  prompt: string;
  context?: Record<string, unknown>;
  priority?: 'express' | 'standard' | 'bulk';
  parentTaskId?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskResult {
  taskId: string;
  modelUsed: string;
  result: unknown;
  tokensUsed: { input: number; output: number };
  costUsd: number;
  durationMs: number;
  subtasks?: TaskResult[];
}

interface ModelRouting {
  primary: string;
  fallback: string;
}

const TASK_MODEL_MAP: Record<TaskType, ModelRouting> = {
  'reasoning':          { primary: 'opus-brain',        fallback: 'sonnet-coder' },
  'research':           { primary: 'gemini-research',   fallback: 'chatgpt-memory' },
  'coding':             { primary: 'sonnet-coder',      fallback: 'opus-brain' },
  'speed':              { primary: 'grok-fast',         fallback: 'gpt4-mini' },
  'web-search':         { primary: 'chatgpt-memory',    fallback: 'gemini-research' },
  'memory-recall':      { primary: 'chatgpt-memory',    fallback: 'gemini-research' },
  'image-generation':   { primary: 'nano-banana-image', fallback: 'gpt4-vision' },
  'video-generation':   { primary: 'veo-video',         fallback: 'nano-banana-image' },
  'vision-analysis':    { primary: 'gpt4-vision',       fallback: 'grok-vision' },
  'classification':     { primary: 'gpt4-mini',         fallback: 'grok-fast' },
  'orchestration':      { primary: 'opus-brain',        fallback: 'sonnet-coder' },
  'app-building':       { primary: 'sonnet-coder',      fallback: 'opus-brain' },
  'browser-automation': { primary: 'gemini-research',   fallback: 'chatgpt-memory' },
  'tool-integration':   { primary: 'gpt4-mini',         fallback: 'grok-fast' },
};

export class MultiModelOrchestrator {
  private activeTaskCount = 0;
  private totalCostUsd = 0;
  private taskHistory: TaskResult[] = [];

  resolveModel(taskType: TaskType): ModelConfig {
    const routing = TASK_MODEL_MAP[taskType];
    const primary = MODEL_REGISTRY[routing.primary];
    if (primary) return primary;

    const fallback = MODEL_REGISTRY[routing.fallback];
    if (fallback) {
      Logger.warn(`[SuperAgent] Primary model ${routing.primary} unavailable, using fallback ${routing.fallback}`);
      return fallback;
    }

    Logger.warn(`[SuperAgent] No model found for ${taskType}, defaulting to opus-brain`);
    return MODEL_REGISTRY['opus-brain'];
  }

  classifyTask(prompt: string): TaskType {
    const lower = prompt.toLowerCase();

    if (/generar?\s*(imagen|image|foto|photo|logo|ilustraci|illustration)/i.test(lower)) return 'image-generation';
    if (/generar?\s*(video|animaci|clip|motion)/i.test(lower)) return 'video-generation';
    if (/(buscar|search|investigar|research|analizar?\s*web|browse)/i.test(lower)) return 'web-search';
    if (/(recordar|remember|histor(ial|y)|memoria|context\s*anterior)/i.test(lower)) return 'memory-recall';
    if (/(crea(r|te)\s*(app|aplicaci|website|sitio|report|informe))/i.test(lower)) return 'app-building';
    if (/(cod(e|ificar|igo)|programa(r|ción)|implementar?|debug|fix\s*bug)/i.test(lower)) return 'coding';
    if (/(rápido|quick|fast|resumen|summary|clasifica)/i.test(lower)) return 'speed';
    if (/(analizar?\s*(imagen|photo|screenshot|captura))/i.test(lower)) return 'vision-analysis';
    if (/(navegar|browser|automat(izar|e)|scrape|extract)/i.test(lower)) return 'browser-automation';
    if (/(conectar|integra(r|tion)|gmail|slack|notion|calendar)/i.test(lower)) return 'tool-integration';
    if (/(planificar|plan|estrategia|strategy|orquest)/i.test(lower)) return 'orchestration';
    if (/(investigar?|research|analizar?\s*(a\s*fondo|deep)|estudi)/i.test(lower)) return 'research';

    return 'reasoning';
  }

  async decomposeTask(task: TaskRequest): Promise<TaskRequest[]> {
    if (!FEATURE_FLAGS.ENABLE_MULTI_AGENT_COORDINATION) {
      return [task];
    }

    const subtasks: TaskRequest[] = [];
    const taskType = task.type;

    // Complex tasks that benefit from decomposition
    if (taskType === 'app-building') {
      subtasks.push(
        { ...task, id: `${task.id}-plan`, type: 'orchestration', prompt: `Plan the architecture for: ${task.prompt}` },
        { ...task, id: `${task.id}-research`, type: 'research', prompt: `Research best practices for: ${task.prompt}` },
        { ...task, id: `${task.id}-code`, type: 'coding', prompt: `Implement: ${task.prompt}` },
      );
    } else if (taskType === 'research') {
      subtasks.push(
        { ...task, id: `${task.id}-web`, type: 'web-search', prompt: `Search the web for: ${task.prompt}` },
        { ...task, id: `${task.id}-deep`, type: 'research', prompt: `Deep analysis of: ${task.prompt}` },
        { ...task, id: `${task.id}-memory`, type: 'memory-recall', prompt: `Recall related context for: ${task.prompt}` },
      );
    } else {
      subtasks.push(task);
    }

    return subtasks;
  }

  async executeTask(task: TaskRequest): Promise<TaskResult> {
    const startTime = Date.now();
    this.activeTaskCount++;

    try {
      const model = this.resolveModel(task.type);
      Logger.info(`[SuperAgent] Routing task ${task.id} (${task.type}) → ${model.id} (${model.model})`);

      // Simulated execution — the actual LLM call is handled by the agent executor
      const result: TaskResult = {
        taskId: task.id,
        modelUsed: model.id,
        result: {
          model: model.model,
          provider: model.provider,
          taskType: task.type,
          prompt: task.prompt,
          routed: true,
        },
        tokensUsed: { input: 0, output: 0 },
        costUsd: 0,
        durationMs: Date.now() - startTime,
      };

      this.taskHistory.push(result);
      return result;
    } finally {
      this.activeTaskCount--;
    }
  }

  async executeParallel(tasks: TaskRequest[]): Promise<TaskResult[]> {
    if (!FEATURE_FLAGS.ENABLE_PARALLEL_EXECUTION) {
      const results: TaskResult[] = [];
      for (const task of tasks) {
        results.push(await this.executeTask(task));
      }
      return results;
    }

    return Promise.all(tasks.map(t => this.executeTask(t)));
  }

  getStats() {
    return {
      activeTasks: this.activeTaskCount,
      totalCost: this.totalCostUsd,
      totalTasksExecuted: this.taskHistory.length,
      modelsAvailable: Object.keys(MODEL_REGISTRY).length,
      modelRegistry: Object.entries(MODEL_REGISTRY).map(([id, config]) => ({
        id,
        model: config.model,
        role: config.role,
        provider: config.provider,
      })),
    };
  }
}

export const multiModelOrchestrator = new MultiModelOrchestrator();
