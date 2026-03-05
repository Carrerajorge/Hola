/**
 * Rendering Capabilities & Engine Registry Tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  detectRenderingCapabilities,
  resetCapabilitiesCache,
  getRecommendedEngine,
  isEngineSupported,
} from '../../client/src/lib/rendering/utils/capabilities';
import { ENGINE_REGISTRY } from '../../client/src/lib/rendering/types';
import type { RenderingCapabilities, RenderCategory } from '../../client/src/lib/rendering/types';

describe('Rendering Capabilities', () => {
  beforeEach(() => {
    resetCapabilitiesCache();
  });

  it('should detect capabilities in non-browser environment', () => {
    const caps = detectRenderingCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.webgl).toBe('boolean');
    expect(typeof caps.webgl2).toBe('boolean');
    expect(typeof caps.svg).toBe('boolean');
    expect(typeof caps.offscreenCanvas).toBe('boolean');
    expect(typeof caps.sharedArrayBuffer).toBe('boolean');
    expect(typeof caps.devicePixelRatio).toBe('number');
    expect(['low', 'mid', 'high', 'unknown']).toContain(caps.gpuTier);
  });

  it('should cache capabilities after first detection', () => {
    const caps1 = detectRenderingCapabilities();
    const caps2 = detectRenderingCapabilities();
    expect(caps1).toBe(caps2); // Same reference
  });

  it('should reset cache properly', () => {
    const caps1 = detectRenderingCapabilities();
    resetCapabilitiesCache();
    const caps2 = detectRenderingCapabilities();
    expect(caps1).not.toBe(caps2); // Different reference after reset
    expect(caps1).toEqual(caps2); // Same values
  });
});

describe('Engine Registry', () => {
  it('should contain all expected engines', () => {
    const expectedEngines = [
      'three-r3f', 'pixi', 'fabric', 'rough', 'lottie',
      'react-spring', 'reactflow', 'globe', 'd3-enhanced',
      'echarts', 'recharts', 'konva', 'mermaid',
    ];

    for (const engine of expectedEngines) {
      expect(ENGINE_REGISTRY[engine as keyof typeof ENGINE_REGISTRY]).toBeDefined();
    }
  });

  it('should have correct structure for each engine', () => {
    for (const [key, info] of Object.entries(ENGINE_REGISTRY)) {
      expect(info.type).toBe(key);
      expect(typeof info.name).toBe('string');
      expect(typeof info.description).toBe('string');
      expect(typeof info.supportsExport).toBe('boolean');
      expect(typeof info.supportsInteraction).toBe('boolean');
      expect(typeof info.requiresWebGL).toBe('boolean');
      expect(typeof info.lazyLoadable).toBe('boolean');
      expect(['3d', '2d-canvas', 'svg', 'animation', 'diagram', 'chart', 'globe']).toContain(info.category);
    }
  });

  it('should mark WebGL-requiring engines correctly', () => {
    expect(ENGINE_REGISTRY['three-r3f'].requiresWebGL).toBe(true);
    expect(ENGINE_REGISTRY['pixi'].requiresWebGL).toBe(true);
    expect(ENGINE_REGISTRY['globe'].requiresWebGL).toBe(true);
    expect(ENGINE_REGISTRY['fabric'].requiresWebGL).toBe(false);
    expect(ENGINE_REGISTRY['rough'].requiresWebGL).toBe(false);
    expect(ENGINE_REGISTRY['lottie'].requiresWebGL).toBe(false);
    expect(ENGINE_REGISTRY['reactflow'].requiresWebGL).toBe(false);
  });
});

describe('getRecommendedEngine', () => {
  const highCaps: RenderingCapabilities = {
    webgl: true, webgl2: true, webgpu: false, offscreenCanvas: true,
    svg: true, sharedArrayBuffer: true, maxTextureSize: 16384,
    devicePixelRatio: 2, gpuTier: 'high', preferredEngine: 'three-r3f',
  };

  const lowCaps: RenderingCapabilities = {
    webgl: false, webgl2: false, webgpu: false, offscreenCanvas: false,
    svg: true, sharedArrayBuffer: false, maxTextureSize: 0,
    devicePixelRatio: 1, gpuTier: 'unknown', preferredEngine: 'rough',
  };

  it('should recommend 3D engines when WebGL is available', () => {
    const engine = getRecommendedEngine('3d', highCaps);
    expect(engine).toBe('three-r3f');
  });

  it('should recommend pixi for 2d-canvas when WebGL is available', () => {
    const engine = getRecommendedEngine('2d-canvas', highCaps);
    expect(engine).toBe('pixi');
  });

  it('should recommend fabric for 2d-canvas without WebGL', () => {
    const engine = getRecommendedEngine('2d-canvas', lowCaps);
    expect(engine).toBe('fabric');
  });

  it('should recommend rough for svg', () => {
    const engine = getRecommendedEngine('svg', highCaps);
    expect(engine).toBe('rough');
  });

  it('should recommend lottie for animations', () => {
    const engine = getRecommendedEngine('animation', highCaps);
    expect(engine).toBe('lottie');
  });

  it('should recommend reactflow for diagrams', () => {
    const engine = getRecommendedEngine('diagram', highCaps);
    expect(engine).toBe('reactflow');
  });

  it('should recommend echarts for charts', () => {
    const engine = getRecommendedEngine('chart', highCaps);
    expect(engine).toBe('echarts');
  });

  it('should recommend globe for globe category with WebGL', () => {
    const engine = getRecommendedEngine('globe', highCaps);
    expect(engine).toBe('globe');
  });

  it('should fallback for globe category without WebGL', () => {
    const engine = getRecommendedEngine('globe', lowCaps);
    expect(engine).toBe('d3-enhanced');
  });
});

describe('isEngineSupported', () => {
  const withWebGL: RenderingCapabilities = {
    webgl: true, webgl2: true, webgpu: false, offscreenCanvas: true,
    svg: true, sharedArrayBuffer: false, maxTextureSize: 8192,
    devicePixelRatio: 1, gpuTier: 'mid', preferredEngine: 'pixi',
  };

  const withoutWebGL: RenderingCapabilities = {
    webgl: false, webgl2: false, webgpu: false, offscreenCanvas: false,
    svg: true, sharedArrayBuffer: false, maxTextureSize: 0,
    devicePixelRatio: 1, gpuTier: 'unknown', preferredEngine: 'rough',
  };

  it('should report WebGL engines as supported with WebGL', () => {
    expect(isEngineSupported('three-r3f', withWebGL)).toBe(true);
    expect(isEngineSupported('pixi', withWebGL)).toBe(true);
    expect(isEngineSupported('globe', withWebGL)).toBe(true);
  });

  it('should report WebGL engines as unsupported without WebGL', () => {
    expect(isEngineSupported('three-r3f', withoutWebGL)).toBe(false);
    expect(isEngineSupported('pixi', withoutWebGL)).toBe(false);
    expect(isEngineSupported('globe', withoutWebGL)).toBe(false);
  });

  it('should always support non-WebGL engines', () => {
    expect(isEngineSupported('fabric', withoutWebGL)).toBe(true);
    expect(isEngineSupported('rough', withoutWebGL)).toBe(true);
    expect(isEngineSupported('lottie', withoutWebGL)).toBe(true);
    expect(isEngineSupported('react-spring', withoutWebGL)).toBe(true);
    expect(isEngineSupported('reactflow', withoutWebGL)).toBe(true);
  });
});
