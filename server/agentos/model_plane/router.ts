import { z } from "zod";
import { llmGateway } from "../../lib/llmGateway";
// import { costEngine } from "../../services/finops/costEngine";

// Provider Definitions
export const ProviderType = z.enum(["openai", "anthropic", "google", "xai", "openrouter", "ollama", "local", "gemini", "deepseek"]);
export type ProviderType = z.infer<typeof ProviderType>;

export const ModelRequest = z.object({
  provider: ProviderType.optional(),
  modelId: z.string(),
  messages: z.array(z.any()),
  temperature: z.number().optional(),
  maxTokens: z.number().optional(),
  stream: z.boolean().default(false),
  userId: z.string().default("anonymous"),
  requestId: z.string().optional(),
  // Cost control
  budgetLimit: z.number().optional(), // Max cost in cents
});

export const ModelResponse = z.object({
  id: z.string(),
  provider: ProviderType,
  modelId: z.string(),
  output: z.any(),
  usage: z.object({
    promptTokens: z.number(),
    completionTokens: z.number(),
    totalTokens: z.number(),
  }),
  latencyMs: z.number(),
});

export class ModelRouter {
  // Intelligent Routing Logic
  async route(req: z.infer<typeof ModelRequest>): Promise<z.infer<typeof ModelResponse>> {
    const { userId, modelId, messages, temperature, maxTokens } = req;

    // 1. Check Budget (Global) via FinOps Engine
    // await costEngine.enforceGuardrails(userId, 0);

    // 2. Select Model (QoS / Cost-Aware) handled by LLMGateway's smart routing if provider not set
    // But we can add policy checks here if needed (Control Plane)

    // 3. Execute with Fallback (delegated to LLMGateway for now as it has robust fallback)
    const response = await llmGateway.chat(messages, {
      model: modelId,
      temperature,
      maxTokens,
      userId,
      requestId: req.requestId,
      enableFallback: true
    });

    // 4. Record Cost (handled by LLMGateway -> CostEngine)

    return {
      id: response.requestId,
      provider: response.provider as ProviderType,
      modelId: response.model,
      output: response.content,
      usage: {
        promptTokens: response.usage?.promptTokens || 0,
        completionTokens: response.usage?.completionTokens || 0,
        totalTokens: response.usage?.totalTokens || 0,
      },
      latencyMs: response.latencyMs,
    };
  }
}
