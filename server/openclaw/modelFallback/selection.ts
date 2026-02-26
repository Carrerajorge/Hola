import type { ModelRef } from '../types';

const MODEL_ALIASES: Record<string, ModelRef> = {
  best: { provider: 'anthropic', model: 'claude-opus-4-6' },
  fast: { provider: 'google', model: 'gemini-2.0-flash' },
  balanced: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
  cheap: { provider: 'google', model: 'gemini-2.0-flash' },
  code: { provider: 'anthropic', model: 'claude-sonnet-4-6' },
};

const MODEL_NORMALIZATIONS: Record<string, string> = {
  'opus-4.6': 'claude-opus-4-6',
  'opus-4': 'claude-opus-4-6',
  'sonnet-4.6': 'claude-sonnet-4-6',
  'sonnet-4': 'claude-sonnet-4-6',
  'haiku-4.5': 'claude-haiku-4-5-20251001',
  'gpt4o': 'gpt-4o',
  'gpt-4': 'gpt-4o',
  'gemini-pro': 'gemini-2.5-pro-preview-05-06',
  'gemini-flash': 'gemini-2.0-flash',
  'grok': 'grok-4-1-fast-non-reasoning',
  'grok-4': 'grok-4-0709',
  'grok-4.1': 'grok-4-1-fast-non-reasoning',
  'grok-4.1-reasoning': 'grok-4-1-fast-reasoning',
  'grok-fast': 'grok-3-fast',
};

export function parseModelRef(input: string): ModelRef {
  const slashIdx = input.indexOf('/');
  if (slashIdx > 0) {
    return { provider: input.slice(0, slashIdx), model: input.slice(slashIdx + 1) };
  }
  return { provider: 'auto', model: input };
}

export function resolveModelAlias(input: string): ModelRef {
  const lower = input.toLowerCase().trim();
  if (MODEL_ALIASES[lower]) return { ...MODEL_ALIASES[lower] };
  return parseModelRef(input);
}

export function normalizeModelRef(input: string): ModelRef {
  const ref = resolveModelAlias(input);
  const normalized = MODEL_NORMALIZATIONS[ref.model.toLowerCase()];
  if (normalized) ref.model = normalized;
  return ref;
}
