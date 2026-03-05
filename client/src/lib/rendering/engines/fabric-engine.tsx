/**
 * Fabric.js Canvas Engine
 * Interactive canvas with object manipulation
 */

import React, { useRef, useEffect, useCallback, forwardRef, useImperativeHandle, useState } from 'react';
import type { FabricCanvasConfig, FabricObjectConfig } from '../types';

export interface FabricEngineProps {
  config?: FabricCanvasConfig;
  width?: number;
  height?: number;
  className?: string;
  style?: React.CSSProperties;
  onReady?: (canvas: any) => void;
  onObjectSelected?: (obj: any) => void;
  onObjectModified?: (obj: any) => void;
}

export interface FabricEngineRef {
  getCanvas: () => any | null;
  addObject: (config: FabricObjectConfig) => void;
  removeSelected: () => void;
  clear: () => void;
  toJSON: () => object;
  loadJSON: (json: object) => void;
  toDataURL: (format?: string) => string;
  toSVG: () => string;
  enableDrawing: (color?: string, width?: number) => void;
  disableDrawing: () => void;
  undo: () => void;
  redo: () => void;
}

export const FabricEngine = forwardRef<FabricEngineRef, FabricEngineProps>(
  function FabricEngine(
    { config, width = 800, height = 600, className, style, onReady, onObjectSelected, onObjectModified },
    ref
  ) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const fabricCanvasRef = useRef<any>(null);
    const historyRef = useRef<string[]>([]);
    const historyIndexRef = useRef(-1);

    const saveHistory = useCallback(() => {
      if (!fabricCanvasRef.current) return;
      const json = JSON.stringify(fabricCanvasRef.current.toJSON());
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      historyRef.current.push(json);
      historyIndexRef.current = historyRef.current.length - 1;
    }, []);

    useImperativeHandle(ref, () => ({
      getCanvas: () => fabricCanvasRef.current,
      addObject: (objConfig: FabricObjectConfig) => {
        addFabricObject(fabricCanvasRef.current, objConfig);
        saveHistory();
      },
      removeSelected: () => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        const active = canvas.getActiveObject();
        if (active) {
          canvas.remove(active);
          canvas.renderAll();
          saveHistory();
        }
      },
      clear: () => {
        fabricCanvasRef.current?.clear();
        saveHistory();
      },
      toJSON: () => fabricCanvasRef.current?.toJSON() || {},
      loadJSON: (json: object) => {
        fabricCanvasRef.current?.loadFromJSON(json);
        saveHistory();
      },
      toDataURL: (format = 'png') =>
        fabricCanvasRef.current?.toDataURL({ format }) || '',
      toSVG: () => fabricCanvasRef.current?.toSVG() || '',
      enableDrawing: (color = '#000000', bWidth = 3) => {
        const canvas = fabricCanvasRef.current;
        if (!canvas) return;
        canvas.isDrawingMode = true;
        canvas.freeDrawingBrush.color = color;
        canvas.freeDrawingBrush.width = bWidth;
      },
      disableDrawing: () => {
        if (fabricCanvasRef.current) {
          fabricCanvasRef.current.isDrawingMode = false;
        }
      },
      undo: () => {
        if (historyIndexRef.current > 0) {
          historyIndexRef.current--;
          fabricCanvasRef.current?.loadFromJSON(
            JSON.parse(historyRef.current[historyIndexRef.current])
          );
        }
      },
      redo: () => {
        if (historyIndexRef.current < historyRef.current.length - 1) {
          historyIndexRef.current++;
          fabricCanvasRef.current?.loadFromJSON(
            JSON.parse(historyRef.current[historyIndexRef.current])
          );
        }
      },
    }));

    useEffect(() => {
      let canvas: any = null;

      const initFabric = async () => {
        if (!canvasRef.current) return;

        const fabricModule = await import('fabric');
        const { Canvas: FabricCanvas } = fabricModule;

        canvas = new FabricCanvas(canvasRef.current, {
          width: config?.width || width,
          height: config?.height || height,
          backgroundColor: config?.background || '#1e1e2e',
          selection: config?.selection ?? true,
          isDrawingMode: config?.freeDrawing ?? false,
        });

        if (config?.freeDrawing && config.brushColor) {
          canvas.freeDrawingBrush.color = config.brushColor;
          canvas.freeDrawingBrush.width = config.brushWidth || 3;
        }

        fabricCanvasRef.current = canvas;

        // Add configured objects
        if (config?.objects) {
          for (const obj of config.objects) {
            addFabricObject(canvas, obj);
          }
        } else {
          createDemoScene(fabricModule, canvas);
        }

        // Event listeners
        canvas.on('selection:created', (e: any) => {
          onObjectSelected?.(e.selected?.[0]);
        });

        canvas.on('object:modified', (e: any) => {
          onObjectModified?.(e.target);
          saveHistory();
        });

        saveHistory();
        onReady?.(canvas);
      };

      initFabric();

      return () => {
        if (canvas) {
          canvas.dispose();
          fabricCanvasRef.current = null;
        }
      };
    }, [config, width, height, onReady, onObjectSelected, onObjectModified, saveHistory]);

    return (
      <div
        className={className}
        style={{
          width,
          height,
          overflow: 'hidden',
          borderRadius: '8px',
          position: 'relative',
          ...style,
        }}
        data-testid="fabric-engine"
      >
        <canvas ref={canvasRef} />
      </div>
    );
  }
);

function addFabricObject(canvas: any, config: FabricObjectConfig) {
  if (!canvas) return;

  // Object creation is async with fabric v6
  import('fabric').then((fabricModule) => {
    let obj: any;
    const baseProps = {
      left: config.left || 50,
      top: config.top || 50,
      fill: config.fill || '#6366f1',
      stroke: config.stroke,
      strokeWidth: config.strokeWidth || 0,
      selectable: config.selectable ?? true,
      opacity: config.opacity ?? 1,
      angle: config.angle || 0,
    };

    switch (config.type) {
      case 'rect':
        obj = new fabricModule.Rect({
          ...baseProps,
          width: config.width || 100,
          height: config.height || 80,
          rx: 8,
          ry: 8,
        });
        break;
      case 'circle':
        obj = new fabricModule.Circle({
          ...baseProps,
          radius: config.radius || 50,
        });
        break;
      case 'triangle':
        obj = new fabricModule.Triangle({
          ...baseProps,
          width: config.width || 100,
          height: config.height || 100,
        });
        break;
      case 'text':
        obj = new fabricModule.Text(config.text || 'Text', {
          ...baseProps,
          fontSize: config.fontSize || 24,
          fontFamily: config.fontFamily || 'Inter, system-ui, sans-serif',
        });
        break;
      case 'line':
        obj = new fabricModule.Line(
          [config.left || 0, config.top || 0, config.width || 200, config.height || 200],
          {
            ...baseProps,
            stroke: config.stroke || '#6366f1',
            strokeWidth: config.strokeWidth || 2,
          }
        );
        break;
      default:
        return;
    }

    if (obj) {
      canvas.add(obj);
      canvas.renderAll();
    }
  });
}

function createDemoScene(fabricModule: any, canvas: any) {
  // Background gradient-like rects
  const gradientRects = [
    { left: 0, top: 0, width: 200, height: 600, fill: '#1a1a2e', opacity: 0.3 },
    { left: 200, top: 0, width: 200, height: 600, fill: '#16213e', opacity: 0.3 },
    { left: 400, top: 0, width: 200, height: 600, fill: '#0f3460', opacity: 0.3 },
    { left: 600, top: 0, width: 200, height: 600, fill: '#533483', opacity: 0.3 },
  ];

  gradientRects.forEach((props) => {
    const rect = new fabricModule.Rect({
      ...props,
      selectable: false,
      evented: false,
    });
    canvas.add(rect);
  });

  // Decorative shapes
  const shapes = [
    new fabricModule.Rect({
      left: 100, top: 100, width: 120, height: 90, fill: '#6366f1',
      rx: 12, ry: 12, opacity: 0.9, shadow: 'rgba(99,102,241,0.4) 0 4 12',
    }),
    new fabricModule.Circle({
      left: 350, top: 80, radius: 55, fill: '#ec4899',
      opacity: 0.9, shadow: 'rgba(236,72,153,0.4) 0 4 12',
    }),
    new fabricModule.Triangle({
      left: 550, top: 120, width: 100, height: 100, fill: '#06b6d4',
      opacity: 0.9, shadow: 'rgba(6,182,212,0.4) 0 4 12',
    }),
    new fabricModule.Rect({
      left: 200, top: 320, width: 160, height: 70, fill: '#10b981',
      rx: 35, ry: 35, opacity: 0.9, shadow: 'rgba(16,185,129,0.4) 0 4 12',
    }),
    new fabricModule.Circle({
      left: 500, top: 350, radius: 40, fill: '#f59e0b',
      opacity: 0.9, shadow: 'rgba(245,158,11,0.4) 0 4 12',
    }),
  ];

  shapes.forEach((shape) => canvas.add(shape));

  // Title
  const title = new fabricModule.Text('Fabric.js Canvas Editor', {
    left: 200, top: 20,
    fontSize: 22, fontFamily: 'Inter, system-ui, sans-serif',
    fontWeight: 'bold', fill: '#ffffff',
    selectable: false,
  });
  canvas.add(title);

  const subtitle = new fabricModule.Text('Drag, resize & rotate objects', {
    left: 250, top: 50,
    fontSize: 14, fontFamily: 'Inter, system-ui, sans-serif',
    fill: '#94a3b8', selectable: false,
  });
  canvas.add(subtitle);

  canvas.renderAll();
}
