/**
 * Rendering Types & Config Validation Tests
 */

import { describe, it, expect } from 'vitest';
import type {
  UnifiedRenderConfig,
  R3FSceneConfig,
  FlowDiagramConfig,
  RoughDrawingConfig,
  GlobeConfig,
  FabricCanvasConfig,
  PixiSceneConfig,
  LottieConfig,
  SpringAnimationConfig,
  RenderEngineType,
  RenderCategory,
} from '../../client/src/lib/rendering/types';
import { ENGINE_REGISTRY } from '../../client/src/lib/rendering/types';

describe('Rendering Types', () => {
  it('should accept valid UnifiedRenderConfig', () => {
    const config: UnifiedRenderConfig = {
      engine: 'three-r3f',
      width: 800,
      height: 600,
      className: 'test-class',
      responsive: true,
    };
    expect(config.engine).toBe('three-r3f');
    expect(config.width).toBe(800);
  });

  it('should accept valid R3FSceneConfig', () => {
    const config: R3FSceneConfig = {
      camera: {
        position: [5, 3, 5],
        fov: 50,
        type: 'perspective',
      },
      lights: [
        { type: 'ambient', intensity: 0.5 },
        { type: 'directional', position: [5, 5, 5], intensity: 1 },
      ],
      environment: 'city',
      controls: {
        type: 'orbit',
        enableZoom: true,
        autoRotate: true,
      },
      objects: [
        { type: 'box', position: [0, 0, 0], color: '#6366f1', material: 'standard' },
        { type: 'sphere', position: [2, 0, 0], scale: 0.5, material: 'glass' },
        { type: 'particles', position: [0, 2, 0] },
      ],
    };
    expect(config.objects).toHaveLength(3);
    expect(config.camera?.fov).toBe(50);
  });

  it('should accept valid FlowDiagramConfig', () => {
    const config: FlowDiagramConfig = {
      nodes: [
        { id: '1', data: { label: 'Start' }, position: { x: 0, y: 0 } },
        { id: '2', type: 'custom', data: { label: 'Process', color: '#6366f1' }, position: { x: 100, y: 100 } },
      ],
      edges: [
        { id: 'e1-2', source: '1', target: '2', animated: true },
      ],
      fitView: true,
      minimap: true,
      background: 'dots',
    };
    expect(config.nodes).toHaveLength(2);
    expect(config.edges).toHaveLength(1);
  });

  it('should accept valid RoughDrawingConfig', () => {
    const config: RoughDrawingConfig = {
      width: 800,
      height: 600,
      background: '#1e1e2e',
      style: 'sketchy',
      shapes: [
        {
          type: 'rectangle',
          x: 10, y: 10, width: 100, height: 80,
          options: { roughness: 2, fill: '#6366f1', fillStyle: 'hachure' },
        },
        { type: 'circle', x: 200, y: 100, width: 60, options: { stroke: '#ec4899' } },
        { type: 'polygon', points: [[10, 10], [100, 50], [50, 100]] },
      ],
    };
    expect(config.shapes).toHaveLength(3);
  });

  it('should accept valid GlobeConfig', () => {
    const config: GlobeConfig = {
      width: 600,
      height: 600,
      points: [
        { lat: 40.7, lng: -74, size: 0.8, color: '#6366f1', label: 'NYC' },
      ],
      arcs: [
        { startLat: 40.7, startLng: -74, endLat: 51.5, endLng: -0.1, color: '#ec4899' },
      ],
      atmosphere: true,
      autoRotate: true,
      autoRotateSpeed: 0.5,
    };
    expect(config.points).toHaveLength(1);
    expect(config.arcs).toHaveLength(1);
  });

  it('should accept valid FabricCanvasConfig', () => {
    const config: FabricCanvasConfig = {
      width: 800,
      height: 600,
      background: '#1e1e2e',
      selection: true,
      freeDrawing: false,
      objects: [
        { type: 'rect', left: 50, top: 50, width: 100, height: 80, fill: '#6366f1' },
        { type: 'circle', left: 200, top: 100, radius: 40, fill: '#ec4899' },
        { type: 'text', text: 'Hello', fontSize: 24, fontFamily: 'Inter' },
      ],
    };
    expect(config.objects).toHaveLength(3);
  });

  it('should have all engine types in registry', () => {
    const allEngineTypes: RenderEngineType[] = [
      'three-r3f', 'pixi', 'fabric', 'rough', 'lottie',
      'react-spring', 'reactflow', 'globe', 'd3-enhanced',
      'echarts', 'recharts', 'konva', 'mermaid',
    ];

    expect(Object.keys(ENGINE_REGISTRY)).toHaveLength(allEngineTypes.length);
    for (const type of allEngineTypes) {
      expect(ENGINE_REGISTRY[type]).toBeDefined();
    }
  });

  it('should have valid categories in registry', () => {
    const validCategories: RenderCategory[] = [
      '3d', '2d-canvas', 'svg', 'animation', 'diagram', 'chart', 'globe',
    ];

    for (const info of Object.values(ENGINE_REGISTRY)) {
      expect(validCategories).toContain(info.category);
    }
  });
});
