/**
 * Rendering Orchestrator
 * Unified component that routes to the correct rendering engine
 * based on configuration and browser capabilities
 */

import React, { Suspense, lazy, useMemo } from 'react';
import { Loader2 } from 'lucide-react';
import type { UnifiedRenderConfig, RenderEngineType } from './types';
import { useRenderEngine } from './hooks/useRenderEngine';

// ============================================
// LAZY-LOADED ENGINE COMPONENTS
// ============================================

const LazyR3FEngine = lazy(() =>
  import('./engines/r3f-engine').then((m) => ({ default: m.R3FEngine }))
);
const LazyPixiEngine = lazy(() =>
  import('./engines/pixi-engine').then((m) => ({ default: m.PixiEngine }))
);
const LazyFabricEngine = lazy(() =>
  import('./engines/fabric-engine').then((m) => ({ default: m.FabricEngine }))
);
const LazyRoughEngine = lazy(() =>
  import('./engines/rough-engine').then((m) => ({ default: m.RoughEngine }))
);
const LazyLottieEngine = lazy(() =>
  import('./engines/lottie-engine').then((m) => ({ default: m.LottieEngine }))
);
const LazySpringEngine = lazy(() =>
  import('./engines/spring-engine').then((m) => ({ default: m.SpringEngine }))
);
const LazyReactFlowEngine = lazy(() =>
  import('./engines/reactflow-engine').then((m) => ({ default: m.ReactFlowEngine }))
);
const LazyGlobeEngine = lazy(() =>
  import('./engines/globe-engine').then((m) => ({ default: m.GlobeEngine }))
);

// ============================================
// LOADING FALLBACK
// ============================================

function EngineLoadingFallback({ engine }: { engine: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        minHeight: '200px',
        backgroundColor: '#1e1e2e',
        borderRadius: '8px',
        color: '#94a3b8',
        gap: '12px',
      }}
    >
      <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
      <span style={{ fontSize: '14px' }}>Loading {engine} engine...</span>
    </div>
  );
}

// ============================================
// ERROR BOUNDARY FALLBACK
// ============================================

function EngineErrorFallback({ engine, error }: { engine: string; error?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
        minHeight: '200px',
        backgroundColor: '#1e1e2e',
        borderRadius: '8px',
        color: '#ef4444',
        gap: '8px',
        padding: '24px',
      }}
    >
      <span style={{ fontSize: '16px', fontWeight: 600 }}>Engine Error</span>
      <span style={{ fontSize: '13px', color: '#94a3b8', textAlign: 'center' }}>
        {error || `Failed to load ${engine} rendering engine`}
      </span>
    </div>
  );
}

// ============================================
// RENDERING ORCHESTRATOR
// ============================================

export interface RenderingOrchestratorProps {
  config: UnifiedRenderConfig;
  onReady?: () => void;
  onError?: (error: Error) => void;
}

export function RenderingOrchestrator({ config, onReady, onError }: RenderingOrchestratorProps) {
  const { activeEngine, isSupported, error } = useRenderEngine({
    engine: config.engine,
    fallback: 'rough',
  });

  const widthNum = typeof config.width === 'number' ? config.width : undefined;
  const heightNum = typeof config.height === 'number' ? config.height : undefined;

  if (!isSupported || error) {
    return <EngineErrorFallback engine={activeEngine} error={error || undefined} />;
  }

  const engineComponent = useMemo(() => {
    switch (activeEngine) {
      case 'three-r3f':
        return (
          <LazyR3FEngine
            config={config.r3f}
            width={config.width}
            height={config.height}
            className={config.className}
            onReady={onReady}
          />
        );
      case 'pixi':
        return (
          <LazyPixiEngine
            config={config.pixi}
            width={widthNum || 800}
            height={heightNum || 600}
            className={config.className}
            onReady={onReady}
          />
        );
      case 'fabric':
        return (
          <LazyFabricEngine
            config={config.fabric}
            width={widthNum || 800}
            height={heightNum || 600}
            className={config.className}
            onReady={onReady}
          />
        );
      case 'rough':
        return (
          <LazyRoughEngine
            config={config.rough}
            width={widthNum || 800}
            height={heightNum || 500}
            className={config.className}
            onReady={onReady}
          />
        );
      case 'lottie':
        return (
          <LazyLottieEngine
            config={config.lottie}
            width={config.width}
            height={config.height}
            className={config.className}
            onReady={onReady}
          />
        );
      case 'react-spring':
        return (
          <LazySpringEngine
            width={config.width}
            height={config.height}
            className={config.className}
          />
        );
      case 'reactflow':
        return (
          <LazyReactFlowEngine
            config={config.flow}
            width={config.width}
            height={config.height}
            className={config.className}
            onReady={onReady}
          />
        );
      case 'globe':
        return (
          <LazyGlobeEngine
            config={config.globe}
            width={widthNum || 600}
            height={heightNum || 600}
            className={config.className}
            onReady={onReady}
          />
        );
      default:
        return <EngineErrorFallback engine={activeEngine} error="Unknown rendering engine" />;
    }
  }, [activeEngine, config, onReady, widthNum, heightNum]);

  return (
    <Suspense fallback={<EngineLoadingFallback engine={activeEngine} />}>
      {engineComponent}
    </Suspense>
  );
}

// ============================================
// QUICK RENDER HELPERS
// ============================================

/** Quickly render a 3D scene */
export function Render3D(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'three-r3f' }} onReady={props.onReady} />;
}

/** Quickly render a 2D PixiJS scene */
export function Render2D(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'pixi' }} onReady={props.onReady} />;
}

/** Quickly render a canvas editor */
export function RenderCanvas(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'fabric' }} onReady={props.onReady} />;
}

/** Quickly render hand-drawn graphics */
export function RenderSketch(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'rough' }} onReady={props.onReady} />;
}

/** Quickly render a Lottie animation */
export function RenderAnimation(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'lottie' }} onReady={props.onReady} />;
}

/** Quickly render a flow diagram */
export function RenderFlow(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'reactflow' }} onReady={props.onReady} />;
}

/** Quickly render a 3D globe */
export function RenderGlobe(props: Omit<UnifiedRenderConfig, 'engine'> & { onReady?: () => void }) {
  return <RenderingOrchestrator config={{ ...props, engine: 'globe' }} onReady={props.onReady} />;
}
