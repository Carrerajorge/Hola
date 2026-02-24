import { describe, it, expect } from 'vitest';
import { definePlugin, validatePlugin } from '../plugins/pluginSDK';

describe('definePlugin', () => {
  it('should create a valid plugin definition', () => {
    const plugin = definePlugin({
      id: 'my-plugin',
      version: '1.0.0',
      title: 'My Plugin',
      hooks: {
        session_start: async () => {},
      },
    });
    expect(plugin.id).toBe('my-plugin');
    expect(plugin.version).toBe('1.0.0');
  });
});

describe('validatePlugin', () => {
  it('should accept valid plugin', () => {
    const result = validatePlugin({ id: 'test', version: '1.0.0' });
    expect(result.valid).toBe(true);
  });

  it('should reject plugin without id', () => {
    const result = validatePlugin({} as any);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Plugin must have an id');
  });

  it('should reject plugin with invalid hook point', () => {
    const result = validatePlugin({ id: 'test', hooks: { invalid_hook: () => {} } } as any);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid hook point');
  });
});
