import { storage } from "../storage";
import type { InsertAiModel, AiModel } from "@shared/schema";

interface KnownModel {
  modelId: string;
  name: string;
  contextWindow: number;
  maxOutput: number;
  type: "TEXT" | "IMAGE" | "EMBEDDING" | "AUDIO" | "VIDEO" | "MULTIMODAL";
  inputCost?: string;
  outputCost?: string;
  description?: string;
  releaseDate?: string;
  isDeprecated?: boolean;
}

const KNOWN_MODELS: Record<string, KnownModel[]> = {
  anthropic: [
    { modelId: "claude-opus-4-5", name: "Claude Opus 4.5", contextWindow: 200000, maxOutput: 32000, type: "TEXT", inputCost: "0.015", outputCost: "0.075", description: "Most capable Claude model for complex reasoning" },
    { modelId: "claude-sonnet-4-5", name: "Claude Sonnet 4.5", contextWindow: 200000, maxOutput: 16000, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Balanced performance and cost" },
    { modelId: "claude-haiku-4-5", name: "Claude Haiku 4.5", contextWindow: 200000, maxOutput: 8000, type: "TEXT", inputCost: "0.00025", outputCost: "0.00125", description: "Fastest, most compact Claude model" },
    { modelId: "claude-3.5-sonnet", name: "Claude 3.5 Sonnet", contextWindow: 200000, maxOutput: 8192, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Previous generation Sonnet" },
    { modelId: "claude-3.5-haiku", name: "Claude 3.5 Haiku", contextWindow: 200000, maxOutput: 8192, type: "TEXT", inputCost: "0.00025", outputCost: "0.00125", description: "Previous generation Haiku" },
    { modelId: "claude-3-opus", name: "Claude 3 Opus", contextWindow: 200000, maxOutput: 4096, type: "TEXT", inputCost: "0.015", outputCost: "0.075", description: "Claude 3 flagship model", isDeprecated: true },
  ],
  google: [
    { modelId: "gemini-3-flash-preview", name: "Gemini 3 Flash Preview", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Más nuevo y rápido (predeterminado)" },
    { modelId: "gemini-2.5-pro", name: "Gemini 2.5 Pro", contextWindow: 2000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.0025", outputCost: "0.01", description: "Más capaz y avanzado" },
    { modelId: "gemini-2.5-flash", name: "Gemini 2.5 Flash", contextWindow: 1000000, maxOutput: 65536, type: "MULTIMODAL", inputCost: "0.00015", outputCost: "0.0006", description: "Rápido y eficiente" },
    { modelId: "gemini-2.0-flash", name: "Gemini 2.0 Flash", contextWindow: 1000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.0001", outputCost: "0.0004", description: "Previous generation Flash" },
    { modelId: "gemini-1.5-pro", name: "Gemini 1.5 Pro", contextWindow: 2000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.00125", outputCost: "0.005", description: "Gemini 1.5 flagship", isDeprecated: true },
    { modelId: "gemini-1.5-flash", name: "Gemini 1.5 Flash", contextWindow: 1000000, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.000075", outputCost: "0.0003", description: "Fast Gemini 1.5 model", isDeprecated: true },
    { modelId: "imagen-3", name: "Imagen 3", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "Image generation model" },
    { modelId: "text-embedding-004", name: "Text Embedding 004", contextWindow: 2048, maxOutput: 0, type: "EMBEDDING", inputCost: "0.000025", outputCost: "0.00", description: "Text embedding model" },
  ],
  xai: [
    { modelId: "grok-3", name: "Grok 3", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "xAI flagship model" },
    { modelId: "grok-3-fast", name: "Grok 3 Fast", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.0005", outputCost: "0.002", description: "Fast inference Grok 3" },
    { modelId: "grok-3-mini", name: "Grok 3 Mini", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.0003", outputCost: "0.0005", description: "Smaller, faster Grok model" },
    { modelId: "grok-3-mini-fast", name: "Grok 3 Mini Fast", contextWindow: 131072, maxOutput: 16384, type: "TEXT", inputCost: "0.0001", outputCost: "0.0004", description: "Fastest Grok variant" },
    { modelId: "grok-2", name: "Grok 2", contextWindow: 131072, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.01", description: "Previous generation Grok", isDeprecated: true },
    { modelId: "grok-2-vision", name: "Grok 2 Vision", contextWindow: 32768, maxOutput: 8192, type: "MULTIMODAL", inputCost: "0.002", outputCost: "0.01", description: "Análisis de imágenes" },
  ],
  openai: [
    { modelId: "gpt-5", name: "GPT-5", contextWindow: 128000, maxOutput: 16384, type: "TEXT", inputCost: "0.01", outputCost: "0.03", description: "Latest OpenAI flagship model" },
    { modelId: "gpt-4.1", name: "GPT-4.1", contextWindow: 1000000, maxOutput: 32768, type: "MULTIMODAL", inputCost: "0.002", outputCost: "0.008", description: "Extended context GPT-4" },
    { modelId: "gpt-4o", name: "GPT-4o", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.0025", outputCost: "0.01", description: "Omni model with vision and audio" },
    { modelId: "gpt-4o-mini", name: "GPT-4o Mini", contextWindow: 128000, maxOutput: 16384, type: "MULTIMODAL", inputCost: "0.00015", outputCost: "0.0006", description: "Smaller GPT-4o variant" },
    { modelId: "o3", name: "o3", contextWindow: 128000, maxOutput: 100000, type: "TEXT", inputCost: "0.01", outputCost: "0.04", description: "Reasoning model" },
    { modelId: "o3-mini", name: "o3 Mini", contextWindow: 128000, maxOutput: 65536, type: "TEXT", inputCost: "0.00115", outputCost: "0.0044", description: "Smaller reasoning model" },
    { modelId: "o1", name: "o1", contextWindow: 200000, maxOutput: 100000, type: "TEXT", inputCost: "0.015", outputCost: "0.06", description: "Advanced reasoning model" },
    { modelId: "o1-mini", name: "o1 Mini", contextWindow: 128000, maxOutput: 65536, type: "TEXT", inputCost: "0.003", outputCost: "0.012", description: "Smaller o1 variant" },
    { modelId: "dall-e-3", name: "DALL-E 3", contextWindow: 0, maxOutput: 0, type: "IMAGE", inputCost: "0.04", outputCost: "0.00", description: "Image generation" },
    { modelId: "whisper-1", name: "Whisper", contextWindow: 0, maxOutput: 0, type: "AUDIO", inputCost: "0.006", outputCost: "0.00", description: "Speech to text" },
    { modelId: "text-embedding-3-large", name: "Text Embedding 3 Large", contextWindow: 8191, maxOutput: 0, type: "EMBEDDING", inputCost: "0.00013", outputCost: "0.00", description: "Latest embedding model" },
  ],
  openrouter: [
    { modelId: "meta-llama/llama-3.3-70b", name: "Llama 3.3 70B", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.0004", outputCost: "0.0004", description: "Meta's open source model" },
    { modelId: "meta-llama/llama-3.1-405b", name: "Llama 3.1 405B", contextWindow: 128000, maxOutput: 4096, type: "TEXT", inputCost: "0.003", outputCost: "0.003", description: "Largest Llama model" },
    { modelId: "meta-llama/llama-3.1-70b", name: "Llama 3.1 70B", contextWindow: 128000, maxOutput: 4096, type: "TEXT", inputCost: "0.0004", outputCost: "0.0004", description: "Medium Llama model" },
    { modelId: "mistralai/mistral-large-2411", name: "Mistral Large 24.11", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.006", description: "Mistral flagship model" },
    { modelId: "mistralai/mistral-medium", name: "Mistral Medium", contextWindow: 32000, maxOutput: 8192, type: "TEXT", inputCost: "0.00275", outputCost: "0.0081", description: "Balanced Mistral model" },
    { modelId: "mistralai/codestral-2501", name: "Codestral", contextWindow: 256000, maxOutput: 8192, type: "TEXT", inputCost: "0.0003", outputCost: "0.0009", description: "Code-specialized model" },
    { modelId: "qwen/qwen-2.5-72b", name: "Qwen 2.5 72B", contextWindow: 32000, maxOutput: 8192, type: "TEXT", inputCost: "0.0003", outputCost: "0.0003", description: "Alibaba's Qwen model" },
    { modelId: "deepseek/deepseek-v3", name: "DeepSeek V3", contextWindow: 64000, maxOutput: 8192, type: "TEXT", inputCost: "0.00014", outputCost: "0.00028", description: "DeepSeek's latest model" },
    { modelId: "deepseek/deepseek-r1", name: "DeepSeek R1", contextWindow: 64000, maxOutput: 8192, type: "TEXT", inputCost: "0.00055", outputCost: "0.00219", description: "DeepSeek reasoning model" },
    { modelId: "cohere/command-r-plus", name: "Command R+", contextWindow: 128000, maxOutput: 4096, type: "TEXT", inputCost: "0.0025", outputCost: "0.01", description: "Cohere's flagship model" },
  ],
  perplexity: [
    { modelId: "sonar-pro", name: "Sonar Pro", contextWindow: 200000, maxOutput: 8192, type: "TEXT", inputCost: "0.003", outputCost: "0.015", description: "Perplexity search-enhanced model" },
    { modelId: "sonar", name: "Sonar", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.001", outputCost: "0.001", description: "Fast search model" },
    { modelId: "sonar-reasoning-pro", name: "Sonar Reasoning Pro", contextWindow: 128000, maxOutput: 8192, type: "TEXT", inputCost: "0.002", outputCost: "0.008", description: "Reasoning with search" },
  ],
};

export function getAvailableProviders(): string[] {
  return Object.keys(KNOWN_MODELS);
}

export function getKnownModelsForProvider(provider: string): KnownModel[] {
  return KNOWN_MODELS[provider.toLowerCase()] || [];
}

export async function syncModelsForProvider(provider: string): Promise<{ added: number; updated: number; errors: string[] }> {
  const result = { added: 0, updated: 0, errors: [] as string[] };
  
  const knownModels = KNOWN_MODELS[provider.toLowerCase()];
  if (!knownModels || knownModels.length === 0) {
    result.errors.push(`Unknown provider: ${provider}`);
    return result;
  }
  
  const existingModels = await storage.getAiModels();
  const existingByModelId = new Map(
    existingModels
      .filter(m => m.provider.toLowerCase() === provider.toLowerCase())
      .map(m => [m.modelId, m])
  );
  
  for (const model of knownModels) {
    try {
      const existing = existingByModelId.get(model.modelId);
      
      if (existing) {
        await storage.updateAiModel(existing.id, {
          name: model.name,
          modelType: model.type,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutput,
          inputCostPer1k: model.inputCost || "0.00",
          outputCostPer1k: model.outputCost || "0.00",
          description: model.description || existing.description,
          isDeprecated: model.isDeprecated ? "true" : "false",
          releaseDate: model.releaseDate,
          lastSyncAt: new Date(),
        });
        result.updated++;
      } else {
        await storage.createAiModel({
          name: model.name,
          provider: provider.toLowerCase(),
          modelId: model.modelId,
          modelType: model.type,
          contextWindow: model.contextWindow,
          maxOutputTokens: model.maxOutput,
          inputCostPer1k: model.inputCost || "0.00",
          outputCostPer1k: model.outputCost || "0.00",
          costPer1k: model.inputCost || "0.00",
          description: model.description,
          isDeprecated: model.isDeprecated ? "true" : "false",
          releaseDate: model.releaseDate,
          status: "inactive",
          lastSyncAt: new Date(),
        });
        result.added++;
      }
    } catch (error: any) {
      result.errors.push(`Error syncing ${model.modelId}: ${error.message}`);
    }
  }
  
  return result;
}

export async function syncAllProviders(): Promise<Record<string, { added: number; updated: number; errors: string[] }>> {
  const results: Record<string, { added: number; updated: number; errors: string[] }> = {};
  
  for (const provider of Object.keys(KNOWN_MODELS)) {
    results[provider] = await syncModelsForProvider(provider);
  }
  
  return results;
}

export function getModelStats(): { totalKnown: number; byProvider: Record<string, number>; byType: Record<string, number> } {
  const byProvider: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let totalKnown = 0;
  
  for (const [provider, models] of Object.entries(KNOWN_MODELS)) {
    byProvider[provider] = models.length;
    totalKnown += models.length;
    
    for (const model of models) {
      byType[model.type] = (byType[model.type] || 0) + 1;
    }
  }
  
  return { totalKnown, byProvider, byType };
}
