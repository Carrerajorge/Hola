/**
 * Rendering Engines - Barrel Export
 * All rendering engine components
 */

// React Three Fiber (3D)
export { R3FEngine } from './r3f-engine';
export type { R3FEngineProps, R3FEngineRef } from './r3f-engine';

// PixiJS (2D WebGL)
export { PixiEngine } from './pixi-engine';
export type { PixiEngineProps, PixiEngineRef } from './pixi-engine';

// Fabric.js (Canvas editing)
export { FabricEngine } from './fabric-engine';
export type { FabricEngineProps, FabricEngineRef } from './fabric-engine';

// Rough.js (Hand-drawn SVG)
export { RoughEngine } from './rough-engine';
export type { RoughEngineProps, RoughEngineRef } from './rough-engine';

// Lottie (Animations)
export { LottieEngine, BUILT_IN_ANIMATIONS } from './lottie-engine';
export type { LottieEngineProps, LottieEngineRef, BuiltInAnimation } from './lottie-engine';

// React Spring (Physics animations)
export {
  SpringEngine,
  AnimatedCard,
  AnimatedList,
  AnimatedCounter,
  AnimatedProgress,
  AnimatedPresence,
  MorphingShape,
  SPRING_PRESETS,
} from './spring-engine';
export type { SpringEngineProps } from './spring-engine';

// ReactFlow (Node diagrams)
export { ReactFlowEngine } from './reactflow-engine';
export type { ReactFlowEngineProps, ReactFlowEngineRef } from './reactflow-engine';

// Globe (3D Globe)
export { GlobeEngine } from './globe-engine';
export type { GlobeEngineProps, GlobeEngineRef } from './globe-engine';
