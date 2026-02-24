import type { OpenClawPlugin, HookPoint } from '../types';

const VALID_HOOK_POINTS: HookPoint[] = [
  'before_model_resolve',
  'before_prompt_build',
  'before_tool_call',
  'after_tool_call',
  'agent_end',
  'message_received',
  'message_sent',
  'session_start',
  'session_end',
  'gateway_start',
  'gateway_stop',
  'error',
];

export function definePlugin(definition: OpenClawPlugin): OpenClawPlugin {
  return { ...definition };
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export function validatePlugin(plugin: unknown): ValidationResult {
  const errors: string[] = [];
  const p = plugin as Record<string, unknown>;

  if (!p || typeof p !== 'object') {
    return { valid: false, errors: ['Plugin must be an object'] };
  }

  if (!p.id || typeof p.id !== 'string') {
    errors.push('Plugin must have an id');
  }

  if (p.hooks && typeof p.hooks === 'object') {
    for (const key of Object.keys(p.hooks as object)) {
      if (!VALID_HOOK_POINTS.includes(key as HookPoint)) {
        errors.push(`Invalid hook point: ${key}`);
      }
    }
  }

  if (p.tools && typeof p.tools !== 'function') {
    errors.push('Plugin tools must be a function');
  }

  if (p.setup && typeof p.setup !== 'function') {
    errors.push('Plugin setup must be a function');
  }

  if (p.shutdown && typeof p.shutdown !== 'function') {
    errors.push('Plugin shutdown must be a function');
  }

  return { valid: errors.length === 0, errors };
}
