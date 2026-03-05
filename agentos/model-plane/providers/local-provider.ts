// AgentOS Model-Plane — Local Model Provider
// Supports Ollama, vLLM, and SGLang local inference servers.

import {
  ModelProvider,
  ModelProviderConfig,
  ModelInfo,
  ModelRequest,
  ModelResponse,
  ProviderHealth,
  ModelMessage,
  ContentPart,
  ToolCall,
  Logger,
  defaultLogger,
  ModelCapability,
} from '../types';

// ---------------------------------------------------------------------------
// Local backend types
// ---------------------------------------------------------------------------

export type LocalBackend = 'ollama' | 'vllm' | 'sglang';

export interface LocalProviderOptions {
  backend: LocalBackend;
  modelsOverride?: ModelInfo[];
}

interface OllamaTagsResponse {
  models: Array<{ name: string; size: number; details?: { family?: string; parameter_size?: string } }>;
}

interface OpenAICompatResponse {
  id: string;
  choices: Array<{
    message: { role: string; content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class LocalProvider implements ModelProvider {
  readonly kind = 'local' as const;
  readonly name: string;

  private config!: ModelProviderConfig;
  private logger: Logger;
  private initialized = false;
  private backend: LocalBackend;
  private baseUrl = 'http://localhost:11434'; // Ollama default
  private modelsCache: ModelInfo[] = [];
  private modelsOverride?: ModelInfo[];

  private static readonly DEFAULT_URLS: Record<LocalBackend, string> = {
    ollama: 'http://localhost:11434',
    vllm: 'http://localhost:8000',
    sglang: 'http://localhost:30000',
  };

  constructor(options: LocalProviderOptions, logger?: Logger) {
    this.backend = options.backend;
    this.name = `Local (${options.backend})`;
    this.modelsOverride = options.modelsOverride;
    this.logger = logger ?? defaultLogger;
  }

  async initialize(config: ModelProviderConfig): Promise<void> {
    this.config = { timeout: 120_000, maxRetries: 1, ...config };
    this.baseUrl = config.baseUrl ?? LocalProvider.DEFAULT_URLS[this.backend];
    this.initialized = true;
    this.logger.log('info', `Local provider (${this.backend}) initialized`, { baseUrl: this.baseUrl });

    // Eagerly discover models
    try {
      this.modelsCache = await this.discoverModels();
    } catch {
      this.logger.log('warn', 'Could not discover local models at init — server may not be running');
    }
  }

  async listModels(): Promise<ModelInfo[]> {
    this.ensureInit();
    if (this.modelsOverride) return this.modelsOverride;
    if (this.modelsCache.length === 0) {
      this.modelsCache = await this.discoverModels();
    }
    return this.modelsCache;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.ensureInit();
    const modelId = request.model ?? this.modelsCache[0]?.id ?? 'llama3';
    const start = Date.now();
    const traceId = `local-${request.requestId}-${Date.now()}`;

    this.logger.log('debug', `Local (${this.backend}) request`, { model: modelId, requestId: request.requestId });

    if (this.backend === 'ollama') {
      return this.completeOllama(request, modelId, start, traceId);
    }
    // vLLM and SGLang expose OpenAI-compatible endpoints
    return this.completeOpenAICompat(request, modelId, start, traceId);
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      this.ensureInit();
      const endpoint = this.backend === 'ollama' ? '/api/tags' : '/v1/models';
      const res = await fetch(`${this.baseUrl}${endpoint}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        provider: 'local',
        status: 'healthy',
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        errorRate: 0,
        availableModels: this.modelsCache.map((m) => m.id),
      };
    } catch (err: unknown) {
      return {
        provider: 'local',
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        errorRate: 1,
        availableModels: [],
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.modelsCache = [];
    this.logger.log('info', `Local provider (${this.backend}) shut down`);
  }

  // -----------------------------------------------------------------------
  // Ollama-native completion
  // -----------------------------------------------------------------------

  private async completeOllama(
    request: ModelRequest,
    modelId: string,
    start: number,
    traceId: string,
  ): Promise<ModelResponse> {
    const body = {
      model: modelId,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : (m.content as ContentPart[]).map((p) => p.text ?? '').join(''),
        ...(m.role === 'user' && this.extractImages(m).length > 0 ? { images: this.extractImages(m) } : {}),
      })),
      stream: false,
      options: {
        temperature: request.temperature ?? 0.7,
        top_p: request.topP,
        num_predict: request.maxTokens,
        stop: request.stop,
      },
    };

    const res = await this.post('/api/chat', body);
    const data = (await res.json()) as {
      message: { role: string; content: string };
      eval_count?: number;
      prompt_eval_count?: number;
    };

    const inputTokens = data.prompt_eval_count ?? 0;
    const outputTokens = data.eval_count ?? 0;

    return {
      requestId: request.requestId,
      model: modelId,
      provider: 'local',
      content: data.message.content,
      usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
      latencyMs: Date.now() - start,
      costUsd: 0, // local = free
      traceId,
      cached: false,
    };
  }

  // -----------------------------------------------------------------------
  // OpenAI-compatible completion (vLLM / SGLang)
  // -----------------------------------------------------------------------

  private async completeOpenAICompat(
    request: ModelRequest,
    modelId: string,
    start: number,
    traceId: string,
  ): Promise<ModelResponse> {
    const body: Record<string, unknown> = {
      model: modelId,
      messages: request.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : (m.content as ContentPart[]).map((p) => p.text ?? '').join(''),
      })),
      temperature: request.temperature ?? 0.7,
      max_tokens: request.maxTokens ?? 2048,
    };
    if (request.topP !== undefined) body.top_p = request.topP;
    if (request.stop) body.stop = request.stop;
    if (request.tools?.length) {
      body.tools = request.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const res = await this.post('/v1/chat/completions', body);
    const raw = (await res.json()) as OpenAICompatResponse;
    const choice = raw.choices[0];
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    return {
      requestId: request.requestId,
      model: modelId,
      provider: 'local',
      content: choice?.message?.content ?? '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: raw.usage.prompt_tokens,
        outputTokens: raw.usage.completion_tokens,
        totalTokens: raw.usage.total_tokens,
      },
      latencyMs: Date.now() - start,
      costUsd: 0,
      traceId,
      cached: false,
    };
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private ensureInit(): void {
    if (!this.initialized) throw new Error('LocalProvider is not initialized');
  }

  private extractImages(msg: ModelMessage): string[] {
    if (typeof msg.content === 'string') return [];
    return (msg.content as ContentPart[])
      .filter((p) => p.type === 'image_url' && p.data)
      .map((p) => p.data!);
  }

  private inferCapabilities(name: string): ModelCapability[] {
    const caps: ModelCapability[] = ['text-generation'];
    const lower = name.toLowerCase();
    if (lower.includes('code') || lower.includes('deepseek-coder') || lower.includes('starcoder')) {
      caps.push('code-generation');
    }
    if (lower.includes('llava') || lower.includes('vision') || lower.includes('bakllava')) {
      caps.push('image-understanding');
    }
    if (lower.includes('embed')) {
      caps.push('text-embedding');
    }
    return caps;
  }

  private async discoverModels(): Promise<ModelInfo[]> {
    if (this.backend === 'ollama') {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5_000) });
      if (!res.ok) throw new Error(`Ollama tags failed: ${res.status}`);
      const data = (await res.json()) as OllamaTagsResponse;
      return data.models.map((m) => ({
        id: m.name,
        name: m.name,
        provider: 'local' as const,
        capabilities: this.inferCapabilities(m.name),
        maxContextTokens: 8192,
        costPer1kInputTokens: 0,
        costPer1kOutputTokens: 0,
        avgLatencyMs: 1000,
        qualityScore: 0.7,
      }));
    }

    // vLLM / SGLang — OpenAI /v1/models
    const res = await fetch(`${this.baseUrl}/v1/models`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) throw new Error(`Model list failed: ${res.status}`);
    const data = (await res.json()) as { data: Array<{ id: string }> };
    return data.data.map((m) => ({
      id: m.id,
      name: m.id,
      provider: 'local' as const,
      capabilities: this.inferCapabilities(m.id),
      maxContextTokens: 8192,
      costPer1kInputTokens: 0,
      costPer1kOutputTokens: 0,
      avgLatencyMs: 800,
      qualityScore: 0.7,
    }));
  }

  private async post(path: string, body: unknown): Promise<Response> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        ...this.config.headers,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.config.timeout ?? 120_000),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Local (${this.backend}) API error ${res.status}: ${text}`);
    }
    return res;
  }
}
