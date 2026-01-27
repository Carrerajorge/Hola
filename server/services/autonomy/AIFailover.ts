/**
 * AI Provider Failover Service
 *
 * Automatic failover between AI providers when one fails.
 * Implements improvement #3 and intelligent model routing.
 */

import { EventEmitter } from "events";

// ============================================================================
// TYPES
// ============================================================================

export type AIProvider = "openai" | "anthropic" | "gemini" | "xai" | "deepseek";

export interface ProviderConfig {
    name: AIProvider;
    enabled: boolean;
    priority: number; // Lower = higher priority
    apiKey?: string;
    models: string[];
    maxRetries: number;
    timeout: number;
    costPerToken: { input: number; output: number };
    capabilities: string[];
    healthScore: number; // 0-100
    lastError?: Date;
    errorCount: number;
    successCount: number;
    avgResponseTime: number;
}

export interface FailoverResult {
    success: boolean;
    provider: AIProvider;
    model: string;
    attempts: number;
    totalTime: number;
    error?: string;
}

export interface ModelRequest {
    prompt: string;
    systemPrompt?: string;
    maxTokens?: number;
    temperature?: number;
    preferredProvider?: AIProvider;
    preferredModel?: string;
    capabilities?: string[]; // Required capabilities
    maxCost?: number;
    timeout?: number;
}

// ============================================================================
// AI FAILOVER SERVICE
// ============================================================================

export class AIFailoverService extends EventEmitter {
    private providers: Map<AIProvider, ProviderConfig> = new Map();
    private circuitBreakers: Map<AIProvider, CircuitBreaker> = new Map();
    private requestMetrics: RequestMetrics;

    constructor() {
        super();
        this.requestMetrics = new RequestMetrics();
        this.initializeProviders();
        console.log("[AIFailover] Service initialized");
    }

    // ========================================================================
    // INITIALIZATION
    // ========================================================================

    private initializeProviders(): void {
        // OpenAI
        this.registerProvider({
            name: "openai",
            enabled: !!process.env.OPENAI_API_KEY,
            priority: 1,
            apiKey: process.env.OPENAI_API_KEY,
            models: ["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo", "o1", "o1-mini"],
            maxRetries: 3,
            timeout: 60000,
            costPerToken: { input: 0.00001, output: 0.00003 },
            capabilities: ["chat", "code", "analysis", "creative", "vision", "function_calling"],
            healthScore: 100,
            errorCount: 0,
            successCount: 0,
            avgResponseTime: 0
        });

        // Anthropic
        this.registerProvider({
            name: "anthropic",
            enabled: !!process.env.ANTHROPIC_API_KEY,
            priority: 2,
            apiKey: process.env.ANTHROPIC_API_KEY,
            models: ["claude-3-5-sonnet-20241022", "claude-3-opus-20240229", "claude-3-haiku-20240307"],
            maxRetries: 3,
            timeout: 60000,
            costPerToken: { input: 0.000015, output: 0.000075 },
            capabilities: ["chat", "code", "analysis", "creative", "vision"],
            healthScore: 100,
            errorCount: 0,
            successCount: 0,
            avgResponseTime: 0
        });

        // Gemini
        this.registerProvider({
            name: "gemini",
            enabled: !!(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY),
            priority: 3,
            apiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY,
            models: ["gemini-2.0-flash-exp", "gemini-1.5-pro", "gemini-1.5-flash"],
            maxRetries: 3,
            timeout: 60000,
            costPerToken: { input: 0.000007, output: 0.000021 },
            capabilities: ["chat", "code", "analysis", "creative", "vision"],
            healthScore: 100,
            errorCount: 0,
            successCount: 0,
            avgResponseTime: 0
        });

        // xAI (Grok)
        this.registerProvider({
            name: "xai",
            enabled: !!(process.env.XAI_API_KEY || process.env.GROK_API_KEY),
            priority: 4,
            apiKey: process.env.XAI_API_KEY || process.env.GROK_API_KEY,
            models: ["grok-beta", "grok-2"],
            maxRetries: 3,
            timeout: 60000,
            costPerToken: { input: 0.00001, output: 0.00003 },
            capabilities: ["chat", "code", "analysis", "creative"],
            healthScore: 100,
            errorCount: 0,
            successCount: 0,
            avgResponseTime: 0
        });

        // DeepSeek
        this.registerProvider({
            name: "deepseek",
            enabled: !!process.env.DEEPSEEK_API_KEY,
            priority: 5,
            apiKey: process.env.DEEPSEEK_API_KEY,
            models: ["deepseek-chat", "deepseek-coder"],
            maxRetries: 3,
            timeout: 60000,
            costPerToken: { input: 0.000001, output: 0.000002 },
            capabilities: ["chat", "code", "analysis"],
            healthScore: 100,
            errorCount: 0,
            successCount: 0,
            avgResponseTime: 0
        });

        // Initialize circuit breakers
        for (const provider of this.providers.keys()) {
            this.circuitBreakers.set(provider, new CircuitBreaker(provider));
        }

        console.log(`[AIFailover] Registered ${this.providers.size} providers`);
    }

    private registerProvider(config: ProviderConfig): void {
        this.providers.set(config.name, config);
    }

    // ========================================================================
    // PROVIDER SELECTION
    // ========================================================================

    /**
     * Get the best available provider based on health, priority, and requirements
     */
    getAvailableProviders(requirements?: { capabilities?: string[] }): ProviderConfig[] {
        const available: ProviderConfig[] = [];

        for (const [name, config] of this.providers) {
            if (!config.enabled) continue;

            const breaker = this.circuitBreakers.get(name);
            if (breaker?.isOpen()) continue;

            // Check capabilities
            if (requirements?.capabilities) {
                const hasAll = requirements.capabilities.every(
                    cap => config.capabilities.includes(cap)
                );
                if (!hasAll) continue;
            }

            available.push(config);
        }

        // Sort by health score (desc) then priority (asc)
        return available.sort((a, b) => {
            if (b.healthScore !== a.healthScore) {
                return b.healthScore - a.healthScore;
            }
            return a.priority - b.priority;
        });
    }

    /**
     * Select the optimal provider and model for a request
     */
    selectProvider(request: ModelRequest): { provider: AIProvider; model: string } | null {
        // If preferred provider is specified and healthy, use it
        if (request.preferredProvider) {
            const config = this.providers.get(request.preferredProvider);
            const breaker = this.circuitBreakers.get(request.preferredProvider);

            if (config?.enabled && !breaker?.isOpen()) {
                const model = request.preferredModel && config.models.includes(request.preferredModel)
                    ? request.preferredModel
                    : config.models[0];

                return { provider: request.preferredProvider, model };
            }
        }

        // Get available providers
        const available = this.getAvailableProviders({
            capabilities: request.capabilities
        });

        if (available.length === 0) {
            console.warn("[AIFailover] No providers available!");
            return null;
        }

        // Select best provider
        const selected = available[0];

        // Select model (prefer the requested one if available)
        let model = selected.models[0];
        if (request.preferredModel && selected.models.includes(request.preferredModel)) {
            model = request.preferredModel;
        }

        return { provider: selected.name, model };
    }

    // ========================================================================
    // FAILOVER LOGIC
    // ========================================================================

    /**
     * Execute a request with automatic failover
     */
    async executeWithFailover<T>(
        request: ModelRequest,
        executor: (provider: AIProvider, model: string) => Promise<T>
    ): Promise<{ result: T; failoverInfo: FailoverResult }> {
        const startTime = Date.now();
        const attempts: Array<{ provider: AIProvider; error: string }> = [];

        // Get all available providers in order
        const available = this.getAvailableProviders({
            capabilities: request.capabilities
        });

        // Try preferred provider first if specified
        if (request.preferredProvider) {
            const preferred = this.providers.get(request.preferredProvider);
            if (preferred && !this.circuitBreakers.get(request.preferredProvider)?.isOpen()) {
                const idx = available.findIndex(p => p.name === request.preferredProvider);
                if (idx > 0) {
                    available.splice(idx, 1);
                    available.unshift(preferred);
                }
            }
        }

        for (const provider of available) {
            const model = request.preferredModel && provider.models.includes(request.preferredModel)
                ? request.preferredModel
                : provider.models[0];

            const breaker = this.circuitBreakers.get(provider.name)!;

            try {
                console.log(`[AIFailover] Trying ${provider.name}/${model}...`);

                const result = await breaker.execute(() =>
                    this.withTimeout(
                        executor(provider.name, model),
                        request.timeout || provider.timeout
                    )
                );

                // Success!
                this.recordSuccess(provider.name, Date.now() - startTime);

                return {
                    result,
                    failoverInfo: {
                        success: true,
                        provider: provider.name,
                        model,
                        attempts: attempts.length + 1,
                        totalTime: Date.now() - startTime
                    }
                };
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : "Unknown error";
                console.warn(`[AIFailover] ${provider.name} failed: ${errorMsg}`);

                attempts.push({ provider: provider.name, error: errorMsg });
                this.recordFailure(provider.name, errorMsg);

                this.emit("provider_failed", {
                    provider: provider.name,
                    model,
                    error: errorMsg
                });
            }
        }

        // All providers failed
        throw new Error(`All AI providers failed. Attempts: ${JSON.stringify(attempts)}`);
    }

    private withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                reject(new Error(`Timeout after ${timeoutMs}ms`));
            }, timeoutMs);

            promise
                .then(result => {
                    clearTimeout(timer);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timer);
                    reject(error);
                });
        });
    }

    // ========================================================================
    // METRICS & HEALTH
    // ========================================================================

    private recordSuccess(provider: AIProvider, responseTime: number): void {
        const config = this.providers.get(provider);
        if (!config) return;

        config.successCount++;
        config.avgResponseTime = (config.avgResponseTime * 0.9) + (responseTime * 0.1);

        // Improve health score
        config.healthScore = Math.min(100, config.healthScore + 5);

        this.requestMetrics.record(provider, true, responseTime);
    }

    private recordFailure(provider: AIProvider, error: string): void {
        const config = this.providers.get(provider);
        if (!config) return;

        config.errorCount++;
        config.lastError = new Date();

        // Decrease health score
        config.healthScore = Math.max(0, config.healthScore - 20);

        this.requestMetrics.record(provider, false, 0);
    }

    getProviderHealth(): Record<AIProvider, { health: number; available: boolean }> {
        const result: Record<string, { health: number; available: boolean }> = {};

        for (const [name, config] of this.providers) {
            const breaker = this.circuitBreakers.get(name);
            result[name] = {
                health: config.healthScore,
                available: config.enabled && !breaker?.isOpen()
            };
        }

        return result as Record<AIProvider, { health: number; available: boolean }>;
    }

    getMetrics(): {
        totalRequests: number;
        successRate: number;
        avgResponseTime: number;
        byProvider: Record<string, any>;
    } {
        return this.requestMetrics.getSummary();
    }

    // ========================================================================
    // MANUAL CONTROLS
    // ========================================================================

    disableProvider(provider: AIProvider): void {
        const config = this.providers.get(provider);
        if (config) {
            config.enabled = false;
            console.log(`[AIFailover] Provider disabled: ${provider}`);
            this.emit("provider_disabled", { provider });
        }
    }

    enableProvider(provider: AIProvider): void {
        const config = this.providers.get(provider);
        if (config) {
            config.enabled = true;
            config.healthScore = 50; // Start at 50% health
            console.log(`[AIFailover] Provider enabled: ${provider}`);
            this.emit("provider_enabled", { provider });
        }
    }

    resetProvider(provider: AIProvider): void {
        const config = this.providers.get(provider);
        const breaker = this.circuitBreakers.get(provider);

        if (config) {
            config.healthScore = 100;
            config.errorCount = 0;
            config.successCount = 0;
        }

        if (breaker) {
            breaker.reset();
        }

        console.log(`[AIFailover] Provider reset: ${provider}`);
    }
}

// ============================================================================
// CIRCUIT BREAKER
// ============================================================================

class CircuitBreaker {
    private failures = 0;
    private lastFailure?: Date;
    private state: "closed" | "open" | "half-open" = "closed";
    private readonly threshold = 5;
    private readonly resetTimeout = 60000; // 1 minute

    constructor(private name: string) {}

    isOpen(): boolean {
        if (this.state === "open") {
            // Check if we should try half-open
            if (this.lastFailure && Date.now() - this.lastFailure.getTime() > this.resetTimeout) {
                this.state = "half-open";
                return false;
            }
            return true;
        }
        return false;
    }

    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.isOpen()) {
            throw new Error(`Circuit breaker open for ${this.name}`);
        }

        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    private onSuccess(): void {
        this.failures = 0;
        this.state = "closed";
    }

    private onFailure(): void {
        this.failures++;
        this.lastFailure = new Date();

        if (this.failures >= this.threshold) {
            this.state = "open";
            console.log(`[CircuitBreaker] ${this.name} opened after ${this.failures} failures`);
        }
    }

    reset(): void {
        this.failures = 0;
        this.state = "closed";
        this.lastFailure = undefined;
    }
}

// ============================================================================
// REQUEST METRICS
// ============================================================================

class RequestMetrics {
    private requests: Array<{
        provider: AIProvider;
        success: boolean;
        responseTime: number;
        timestamp: Date;
    }> = [];

    private readonly maxHistory = 1000;

    record(provider: AIProvider, success: boolean, responseTime: number): void {
        this.requests.push({
            provider,
            success,
            responseTime,
            timestamp: new Date()
        });

        // Keep history bounded
        if (this.requests.length > this.maxHistory) {
            this.requests = this.requests.slice(-this.maxHistory);
        }
    }

    getSummary(): {
        totalRequests: number;
        successRate: number;
        avgResponseTime: number;
        byProvider: Record<string, any>;
    } {
        const total = this.requests.length;
        const successful = this.requests.filter(r => r.success).length;
        const avgTime = this.requests.reduce((sum, r) => sum + r.responseTime, 0) / (total || 1);

        const byProvider: Record<string, any> = {};

        for (const r of this.requests) {
            if (!byProvider[r.provider]) {
                byProvider[r.provider] = { total: 0, success: 0, avgTime: 0 };
            }
            byProvider[r.provider].total++;
            if (r.success) byProvider[r.provider].success++;
            byProvider[r.provider].avgTime += r.responseTime;
        }

        for (const p in byProvider) {
            byProvider[p].avgTime /= byProvider[p].total || 1;
            byProvider[p].successRate = byProvider[p].success / (byProvider[p].total || 1);
        }

        return {
            totalRequests: total,
            successRate: successful / (total || 1),
            avgResponseTime: avgTime,
            byProvider
        };
    }
}

// Singleton instance
export const aiFailover = new AIFailoverService();

export default aiFailover;
