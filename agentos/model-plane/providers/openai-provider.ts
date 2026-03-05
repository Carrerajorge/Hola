// AgentOS Model-Plane — OpenAI Provider
// Implements ModelProvider for the OpenAI API (GPT / o-series / DALL-E).

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
// OpenAI wire types (subset)
// ---------------------------------------------------------------------------

interface OAIChatPayload {
  model: string;
  messages: Array<{ role: string; content: unknown; name?: string; tool_call_id?: string }>;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  stop?: string[];
  tools?: unknown[];
  tool_choice?: unknown;
  response_format?: unknown;
}

interface OAIChatResponse {
  id: string;
  object: string;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string | null;
      tool_calls?: Array<{ id: string; type: string; function: { name: string; arguments: string } }>;
    };
    finish_reason: string;
  }>;
  usage: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class OpenAIProvider implements ModelProvider {
  readonly kind = 'openai' as const;
  readonly name = 'OpenAI';

  private config!: ModelProviderConfig;
  private logger: Logger;
  private initialized = false;
  private baseUrl = 'https://api.openai.com/v1';

  private static readonly MODELS: ModelInfo[] = [
    {
      id: 'gpt-4o',
      name: 'GPT-4o',
      provider: 'openai',
      capabilities: ['text-generation', 'code-generation', 'function-calling', 'structured-output', 'image-understanding', 'long-context'],
      maxContextTokens: 128_000,
      costPer1kInputTokens: 0.0025,
      costPer1kOutputTokens: 0.01,
      avgLatencyMs: 1200,
      qualityScore: 0.92,
    },
    {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'openai',
      capabilities: ['text-generation', 'code-generation', 'function-calling', 'structured-output', 'image-understanding'],
      maxContextTokens: 128_000,
      costPer1kInputTokens: 0.00015,
      costPer1kOutputTokens: 0.0006,
      avgLatencyMs: 700,
      qualityScore: 0.84,
    },
    {
      id: 'o3-mini',
      name: 'o3-mini',
      provider: 'openai',
      capabilities: ['text-generation', 'code-generation', 'reasoning', 'function-calling', 'structured-output'],
      maxContextTokens: 200_000,
      costPer1kInputTokens: 0.0011,
      costPer1kOutputTokens: 0.0044,
      avgLatencyMs: 3000,
      qualityScore: 0.91,
    },
    {
      id: 'gpt-4.1',
      name: 'GPT-4.1',
      provider: 'openai',
      capabilities: ['text-generation', 'code-generation', 'code-editing', 'function-calling', 'structured-output', 'long-context', 'image-understanding'],
      maxContextTokens: 1_000_000,
      costPer1kInputTokens: 0.002,
      costPer1kOutputTokens: 0.008,
      avgLatencyMs: 1100,
      qualityScore: 0.93,
    },
  ];

  constructor(logger?: Logger) {
    this.logger = logger ?? defaultLogger;
  }

  async initialize(config: ModelProviderConfig): Promise<void> {
    if (!config.apiKey) throw new Error('OpenAIProvider requires an apiKey');
    this.config = { timeout: 60_000, maxRetries: 2, ...config };
    if (config.baseUrl) this.baseUrl = config.baseUrl;
    this.initialized = true;
    this.logger.log('info', 'OpenAI provider initialized');
  }

  async listModels(): Promise<ModelInfo[]> {
    this.ensureInit();
    return OpenAIProvider.MODELS;
  }

  async complete(request: ModelRequest): Promise<ModelResponse> {
    this.ensureInit();
    const modelId = request.model ?? 'gpt-4o';
    const start = Date.now();
    const traceId = `oai-${request.requestId}-${Date.now()}`;

    this.logger.log('debug', 'OpenAI request', { requestId: request.requestId, model: modelId });

    const payload = this.buildPayload(request, modelId);
    const raw = await this.postWithRetry('/chat/completions', payload);
    const latencyMs = Date.now() - start;

    const choice = raw.choices[0];
    const content = choice?.message?.content ?? '';
    const toolCalls: ToolCall[] = (choice?.message?.tool_calls ?? []).map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: tc.function.arguments,
    }));

    const costUsd =
      (raw.usage.prompt_tokens / 1000) * this.modelCost(modelId, 'input') +
      (raw.usage.completion_tokens / 1000) * this.modelCost(modelId, 'output');

    return {
      requestId: request.requestId,
      model: modelId,
      provider: 'openai',
      content,
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      usage: {
        inputTokens: raw.usage.prompt_tokens,
        outputTokens: raw.usage.completion_tokens,
        totalTokens: raw.usage.total_tokens,
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
      this.ensureInit();
      const res = await fetch(`${this.baseUrl}/models`, {
        headers: { Authorization: `Bearer ${this.config.apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return {
        provider: 'openai',
        status: 'healthy',
        latencyMs: Date.now() - start,
        lastChecked: new Date(),
        errorRate: 0,
        availableModels: OpenAIProvider.MODELS.map((m) => m.id),
      };
    } catch (err: unknown) {
      return {
        provider: 'openai',
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
    this.logger.log('info', 'OpenAI provider shut down');
  }

  // -----------------------------------------------------------------------
  // Private
  // -----------------------------------------------------------------------

  private ensureInit(): void {
    if (!this.initialized) throw new Error('OpenAIProvider not initialized');
  }

  private buildPayload(req: ModelRequest, modelId: string): OAIChatPayload {
    const payload: OAIChatPayload = {
      model: modelId,
      messages: req.messages.map((m) => this.convertMessage(m)),
    };
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    if (req.topP !== undefined) payload.top_p = req.topP;
    if (req.stop) payload.stop = req.stop;
    if (req.tools?.length) {
      payload.tools = req.tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    return payload;
  }

  private convertMessage(msg: ModelMessage): { role: string; content: unknown; name?: string; tool_call_id?: string } {
    const out: { role: string; content: unknown; name?: string; tool_call_id?: string } = {
      role: msg.role,
      content: typeof msg.content === 'string' ? msg.content : this.convertParts(msg.content as ContentPart[]),
    };
    if (msg.name) out.name = msg.name;
    if (msg.toolCallId) out.tool_call_id = msg.toolCallId;
    return out;
  }

  private convertParts(parts: ContentPart[]): unknown[] {
    return parts.map((p) => {
      if (p.type === 'text') return { type: 'text', text: p.text };
      if (p.type === 'image_url') return { type: 'image_url', image_url: { url: p.url ?? `data:${p.mediaType};base64,${p.data}` } };
      return { type: 'text', text: `[unsupported: ${p.type}]` };
    });
  }

  private modelCost(id: string, dir: 'input' | 'output'): number {
    const m = OpenAIProvider.MODELS.find((x) => x.id === id);
    if (!m) return 0;
    return dir === 'input' ? m.costPer1kInputTokens : m.costPer1kOutputTokens;
  }

  private async postWithRetry(path: string, body: unknown, attempt = 0): Promise<OAIChatResponse> {
    const maxRetries = this.config.maxRetries ?? 2;
    try {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
          ...(this.config.organizationId ? { 'OpenAI-Organization': this.config.organizationId } : {}),
          ...this.config.headers,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.config.timeout ?? 60_000),
      });
      if (!res.ok) {
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt, 10_000);
          this.logger.log('warn', `OpenAI ${res.status}, retry in ${delay}ms`, { attempt });
          await new Promise((r) => setTimeout(r, delay));
          return this.postWithRetry(path, body, attempt + 1);
        }
        throw new Error(`OpenAI API error ${res.status}: ${text}`);
      }
      return (await res.json()) as OAIChatResponse;
    } catch (err) {
      if (attempt < maxRetries && err instanceof TypeError) {
        const delay = Math.min(1000 * 2 ** attempt, 10_000);
        this.logger.log('warn', `OpenAI network error, retry in ${delay}ms`, { attempt });
        await new Promise((r) => setTimeout(r, delay));
        return this.postWithRetry(path, body, attempt + 1);
      }
      throw err;
    }
  }
}
