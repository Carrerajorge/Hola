/**
 * AI Model Orchestration System
 * Tasks 61-70: Model routing, fallback strategies, complexity analysis
 */

import { EventEmitter } from 'events';
import { Logger } from '../logger';
import { serviceRegistry } from '../serviceMesh';

// ============================================================================
// Types & Interfaces
// ============================================================================

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'mistral' | 'local';
export type ModelTier = 'ultra' | 'pro' | 'flash' | 'instant';

export interface ModelConfig {
    id: string;
    provider: ModelProvider;
    tier: ModelTier;
    contextWindow: number;
    costPerInputToken: number;
    costPerOutputToken: number;
    capabilities: {
        vision: boolean;
        functionCalling: boolean;
        jsonMode: boolean;
        streaming: boolean;
    };
    latencyScore: number; // ms per token approx
    reliabilityScore: number; // 0-1
}

export interface PromptRequest {
    taskId: string;
    messages: any[];
    requirements: {
        minContext?: number;
        maxCost?: number;
        maxLatency?: number;
        features?: ('vision' | 'functionCalling' | 'jsonMode')[];
        tier?: ModelTier;
    };
    metadata?: Record<string, any>;
}

export interface ModelResponse {
    content: string;
    modelUsed: string;
    tokenUsage: {
        prompt: number;
        completion: number;
        total: number;
    };
    cost: number;
    durationMs: number;
    cached: boolean;
}

// ============================================================================
// Task 61: Intelligent Model Router
// ============================================================================

class ModelRouter extends EventEmitter {
    private models: Map<string, ModelConfig> = new Map();

    constructor() {
        super();
        this.initializeModels();
    }

    private initializeModels() {
        // Current Generation SOTA
        this.registerModel({
            id: 'gpt-4o',
            provider: 'openai',
            tier: 'ultra',
            contextWindow: 128000,
            costPerInputToken: 5 / 1000000,
            costPerOutputToken: 15 / 1000000,
            capabilities: { vision: true, functionCalling: true, jsonMode: true, streaming: true },
            latencyScore: 25,
            reliabilityScore: 0.99
        });

        this.registerModel({
            id: 'claude-3-5-sonnet-20240620',
            provider: 'anthropic',
            tier: 'pro',
            contextWindow: 200000,
            costPerInputToken: 3 / 1000000,
            costPerOutputToken: 15 / 1000000,
            capabilities: { vision: true, functionCalling: true, jsonMode: true, streaming: true },
            latencyScore: 30,
            reliabilityScore: 0.99
        });

        this.registerModel({
            id: 'gemini-1.5-flash',
            provider: 'google',
            tier: 'flash',
            contextWindow: 1000000,
            costPerInputToken: 0.35 / 1000000,
            costPerOutputToken: 0.7 / 1000000,
            capabilities: { vision: true, functionCalling: true, jsonMode: true, streaming: true },
            latencyScore: 15,
            reliabilityScore: 0.98
        });
    }

    registerModel(config: ModelConfig) {
        this.models.set(config.id, config);
    }

    /**
     * Route a request to the best fitting model
     */
    selectModel(request: PromptRequest): ModelConfig {
        const candidates = Array.from(this.models.values())
            .filter(m => this.meetsRequirements(m, request.requirements));

        if (candidates.length === 0) {
            throw new Error('No models available meeting requirements');
        }

        // Task Complexity Analysis (Task 63)
        const complexity = this.analyzeComplexity(request.messages);

        // Selection Strategy:
        // 1. If specific tier requested, use best model in tier
        // 2. If high complexity, prioritize Ultra tier
        // 3. Otherwise, prioritize Cost/Speed (Flash tier)

        if (request.requirements.tier) {
            return this.selectBestInTier(candidates, request.requirements.tier);
        }

        if (complexity === 'high') {
            const ultraModels = candidates.filter(m => m.tier === 'ultra');
            return ultraModels.length > 0 ? ultraModels[0] : candidates[0];
        }

        // Default: Optimize for efficiency
        return candidates.sort((a, b) =>
            (a.costPerInputToken + a.costPerOutputToken) - (b.costPerInputToken + b.costPerOutputToken)
        )[0];
    }

    private meetsRequirements(model: ModelConfig, requirements: PromptRequest['requirements']): boolean {
        if (requirements.minContext && model.contextWindow < requirements.minContext) return false;
        if (requirements.features) {
            for (const feature of requirements.features) {
                if (!model.capabilities[feature]) return false;
            }
        }
        return true;
    }

    private analyzeComplexity(messages: any[]): 'low' | 'medium' | 'high' {
        const totalLength = JSON.stringify(messages).length;

        // Heuristic 1: Length
        if (totalLength > 10000) return 'high';

        // Heuristic 2: Keywords
        const text = messages.map(m => m.content).join(' ').toLowerCase();
        const complexKeywords = ['analyze', 'synthesize', 'compare', 'code', 'refactor', 'architect'];
        const hits = complexKeywords.filter(k => text.includes(k)).length;

        if (hits > 3) return 'high';
        if (hits > 0) return 'medium';

        return 'low';
    }

    private selectBestInTier(candidates: ModelConfig[], tier: ModelTier): ModelConfig {
        const inTier = candidates.filter(m => m.tier === tier);
        return inTier.length > 0 ? inTier[0] : candidates[0]; // Fallback if tier not exact matches
    }
}

export const modelRouter = new ModelRouter();

// ============================================================================
// Task 65: Fallback & Retry Strategy
// ============================================================================

export class AIModelService {
    /**
     * Execute model request with smart fallback
     */
    async generateCompletion(request: PromptRequest, retryCount = 0): Promise<ModelResponse> {
        const primaryModel = modelRouter.selectModel(request);

        try {
            return await this.callModelProvider(primaryModel, request);
        } catch (error: any) {
            Logger.warn(`[AI] Model ${primaryModel.id} failed: ${error.message}`);

            // Fallback Strategy
            if (retryCount < 2) {
                // Try fallback model
                const fallbackModel = this.getFallbackModel(primaryModel, request);
                if (fallbackModel) {
                    Logger.info(`[AI] Falling back to ${fallbackModel.id}`);
                    // Update request metadata to indicate fallback
                    return this.generateCompletionWithModel(fallbackModel, request, retryCount + 1);
                }
            }

            throw error;
        }
    }

    private async generateCompletionWithModel(model: ModelConfig, request: PromptRequest, attempt: number): Promise<ModelResponse> {
        try {
            return await this.callModelProvider(model, request);
        } catch (error) {
            if (attempt < 2) {
                // Simple linear backoff for same model retry
                await new Promise(r => setTimeout(r, 1000 * attempt));
                return this.generateCompletionWithModel(model, request, attempt + 1);
            }
            throw error;
        }
    }

    private getFallbackModel(failedModel: ModelConfig, request: PromptRequest): ModelConfig | null {
        // Logic: Same provider different model? OR Different provider same tier?
        // Implementation: Try different provider same tier first for redundancy
        const allModels = Array.from(modelRouter['models'].values());

        // 1. Try different provider, same tier
        const sameTier = allModels.filter(m =>
            m.tier === failedModel.tier &&
            m.provider !== failedModel.provider &&
            modelRouter['meetsRequirements'](m, request.requirements)
        );
        if (sameTier.length > 0) return sameTier[0];

        // 2. Try same provider, different model (e.g. gpt-4 -> gpt-3.5)
        // Avoid upgrading tier unless critical
        const lowerTier = allModels.filter(m =>
            m.provider === failedModel.provider &&
            m.id !== failedModel.id &&
            modelRouter['meetsRequirements'](m, request.requirements)
        );
        if (lowerTier.length > 0) return lowerTier[0];

        return null;
    }

    private async callModelProvider(model: ModelConfig, request: PromptRequest): Promise<ModelResponse> {
        const startTime = Date.now();
        Logger.info(`[AI] Calling ${model.provider}:${model.id} for task ${request.taskId}`);

        try {
            // Import dynamically to avoid circular deps
            const { openai } = await import('../openai');

            // Map request messages to OpenAI format
            const messages = request.messages.map(m => ({
                role: m.role as 'system' | 'user' | 'assistant',
                content: m.content
            }));

            // Force JSON mode if requested
            const response_format = request.requirements.jsonMode ? { type: "json_object" } : undefined;

            const completion = await openai.chat.completions.create({
                model: model.id, // e.g., 'gpt-4o' or 'grok-3-fast'
                messages,
                response_format: response_format as any,
                // stream: request.requirements.streaming // Handle streaming later
            });

            const choice = completion.choices[0];
            const content = choice.message.content || '';
            const usage = completion.usage || { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };

            Logger.info(`[AI] Success: ${usage.total_tokens} tokens used`);

            return {
                content,
                modelUsed: completion.model,
                tokenUsage: {
                    prompt: usage.prompt_tokens,
                    completion: usage.completion_tokens,
                    total: usage.total_tokens
                },
                cost: (usage.prompt_tokens * model.costPerInputToken) + (usage.completion_tokens * model.costPerOutputToken),
                durationMs: Date.now() - startTime,
                cached: false
            };

        } catch (error: any) {
            Logger.error(`[AI] Provider Call Failed: ${error.message}`);

            // If strictly local or API key missing, fall back to simulation
            if (error.message.includes('API key') || process.env.NODE_ENV === 'development') {
                Logger.warn('[AI] Falling back to simulation due to error/config');
                await new Promise(resolve => setTimeout(resolve, model.latencyScore * 10));
                return {
                    content: `[SIMULATION] Response to: ${request.messages[request.messages.length - 1].content.substring(0, 50)}...`,
                    modelUsed: 'simulation-' + model.id,
                    tokenUsage: { prompt: 50, completion: 20, total: 70 },
                    cost: 0,
                    durationMs: Date.now() - startTime,
                    cached: false
                };
            }

            throw error;
        }
    }
}

export const aiService = new AIModelService();
