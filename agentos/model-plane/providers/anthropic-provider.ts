// AgentOS Model-Plane — Anthropic Claude Provider
// Implements ModelProvider for the Anthropic API (Claude family).

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
} from '../types';

// ---------------------------------------------------------------------------
// Anthropic-specific wire types
// ---------------------------------------------------------------------------

interface AnthropicMessagePayload {
  model: string;
  max_tokens: number;
  messages: Array<{ role: string; content: unknown }>;
  system?: string;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  tools?: unknown[];
  metadata?: Record<string, unknown>;
}

interface AnthropicResponsePayload {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  model: string;
  usage: { input_tokens: number; output_tokens: number };
  stop_reason: string;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class AnthropicProvider implements ModelProvider {
  readonly kind = 'anthropic' as const;
  readonly name = 'Anthropic Claude';

  private config!: ModelProviderConfig;
  private logger: Logger;
  private initialized = false;
  private baseUrl = 'https://api.anthropic.com/v1';

  private static readonly MODELS: ModelInfo[] = [
    {
      id: 'claude-opus-4-20250514',
      name: 'Claude Opus 4',
      provider: 'anthropic',
      capabilities: ['text-generation', 'code-generation', 'code-editing', 'function-calling', 'structured-output', 'long-context', 'reasoning', 'image-understanding'],
      maxContextTokens: 200_000,
      costPer1kInputTokens: 0.015,
      costPer1kOutputTokens: 0.075,
      avgLatencyMs: 2500,
      qualityScore: 0.97,
    },
    {
      id: 'claude-sonnet-4-20250514',
      name: 'Claude Sonnet 4',
      provider: 'anthropic',
      capabilities: ['text-generation', 'code-generation', 'code-editing', 'function-calling', 'structured-output', 'long-context', 'reasoning', 'image-understanding'],
      maxContextTokens: 200_000,
      costPer1kInputTokens: 0.003,
      costPer1kOutputTokens: 0.015,
      avgLatencyMs: 1500,
      qualityScore: 0.93,
    },
    {
      id: 'claude-haiku-3-5-20241022',
      name: 'Claude 3.5 Haiku',
      provider: 'anthropic',
      capabilities: ['text-generation', 'code-generation', 'function-calling', 'structured-output', 'long-context'],
      maxContextTokens: 200_000,
      costPer1kInputTokens: 0.0008,
      costPer1kOutputTokens: 0.004,
      avgLatencyMs: 600,
      qualityScore: 0.82,
    },
  ];

  constructor(logger?: Logger) {
    this.logger = logger ?? defaultLogger;
  }

  async initialize(config: ModelProviderConfig): Promise<void> {
    if (!config.apiKey) {
      throw new Error('AnthropicProvider requires an apiKey');
    }
    this.config = { timeout: 60_000, maxRetries: 2, ...config };
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    this.initialized = true;
    this.logger.log('info', 'Anthropic provider initialized');
  }

  async listModels(): Promise<ModelInfo[]> {
    this.ensureInitialized();
    return AnthropicProvider.MODELS;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.ensureInitialized();
    const modelId = request.model ?? 'claude-sonnet-4-20250514';
    const start = Date.now();
    const traceId = `ant-${request.requestId}-${Date.now()}`;

    this.logger.log('debug', 'Anthropic request', { requestId: request.requestId, model: modelId });

    const payload = this.buildPayload(request, modelId);
    const response = await this.postWithRetry('/messages', payload);
    const latencyMs = Date.now() - start;

    const textParts = response.content.filter((c) => c.type === 'text').map((c) => c.text ?? '');
    const toolCalls: ToolCall[] = response.content
      .filter((c) => c.type === 'tool_use')
      .map((c) => ({ id: c.id!, name: c.name!, arguments: JSON.stringify(c.input) }));

    const costUsd =
      (response.usage.input_tokens / 1000) * this.getModelCost(modelId, 'input') +
      (response.usage.output_tokens / 1000) * this.getModelCost(modelId, 'output');

    return {
      requestId: request.requestId,
      model: modelId,
      provider: 'anthropic',
      content: textParts.join(''),
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        totalTokens: response.usage.input_tokens + response.usage.output_tokens,
      },
      latencyMs,
      costUsd,
      traceId,
      cached: false,
    };
  }

  async healthCheck(): Promise<ProviderHealth> {
    const start = Date.now();
    try {
      this.ensureInitialized();
      // Lightweight probe — list models or send a tiny request
      await this.postWithRetry('/messages', {
        model: 'claude-haiku-3-5-20241022',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return {
        provider: 'anthropic',
        status: 'healthy',
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        errorRate: 0,
        availableModels: AnthropicProvider.MODELS.map((m) => m.id),
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        provider: 'anthropic',
        status: 'unhealthy',
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        errorRate: 1,
        availableModels: [],
        message: msg,
      };
    }
  }

  async shutdown(): Promise<void> {
    this.initialized = false;
    this.logger.log('info', 'Anthropic provider shut down');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private ensureInitialized(): void {
    if (!this.initialized) throw new Error('AnthropicProvider is not initialized');
  }

  private buildPayload(request: ModelRequest, modelId: string): AnthropicMessagePayload {
    const systemMsg = request.messages.find((m) => m.role === 'system');
    const nonSystem = request.messages.filter((m) => m.role !== 'system');

    const payload: AnthropicMessagePayload = {
      model: modelId,
      max_tokens: request.maxTokens ?? 4096,
      messages: nonSystem.map((m) => ({
        role: m.role === 'tool' ? 'user' : m.role,
        content: this.convertContent(m),
      })),
    };

    if (systemMsg) {
      payload.system = typeof systemMsg.content === 'string' ? systemMsg.content : (systemMsg.content as ContentPart[]).map((p) => p.text ?? '').join('');
    }
    if (request.temperature !== undefined) payload.temperature = request.temperature;
    if (request.topP !== undefined) payload.top_p = request.topP;
    if (request.stop) payload.stop_sequences = request.stop;
    if (request.tools?.length) {
      payload.tools = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }
    return payload;
  }

  private convertContent(msg: ModelMessage): unknown {
    if (typeof msg.content === 'string') return msg.content;
    return (msg.content as ContentPart[]).map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'image_url') {
        return { type: 'image', source: { type: p.data ? 'base64' : 'url', media_type: p.mediaType ?? 'image/png', data: p.data, url: p.url } };
      }
      return { type: 'text', text: `[unsupported content type: ${p.type}]` };
    });
  }

  private getModelCost(modelId: string, direction: 'input' | 'output'): number {
    const info = AnthropicProvider.MODELS.find((m) => m.id === modelId);
    if (!info) return 0;
    return direction === 'input' ? info.costPer1kInputTokens : info.costPer1kOutputTokens;
  }

  private async postWithRetry(path: string, body: unknown, attempt = 0): Promise<AnthropicResponsePayload> {
    const maxRetries = this.config.maxRetries ?? 2;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.config.apiKey!,
          'anthropic-version': '2023-06-01',
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
      });

      if (!res.ok) {
        const errBody = await res.text();
        const isRetryable = res.status === 429 || res.status >= 500;
        if (isRetryable && attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000);
          this.logger.log('warn', `Anthropic API ${res.status}, retrying in ${delay}ms`, { attempt });
          await new Promise((r) => setTimeout(r, delay));
          return this.postWithRetry(path, body, attempt + 1);
        }
        throw new Error(`Anthropic API error ${res.status}: ${errBody}`);
      }

      return (await res.json()) as AnthropicResponsePayload;
    } catch (err) {
      if (attempt < maxRetries && err instanceof TypeError) {
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        this.logger.log('warn', `Anthropic network error, retrying in ${delay}ms`, { attempt });
        await new Promise((r) => setTimeout(r, delay));
        return this.postWithRetry(path, body, attempt + 1);
      }
      throw err;
    }
  }
}
