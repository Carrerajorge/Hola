/**
 * ILIAGPT × OpenClaw Fusion — Multi-Model Orchestrator
 * 
 * Routes tasks to the optimal AI model based on task type, cost constraints,
 * and availability. Implements the OpenClaw 6-stage pipeline with intelligent
 * model selection and automatic fallback chains.
 * 
 * @version 2.2.0-fusion
 * @license MIT
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { MODEL_REGISTRY, PIPELINE_STAGES, ModelConfig, PipelineStageConfig } from '../openclaw.config';
import { storage } from '../storage';
// Use a local log helper (vite.ts doesn't export log at runtime)
function log(message: string, source?: string) {
  console.log(`[${source || 'orchestrator'}] ${message}`);
}

/* ──────────────────────────────────────────────────
   Type Definitions
   ────────────────────────────────────────────────── */

export interface OrchestratorTask {
  id: string;
  type: 'chat' | 'research' | 'code' | 'analysis' | 'vision' | 'quick';
  prompt: string;
  context?: string;
  images?: string[];          // base64 or URLs
  maxCost?: number;           // USD budget
  preferredModel?: string;    // override model selection
  sessionId?: number;
  userId?: number;
  metadata?: Record<string, unknown>;
}

export interface OrchestratorResult {
  taskId: string;
  modelUsed: string;
  stage: string;
  content: string;
  tokensUsed: { input: number; output: number };
  costUSD: number;
  latencyMs: number;
  pipelineResults?: PipelineStageResult[];
  error?: string;
}

export interface PipelineStageResult {
  stage: string;
  model: string;
  output: string;
  tokensUsed: { input: number; output: number };
  costUSD: number;
  latencyMs: number;
  success: boolean;
}

export interface ModelClients {
  anthropic: Anthropic;
  google: GoogleGenerativeAI;
  openai: OpenAI;
}

/* ──────────────────────────────────────────────────
   Multi-Model Orchestrator Class
   ────────────────────────────────────────────────── */

export class MultiModelOrchestrator {
  private clients: ModelClients;
  private costTracker: Map<string, number> = new Map();
  private requestCount: Map<string, number> = new Map();

  constructor() {
    this.clients = {
      anthropic: new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      }),
      google: new GoogleGenerativeAI(
        process.env.GOOGLE_AI_API_KEY || ''
      ),
      openai: new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      }),
    };

    log('MultiModelOrchestrator initialized with providers: anthropic, google, openai', 'orchestrator');
  }

  /* ────────────────────────────────────────────────
     Public API
     ──────────────────────────────────────────────── */

  async executeTask(task: OrchestratorTask): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const taskId = task.id || `task-${Date.now()}`;

    try {
      // Select the optimal model for this task
      const modelConfig = this.selectModel(task);
      log(`Task ${taskId}: routing to model ${modelConfig.id} (${modelConfig.model})`, 'orchestrator');

      // Execute based on task type
      let result: OrchestratorResult;

      if (task.type === 'code') {
        result = await this.runFullPipeline(task, taskId);
      } else {
        result = await this.executeSingleModel(task, modelConfig, taskId);
      }

      // Track cost
      this.trackCost(modelConfig.id, result.costUSD);

      return result;
    } catch (error) {
      log(`Task ${taskId} failed: ${error}`, 'orchestrator');
      throw error;
    }
  }

  async streamTask(
    task: OrchestratorTask,
    onChunk: (chunk: string) => void,
    onComplete: (result: OrchestratorResult) => void
  ): Promise<void> {
    const startTime = Date.now();
    const taskId = task.id || `task-${Date.now()}`;
    const modelConfig = this.selectModel(task);

    log(`Streaming task ${taskId} with ${modelConfig.id}`, 'orchestrator');

    try {
      let fullContent = '';
      let inputTokens = 0;
      let outputTokens = 0;

      if (modelConfig.provider === 'anthropic') {
        const stream = this.clients.anthropic.messages.stream({
          model: modelConfig.model,
          max_tokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
          messages: [{ role: 'user', content: task.prompt }],
          system: task.context,
        });

        for await (const event of stream) {
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            onChunk(event.delta.text);
            fullContent += event.delta.text;
          }
        }

        const finalMessage = await stream.finalMessage();
        inputTokens = finalMessage.usage.input_tokens;
        outputTokens = finalMessage.usage.output_tokens;

      } else if (modelConfig.provider === 'openai') {
        const stream = await this.clients.openai.chat.completions.create({
          model: modelConfig.model,
          max_tokens: modelConfig.maxTokens,
          temperature: modelConfig.temperature,
          messages: [
            ...(task.context ? [{ role: 'system' as const, content: task.context }] : []),
            { role: 'user' as const, content: task.prompt },
          ],
          stream: true,
        });

        for await (const chunk of stream) {
          const delta = chunk.choices[0]?.delta?.content || '';
          if (delta) {
            onChunk(delta);
            fullContent += delta;
          }
        }

        // Estimate tokens for streaming (OpenAI doesn't provide in stream)
        inputTokens = Math.ceil(task.prompt.length / 4);
        outputTokens = Math.ceil(fullContent.length / 4);
      }

      const costUSD = this.calculateCost(modelConfig, inputTokens, outputTokens);
      const latencyMs = Date.now() - startTime;

      onComplete({
        taskId,
        modelUsed: modelConfig.id,
        stage: 'direct',
        content: fullContent,
        tokensUsed: { input: inputTokens, output: outputTokens },
        costUSD,
        latencyMs,
      });

      this.trackCost(modelConfig.id, costUSD);
    } catch (error) {
      // Attempt fallback
      if (modelConfig.fallbackTo) {
        log(`Streaming fallback to ${modelConfig.fallbackTo}`, 'orchestrator');
        const fallbackConfig = MODEL_REGISTRY[modelConfig.fallbackTo];
        if (fallbackConfig) {
          await this.streamTask(
            { ...task, preferredModel: modelConfig.fallbackTo },
            onChunk,
            onComplete
          );
          return;
        }
      }
      throw error;
    }
  }

  /* ────────────────────────────────────────────────
     Model Selection Logic
     ──────────────────────────────────────────────── */

  private selectModel(task: OrchestratorTask): ModelConfig {
    // Explicit override
    if (task.preferredModel && MODEL_REGISTRY[task.preferredModel]) {
      return MODEL_REGISTRY[task.preferredModel];
    }

    // Task-type routing
    const typeToModel: Record<OrchestratorTask['type'], string> = {
      'chat': 'opus-brain',
      'research': 'gemini-research',
      'code': 'sonnet-coder',
      'analysis': 'opus-brain',
      'vision': task.images?.length ? 'gpt4-vision' : 'gpt4-mini',
      'quick': 'gpt4-mini',
    };

    const preferredId = typeToModel[task.type];
    const preferred = MODEL_REGISTRY[preferredId];

    // Check cost constraints
    if (task.maxCost && preferred) {
      const estimatedCost = this.estimateCost(preferred, task.prompt);
      if (estimatedCost > task.maxCost) {
        // Fall back to cheaper model
        return MODEL_REGISTRY['gpt4-mini'];
      }
    }

    return preferred || MODEL_REGISTRY['gpt4-mini'];
  }

  /* ────────────────────────────────────────────────
     Single Model Execution
     ──────────────────────────────────────────────── */

  private async executeSingleModel(
    task: OrchestratorTask,
    modelConfig: ModelConfig,
    taskId: string
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();

    try {
      let content = '';
      let inputTokens = 0;
      let outputTokens = 0;

      switch (modelConfig.provider) {
        case 'anthropic':
          ({ content, inputTokens, outputTokens } = await this.callAnthropic(task, modelConfig));
          break;
        case 'google':
          ({ content, inputTokens, outputTokens } = await this.callGoogle(task, modelConfig));
          break;
        case 'openai':
          ({ content, inputTokens, outputTokens } = await this.callOpenAI(task, modelConfig));
          break;
        default:
          throw new Error(`Unsupported provider: ${modelConfig.provider}`);
      }

      const costUSD = this.calculateCost(modelConfig, inputTokens, outputTokens);

      return {
        taskId,
        modelUsed: modelConfig.id,
        stage: 'direct',
        content,
        tokensUsed: { input: inputTokens, output: outputTokens },
        costUSD,
        latencyMs: Date.now() - startTime,
      };
    } catch (error) {
      // Attempt fallback chain
      if (modelConfig.fallbackTo) {
        log(`Falling back from ${modelConfig.id} to ${modelConfig.fallbackTo}`, 'orchestrator');
        const fallbackConfig = MODEL_REGISTRY[modelConfig.fallbackTo];
        if (fallbackConfig) {
          return this.executeSingleModel(task, fallbackConfig, taskId);
        }
      }
      throw error;
    }
  }

  /* ────────────────────────────────────────────────
     Full 6-Stage Pipeline
     ──────────────────────────────────────────────── */

  private async runFullPipeline(
    task: OrchestratorTask,
    taskId: string
  ): Promise<OrchestratorResult> {
    const startTime = Date.now();
    const stageResults: PipelineStageResult[] = [];
    let accumulatedContext = task.context || '';

    for (const stageConfig of PIPELINE_STAGES) {
      const stageStart = Date.now();
      const modelConfig = MODEL_REGISTRY[stageConfig.model];

      if (!modelConfig) {
        log(`Pipeline stage ${stageConfig.name}: model ${stageConfig.model} not found, skipping`, 'orchestrator');
        continue;
      }

      try {
        log(`Pipeline stage: ${stageConfig.name} using ${modelConfig.id}`, 'orchestrator');

        const stagePrompt = this.buildStagePrompt(stageConfig.name, task, accumulatedContext);
        const stageTask = { ...task, prompt: stagePrompt, context: accumulatedContext };

        const { content, inputTokens, outputTokens } = await this.callModel(stageTask, modelConfig);
        const costUSD = this.calculateCost(modelConfig, inputTokens, outputTokens);

        const stageResult: PipelineStageResult = {
          stage: stageConfig.name,
          model: modelConfig.id,
          output: content,
          tokensUsed: { input: inputTokens, output: outputTokens },
          costUSD,
          latencyMs: Date.now() - stageStart,
          success: true,
        };

        stageResults.push(stageResult);
        accumulatedContext += `\n\n[${stageConfig.name}]: ${content}`;

      } catch (error) {
        log(`Pipeline stage ${stageConfig.name} failed: ${error}`, 'orchestrator');
        stageResults.push({
          stage: stageConfig.name,
          model: stageConfig.model,
          output: '',
          tokensUsed: { input: 0, output: 0 },
          costUSD: 0,
          latencyMs: Date.now() - stageStart,
          success: false,
        });
      }
    }

    // Final synthesis
    const finalStage = stageResults[stageResults.length - 1];
    const totalCost = stageResults.reduce((sum, s) => sum + s.costUSD, 0);
    const totalInput = stageResults.reduce((sum, s) => sum + s.tokensUsed.input, 0);
    const totalOutput = stageResults.reduce((sum, s) => sum + s.tokensUsed.output, 0);

    return {
      taskId,
      modelUsed: finalStage?.model || 'unknown',
      stage: 'pipeline',
      content: finalStage?.output || '',
      tokensUsed: { input: totalInput, output: totalOutput },
      costUSD: totalCost,
      latencyMs: Date.now() - startTime,
      pipelineResults: stageResults,
    };
  }

  /* ────────────────────────────────────────────────
     Provider-Specific Callers
     ──────────────────────────────────────────────── */

  private async callAnthropic(
    task: OrchestratorTask,
    config: ModelConfig
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const response = await this.clients.anthropic.messages.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      system: task.context,
      messages: [{ role: 'user', content: task.prompt }],
    });

    const content = response.content
      .filter(b => b.type === 'text')
      .map(b => (b as { type: 'text'; text: string }).text)
      .join('');

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }

  private async callGoogle(
    task: OrchestratorTask,
    config: ModelConfig
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const model = this.clients.google.getGenerativeModel({ model: config.model });
    const prompt = task.context ? `${task.context}\n\n${task.prompt}` : task.prompt;
    const result = await model.generateContent(prompt);
    const content = result.response.text();
    const usage = result.response.usageMetadata;

    return {
      content,
      inputTokens: usage?.promptTokenCount || 0,
      outputTokens: usage?.candidatesTokenCount || 0,
    };
  }

  private async callOpenAI(
    task: OrchestratorTask,
    config: ModelConfig
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      ...(task.context ? [{ role: 'system' as const, content: task.context }] : []),
      { role: 'user' as const, content: task.prompt },
    ];

    const response = await this.clients.openai.chat.completions.create({
      model: config.model,
      max_tokens: config.maxTokens,
      temperature: config.temperature,
      messages,
    });

    return {
      content: response.choices[0]?.message?.content || '',
      inputTokens: response.usage?.prompt_tokens || 0,
      outputTokens: response.usage?.completion_tokens || 0,
    };
  }

  private async callModel(
    task: OrchestratorTask,
    config: ModelConfig
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    switch (config.provider) {
      case 'anthropic': return this.callAnthropic(task, config);
      case 'google': return this.callGoogle(task, config);
      case 'openai': return this.callOpenAI(task, config);
      default: throw new Error(`Unsupported provider: ${config.provider}`);
    }
  }

  /* ────────────────────────────────────────────────
     Helper Methods
     ──────────────────────────────────────────────── */

  private buildStagePrompt(stage: string, task: OrchestratorTask, context: string): string {
    const stagePrompts: Record<string, string> = {
      'intent-analysis': `Analyze the following task and identify: 1) Primary intent, 2) Required capabilities, 3) Complexity level (1-5), 4) Suggested pipeline approach.\n\nTask: ${task.prompt}`,
      'context-retrieval': `Based on this task, retrieve and synthesize relevant context, examples, and background information that would help in completing it.\n\nTask: ${task.prompt}\nContext so far: ${context}`,
      'skill-selection': `Select the most appropriate skills and tools to complete this task. Consider: available APIs, code patterns, and best practices.\n\nTask: ${task.prompt}\nAnalysis: ${context}`,
      'execution': `Execute the following task using the selected skills and context. Produce a complete, working solution.\n\nTask: ${task.prompt}\nContext: ${context}`,
      'validation': `Review and validate the following solution for correctness, completeness, and quality. Identify any issues or improvements.\n\nOriginal Task: ${task.prompt}\nSolution: ${context}`,
      'synthesis': `Synthesize a final, polished response that addresses the original task. Incorporate all validation feedback.\n\nOriginal Task: ${task.prompt}\nFull Pipeline: ${context}`,
    };

    return stagePrompts[stage] || task.prompt;
  }

  private calculateCost(config: ModelConfig, inputTokens: number, outputTokens: number): number {
    const inputCost = (inputTokens / 1_000_000) * config.costPerMillionTokens.input;
    const outputCost = (outputTokens / 1_000_000) * config.costPerMillionTokens.output;
    return inputCost + outputCost;
  }

  private estimateCost(config: ModelConfig, prompt: string): number {
    const estimatedInputTokens = Math.ceil(prompt.length / 4);
    const estimatedOutputTokens = Math.ceil(estimatedInputTokens * 1.5);
    return this.calculateCost(config, estimatedInputTokens, estimatedOutputTokens);
  }

  private trackCost(modelId: string, cost: number): void {
    this.costTracker.set(modelId, (this.costTracker.get(modelId) || 0) + cost);
    this.requestCount.set(modelId, (this.requestCount.get(modelId) || 0) + 1);
  }

  getCostReport(): Record<string, { totalCost: number; requests: number }> {
    const report: Record<string, { totalCost: number; requests: number }> = {};
    for (const [modelId, cost] of this.costTracker.entries()) {
      report[modelId] = {
        totalCost: cost,
        requests: this.requestCount.get(modelId) || 0,
      };
    }
    return report;
  }
}

// Singleton instance
export const orchestrator = new MultiModelOrchestrator();
