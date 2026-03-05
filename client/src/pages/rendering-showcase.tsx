/**
 * Rendering Showcase Page
 * Demonstrates all rendering engines available in the platform
 */

import React, { Suspense, lazy, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import type { RenderEngineType } from '@/lib/rendering/types';
import { ENGINE_REGISTRY } from '@/lib/rendering/types';
import { useRenderingCapabilities } from '@/lib/rendering/hooks/useRenderingCapabilities';
import { isEngineSupported } from '@/lib/rendering/utils/capabilities';

// Lazy load all engines
const R3FEngine = lazy(() => import('@/lib/rendering/engines/r3f-engine').then(m => ({ default: m.R3FEngine })));
const PixiEngine = lazy(() => import('@/lib/rendering/engines/pixi-engine').then(m => ({ default: m.PixiEngine })));
const FabricEngine = lazy(() => import('@/lib/rendering/engines/fabric-engine').then(m => ({ default: m.FabricEngine })));
const RoughEngine = lazy(() => import('@/lib/rendering/engines/rough-engine').then(m => ({ default: m.RoughEngine })));
const LottieEngine = lazy(() => import('@/lib/rendering/engines/lottie-engine').then(m => ({ default: m.LottieEngine })));
const SpringEngine = lazy(() => import('@/lib/rendering/engines/spring-engine').then(m => ({ default: m.SpringEngine })));
const ReactFlowEngine = lazy(() => import('@/lib/rendering/engines/reactflow-engine').then(m => ({ default: m.ReactFlowEngine })));
const GlobeEngine = lazy(() => import('@/lib/rendering/engines/globe-engine').then(m => ({ default: m.GlobeEngine })));

// ============================================
// SHOWCASE ENGINE OPTIONS
// ============================================

const SHOWCASE_ENGINES: Array<{
  type: RenderEngineType;
  title: string;
  description: string;
  category: string;
  color: string;
}> = [
  {
    type: 'three-r3f',
    title: 'React Three Fiber',
    description: '3D scenes with Three.js — orbit controls, materials, lighting, particles',
    category: '3D',
    color: '#6366f1',
  },
  {
    type: 'pixi',
    title: 'PixiJS',
    description: 'High-performance 2D WebGL — particle systems, sprite networks',
    category: '2D WebGL',
    color: '#ec4899',
  },
  {
    type: 'fabric',
    title: 'Fabric.js',
    description: 'Interactive canvas editor — drag, resize, rotate objects, free drawing',
    category: 'Canvas',
    color: '#10b981',
  },
  {
    type: 'rough',
    title: 'Rough.js',
    description: 'Hand-drawn style SVG graphics — sketchy, organic aesthetics',
    category: 'SVG',
    color: '#f59e0b',
  },
  {
    type: 'lottie',
    title: 'Lottie',
    description: 'After Effects animations — smooth vector animations for the web',
    category: 'Animation',
    color: '#06b6d4',
  },
  {
    type: 'react-spring',
    title: 'React Spring',
    description: 'Physics-based animations — springs, trails, transitions, morphing',
    category: 'Animation',
    color: '#a855f7',
  },
  {
    type: 'reactflow',
    title: 'ReactFlow',
    description: 'Node-based diagrams — flowcharts, pipelines, interactive graphs',
    category: 'Diagram',
    color: '#f97316',
  },
  {
    type: 'globe',
    title: 'Globe.gl',
    description: '3D Globe — geospatial data, arcs, points, atmospheric effects',
    category: 'Globe',
    color: '#14b8a6',
  },
];

// ============================================
// ENGINE RENDERER
// ============================================

function EngineRenderer({ type }: { type: RenderEngineType }) {
  const fallback = (
    <div className="flex items-center justify-center w-full h-full min-h-[400px] bg-[#1e1e2e] rounded-lg">
      <Loader2 className="w-8 h-8 animate-spin text-indigo-400" />
    </div>
  );

  return (
    <Suspense fallback={fallback}>
      {type === 'three-r3f' && <R3FEngine height={450} />}
      {type === 'pixi' && <PixiEngine width={800} height={450} />}
      {type === 'fabric' && <FabricEngine width={800} height={450} />}
      {type === 'rough' && <RoughEngine width={800} height={450} />}
      {type === 'lottie' && <LottieEngine preset="pulse" width={400} height={400} />}
      {type === 'react-spring' && <SpringEngine height={450} />}
      {type === 'reactflow' && <ReactFlowEngine height={450} />}
      {type === 'globe' && <GlobeEngine width={600} height={500} />}
    </Suspense>
  );
}

// ============================================
// CAPABILITIES PANEL
// ============================================

function CapabilitiesPanel() {
  const caps = useRenderingCapabilities();

  const items = [
    { label: 'WebGL', supported: caps.webgl },
    { label: 'WebGL 2', supported: caps.webgl2 },
    { label: 'WebGPU', supported: caps.webgpu },
    { label: 'OffscreenCanvas', supported: caps.offscreenCanvas },
    { label: 'SVG', supported: caps.svg },
    { label: 'SharedArrayBuffer', supported: caps.sharedArrayBuffer },
  ];

  return (
    <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl p-6 mb-8">
      <h2 className="text-lg font-semibold text-white mb-4">Browser Rendering Capabilities</h2>
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        {items.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-2 bg-[#12121f] rounded-lg px-3 py-2"
          >
            <div
              className={`w-2.5 h-2.5 rounded-full ${
                item.supported ? 'bg-green-400' : 'bg-red-400'
              }`}
            />
            <span className="text-sm text-gray-300">{item.label}</span>
          </div>
        ))}
      </div>
      <div className="mt-4 flex gap-6 text-sm text-gray-400">
        <span>GPU Tier: <strong className="text-white">{caps.gpuTier}</strong></span>
        <span>Max Texture: <strong className="text-white">{caps.maxTextureSize}px</strong></span>
        <span>DPR: <strong className="text-white">{caps.devicePixelRatio.toFixed(1)}</strong></span>
        <span>Preferred: <strong className="text-indigo-400">{caps.preferredEngine}</strong></span>
      </div>
    </div>
  );
}

// ============================================
// MAIN SHOWCASE PAGE
// ============================================

export default function RenderingShowcase() {
  const [activeEngine, setActiveEngine] = useState<RenderEngineType>('three-r3f');
  const caps = useRenderingCapabilities();

  const activeInfo = SHOWCASE_ENGINES.find((e) => e.type === activeEngine)!;

  return (
    <div className="min-h-screen bg-[#0f0f1a] text-white">
      {/* Header */}
      <div className="border-b border-[#2d2d44] bg-[#12121f]">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <h1 className="text-3xl font-bold bg-gradient-to-r from-indigo-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent">
            Rendering Engine Showcase
          </h1>
          <p className="text-gray-400 mt-2">
            8 rendering engines powering the visual layer of the platform
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {/* Capabilities */}
        <CapabilitiesPanel />

        {/* Engine Selector */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
          {SHOWCASE_ENGINES.map((engine) => {
            const supported = isEngineSupported(engine.type, caps);
            const isActive = activeEngine === engine.type;

            return (
              <button
                key={engine.type}
                onClick={() => supported && setActiveEngine(engine.type)}
                disabled={!supported}
                className={`
                  relative p-4 rounded-xl border transition-all duration-200 text-left
                  ${isActive
                    ? 'border-2 shadow-lg'
                    : supported
                      ? 'border-[#2d2d44] hover:border-[#4d4d64] bg-[#1a1a2e]'
                      : 'border-[#1d1d34] bg-[#12121f] opacity-50 cursor-not-allowed'
                  }
                `}
                style={isActive ? {
                  borderColor: engine.color,
                  backgroundColor: `${engine.color}10`,
                  boxShadow: `0 0 20px ${engine.color}15`,
                } : undefined}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span
                    className="text-xs font-semibold px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: `${engine.color}20`,
                      color: engine.color,
                    }}
                  >
                    {engine.category}
                  </span>
                  {!supported && (
                    <span className="text-xs text-red-400">Unsupported</span>
                  )}
                </div>
                <h3 className="font-semibold text-sm text-white mt-2">{engine.title}</h3>
                <p className="text-xs text-gray-400 mt-1 line-clamp-2">{engine.description}</p>
              </button>
            );
          })}
        </div>

        {/* Active Engine Display */}
        <div className="bg-[#1a1a2e] border border-[#2d2d44] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#2d2d44] flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold" style={{ color: activeInfo.color }}>
                {activeInfo.title}
              </h2>
              <p className="text-sm text-gray-400">{activeInfo.description}</p>
            </div>
            <span
              className="text-xs font-bold px-3 py-1 rounded-full"
              style={{
                backgroundColor: `${activeInfo.color}20`,
                color: activeInfo.color,
              }}
            >
              {ENGINE_REGISTRY[activeEngine]?.category.toUpperCase()}
            </span>
          </div>
          <div className="p-4 flex items-center justify-center" style={{ minHeight: '500px' }}>
            <EngineRenderer type={activeEngine} />
          </div>
        </div>

        {/* Engine Grid Summary */}
        <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
          {Object.values(ENGINE_REGISTRY).map((info) => (
            <div
              key={info.type}
              className="bg-[#12121f] border border-[#2d2d44] rounded-lg p-4"
            >
              <div className="text-sm font-semibold text-white">{info.name}</div>
              <div className="text-xs text-gray-500 mt-1">{info.description}</div>
              <div className="flex gap-2 mt-3 flex-wrap">
                {info.supportsExport && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/10 text-green-400">Export</span>
                )}
                {info.supportsInteraction && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/10 text-blue-400">Interactive</span>
                )}
                {info.requiresWebGL && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-400">WebGL</span>
                )}
                {info.lazyLoadable && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-purple-500/10 text-purple-400">Lazy</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
