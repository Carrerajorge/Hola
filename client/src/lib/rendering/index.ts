/**
 * Rendering Library - Main Entry Point
 * Unified rendering system for ILIAGPT/MICHAT PRO
 *
 * Supported engines:
 * - React Three Fiber (3D scenes, models, particles)
 * - PixiJS (2D WebGL, particles, sprites)
 * - Fabric.js (Canvas editing, drawing)
 * - Rough.js (Hand-drawn style SVG)
 * - Lottie (After Effects animations)
 * - React Spring (Physics-based animations)
 * - ReactFlow (Node diagrams, flowcharts)
 * - react-globe.gl (3D Globe visualizations)
 */

// Types
export type {
  RenderEngineType,
  RenderCategory,
  RenderEngineInfo,
  RenderingCapabilities,
  RenderingContextValue,
  UnifiedRenderConfig,
  R3FSceneConfig,
  R3FObjectConfig,
  PixiSceneConfig,
  PixiSpriteConfig,
  PixiParticleConfig,
  FabricCanvasConfig,
  FabricObjectConfig,
  RoughDrawingConfig,
  RoughShapeConfig,
  LottieConfig,
  SpringAnimationConfig,
  FlowDiagramConfig,
  FlowNodeConfig,
  FlowEdgeConfig,
  GlobeConfig,
  GlobePointConfig,
  GlobeArcConfig,
  GlobePolygonConfig,
  GlobeLabelConfig,
} from './types';

export { ENGINE_REGISTRY } from './types';

// Context
export { RenderingProvider, useRenderingContext, RenderingContext } from './RenderingContext';

// Hooks
export { useRenderingCapabilities } from './hooks/useRenderingCapabilities';
export { useRenderEngine } from './hooks/useRenderEngine';
export { useAnimationFrame } from './hooks/useAnimationFrame';

// Utils
export {
  detectRenderingCapabilities,
  getRecommendedEngine,
  isEngineSupported,
  resetCapabilitiesCache,
} from './utils/capabilities';

// Orchestrator
export {
  RenderingOrchestrator,
  Render3D,
  Render2D,
  RenderCanvas,
  RenderSketch,
  RenderAnimation,
  RenderFlow,
  RenderGlobe,
} from './RenderingOrchestrator';

// Engines (direct access)
export {
  R3FEngine,
  PixiEngine,
  FabricEngine,
  RoughEngine,
  LottieEngine,
  SpringEngine,
  ReactFlowEngine,
  GlobeEngine,
  BUILT_IN_ANIMATIONS,
  SPRING_PRESETS,
  AnimatedCard,
  AnimatedList,
  AnimatedCounter,
  AnimatedProgress,
  AnimatedPresence,
  MorphingShape,
} from './engines';
