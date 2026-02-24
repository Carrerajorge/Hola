interface ModelInfo {
  id: string;
  provider: string;
  contextWindow: number;
  pricingTier: 'free' | 'cheap' | 'standard' | 'premium';
  capabilities: string[];
}

const CATALOG: ModelInfo[] = [
  { id: 'claude-opus-4-6', provider: 'anthropic', contextWindow: 200000, pricingTier: 'premium', capabilities: ['vision', 'function_calling', 'streaming', 'reasoning'] },
  { id: 'claude-sonnet-4-6', provider: 'anthropic', contextWindow: 200000, pricingTier: 'standard', capabilities: ['vision', 'function_calling', 'streaming', 'reasoning'] },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', contextWindow: 200000, pricingTier: 'cheap', capabilities: ['vision', 'function_calling', 'streaming'] },
  { id: 'gpt-4o', provider: 'openai', contextWindow: 128000, pricingTier: 'standard', capabilities: ['vision', 'function_calling', 'streaming'] },
  { id: 'gpt-4o-mini', provider: 'openai', contextWindow: 128000, pricingTier: 'cheap', capabilities: ['vision', 'function_calling', 'streaming'] },
  { id: 'o3', provider: 'openai', contextWindow: 200000, pricingTier: 'premium', capabilities: ['vision', 'function_calling', 'streaming', 'reasoning'] },
  { id: 'gemini-2.5-pro-preview-05-06', provider: 'google', contextWindow: 1048576, pricingTier: 'standard', capabilities: ['vision', 'function_calling', 'streaming', 'reasoning'] },
  { id: 'gemini-2.0-flash', provider: 'google', contextWindow: 1048576, pricingTier: 'cheap', capabilities: ['vision', 'function_calling', 'streaming'] },
  { id: 'grok-3', provider: 'xai', contextWindow: 131072, pricingTier: 'standard', capabilities: ['function_calling', 'streaming'] },
];

export function getModelInfo(modelId: string): ModelInfo | null {
  return CATALOG.find(m => m.id === modelId) ?? null;
}

export function listModels(filter?: { provider?: string; capability?: string }): ModelInfo[] {
  let models = [...CATALOG];
  if (filter?.provider) models = models.filter(m => m.provider === filter.provider);
  if (filter?.capability) models = models.filter(m => m.capabilities.includes(filter.capability!));
  return models;
}
