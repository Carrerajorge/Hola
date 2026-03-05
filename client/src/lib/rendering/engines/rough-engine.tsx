/**
 * Rough.js SVG Engine
 * Hand-drawn style graphics rendering
 */

import React, { useRef, useEffect, forwardRef, useImperativeHandle, useMemo } from 'react';
import rough from 'roughjs';
import type { RoughDrawingConfig, RoughShapeConfig } from '../types';

export interface RoughEngineProps {
  config?: RoughDrawingConfig;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  onReady?: () => void;
}

export interface RoughEngineRef {
  redraw: () => void;
  toSVG: () => string;
  toDataURL: () => Promise<string>;
}

export const RoughEngine = forwardRef<RoughEngineRef, RoughEngineProps>(
  function RoughEngine({ config, width = 800, height = 500, className, style, onReady }, ref) {
    const svgRef = useRef<SVGSVGElement>(null);

    const drawShapes = useMemo(() => {
      return (svgElement: SVGSVGElement) => {
        // Clear existing children (except defs)
        const children = Array.from(svgElement.children);
        children.forEach((child) => {
          if (child.tagName !== 'defs') {
            svgElement.removeChild(child);
          }
        });

        const rc = rough.svg(svgElement);
        const shapes = config?.shapes || getDefaultShapes(width, height);

        for (const shape of shapes) {
          const opts = {
            roughness: shape.options?.roughness ?? 1.5,
            bowing: shape.options?.bowing ?? 1,
            stroke: shape.options?.stroke || '#e2e8f0',
            strokeWidth: shape.options?.strokeWidth || 2,
            fill: shape.options?.fill,
            fillStyle: shape.options?.fillStyle || 'hachure',
            fillWeight: shape.options?.fillWeight,
            hachureAngle: shape.options?.hachureAngle,
            hachureGap: shape.options?.hachureGap,
            seed: shape.options?.seed,
          };

          let node: SVGGElement | null = null;

          switch (shape.type) {
            case 'line':
              node = rc.line(
                shape.x || 0,
                shape.y || 0,
                shape.x2 || 100,
                shape.y2 || 100,
                opts
              );
              break;
            case 'rectangle':
              node = rc.rectangle(
                shape.x || 0,
                shape.y || 0,
                shape.width || 100,
                shape.height || 80,
                opts
              );
              break;
            case 'circle':
              node = rc.circle(
                shape.x || 50,
                shape.y || 50,
                (shape.width || 100),
                opts
              );
              break;
            case 'ellipse':
              node = rc.ellipse(
                shape.x || 50,
                shape.y || 50,
                shape.width || 100,
                shape.height || 60,
                opts
              );
              break;
            case 'polygon':
              if (shape.points) {
                node = rc.polygon(shape.points, opts);
              }
              break;
            case 'path':
              if (shape.path) {
                node = rc.path(shape.path, opts);
              }
              break;
            case 'arc':
              node = rc.arc(
                shape.x || 50,
                shape.y || 50,
                shape.width || 100,
                shape.height || 100,
                0,
                Math.PI * 2,
                false,
                opts
              );
              break;
          }

          if (node) {
            svgElement.appendChild(node);
          }
        }
      };
    }, [config, width, height]);

    useEffect(() => {
      if (!svgRef.current) return;
      drawShapes(svgRef.current);
      onReady?.();
    }, [drawShapes, onReady]);

    useImperativeHandle(ref, () => ({
      redraw: () => {
        if (svgRef.current) drawShapes(svgRef.current);
      },
      toSVG: () => {
        if (svgRef.current) return svgRef.current.outerHTML;
        return '';
      },
      toDataURL: async () => {
        if (!svgRef.current) return '';
        const svgData = new XMLSerializer().serializeToString(svgRef.current);
        const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        return new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.fillStyle = config?.background || '#1e1e2e';
              ctx.fillRect(0, 0, width, height);
              ctx.drawImage(img, 0, 0);
            }
            URL.revokeObjectURL(url);
            resolve(canvas.toDataURL('image/png'));
          };
          img.src = url;
        });
      },
    }));

    return (
      <div
        className={className}
        style={{
          width,
          height,
          overflow: 'hidden',
          borderRadius: '8px',
          position: 'relative',
          backgroundColor: config?.background || '#1e1e2e',
          ...style,
        }}
        data-testid="rough-engine"
      >
        <svg
          ref={svgRef}
          width={width}
          height={height}
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <filter id="rough-glow">
              <feGaussianBlur stdDeviation="3" result="coloredBlur" />
              <feMerge>
                <feMergeNode in="coloredBlur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
        </svg>
      </div>
    );
  }
);

function getDefaultShapes(w: number, h: number): RoughShapeConfig[] {
  const cx = w / 2;
  const cy = h / 2;

  return [
    // Title box
    {
      type: 'rectangle',
      x: cx - 180,
      y: 20,
      width: 360,
      height: 50,
      options: {
        stroke: '#6366f1',
        strokeWidth: 2,
        fill: '#6366f1',
        fillStyle: 'cross-hatch',
        roughness: 1.5,
        fillWeight: 0.5,
        hachureGap: 6,
      },
    },
    // Main shapes
    {
      type: 'rectangle',
      x: 40,
      y: 120,
      width: 150,
      height: 110,
      options: {
        stroke: '#ec4899',
        strokeWidth: 2,
        fill: '#ec4899',
        fillStyle: 'hachure',
        roughness: 2,
        fillWeight: 1,
        hachureGap: 4,
      },
    },
    {
      type: 'circle',
      x: cx,
      y: cy,
      width: 120,
      options: {
        stroke: '#06b6d4',
        strokeWidth: 2,
        fill: '#06b6d4',
        fillStyle: 'zigzag',
        roughness: 1.8,
        fillWeight: 0.8,
        hachureGap: 5,
      },
    },
    {
      type: 'ellipse',
      x: w - 140,
      y: 180,
      width: 140,
      height: 90,
      options: {
        stroke: '#10b981',
        strokeWidth: 2,
        fill: '#10b981',
        fillStyle: 'dots',
        roughness: 1.5,
        fillWeight: 2,
        hachureGap: 6,
      },
    },
    // Connecting lines
    {
      type: 'line',
      x: 190,
      y: 175,
      x2: cx - 60,
      y2: cy,
      options: {
        stroke: '#f59e0b',
        strokeWidth: 2,
        roughness: 2,
      },
    },
    {
      type: 'line',
      x: cx + 60,
      y: cy,
      x2: w - 210,
      y2: 180,
      options: {
        stroke: '#f59e0b',
        strokeWidth: 2,
        roughness: 2,
      },
    },
    // Polygon (star-like)
    {
      type: 'polygon',
      points: [
        [cx, h - 140],
        [cx + 40, h - 80],
        [cx + 80, h - 70],
        [cx + 50, h - 40],
        [cx + 60, h - 10],
        [cx, h - 30],
        [cx - 60, h - 10],
        [cx - 50, h - 40],
        [cx - 80, h - 70],
        [cx - 40, h - 80],
      ],
      options: {
        stroke: '#a855f7',
        strokeWidth: 2,
        fill: '#a855f7',
        fillStyle: 'zigzag-line',
        roughness: 1.2,
        fillWeight: 0.6,
        hachureGap: 5,
      },
    },
    // Decorative arcs
    {
      type: 'arc',
      x: 80,
      y: h - 80,
      width: 100,
      height: 100,
      options: {
        stroke: '#f97316',
        strokeWidth: 2,
        roughness: 2,
      },
    },
    {
      type: 'arc',
      x: w - 80,
      y: h - 80,
      width: 100,
      height: 100,
      options: {
        stroke: '#14b8a6',
        strokeWidth: 2,
        roughness: 2,
      },
    },
  ];
}
