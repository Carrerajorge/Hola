/**
 * Globe Rendering Engine
 * 3D Globe visualizations with react-globe.gl
 */

import React, { useRef, useEffect, forwardRef, useImperativeHandle, useState, useMemo, useCallback } from 'react';
import type { GlobeConfig, GlobePointConfig, GlobeArcConfig } from '../types';

export interface GlobeEngineProps {
  config?: GlobeConfig;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
  onPointClick?: (point: GlobePointConfig) => void;
}

export interface GlobeEngineRef {
  getGlobe: () => any | null;
  pointOfView: (coords: { lat: number; lng: number; altitude: number }) => void;
  takeScreenshot: () => string | null;
}

// Default data points for demo
const DEFAULT_POINTS: GlobePointConfig[] = [
  { lat: 40.7128, lng: -74.006, size: 0.8, color: '#6366f1', label: 'New York' },
  { lat: 51.5074, lng: -0.1278, size: 0.8, color: '#ec4899', label: 'London' },
  { lat: 35.6762, lng: 139.6503, size: 0.8, color: '#06b6d4', label: 'Tokyo' },
  { lat: -33.8688, lng: 151.2093, size: 0.6, color: '#10b981', label: 'Sydney' },
  { lat: 48.8566, lng: 2.3522, size: 0.7, color: '#f59e0b', label: 'Paris' },
  { lat: 19.4326, lng: -99.1332, size: 0.7, color: '#a855f7', label: 'Mexico City' },
  { lat: -23.5505, lng: -46.6333, size: 0.7, color: '#f97316', label: 'São Paulo' },
  { lat: 1.3521, lng: 103.8198, size: 0.6, color: '#14b8a6', label: 'Singapore' },
  { lat: 55.7558, lng: 37.6173, size: 0.6, color: '#e11d48', label: 'Moscow' },
  { lat: 28.6139, lng: 77.209, size: 0.7, color: '#8b5cf6', label: 'New Delhi' },
];

const DEFAULT_ARCS: GlobeArcConfig[] = [
  { startLat: 40.7128, startLng: -74.006, endLat: 51.5074, endLng: -0.1278, color: ['#6366f1', '#ec4899'], stroke: 0.5, dashAnimateTime: 2000 },
  { startLat: 51.5074, startLng: -0.1278, endLat: 35.6762, endLng: 139.6503, color: ['#ec4899', '#06b6d4'], stroke: 0.5, dashAnimateTime: 2500 },
  { startLat: 35.6762, startLng: 139.6503, endLat: -33.8688, endLng: 151.2093, color: ['#06b6d4', '#10b981'], stroke: 0.5, dashAnimateTime: 2000 },
  { startLat: 40.7128, startLng: -74.006, endLat: 19.4326, endLng: -99.1332, color: ['#6366f1', '#a855f7'], stroke: 0.5, dashAnimateTime: 1800 },
  { startLat: 48.8566, startLng: 2.3522, endLat: 28.6139, endLng: 77.209, color: ['#f59e0b', '#8b5cf6'], stroke: 0.5, dashAnimateTime: 2200 },
  { startLat: 19.4326, startLng: -99.1332, endLat: -23.5505, endLng: -46.6333, color: ['#a855f7', '#f97316'], stroke: 0.5, dashAnimateTime: 1500 },
];

export const GlobeEngine = forwardRef<GlobeEngineRef, GlobeEngineProps>(
  function GlobeEngine({ config, width = 600, height = 600, className, style, onReady, onPointClick }, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const globeRef = useRef<any>(null);
    const [GlobeComponent, setGlobeComponent] = useState<any>(null);

    // Load globe component dynamically
    useEffect(() => {
      import('react-globe.gl').then((module) => {
        setGlobeComponent(() => module.default);
      });
    }, []);

    const points = useMemo(() => config?.points || DEFAULT_POINTS, [config?.points]);
    const arcs = useMemo(() => config?.arcs || DEFAULT_ARCS, [config?.arcs]);

    useImperativeHandle(ref, () => ({
      getGlobe: () => globeRef.current,
      pointOfView: (coords) => {
        if (globeRef.current) {
          globeRef.current.pointOfView(coords, 1000);
        }
      },
      takeScreenshot: () => {
        // Globe renders in a canvas we can capture
        const canvas = containerRef.current?.querySelector('canvas');
        return canvas ? canvas.toDataURL('image/png') : null;
      },
    }));

    const handleGlobeReady = useCallback(() => {
      if (globeRef.current && config?.pointOfView) {
        globeRef.current.pointOfView(config.pointOfView, 0);
      }
      if (globeRef.current && (config?.autoRotate ?? true)) {
        globeRef.current.controls().autoRotate = true;
        globeRef.current.controls().autoRotateSpeed = config?.autoRotateSpeed ?? 0.5;
      }
      onReady?.();
    }, [config, onReady]);

    if (!GlobeComponent) {
      return (
        <div
          className={className}
          style={{
            width,
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: '#0a0a1a',
            borderRadius: '8px',
            color: '#94a3b8',
            ...style,
          }}
        >
          Loading globe...
        </div>
      );
    }

    return (
      <div
        ref={containerRef}
        className={className}
        style={{
          width,
          height,
          overflow: 'hidden',
          borderRadius: '8px',
          position: 'relative',
          backgroundColor: '#0a0a1a',
          ...style,
        }}
        data-testid="globe-engine"
      >
        <GlobeComponent
          ref={globeRef}
          width={typeof width === 'number' ? width : 600}
          height={typeof height === 'number' ? height : 600}
          globeImageUrl="//unpkg.com/three-globe/example/img/earth-night.jpg"
          bumpImageUrl="//unpkg.com/three-globe/example/img/earth-topology.png"
          backgroundImageUrl="//unpkg.com/three-globe/example/img/night-sky.png"
          // Points
          pointsData={points}
          pointLat={(d: any) => d.lat}
          pointLng={(d: any) => d.lng}
          pointAltitude={(d: any) => d.altitude || 0.01}
          pointRadius={(d: any) => d.size || 0.5}
          pointColor={(d: any) => d.color || '#6366f1'}
          pointLabel={(d: any) => d.label || ''}
          onPointClick={(point: any) => onPointClick?.(point)}
          // Arcs
          arcsData={arcs}
          arcStartLat={(d: any) => d.startLat}
          arcStartLng={(d: any) => d.startLng}
          arcEndLat={(d: any) => d.endLat}
          arcEndLng={(d: any) => d.endLng}
          arcColor={(d: any) => d.color || '#6366f1'}
          arcStroke={(d: any) => d.stroke || 0.5}
          arcDashLength={0.4}
          arcDashGap={0.2}
          arcDashAnimateTime={(d: any) => d.dashAnimateTime || 2000}
          // Atmosphere
          atmosphereColor={config?.atmosphereColor || '#6366f1'}
          atmosphereAltitude={0.15}
          // Events
          onGlobeReady={handleGlobeReady}
        />
      </div>
    );
  }
);
