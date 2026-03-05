/**
 * Rendering Library Type Definitions
 * Unified type system for all rendering engines
 */

// ============================================
// CORE RENDERING TYPES
// ============================================

export type RenderEngineType =
  | 'three-r3f'      // React Three Fiber (3D)
  | 'pixi'           // PixiJS (2D WebGL)
  | 'fabric'         // Fabric.js (Canvas editing)
  | 'rough'          // Rough.js (Hand-drawn SVG)
  | 'lottie'         // Lottie (Animations)
  | 'react-spring'   // React Spring (Physics animations)
  | 'reactflow'      // ReactFlow (Node diagrams)
  | 'globe'          // react-globe.gl (3D Globe)
  | 'd3-enhanced'    // D3 enhanced rendering
  | 'echarts'        // ECharts
  | 'recharts'       // Recharts
  | 'konva'          // Konva (Canvas)
  | 'mermaid';       // Mermaid diagrams

export type RenderCategory =
  | '3d'
  | '2d-canvas'
  | 'svg'
  | 'animation'
  | 'diagram'
  | 'chart'
  | 'globe';

export interface RenderEngineInfo {
  type: RenderEngineType;
  category: RenderCategory;
  name: string;
  description: string;
  supportsExport: boolean;
  supportsInteraction: boolean;
  requiresWebGL: boolean;
  lazyLoadable: boolean;
}

// ============================================
// RENDERING CONTEXT
// ============================================

export interface RenderingCapabilities {
  webgl: boolean;
  webgl2: boolean;
  webgpu: boolean;
  offscreenCanvas: boolean;
  svg: boolean;
  sharedArrayBuffer: boolean;
  maxTextureSize: number;
  devicePixelRatio: number;
  gpuTier: 'low' | 'mid' | 'high' | 'unknown';
  preferredEngine: RenderEngineType;
}

export interface RenderingContextValue {
  capabilities: RenderingCapabilities;
  activeEngines: Set<RenderEngineType>;
  registerEngine: (type: RenderEngineType) => void;
  unregisterEngine: (type: RenderEngineType) => void;
  getRecommendedEngine: (category: RenderCategory) => RenderEngineType;
}

// ============================================
// THREE.JS / R3F TYPES
// ============================================

export interface R3FSceneConfig {
  camera?: {
    position?: [number, number, number];
    fov?: number;
    near?: number;
    far?: number;
    type?: 'perspective' | 'orthographic';
  };
  lights?: Array<{
    type: 'ambient' | 'directional' | 'point' | 'spot' | 'hemisphere';
    color?: string;
    intensity?: number;
    position?: [number, number, number];
  }>;
  environment?: 'sunset' | 'dawn' | 'night' | 'warehouse' | 'forest' | 'apartment' | 'studio' | 'city' | 'park' | 'lobby';
  controls?: {
    type: 'orbit' | 'fly' | 'trackball' | 'pointer-lock';
    enableZoom?: boolean;
    enablePan?: boolean;
    enableRotate?: boolean;
    autoRotate?: boolean;
    autoRotateSpeed?: number;
  };
  postProcessing?: {
    bloom?: boolean;
    ssao?: boolean;
    fxaa?: boolean;
  };
  objects?: Array<R3FObjectConfig>;
}

export interface R3FObjectConfig {
  type: 'box' | 'sphere' | 'cylinder' | 'torus' | 'plane' | 'model' | 'text' | 'particles';
  position?: [number, number, number];
  rotation?: [number, number, number];
  scale?: [number, number, number] | number;
  color?: string;
  material?: 'standard' | 'physical' | 'toon' | 'wireframe' | 'glass';
  modelUrl?: string;
  text?: string;
  animate?: {
    rotation?: [number, number, number];
    position?: { amplitude: number; speed: number; axis: 'x' | 'y' | 'z' };
    scale?: { min: number; max: number; speed: number };
  };
}

// ============================================
// PIXI.JS TYPES
// ============================================

export interface PixiSceneConfig {
  width?: number;
  height?: number;
  background?: string | number;
  antialias?: boolean;
  transparent?: boolean;
  resolution?: number;
  sprites?: Array<PixiSpriteConfig>;
  particles?: PixiParticleConfig;
  interactive?: boolean;
}

export interface PixiSpriteConfig {
  id: string;
  texture: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  anchor?: { x: number; y: number };
  tint?: number;
  alpha?: number;
  rotation?: number;
  interactive?: boolean;
}

export interface PixiParticleConfig {
  count: number;
  colors: number[];
  speed: { min: number; max: number };
  size: { min: number; max: number };
  lifetime: { min: number; max: number };
  emitter: { x: number; y: number; width: number; height: number };
}

// ============================================
// FABRIC.JS TYPES
// ============================================

export interface FabricCanvasConfig {
  width?: number;
  height?: number;
  background?: string;
  selection?: boolean;
  freeDrawing?: boolean;
  brushWidth?: number;
  brushColor?: string;
  objects?: Array<FabricObjectConfig>;
}

export interface FabricObjectConfig {
  type: 'rect' | 'circle' | 'triangle' | 'line' | 'path' | 'text' | 'image' | 'group';
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  src?: string;
  selectable?: boolean;
  opacity?: number;
  angle?: number;
}

// ============================================
// ROUGH.JS TYPES
// ============================================

export interface RoughDrawingConfig {
  width?: number;
  height?: number;
  background?: string;
  style?: 'sketchy' | 'clean' | 'bold';
  shapes?: Array<RoughShapeConfig>;
}

export interface RoughShapeConfig {
  type: 'line' | 'rectangle' | 'circle' | 'ellipse' | 'arc' | 'polygon' | 'path';
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  x2?: number;
  y2?: number;
  points?: [number, number][];
  path?: string;
  options?: {
    roughness?: number;
    bowing?: number;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    fillStyle?: 'hachure' | 'solid' | 'zigzag' | 'cross-hatch' | 'dots' | 'dashed' | 'zigzag-line';
    fillWeight?: number;
    hachureAngle?: number;
    hachureGap?: number;
    seed?: number;
  };
}

// ============================================
// LOTTIE TYPES
// ============================================

export interface LottieConfig {
  animationData?: object;
  path?: string;
  loop?: boolean;
  autoplay?: boolean;
  speed?: number;
  direction?: 1 | -1;
  segments?: [number, number];
  renderer?: 'svg' | 'canvas' | 'html';
  style?: React.CSSProperties;
  onComplete?: () => void;
  onLoopComplete?: () => void;
  onEnterFrame?: (frame: number) => void;
}

// ============================================
// REACT SPRING TYPES
// ============================================

export interface SpringAnimationConfig {
  type: 'spring' | 'trail' | 'transition' | 'chain';
  from: Record<string, number | string>;
  to: Record<string, number | string>;
  config?: {
    mass?: number;
    tension?: number;
    friction?: number;
    clamp?: boolean;
    precision?: number;
    velocity?: number;
    duration?: number;
    easing?: string;
  };
  delay?: number;
  loop?: boolean | { reverse?: boolean };
  immediate?: boolean;
}

// ============================================
// REACT FLOW TYPES
// ============================================

export interface FlowDiagramConfig {
  nodes: Array<FlowNodeConfig>;
  edges: Array<FlowEdgeConfig>;
  layout?: 'horizontal' | 'vertical' | 'radial' | 'force';
  fitView?: boolean;
  minimap?: boolean;
  controls?: boolean;
  background?: 'dots' | 'lines' | 'cross' | 'none';
  interactive?: boolean;
  snapToGrid?: boolean;
  snapGrid?: [number, number];
}

export interface FlowNodeConfig {
  id: string;
  type?: 'default' | 'input' | 'output' | 'custom' | 'group';
  data: { label: string; description?: string; icon?: string; color?: string };
  position: { x: number; y: number };
  style?: Record<string, string | number>;
  draggable?: boolean;
  selectable?: boolean;
  parentId?: string;
}

export interface FlowEdgeConfig {
  id: string;
  source: string;
  target: string;
  type?: 'default' | 'straight' | 'step' | 'smoothstep' | 'bezier';
  animated?: boolean;
  label?: string;
  style?: Record<string, string | number>;
  markerEnd?: string;
}

// ============================================
// GLOBE TYPES
// ============================================

export interface GlobeConfig {
  width?: number;
  height?: number;
  globeImageUrl?: string;
  bumpImageUrl?: string;
  backgroundImageUrl?: string;
  points?: Array<GlobePointConfig>;
  arcs?: Array<GlobeArcConfig>;
  polygons?: Array<GlobePolygonConfig>;
  labels?: Array<GlobeLabelConfig>;
  atmosphere?: boolean;
  atmosphereColor?: string;
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  pointOfView?: { lat: number; lng: number; altitude: number };
}

export interface GlobePointConfig {
  lat: number;
  lng: number;
  size?: number;
  color?: string;
  label?: string;
  altitude?: number;
}

export interface GlobeArcConfig {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  color?: string | [string, string];
  altitude?: number;
  stroke?: number;
  dashLength?: number;
  dashGap?: number;
  dashAnimateTime?: number;
}

export interface GlobePolygonConfig {
  coordinates: [number, number][][];
  color?: string;
  altitude?: number;
  sideColor?: string;
  strokeColor?: string;
}

export interface GlobeLabelConfig {
  lat: number;
  lng: number;
  text: string;
  size?: number;
  color?: string;
  altitude?: number;
}

// ============================================
// UNIFIED RENDER CONFIG
// ============================================

export interface UnifiedRenderConfig {
  engine: RenderEngineType;
  width?: number | string;
  height?: number | string;
  className?: string;
  responsive?: boolean;
  // Engine-specific configs
  r3f?: R3FSceneConfig;
  pixi?: PixiSceneConfig;
  fabric?: FabricCanvasConfig;
  rough?: RoughDrawingConfig;
  lottie?: LottieConfig;
  spring?: SpringAnimationConfig;
  flow?: FlowDiagramConfig;
  globe?: GlobeConfig;
}

// ============================================
// ENGINE REGISTRY
// ============================================

export const ENGINE_REGISTRY: Record<RenderEngineType, RenderEngineInfo> = {
  'three-r3f': {
    type: 'three-r3f',
    category: '3d',
    name: 'React Three Fiber',
    description: 'Declarative 3D rendering with Three.js',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: true,
    lazyLoadable: true,
  },
  'pixi': {
    type: 'pixi',
    category: '2d-canvas',
    name: 'PixiJS',
    description: 'High-performance 2D WebGL renderer',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: true,
    lazyLoadable: true,
  },
  'fabric': {
    type: 'fabric',
    category: '2d-canvas',
    name: 'Fabric.js',
    description: 'Interactive canvas object model',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'rough': {
    type: 'rough',
    category: 'svg',
    name: 'Rough.js',
    description: 'Hand-drawn style graphics',
    supportsExport: true,
    supportsInteraction: false,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'lottie': {
    type: 'lottie',
    category: 'animation',
    name: 'Lottie',
    description: 'After Effects animations for the web',
    supportsExport: false,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'react-spring': {
    type: 'react-spring',
    category: 'animation',
    name: 'React Spring',
    description: 'Physics-based animations',
    supportsExport: false,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'reactflow': {
    type: 'reactflow',
    category: 'diagram',
    name: 'ReactFlow',
    description: 'Node-based diagrams and flowcharts',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'globe': {
    type: 'globe',
    category: 'globe',
    name: 'React Globe.gl',
    description: '3D Globe visualizations',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: true,
    lazyLoadable: true,
  },
  'd3-enhanced': {
    type: 'd3-enhanced',
    category: 'chart',
    name: 'D3 Enhanced',
    description: 'Data-driven documents',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'echarts': {
    type: 'echarts',
    category: 'chart',
    name: 'ECharts',
    description: 'Enterprise charting library',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'recharts': {
    type: 'recharts',
    category: 'chart',
    name: 'Recharts',
    description: 'React composable charting',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'konva': {
    type: 'konva',
    category: '2d-canvas',
    name: 'Konva',
    description: '2D Canvas framework',
    supportsExport: true,
    supportsInteraction: true,
    requiresWebGL: false,
    lazyLoadable: true,
  },
  'mermaid': {
    type: 'mermaid',
    category: 'diagram',
    name: 'Mermaid',
    description: 'Markdown-based diagrams',
    supportsExport: true,
    supportsInteraction: false,
    requiresWebGL: false,
    lazyLoadable: true,
  },
};
