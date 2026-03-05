/**
 * Enhanced Rendering Capabilities Detection
 * Detects browser capabilities for optimal engine selection
 */

import type { RenderingCapabilities, RenderCategory, RenderEngineType } from '../types';

let cachedCapabilities: RenderingCapabilities | null = null;

export function detectRenderingCapabilities(): RenderingCapabilities {
  if (cachedCapabilities) return cachedCapabilities;

  const caps: RenderingCapabilities = {
    webgl: false,
    webgl2: false,
    webgpu: false,
    offscreenCanvas: false,
    svg: false,
    sharedArrayBuffer: false,
    maxTextureSize: 0,
    devicePixelRatio: 1,
    gpuTier: 'unknown',
    preferredEngine: 'rough',
  };

  if (typeof window === 'undefined' || typeof document === 'undefined') {
    cachedCapabilities = caps;
    return caps;
  }

  // Device pixel ratio
  caps.devicePixelRatio = window.devicePixelRatio || 1;

  // SVG support
  caps.svg = !!document.createElementNS &&
    !!document.createElementNS('http://www.w3.org/2000/svg', 'svg').createSVGRect;

  // OffscreenCanvas
  caps.offscreenCanvas = typeof OffscreenCanvas !== 'undefined';

  // SharedArrayBuffer
  caps.sharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

  // WebGL detection
  try {
    const canvas = document.createElement('canvas');
    const gl2 = canvas.getContext('webgl2');
    if (gl2) {
      caps.webgl2 = true;
      caps.webgl = true;
      caps.maxTextureSize = gl2.getParameter(gl2.MAX_TEXTURE_SIZE);
    } else {
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (gl) {
        caps.webgl = true;
        caps.maxTextureSize = (gl as WebGLRenderingContext).getParameter(
          (gl as WebGLRenderingContext).MAX_TEXTURE_SIZE
        );
      }
    }
  } catch {
    // WebGL not available
  }

  // WebGPU detection
  if ('gpu' in navigator) {
    caps.webgpu = true;
  }

  // GPU tier estimation
  if (caps.webgl2 && caps.maxTextureSize >= 16384) {
    caps.gpuTier = 'high';
  } else if (caps.webgl && caps.maxTextureSize >= 8192) {
    caps.gpuTier = 'mid';
  } else if (caps.webgl) {
    caps.gpuTier = 'low';
  }

  // Preferred engine
  if (caps.gpuTier === 'high') {
    caps.preferredEngine = 'three-r3f';
  } else if (caps.webgl) {
    caps.preferredEngine = 'pixi';
  } else if (caps.svg) {
    caps.preferredEngine = 'rough';
  } else {
    caps.preferredEngine = 'fabric';
  }

  cachedCapabilities = caps;
  return caps;
}

export function resetCapabilitiesCache(): void {
  cachedCapabilities = null;
}

/**
 * Get recommended engine for a render category based on capabilities
 */
export function getRecommendedEngine(
  category: RenderCategory,
  capabilities?: RenderingCapabilities
): RenderEngineType {
  const caps = capabilities || detectRenderingCapabilities();

  const recommendations: Record<RenderCategory, RenderEngineType[]> = {
    '3d': ['three-r3f', 'globe'],
    '2d-canvas': caps.webgl ? ['pixi', 'fabric', 'konva'] : ['fabric', 'konva'],
    'svg': ['rough', 'd3-enhanced'],
    'animation': ['lottie', 'react-spring'],
    'diagram': ['reactflow', 'mermaid'],
    'chart': ['echarts', 'recharts', 'd3-enhanced'],
    'globe': caps.webgl ? ['globe', 'three-r3f'] : ['d3-enhanced'],
  };

  const engines = recommendations[category] || ['rough'];

  // Filter based on capabilities
  for (const engine of engines) {
    if (engine === 'three-r3f' || engine === 'pixi' || engine === 'globe') {
      if (caps.webgl) return engine;
    } else {
      return engine;
    }
  }

  return 'rough'; // Ultimate fallback
}

/**
 * Check if a specific engine is supported
 */
export function isEngineSupported(
  engine: RenderEngineType,
  capabilities?: RenderingCapabilities
): boolean {
  const caps = capabilities || detectRenderingCapabilities();
  const webglEngines: RenderEngineType[] = ['three-r3f', 'pixi', 'globe'];
  if (webglEngines.includes(engine)) return caps.webgl;
  return true;
}
